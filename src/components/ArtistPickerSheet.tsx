/**
 * Hoja inferior para elegir a qué artista ir cuando una canción o álbum tiene
 * varios (colaboraciones). Se abre desde el store `artistPicker`.
 */
import { useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverArtUrl } from '@/api/data';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { useArtistPicker } from '@/store/artistPicker';
import { colors, fontSize, spacing } from '@/theme';
import { Cover } from './Cover';

export function ArtistPickerSheet() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const artists = useArtistPicker((s) => s.artists);
  const closeNow = useArtistPicker((s) => s.close);
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(!!artists);
  const close = () => dismiss(closeNow);

  if (!artists) return null;

  const go = (id: string) => {
    close();
    router.push(`/artist/${id}`);
  };

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
        onLayout={onSheetLayout}
      >
        <View style={styles.handle} />
        <Text style={styles.title}>{t('Artists')}</Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {artists.map((a) => (
            <Pressable
              key={a.id}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              onPress={() => go(a.id)}
            >
              <Cover uri={coverArtUrl(a.id, 100)} size={48} rounded />
              <Text style={styles.name} numberOfLines={1}>
                {a.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHighlight,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
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
});
