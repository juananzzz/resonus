/** Cola de reproducción: ver, reordenar y quitar canciones. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { coverArtUrl } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { NowPlayingBars } from '@/components/NowPlayingBars';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';
import { listPerf } from '@/lib/listPerf';

export default function QueueScreen() {
  const t = useT();
  const router = useRouter();
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const removeAt = usePlayerStore((s) => s.removeAt);
  const moveTrack = usePlayerStore((s) => s.moveTrack);
  const showListArtwork = useSettings((s) => s.showListArtwork);

  function renderItem({ item, index: i }: { item: Song; index: number }) {
    const isCurrent = i === index;
    return (
      <View style={[styles.row, isCurrent && styles.rowCurrent]}>
        <Pressable style={styles.main} onPress={() => jumpTo(i)}>
          {showListArtwork ? (
            <View style={styles.artwork}>
              <Cover uri={coverArtUrl(item.coverArt ?? item.albumId, 100)} size={44} />
              {isCurrent ? (
                <View style={styles.artworkOverlay}>
                  <NowPlayingBars playing={isPlaying} />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.leftSlot}>
              {isCurrent ? (
                <NowPlayingBars playing={isPlaying} />
              ) : (
                <Text style={styles.position}>{i + 1}</Text>
              )}
            </View>
          )}
          <View style={styles.info}>
            <Text
              style={[styles.title, isCurrent && styles.current]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {item.artist ? (
              <Text style={styles.artist} numberOfLines={1}>
                {item.artist}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Pressable hitSlop={6} disabled={i === 0} onPress={() => moveTrack(i, i - 1)}>
            <Ionicons
              name="chevron-up"
              size={22}
              color={i === 0 ? colors.textMuted : colors.textSecondary}
            />
          </Pressable>
          <Pressable
            hitSlop={6}
            disabled={i === queue.length - 1}
            onPress={() => moveTrack(i, i + 1)}
          >
            <Ionicons
              name="chevron-down"
              size={22}
              color={i === queue.length - 1 ? colors.textMuted : colors.textSecondary}
            />
          </Pressable>
          <Pressable hitSlop={6} onPress={() => removeAt(i)}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('Queue')}</Text>
        <View style={{ width: 28 }} />
      </View>

      <FlatList
        {...listPerf}
        data={queue}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="list-outline"
              title={t('The queue is empty.')}
              subtitle={t('Play a song or album to start the queue.')}
            />
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  list: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowCurrent: {},
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  leftSlot: { width: 24, alignItems: 'center', justifyContent: 'center' },
  position: { color: colors.textMuted, fontSize: fontSize.sm },
  artwork: { width: 44, height: 44 },
  artworkOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.md,
  },
  info: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.md },
  current: { color: colors.accent },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
