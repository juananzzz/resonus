/**
 * The podcasts kept on this phone: a screen, and `embedded`, the Podcasts
 * section of Explore. All local (SQLite), so nothing is gated on a server.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  addChannel,
  feedErrorMessage,
  listChannels,
  refreshChannel,
  refreshAll,
  search as searchPodcasts,
  type PodcastChannel,
  type PodcastSearchResult,
} from '@/api/podcasts';
import { isManualOffline } from '@/api/netGate';
import { COVER, coverArtUrl } from '@/api/data';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame, useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { Message } from '@/components/Message';
import { PodcastAddSheet } from '@/components/PodcastAddSheet';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { useDebounce } from '@/hooks/useDebounce';
import { episodesLabel, useT } from '@/i18n';
import type { Language } from '@/i18n/languages';
import { listPerf } from '@/lib/listPerf';
import { sortItems } from '@/lib/librarySort';
import { usePodcastAddedIds, usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { invalidatePodcastCaches } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { openPodcastMenu } from '@/components/PodcastMenuSheet';
import {
  colors,
  fontSize,
  radius,
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
  useTheme();
  const router = useRouter();
  const bottomPad = useScreenBottomPadding();
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  const lang = useSettings((s) => s.language);
  // Sort like the rest of the library, so the tab and the Library › Podcasts
  // segment order their shows the same way.
  const sort = useSettings((s) => s.librarySort);
  const toast = useToast((s) => s.show);

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['podcastChannels'],
    queryFn: listChannels,
  });

  // Home's shelf is built from the same rows.
  const reload = () => invalidatePodcastCaches();

  // The hearts, so a row can light its own without asking per row. Invalidated
  // when a heart goes on or off, which is what re-lights the row and the filter.
  const favSet = usePodcastFavoriteIds();
  const addedSet = usePodcastAddedIds();

  // Debounced so typing one letter does not fire a fresh search at the Store
  // each keystroke.
  const term = useDebounce(query.trim());

  // A Stop part way through a refresh-all: the header's action button flips to
  // this while `refreshing`, and it raises the flag `refreshAll` checks before
  // each feed. A ref, not state, so the running loop sees the flip right away.
  const cancelRefresh = useRef(false);

  async function refresh() {
    // Manual offline says no to the whole internet, so there is nothing to
    // re-read; say it instead of failing every feed and reporting a blackout.
    if (isManualOffline()) {
      toast(t("You're offline"));
      return;
    }
    cancelRefresh.current = false;
    setRefreshing(true);
    const { failed, total, stopped } =
      await refreshAll(() => cancelRefresh.current).finally(() => setRefreshing(false));
    await reload();
    // Stopped by hand: the feeds already read stay put, and there is nothing
    // to report — the ones left unwritten simply keep their last answer.
    if (stopped) return;
    if (total > 0 && failed === total) {
      toast(t("Couldn't reach any of your podcast feeds."));
    } else if (failed > 0) {
      toast(t('{n} podcast feeds could not be read.', { n: failed }));
    }
  }

  const channels = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Opening a show stores it too, so only the added ones are listed.
    const all = (data ?? []).filter((c) => addedSet.has(c.id));
    const filtered = q
      ? all.filter(
          (c) =>
            c.title.toLowerCase().includes(q) || (c.author ?? '').toLowerCase().includes(q),
        )
      : all;
    return sortItems(
      filtered,
      sort,
      (c) => c.title,
      sort === 'recent' ? (c) => c.lastPublishedAt ?? 0 : (c) => c.refreshedAt ?? 0,
    );
  }, [data, query, sort, addedSet]);

  const showSearch = addedSet.size > SEARCH_FROM;
  const boxOpen = useSearchBox(embedded, searchOpen, () => setQuery(''));
  // Explore lists your shows and only goes to the Store when you search.
  const discovering = !!embedded && term.length > 1;
  const discover = useQuery({
    queryKey: ['podcastDiscover', term],
    queryFn: () => searchPodcasts(term),
    enabled: discovering,
    // iTunes answers are stable enough to hold for three days: the Store is not
    // asked again on every visit, and a search you already ran stays put.
    staleTime: 1000 * 60 * 60 * 72,
  });
  const discoverList = discover.data ?? [];
  const addedFeeds = useMemo(
    () => new Set((data ?? []).filter((c) => addedSet.has(c.id)).map((c) => c.feedUrl)),
    [data, addedSet],
  );
  const [addingFeed, setAddingFeed] = useState<string | null>(null);

  async function addFromSearch(feed: string) {
    setAddingFeed(feed);
    try {
      const channel = await refreshChannel(feed);
      await addChannel(channel.id);
      await reload();
    } catch (e) {
      toast(feedErrorMessage(t, e));
    } finally {
      setAddingFeed(null);
    }
  }

  // Embedded, Explore's header button opens the sheet.
  useEffect(() => {
    if (actionRef) actionRef.current = () => setAdding(true);
  });

  const addButton = (
    <Pressable hitSlop={10} onPress={() => setAdding(true)} accessibilityLabel={t('Add podcast')}>
      <Icon name="add" size={28} color={colors.text} />
    </Pressable>
  );

  return (
    <BrowseFrame embedded={embedded}>
      {embedded ? null : (
        <View style={styles.header}>
          <BackChevron />
          <Text style={styles.title}>{t('Podcasts')}</Text>
          {/* While a refresh-all is running its action button becomes a Stop,
              so the one gesture that started it can also be the one that ends it. */}
          {refreshing ? (
            <Pressable
              hitSlop={10}
              onPress={() => (cancelRefresh.current = true)}
              accessibilityLabel={t('Stop')}
            >
              <Icon name="stop" size={28} color={colors.danger} />
            </Pressable>
          ) : (
            addButton
          )}
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

      {discovering ? (
        discover.isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
        ) : discover.isError ? (
          <Message
            text={t("Couldn't load your podcasts.")}
            onRetry={() => discover.refetch()}
          />
        ) : (
          <FlatList
            {...listPerf}
            keyboardShouldPersistTaps="handled"
            data={discoverList}
            keyExtractor={(item) => item.feedUrl}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: bottomPad, paddingHorizontal: listPad },
            ]}
            renderItem={({ item }: { item: PodcastSearchResult }) => (
              <Pressable
                style={styles.row}
                onPress={() =>
                  router.push(`/podcast/${encodeURIComponent(item.feedUrl)}`)
                }
              >
                <Cover
                  uri={coverArtUrl(item.imageUrl, COVER.thumb)}
                  size={56}
                  placeholderIcon="headset-outline"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.author ? (
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {item.author}
                    </Text>
                  ) : null}
                </View>
                {addingFeed === item.feedUrl ? (
                  <ActivityIndicator color={colors.accent} />
                ) : addedFeeds.has(item.feedUrl) ? (
                  <Icon name="checkmark" size={24} color={colors.accent} />
                ) : (
                  <Pressable
                    hitSlop={8}
                    disabled={addingFeed !== null}
                    onPress={() => void addFromSearch(item.feedUrl)}
                    accessibilityLabel={t('Add podcast')}
                  >
                    <Icon name="add" size={24} color={colors.textSecondary} />
                  </Pressable>
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              term.length > 1 ? (
                <EmptyState
                  icon="search-outline"
                  title={t('No results')}
                  subtitle={t('No results for “{q}”', { q: term })}
                />
              ) : (
                <EmptyState
                  icon="headset-outline"
                  title={t('No results')}
                  subtitle={t('No podcasts')}
                />
              )
            }
          />
        )
      ) : isLoading ? (
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
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }: { item: PodcastChannel }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/podcast/${item.id}`)}
              onLongPress={() => openPodcastMenu(item)}
            >
              <Cover
                uri={coverArtUrl(item.imageUrl, COVER.thumb)}
                size={56}
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
              <FavoriteButton
                id={item.id}
                starred={favSet.has(item.id)}
                size={20}
                podcast={{ kind: 'channel', channelId: item.id }}
              />
              <Pressable
                hitSlop={8}
                onPress={() => openPodcastMenu(item)}
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
              subtitle={t('Find one, or add it with the address of its feed.')}
              action={{ label: t('Find a podcast'), onPress: () => setAdding(true) }}
            />
          }
        />
      )}

      <PodcastAddSheet
        visible={adding}
        onCancel={() => setAdding(false)}
        onAdded={() => void reload()}
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
}));
