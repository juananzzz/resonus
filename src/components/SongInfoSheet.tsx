/**
 * Everything the app knows about one song, in a sheet (#59).
 *
 * The server is the source, and the file's own tags are the fallback: a local
 * profile has no server to ask, and neither does a song whose metadata came out
 * empty. Nothing here is editable; this is for reading, which is the point of
 * the comment tag, where people keep notes that nothing else in the app shows.
 *
 * Only what the song actually has is drawn. A list of twenty labels with
 * fourteen dashes next to them is harder to read than the six lines that were
 * really filled in.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COVER } from '@/api/data';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { artistTargets } from '@/lib/artistNav';
import { qualityLabel, sampleLabel, transcodeTarget } from '@/lib/audioQuality';
import { formatBytes, formatDuration } from '@/lib/format';
import { useDownloads } from '@/store/downloads';
import { useNetworkType } from '@/store/networkType';
import { useSettings } from '@/store/settings';
import { useSongInfo } from '@/store/songInfo';
import { fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { CoverViewer } from './CoverViewer';

/** One label and its value. Long values wrap instead of being cut off. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

/** One chip: what it says and where it goes. */
interface Chip {
  key: string;
  text: string;
  onPress: () => void;
}

/** Same row, with the value as chips that each browse somewhere. */
function ChipRow({ label, chips }: { label: string; chips: Chip[] }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {chips.map((c) => (
          <Pressable
            key={c.key}
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
            onPress={c.onPress}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>{c.text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function SongInfoSheet() {
  const { songCoverUrl } = useCoverUrls();
  const song = useSongInfo((s) => s.song);
  const closeNow = useSongInfo((s) => s.close);
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [coverOpen, setCoverOpen] = useState(false);
  // The list is scrolled to the top: only then does a downward drag belong to
  // the sheet (see the `pan` below).
  const [atTop, setAtTop] = useState(true);
  const cellular = useNetworkType((s) => s.cellular);
  const maxBitRate = useSettings((s) => (cellular ? s.maxBitRateCellular : s.maxBitRate));
  const streamFormat = useSettings((s) => (cellular ? s.streamFormatCellular : s.streamFormat));
  const losslessOnly = useSettings((s) => s.streamLosslessOnly);
  const dlUri = useDownloads((s) => (song ? s.files[song.id] : undefined));
  const dlBitRate = useDownloads((s) => (song ? s.dlBitRates[song.id] : undefined));
  const { dismiss, pan, makePan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    !!song,
    closeNow,
  );
  // Second drag, for the grabber and the header: with the list scrolled down it
  // owns the gesture, and this is what still closes the sheet from up there.
  const headerPan = makePan();

  if (!song) return null;

  const close = () => dismiss(closeNow);

  /** Goes somewhere, closing the sheet on the way out. */
  const go = (path: string) =>
    dismiss(() => {
      closeNow();
      router.push(path);
    });

  type InfoRow = { label: string; value: string } | { label: string; chips: Chip[] };
  const rows: InfoRow[] = [];
  const add = (label: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null || value === '') return;
    rows.push({ label, value: String(value) });
  };

  // Album and artist are chips too, and for the same reason the genres are:
  // they are somewhere to go. Only when there is an id to go to, though; a
  // radio stream or a song whose tags carry names and nothing else keeps them
  // as the plain text they were.
  if (song.album) {
    rows.push(
      song.albumId
        ? {
            label: t('Album'),
            chips: [
              { key: 'album', text: song.album, onPress: () => go(`/album/${song.albumId}`) },
            ],
          }
        : { label: t('Album'), value: song.album },
    );
  }
  // One chip per artist rather than a single "A feat. B" line: on a
  // collaboration each name goes to its own screen, with no picker in between.
  // A nameless target would draw an empty chip, so it falls back to the song's
  // own artist string and, failing that, is dropped.
  const artists = artistTargets(song)
    .map((a) => ({ id: a.id, name: a.name || song.artist || '' }))
    .filter((a) => a.name);
  if (artists.length > 0) {
    rows.push({
      label: t('Artist'),
      chips: artists.map((a) => ({
        key: a.id,
        text: a.name,
        onPress: () => go(`/artist/${a.id}`),
      })),
    });
  } else {
    add(t('Artist'), song.artist);
  }
  add(t('Year'), song.year);
  // Disc only when the album has more than one: "1 · disc 1" on a single disc
  // album is noise dressed up as information.
  add(
    t('Track'),
    song.track != null
      ? song.discNumber != null && song.discNumber > 1
        ? `${song.track} · ${t('Disc {n}', { n: song.discNumber })}`
        : String(song.track)
      : undefined,
  );
  // Chips, like the album header's: a genre is somewhere to go, and it already
  // reads as one everywhere else in the app.
  const genres = song.genres?.map((g) => g.name) ?? (song.genre ? [song.genre] : []);
  if (genres.length > 0) {
    rows.push({
      label: t('Genre'),
      chips: genres.map((g) => ({
        key: g,
        text: g,
        onPress: () => go(`/genre/${encodeURIComponent(g)}`),
      })),
    });
  }
  add(t('Duration'), song.duration ? formatDuration(song.duration) : undefined);

  // The player's exact wording, arrow and all, so the same file is not
  // described two different ways on two screens.
  const target = transcodeTarget(song, maxBitRate, streamFormat, losslessOnly);
  const format = qualityLabel(song, target.bitRate, dlUri, dlBitRate, target.format);
  add(t('Format'), format);
  // `qualityLabel` folds the sample rate in already, except when it took the
  // transcode branch and dropped the original's specs. Only then is it worth
  // its own line.
  const sample = sampleLabel(song);
  if (sample && (!format || !format.includes(sample))) add(t('Sample rate'), sample);

  add(t('Channels'), song.channelCount);
  add(t('Size'), song.dlBytes ? formatBytes(song.dlBytes) : undefined);
  add(t('Comment'), song.comment);
  add(t('BPM'), song.bpm);
  // Spelled out here, unlike the badge in the lists: this is the one place
  // "clean" is worth saying, since a censored edit is a fact about the file and
  // a row that shows nothing cannot tell it from an untagged one.
  add(
    t('Content'),
    song.explicitStatus === 'explicit'
      ? t('Explicit')
      : song.explicitStatus === 'clean'
        ? t('Clean')
        : undefined,
  );
  add(t('Moods'), song.moods?.join(', '));
  add(t('Plays'), song.playCount);
  add(t('Rating'), song.userRating ? `${song.userRating}/5` : undefined);
  add('MusicBrainz', song.musicBrainzId);
  add('ISRC', song.isrc?.join(', '));

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      {/* Gestures inside an RN Modal need a root view of their own: the
          Modal renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
          onLayout={onSheetLayout}
        >
          {/* The grabber and the header drag on their own, so the sheet can be
              pulled shut from up here whatever the list below is doing. */}
          <GestureDetector gesture={headerPan}>
            <View>
              <View style={styles.grabber} />
              <View style={styles.headerRow}>
                {/* The song's own art, which on an album of live takes or a
                    compilation need not be the album's, and until now could
                    only be seen by playing the track. */}
                <Pressable
                  onPress={() => setCoverOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('Cover art')}
                >
                  <Cover uri={songCoverUrl(song, COVER.thumb)} size={48} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>
                    {song.title}
                  </Text>
                  {song.artist ? (
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {song.artist}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.divider} />
            </View>
          </GestureDetector>

          {/* Scrolls because a comment can be a paragraph. The drag only takes
              the gesture back at the top: pulling down mid-list scrolls it,
              instead of closing the sheet on somebody trying to read. */}
          <GestureDetector gesture={pan.enabled(atTop)}>
            <View>
              <ScrollView
                style={styles.list}
                bounces={false}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={(e) => setAtTop(e.nativeEvent.contentOffset.y <= 0)}
              >
                {rows.map((r) =>
                  'chips' in r ? (
                    <ChipRow key={r.label} label={r.label} chips={r.chips} />
                  ) : (
                    <Row key={r.label} label={r.label} value={r.value} />
                  ),
                )}
                {rows.length === 0 ? (
                  <Text style={styles.empty}>{t('This song carries no information.')}</Text>
                ) : null}
              </ScrollView>
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
      <CoverViewer
        visible={coverOpen}
        uri={songCoverUrl(song, COVER.full)}
        onClose={() => setCoverOpen(false)}
      />
    </Modal>
  );
}

const styles = themed((colors) => ({
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
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  // Capped so a long comment cannot grow the sheet past the screen; below the
  // cap it hugs its content and there is nothing to scroll.
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Fixed width so every value starts on the same column, which is what makes
  // this readable as a table rather than as a list of sentences.
  label: { color: colors.textMuted, fontSize: fontSize.sm, width: 110 },
  value: { color: colors.text, fontSize: fontSize.sm, flex: 1 },
  // The album header's chips, wrapping instead of scrolling sideways: this row
  // has a fixed column to live in and there is no play button below to protect
  // from a song tagged with six genres.
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  chipText: { color: colors.textSecondary, fontSize: fontSize.xs },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
}));
