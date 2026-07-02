/** Cola de reproducción: ver, reordenar (arrastrando) y quitar canciones. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { coverArtUrl } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { formatTotalDuration } from '@/lib/format';
import { tapHaptic } from '@/lib/haptics';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';
import { listPerf } from '@/lib/listPerf';

// ReorderableList no admite removeClippedSubviews (necesita las celdas
// montadas para animar el drag); usamos el resto de props de rendimiento.
const queueListPerf = {
  initialNumToRender: listPerf.initialNumToRender,
  maxToRenderPerBatch: listPerf.maxToRenderPerBatch,
  windowSize: listPerf.windowSize,
};

function QueueRow({ item, i }: { item: Song; i: number }) {
  const jumpTo = usePlayerStore((s) => s.jumpTo);
  const removeAt = usePlayerStore((s) => s.removeAt);
  const isCurrent = usePlayerStore((s) => s.index === i);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const drag = useReorderableDrag();

  return (
    <View style={styles.row}>
      <Pressable style={styles.main} onPress={() => jumpTo(i)} onLongPress={drag}>
        {showListArtwork ? (
          <View style={styles.artwork}>
            <Cover uri={coverArtUrl(item.coverArt ?? item.albumId, 100)} size={44} />
          </View>
        ) : (
          <View style={styles.leftSlot}>
            <Text style={[styles.position, isCurrent && styles.current]}>{i + 1}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={[styles.title, isCurrent && styles.current]} numberOfLines={1}>
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
        <Pressable hitSlop={6} onPress={() => removeAt(i)}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
        <Pressable hitSlop={6} onPressIn={drag}>
          <Ionicons name="reorder-two" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

export default function QueueScreen() {
  const t = useT();
  const router = useRouter();
  const queue = usePlayerStore((s) => s.queue);
  const moveTrack = usePlayerStore((s) => s.moveTrack);
  const totalSec = queue.reduce((acc, s) => acc + (s.duration ?? 0), 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('Queue')}</Text>
          {/* Sin subtítulo para radios (duración desconocida) o una sola canción. */}
          {queue.length > 1 && totalSec > 0 ? (
            <Text style={styles.headerSub}>
              {t('{n} songs', { n: queue.length })} · {formatTotalDuration(totalSec)}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 28 }} />
      </View>

      <ReorderableList
        {...queueListPerf}
        data={queue}
        keyExtractor={(item, i) => `${item.id}-${i}`}
        renderItem={({ item, index }) => <QueueRow item={item} i={index} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          tapHaptic();
          moveTrack(from, to);
        }}
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
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  headerSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  list: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    // Fondo opaco para que la fila arrastrada tape a las demás al pasar.
    backgroundColor: colors.background,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  leftSlot: { width: 24, alignItems: 'center', justifyContent: 'center' },
  position: { color: colors.textMuted, fontSize: fontSize.sm },
  artwork: { width: 44, height: 44 },
  info: { flex: 1 },
  title: { color: colors.text, fontSize: fontSize.md },
  current: { color: colors.accent },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
