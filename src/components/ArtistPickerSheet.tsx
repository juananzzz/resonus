/**
 * Bottom sheet for choosing which artist to go to when a song or album has
 * multiple artists (collaborations). Opened from the `artistPicker` store.
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
import { useArtistPicker } from '@/store/artistPicker';
import { fontSize, radius, SHEET_MAX_WIDTH, spacing, themed, tracking } from '@/theme';
import { Cover } from './Cover';

export function ArtistPickerSheet() {
  const { coverArtUrl } = useCoverUrls();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const artists = useArtistPicker((s) => s.artists);
  const closeNow = useArtistPicker((s) => s.close);
  const { dismiss, pan, makePan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    !!artists,
    closeNow,
  );
  // Second drag, for the handle and the title (see the JSX below).
  const headerPan = makePan();
  // The list is scrolled to the top: only then does a downward drag belong to
  // the sheet, so pulling down mid-list scrolls instead of dismissing.
  const [atTop, setAtTop] = useState(true);
  const close = () => dismiss(closeNow);

  if (!artists) return null;

  const go = (id: string) => {
    close();
    router.push(`/artist/${id}`);
  };

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      {/* Gestures inside an RN Modal need a root view of their own: the Modal
          renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
          onLayout={onSheetLayout}
        >
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
          <GestureDetector gesture={pan.enabled(atTop)}>
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
                    onPress={() => go(a.id)}
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
        </Animated.View>
      </GestureHandlerRootView>
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
