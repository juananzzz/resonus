/**
 * Pantalla de Historial estilo "Escuchado recientemente" de Spotify: barra
 * superior simple (sin cabecera-hero) y canciones agrupadas por día.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
// gesture-handler no exporta SectionList; su ScrollView como scroll interno
// hace que el swipe-a-cola de las filas conviva con el scroll (ver TrackRow).
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { TrackRow } from '@/components/TrackRow';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { currentSong, SOURCE_HISTORY, usePlayerStore } from '@/store/player';
import { usePlayHistory, type HistoryEntry } from '@/store/playHistory';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

interface DaySection {
  title: string;
  data: HistoryEntry[];
  /** Índice del primer elemento de la sección en la lista completa. */
  offset: number;
}

/** "Hoy", "Ayer" o la fecha ("29 de junio", con año si no es el actual). */
function dayLabel(playedAt: number, t: (k: string) => string, lang: string): string {
  const d = new Date(playedAt);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return t('Today');
  if (diffDays === 1) return t('Yesterday');
  const label = d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function HistoryScreen() {
  const t = useT();
  const router = useRouter();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const entries = usePlayHistory((s) => s.entries);
  const clear = usePlayHistory((s) => s.clear);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [confirmClear, setConfirmClear] = useState(false);

  const songs = entries.map((e) => e.song);

  // Las entradas ya vienen de la más reciente a la más antigua.
  const sections: DaySection[] = [];
  entries.forEach((e, i) => {
    const title = dayLabel(e.playedAt, t, lang);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(e);
    else sections.push({ title, data: [e], offset: i });
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.bar}>
        <Pressable hitSlop={12} accessibilityLabel={t('Close')} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.barTitle}>{t('History')}</Text>
        {songs.length > 0 ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Clear history')}
            onPress={() => setConfirmClear(true)}
          >
            <Ionicons name="trash-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {songs.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="time-outline"
            title={t('Nothing played yet')}
            subtitle={t('Songs you play will show up here.')}
          />
        </View>
      ) : (
        <SectionList
          {...listPerf}
          renderScrollComponent={(props) => <GHScrollView {...props} />}
          sections={sections}
          keyExtractor={(item) => item.song.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          renderItem={({ item, index, section }) => (
            <TrackRow
              song={item.song}
              isCurrent={playing?.id === item.song.id}
              showArtwork={showListArtwork}
              onPress={() =>
                playQueue(songs, (section as DaySection).offset + index, SOURCE_HISTORY, '/history')
              }
            />
          )}
        />
      )}

      <Dialog
        visible={confirmClear}
        title={t('Clear history')}
        message={t("This can't be undone.")}
        confirmLabel={t('Clear all')}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          clear();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  barTitle: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
});
