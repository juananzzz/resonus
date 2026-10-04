/**
 * History screen in Spotify's "Recently played" style: simple top bar
 * (no hero header) and songs grouped by day.
 */
import Icon from '@/components/Icon';
import { useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
// gesture-handler doesn't export SectionList; its ScrollView as inner scroll
// makes the row swipe-to-queue coexist with scrolling (see TrackRow).
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { TrackRow } from '@/components/TrackRow';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { currentSong, SOURCE_HISTORY, usePlayerStore } from '@/store/player';
import { markUnplayableOffline } from '@/api/data';
import { usePlayHistory, type HistoryEntry } from '@/store/playHistory';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING, themed, useTheme, tracking } from '@/theme';
import { BackChevron } from '@/components/BackChevron';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';

interface DaySection {
  title: string;
  data: HistoryEntry[];
/** Index of the first element of the section in the full list. */
  offset: number;
}

/** "Today", "Yesterday" or the date ("June 29", with year if not current). */
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
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const entries = usePlayHistory((s) => s.entries);
  const offline = useAuthStore((s) => s.offline);
  const clear = usePlayHistory((s) => s.clear);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const toast = useToast((s) => s.show);
  const [confirmClear, setConfirmClear] = useState(false);

  // Offline, what is not on the phone is marked so the row dims and says so
  // when tapped, the way every other list does. Not filtered out: a history is
  // a record of what was played, and a record with holes in it is worse than
  // one that greys what it cannot reach right now.
  const songs = markUnplayableOffline(entries.map((e) => e.song), offline);
  const marked = entries.map((e, i) => ({ ...e, song: songs[i] }));

  // Entries already come from most recent to oldest.
  const sections: DaySection[] = [];
  marked.forEach((e, i) => {
    const title = dayLabel(e.playedAt, t, lang);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(e);
    else sections.push({ title, data: [e], offset: i });
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.bar}>
        <BackChevron size={28} label={t('Close')} />
        <Text style={styles.barTitle}>{t('History')}</Text>
        {songs.length > 0 ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Clear history')}
            onPress={() => setConfirmClear(true)}
          >
            <Icon name="trash-outline" size={22} color={colors.textSecondary} />
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
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad, paddingHorizontal: listPad },
          ]}
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
        confirmLabel={t('Clear all')}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          const undo = clear();
          if (undo) toast(t('History cleared'), { label: t('Undo'), run: undo });
        }}
      />
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  barTitle: { flex: 1, color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '500',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
}));
