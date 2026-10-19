/**
 * A dialog for making a colour of your own: a saturation/brightness panel, a
 * hue slider, and the hex for whoever already knows the one they want.
 *
 * A dialog and not a bottom sheet: the sheet closes with a drag, and every
 * drag in here is somebody choosing a colour. Nothing is applied until Save,
 * so dragging does not repaint the whole app behind it frame by frame.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ColorPicker, { HueSlider, Panel1 } from 'reanimated-color-picker';

import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing, themed, tracking } from '@/theme';

const HEX = /^#?[0-9a-f]{6}$/i;

/** Mounted only while open, so every opening starts from `initialColor`. */
export function ColorPickerDialog({
  initialColor,
  onCancel,
  onSave,
}: {
  initialColor: string;
  onCancel: () => void;
  onSave: (hex: string) => void;
}) {
  const t = useT();
  // What the picker shows; only moved from outside by typing a hex.
  const [pickerValue, setPickerValue] = useState(initialColor);
  const [hex, setHex] = useState(initialColor.toUpperCase());
  const [text, setText] = useState(initialColor.toUpperCase());

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onCancel}>
      {/* A modal renders outside the app's gesture root. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.center} pointerEvents="box-none">
          <View style={styles.card}>
            <Text style={styles.title}>{t('Custom color')}</Text>
            <ColorPicker
              value={pickerValue}
              thumbSize={24}
              sliderThickness={24}
              boundedThumb
              style={styles.picker}
              onChangeJS={(c) => {
                const next = c.hex.slice(0, 7).toUpperCase();
                setHex(next);
                setText(next);
              }}
            >
              <Panel1 style={styles.panel} />
              <HueSlider style={styles.slider} />
            </ColorPicker>
            <View style={styles.row}>
              <View style={[styles.preview, { backgroundColor: hex }]} />
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={(v) => {
                  setText(v);
                  if (HEX.test(v.trim())) {
                    const next = `#${v.trim().replace('#', '')}`.toUpperCase();
                    setHex(next);
                    setPickerValue(next);
                  }
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
                accessibilityLabel={t('Hex code')}
              />
            </View>
            <View style={styles.actions}>
              <Pressable
                hitSlop={8}
                onPress={onCancel}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={styles.cancel}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={() => onSave(hex)}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Text style={[styles.confirm, { color: colors.accent }]}>{t('Save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdropStrong },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  picker: { gap: spacing.lg },
  panel: { height: 200, borderRadius: radius.md },
  slider: { borderRadius: radius.pill },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  preview: { width: 40, height: 40, borderRadius: radius.pill },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  cancel: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '500' },
  confirm: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
}));
