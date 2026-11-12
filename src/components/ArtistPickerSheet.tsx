/**
 * Bottom sheet for choosing which artist to go to when a song or album has
 * multiple artists (collaborations). Opened from the `artistPicker` store.
 */
import { useSegments } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { COVER, coverArtUrl } from '@/api/data';
import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import { pushOrReplace } from '@/lib/pushOrReplace';
import { useArtistPicker } from '@/store/artistPicker';
import { fontSize, radius, spacing, themed, tracking } from '@/theme';
import { Cover } from './Cover';

export function ArtistPickerSheet() {
  // What is on top decides whether the artist pushes or replaces the modal
  // (see `pushOrReplace`); read before the early return below.
  const top = useSegments()[0];
  const t = useT();
  const artists = useArtistPicker((s) => s.artists);
  const closeNow = useArtistPicker((s) => s.close);
  // The list is scrolled to the top: only then does a downward drag belong to
  // the sheet, so pulling down mid-list scrolls instead of dismissing.
  const [atTop, setAtTop] = useState(true);

  if (!artists) return null;

  /** Picks the artist and leaves the sheet. `close` is the shared frame's,
   *  required as a parameter so no call site can forget it: the frame hands
   *  its close to its content, and this is reached from there. */
  const go = (close: (after?: () => void) => void, id: string) => {
    // The navigation waits for the sheet's exit animation, like the song,
    // media and info sheets do: pushing while the Modal is still up races its
    // unmount with the stack commit, and on iOS that race crashes. It also
    // replaces rather than pushes when a modal is on top, or the artist would
    // land in a sheet there.
    close(() => pushOrReplace(`/artist/${id}`, top));
  };

  return (
    <SheetModal
      visible={!!artists}
      onClosed={closeNow}
      /* The list owns the drag once it is scrolled: only at the top does a
         downward drag belong to the sheet, so pulling down mid-list scrolls
         instead of dismissing. The header keeps its own drag for the way out,
         which is why this sheet places its drags inside the sheet instead of
         taking the frame's one around everything. */
      sheetDrag={false}
    >
      {(close, makePan) => {
        // Second drag, for the handle and the title (see the JSX below).
        const headerPan = makePan();
        return (
          <>
            {/* The header has its own drag, always enabled: it's the way out when
                the list below is scrolled and keeps the gesture for itself. Two
                detectors instead of one around everything so both can never fire
                at once. */}
            <GestureDetector gesture={headerPan}>
              <View>
                <View style={styles.handle} />
                <Text style={styles.title}>{t('Artists')}</Text>
              </View>
            </GestureDetector>
            {/* Around a plain View, not the ScrollView itself: the detector must
                not fight the list's own native scrolling. */}
            <GestureDetector gesture={makePan().enabled(atTop)}>
              <View>
                <ScrollView
                  style={{ maxHeight: 420 }}
                  scrollEventThrottle={16}
                  onScroll={(e) => setAtTop(e.nativeEvent.contentOffset.y <= 0)}
                >
                  {artists.map((a) => (
                    <Pressable
                      key={a.id}
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                      onPress={() => go(close, a.id)}
                    >
                      <Cover uri={coverArtUrl(a.id, COVER.thumb)} size={48} rounded />
                      <Text style={styles.name} numberOfLines={1}>
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </GestureDetector>
          </>
        );
      }}
    </SheetModal>
  );
}

const styles = themed((colors) => ({
  // The sheet's frame (backdrop, sheet, grabber) is not re-declared here: the
  // sheet takes the shared one (see `SheetModal`). The `handle` below is not that
  // grabber: this sheet's header keeps its own cue, drawn in the surface's own
  // highlight rather than the muted grab-cue, and it stays inside the drag
  // around the header.
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  name: { color: colors.text, fontSize: fontSize.md, flex: 1 },
}));
