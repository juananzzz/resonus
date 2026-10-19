/**
 * Simple modal dialog: title, message or optional text field, and
 * Cancel/Confirm buttons. Used for create/rename (with input) and to confirm
 * destructive actions (without input).
 */
import Icon from '@/components/Icon';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing, themed, tracking } from '@/theme';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  /** Anything else to show under the message. */
  children?: ReactNode;
  /** If provided, shows a text field initialized with `initialValue`. */
  input?: { placeholder?: string; initialValue?: string; secure?: boolean };
  confirmLabel: string;
  /** Optional third choice, neither confirm nor cancel (e.g. «Don't remind
   *  me»). Goes on its own line so three labels never crowd one row.
   *  `align` says which end of that line: 'start' for the ones that dismiss,
   *  which stay out of the way, and 'end' to stack it over the confirm when
   *  both are answers to the same question and get compared to each other.
   *  `icon` sits after the label, for the ones a word alone does not describe:
   *  a line of grey text among grey text reads as a label, and `open-outline`
   *  is what says this one leaves the app. */
  neutral?: {
    label: string;
    onPress: () => void;
    align?: 'start' | 'end';
    icon?: keyof typeof Icon.glyphMap;
  };
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export function Dialog({
  visible,
  title,
  message,
  children,
  input,
  confirmLabel,
  neutral,
  destructive,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT();
  const [value, setValue] = useState(input?.initialValue ?? '');
  const inputRef = useRef<TextInput>(null);

  // Reset the text every time it opens.
  useEffect(() => {
    if (visible) setValue(input?.initialValue ?? '');
  }, [visible, input?.initialValue]);

  const canConfirm = input ? value.trim().length > 0 : true;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      // A dialog that asks for a word opens ready to be typed in. Focusing
      // once it is on screen, and not with `autoFocus`: a modal lives in a
      // window of its own, and the field is attached to it before that window
      // takes the focus, so Android had nowhere to raise the keyboard for and
      // the caret sat in a field that needed tapping. By `onShow` the window
      // is up and it does. Anything else that focuses inside a modal has the
      // same problem.
      onShow={() => inputRef.current?.focus()}
    >
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {children}
          {input ? (
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={input.placeholder}
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={setValue}
              secureTextEntry={input.secure}
            />
          ) : null}
          {neutral ? (
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [
                styles.neutral,
                neutral.align === 'end' && { alignSelf: 'flex-end' },
                pressed && { opacity: 0.6 },
              ]}
              onPress={neutral.onPress}
            >
              <Text style={styles.cancel}>{neutral.label}</Text>
              {neutral.icon ? (
                <Icon name={neutral.icon} size={15} color={colors.textSecondary} />
              ) : null}
            </Pressable>
          ) : null}
          <View style={styles.actions}>
            <Pressable hitSlop={8} onPress={onCancel} style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Text style={styles.cancel}>{t('Cancel')}</Text>
            </Pressable>
            <Pressable
              hitSlop={8}
              disabled={!canConfirm}
              onPress={() => onConfirm(value.trim())}
            >
              <Text
                style={[
                  styles.confirm,
                  { color: colors.accent },
                  destructive && { color: colors.danger },
                  !canConfirm && { opacity: 0.4 },
                ]}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdropStrong },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  message: { color: colors.textSecondary, fontSize: fontSize.md },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  neutral: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  cancel: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '500' },
  confirm: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
}));
