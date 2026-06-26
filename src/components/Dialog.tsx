/**
 * Diálogo modal sencillo: título, mensaje o campo de texto opcional y botones
 * Cancelar/Confirmar. Sirve para crear/renombrar (con input) y para confirmar
 * acciones destructivas (sin input).
 */
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  /** Si se indica, muestra un campo de texto inicializado con `initialValue`. */
  input?: { placeholder?: string; initialValue?: string };
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export function Dialog({
  visible,
  title,
  message,
  input,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT();
  const [value, setValue] = useState(input?.initialValue ?? '');

  // Reinicia el texto cada vez que se abre.
  useEffect(() => {
    if (visible) setValue(input?.initialValue ?? '');
  }, [visible, input?.initialValue]);

  const canConfirm = input ? value.trim().length > 0 : true;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {input ? (
            <TextInput
              style={styles.input}
              placeholder={input.placeholder}
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={setValue}
              autoFocus
            />
          ) : null}
          <View style={styles.actions}>
            <Pressable hitSlop={8} onPress={onCancel}>
              <Text style={styles.cancel}>{t('Cancelar')}</Text>
            </Pressable>
            <Pressable
              hitSlop={8}
              disabled={!canConfirm}
              onPress={() => onConfirm(value.trim())}
            >
              <Text
                style={[
                  styles.confirm,
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

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
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
  cancel: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '600' },
  confirm: { color: colors.accent, fontSize: fontSize.md, fontWeight: '700' },
});
