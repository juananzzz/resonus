/** One podcast and its episodes, played straight from the publisher's files. */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { getChannel, listEpisodes, episodeToSong, refreshChannel, type PodcastEpisode } from '@/api/podcasts';
import { COVER } from '@/api/data';
import { BackButton } from '@/components/BackButton';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { listPerf } from '@/lib/listPerf';
import { queryClient } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, tracking, useTheme } from '@/theme';

/** The date an episode was published, in the app's language. */
function dayLabel(at: number, lang: string): string {
  const d = new Date(at);
  const now = new Date();
  return d.toLocaleDateString(lang, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export default function PodcastScreen() {
  const { coverArtUrl } = useCoverUrls();
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const bottomPad = useScreenBottomPadding();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);
  const [refreshing, setRefreshing] = useState(false);

  const channel = useQuery({
    queryKey: ['podcastChannel', id],
    queryFn: () => getChannel(id),
    enabled: !!id,
  });

  const episodes = useQuery({
    queryKey: ['podcastEpisodes', id],
    queryFn: () => listEpisodes(id),
    enabled: !!id,
  });

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['podcastChannel', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastEpisodes', id] });
    void queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] });
  }, [id]);

  const refresh = useCallback(async () => {
    const feedUrl = channel.data?.feedUrl;
    if (!feedUrl) return;
    setRefreshing(true);
    try {
      await refreshChannel(feedUrl);
      reload();
    } catch {
      toast(t("Couldn't read this feed"));
    } finally {
      setRefreshing(false);
    }
  }, [channel.data?.feedUrl, reload, t, toast]);

  /** The whole playable list, starting at the one tapped. */
  const play = useCallback(
    (list: PodcastEpisode[], from: number) => {
      const ch = channel.data;
      if (!ch) return;
      const playable = list.filter((e) => !!e.url);
      const start = playable.findIndex((e) => e.id === list[from]?.id);
      void playQueue(
        playable.map((e) => episodeToSong(e, ch)),
        start < 0 ? 0 : start,
        ch.title,
        `/podcast/${ch.id}`,
      );
    },
    [channel.data, playQueue],
  );

  if (channel.isLoading || episodes.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (channel.isError || !channel.data) {
    return (
      <View style={styles.center}>
        <BackButton />
        <Message text={t("Couldn't load this podcast.")} onRetry={reload} />
      </View>
    );
  }

  const ch = channel.data;
  const list = episodes.data ?? [];
  const siteUrl = ch.siteUrl;

  return (
    <FlatList
      {...listPerf}
      data={list}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Cover
            uri={coverArtUrl(ch.imageUrl, COVER.card)}
            size={160}
            rounded
            placeholderIcon="headset-outline"
          />
          <Text style={styles.title}>{ch.title}</Text>
          {ch.author ? <Text style={styles.author}>{ch.author}</Text> : null}
          {ch.description ? (
            <Text style={styles.description} numberOfLines={6}>
              {ch.description}
            </Text>
          ) : null}
          {ch.error ? (
            <Text style={styles.error}>
              {t("This podcast's feed could not be read, so these episodes may be out of date.")}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {list.length > 0 ? (
              <Pressable
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.7 }]}
                onPress={() => play(list, 0)}
              >
                <Icon name="play" size={18} color={colors.onAccent} />
                <Text style={styles.primaryText}>{t('Play latest')}</Text>
              </Pressable>
            ) : null}
            {siteUrl ? (
              <Pressable
                style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
                onPress={() => void Linking.openURL(siteUrl).catch(() => {})}
              >
                <Icon name="link-outline" size={18} color={colors.text} />
                <Text style={styles.secondaryText}>{t('Website')}</Text>
              </Pressable>
            ) : null}
          </View>
          {list.length > 0 ? <Text style={styles.sectionTitle}>{t('Episodes')}</Text> : null}
        </View>
      }
      renderItem={({ item, index }: { item: PodcastEpisode; index: number }) => {
        const playing = playingId === item.id;
        return (
          <Pressable
            style={({ pressed }) => [styles.episode, pressed && { opacity: 0.6 }]}
            disabled={!item.url}
            onPress={() => play(list, index)}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.episodeTitle, playing && { color: colors.accent }]}
                numberOfLines={2}
              >
                {item.title || t('Untitled episode')}
              </Text>
              <Text style={styles.episodeSub} numberOfLines={1}>
                {[item.publishedAt ? dayLabel(item.publishedAt, lang) : null, formatDuration(item.duration)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {item.url ? (
              <Icon name="play" size={18} color={playing ? colors.accent : colors.textSecondary} />
            ) : (
              <Text style={styles.unplayable}>{t('No audio available')}</Text>
            )}
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <EmptyState
          icon="headset-outline"
          title={t('No episodes')}
          subtitle={t('Pull down to read the feed again.')}
        />
      }
    />
  );
}

const styles = themed((colors) => ({
  center: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  list: { padding: spacing.lg, gap: spacing.xs },
  header: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  author: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'center' },
  description: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  primaryText: { color: colors.onAccent, fontSize: fontSize.sm, fontWeight: '600' },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  secondaryText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  sectionTitle: {
    alignSelf: 'flex-start',
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginTop: spacing.lg,
  },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  episodeTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  episodeSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  unplayable: { color: colors.textMuted, fontSize: fontSize.xs },
}));
