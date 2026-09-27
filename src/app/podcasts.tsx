/**
 * The podcasts subscribed to on this phone.
 *
 * A screen of its own and, `embedded`, the Podcasts section of the Explore tab.
 *
 * Everything here is local: the subscriptions live in this profile's own
 * database rather than on a server, because no server the app talks to has
 * podcasts (`api/podcasts.ts` says why). So unlike the radio screen there is
 * nothing to gate on — a Jellyfin profile and an offline profile both have
 * this working list, and the network is only needed to refresh a feed.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  listChannels,
  refreshAll,
  refreshChannel,
  unsubscribe,
  type PodcastChannel,
} from '@/api/podcasts';
import { COVER, coverArtUrl } from '@/api/data';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame, useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { PodcastAddSheet } from '@/components/PodcastAddSheet';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { episodesLabel, useT } from '@/i18n';
import type { Language } from '@/i18n/languages';
import { listPerf } from '@/lib/listPerf';
import { queryClient } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import {
  colors,
  fontSize,
  radius,
  SHEET_MAX_WIDTH,
  spacing,
  themed,
  tracking,
  useTheme,
} from '@/theme';

/** Channels from which the list stops being read at a glance. */
const SEARCH_FROM = 8;

export default function PodcastsScreen() {
  return <PodcastsBrowser />;
}

/** "12 episodes · Ada Lovelace", or whichever half of that there is. */
function channelSubtitle(
  channel: PodcastChannel,
  t: ReturnType<typeof useT>,
  lang: Language,
) {
  const parts: string[] = [];
  if (channel.episodeCount) parts.push(episodesLabel(channel.episodeCount, lang));
  if (channel.author) parts.push(channel.author);
  return parts.join(' · ') || t('No episodes yet');
}

export function PodcastsBrowser({ embedded, actionRef, searchOpen }: BrowserProps) {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const router = useRouter();
  const bottomPad = useScreenBottomPadding();
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  const insets = useSafeAreaInsets();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);

  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<PodcastChannel | null>(null);
  const [removing, setRemoving] = useState<PodcastChannel | null>(null);
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['podcastChannels'],
    queryFn: listChannels,
  });

  // The Home shelf of recent episodes as well: subscribing, dropping a show or
  // reading the feeds again all change what it holds, and it is built from the
  // same rows.
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: ['podcastChannels'] }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['podcastRecentEpisodes'] }),
    );

  /**
   * Reads the subscriptions again, one feed at a time.
   *
   * Not a single request, and not in parallel: a refresh is a request to
   * somebody's server for each show separately, and a wall of them at once is
   * what gets an app rate-limited by a podcast host. `refreshAll` collects
   * the failures rather than stopping at the first, so one dead feed does not
   * leave the rest stale.
   */
  async function refresh() {
    const { failed, total } = await refreshAll();
    await reload();
    if (total > 0 && failed === total) {
      toast(t("Couldn't reach any of your podcast feeds."));
    } else if (failed > 0) {
      toast(t('{n} podcast feeds could not be read.', { n: failed }));
    }
  }

  const channels = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data ?? [];
    return q
      ? all.filter(
          (c) =>
            c.title.toLowerCase().includes(q) || (c.author ?? '').toLowerCase().includes(q),
        )
      : all;
  }, [data, query]);

  // A handful of podcasts is read at a glance, and a search box over three rows
  // is furniture. It appears once the list is long enough to be scanned.
  const showSearch = (data?.length ?? 0) > SEARCH_FROM;
  const boxOpen = useSearchBox(embedded, searchOpen, () => setQuery(''));

  // Embedded, the Explore tab draws this in its own header; the sheet it opens
  // stays down here with the rest of the subscription form.
  useEffect(() => {
    if (actionRef) actionRef.current = () => setAdding(true);
  });

  const addButton = (
    <Pressable hitSlop={10} onPress={() => setAdding(true)} accessibilityLabel={t('Add podcast')}>
      <Icon name="add" size={28} color={colors.text} />
    </Pressable>
  );

  async function confirmRemove() {
    const channel = removing;
    setRemoving(null);
    if (!channel) return;
    try {
      await unsubscribe(channel.id);
      await reload();
      toast(t('Unsubscribed from “{name}”', { name: channel.title }));
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  return (
    <BrowseFrame embedded={embedded}>
      {embedded ? null : (
        <View style={styles.header}>
          <BackChevron />
          <Text style={styles.title}>{t('Podcasts')}</Text>
          {addButton}
        </View>
      )}

      {(embedded ? boxOpen : showSearch) ? (
        <View style={styles.searchBar}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('Find a podcast')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            autoFocus={embedded}
          />
          {query ? (
            <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityLabel={t('Clear')}>
              <Icon name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError ? (
        <Message text={t("Couldn't load your podcasts.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
          {...listPerf}
          keyboardShouldPersistTaps="handled"
          data={channels}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad, paddingHorizontal: listPad },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isFetching}
              onRefresh={() => void refresh()}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }: { item: PodcastChannel }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/podcast/${item.id}`)}
              onLongPress={() => setMenu(item)}
            >
              <Cover
                uri={coverArtUrl(item.imageUrl, COVER.thumb)}
                size={56}
                rounded
                placeholderIcon="headset-outline"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.error ? (
                  <Text style={[styles.rowSub, { color: colors.danger }]} numberOfLines={1}>
                    {t("Couldn't read this feed")}
                  </Text>
                ) : (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {channelSubtitle(item, t, lang)}
                  </Text>
                )}
              </View>
              <Pressable
                hitSlop={8}
                onPress={() => setMenu(item)}
                accessibilityLabel={t('More')}
              >
                <Icon name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
              </Pressable>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="headset-outline"
              title={t('No podcasts')}
              subtitle={t('Tap + to subscribe to a show.')}
            />
          }
        />
      )}

      <PodcastAddSheet
        visible={adding}
        subscribed={(data ?? []).map((c) => c.feedUrl ?? '').filter(Boolean)}
        onCancel={() => setAdding(false)}
        onSubscribed={() => void reload()}
      />

      <Modal
        transparent
        visible={!!menu}
        animationType="fade"
        onRequestClose={() => setMenu(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenu(null)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {menu?.title}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              const channel = menu;
              setMenu(null);
              if (!channel?.feedUrl) return;
              void refreshChannel(channel.feedUrl)
                .then(() => reload())
                .catch(() => toast(t("Couldn't read this feed")));
            }}
          >
            <Icon name="refresh" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Refresh')}</Text>
          </Pressable>
          {menu?.siteUrl ? (
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                const url = menu?.siteUrl;
                setMenu(null);
                if (url) void Linking.openURL(url).catch(() => {});
              }}
            >
              <Icon name="link-outline" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Open website')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              const channel = menu;
              setMenu(null);
              setRemoving(channel);
            }}
          >
            <Icon name="trash-outline" size={24} color={colors.danger} />
            <Text style={[styles.actionText, { color: colors.danger }]}>
              {t('Unsubscribe')}
            </Text>
          </Pressable>
        </View>
      </Modal>

      <Dialog
        visible={!!removing}
        title={t('Unsubscribe')}
        message={t('Remove “{name}” and its episodes from this device?', {
          name: removing?.title ?? '',
        })}
        confirmLabel={t('Unsubscribe')}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </BrowseFrame>
  );
}

const styles = themed((colors) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
  },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  // The box "Your library" has, to the same measurements, which is what every
  // section of Explore now opens.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.md, padding: 0 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
