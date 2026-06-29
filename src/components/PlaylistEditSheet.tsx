/** Hoja para editar una lista: nombre, descripción y visibilidad pública. */
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Cover } from '@/components/Cover';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';

export interface PlaylistEdit {
  name: string;
  comment: string;
  public: boolean;
}

interface Props {
  visible: boolean;
  initial: PlaylistEdit;
  coverUri?: string;
  /** Oculta el interruptor de lista pública (p. ej. en modo local, sin servidor). */
  hidePublic?: boolean;
  onCancel: () => void;
  onSave: (changes: PlaylistEdit) => void;
}

export function PlaylistEditSheet({ visible, initial, coverUri, hidePublic, onCancel, onSave }: Props) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [comment, setComment] = useState(initial.comment);
  const [isPublic, setIsPublic] = useState(initial.public);

  // Reinicia los campos cada vez que se abre.
  useEffect(() => {
    if (visible) {
      setName(initial.name);
      setComment(initial.comment);
      setIsPublic(initial.public);
    }
  }, [visible, initial.name, initial.comment, initial.public]);

  const canSave = name.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={onCancel}>
            <Text style={styles.headerAction}>{t('Cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('Edit playlist')}</Text>
          <Pressable
            hitSlop={12}
            disabled={!canSave}
            onPress={() => onSave({ name: name.trim(), comment: comment.trim(), public: isPublic })}
          >
            <Text style={[styles.headerAction, !canSave && styles.disabled]}>{t('Save')}</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.coverWrap}>
              <Cover uri={coverUri} size={160} />
            </View>

            <Text style={styles.label}>{t('Name')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('Playlist name')}
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>{t('Description')}</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={comment}
              onChangeText={setComment}
              placeholder={t('Add an optional description')}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {hidePublic ? null : (
              <Pressable style={styles.switchRow} onPress={() => setIsPublic((v) => !v)}>
                <View style={styles.switchInfo}>
                  <Text style={styles.switchTitle}>{t('Public playlist')}</Text>
                  <Text style={styles.switchSub}>{t('Visible to other users on the server')}</Text>
                </View>
                <Switch
                  value={isPublic}
                  onValueChange={setIsPublic}
                  trackColor={{ true: colors.accent, false: colors.surfaceHighlight }}
                  thumbColor="#fff"
                />
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  headerAction: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
  disabled: { color: colors.textMuted },
  content: { padding: spacing.lg, gap: spacing.sm },
  coverWrap: { alignItems: 'center', marginBottom: spacing.sm },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  multiline: { minHeight: 90 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  switchInfo: { flex: 1 },
  switchTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  switchSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
});
