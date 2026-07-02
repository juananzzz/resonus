/** Pantalla de Actividad / Historial: canciones escuchadas, la más reciente primero. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { TrackListView } from '@/components/TrackListView';
import { songsLabel, useT } from '@/i18n';
import { currentSong, SOURCE_HISTORY, usePlayerStore } from '@/store/player';
import { usePlayHistory } from '@/store/playHistory';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing } from '@/theme';

export default function HistoryScreen() {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const entries = usePlayHistory((s) => s.entries);
  const clear = usePlayHistory((s) => s.clear);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const songs = entries.map((e) => e.song);

  if (songs.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="time-outline"
          title={t('Nothing played yet')}
          subtitle={t('Songs you play will show up here.')}
        />
      </View>
    );
  }

  return (
    <TrackListView
      title={t('History')}
      meta={songsLabel(songs.length, lang)}
      hideCover
      // Acento oscurecido (~60%), como los tonos oscuros que useDominantColor
      // elige en álbumes: el degradado funde limpio a negro (ver Favoritos).
      accentColor="#116f32"
      songs={songs}
      currentId={playing?.id}
      showArtwork={showListArtwork}
      footer={
        <Pressable style={styles.clear} onPress={clear}>
          <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.clearText}>{t('Clear history')}</Text>
        </Pressable>
      }
      onPlay={(start) => playQueue(songs, start, SOURCE_HISTORY, '/history')}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
  },
  clearText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
});
