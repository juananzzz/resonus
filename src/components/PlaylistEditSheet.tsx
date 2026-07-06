/** Hoja para editar una lista: carátula, nombre, descripción y visibilidad. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import { deletePlaylistImage, NavidromeError, uploadPlaylistImage } from '@/api/navidrome';
import { removeLocalPlaylistCover, setLocalPlaylistCover } from '@/lib/localQueries';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, radius, spacing } from '@/theme';

export interface PlaylistEdit {
  name: string;
  comment: string;
  public: boolean;
}

type PickedImage = { uri: string; name: string; type: string };

/** Acción de carátula a la espera de la contraseña (perfiles antiguos). */
type CoverAction = { kind: 'upload'; image: PickedImage } | { kind: 'remove' };

interface Props {
  visible: boolean;
  initial: PlaylistEdit;
  coverUri?: string;
  /** Oculta el interruptor de lista pública (p. ej. en modo local, sin servidor). */
  hidePublic?: boolean;
  /**
   * Id de la playlist en el servidor: habilita cambiar la carátula con una
   * imagen local (API nativa de Navidrome ≥ 0.61). Solo perfiles Navidrome.
   */
  coverUploadId?: string;
  /**
   * Id de una lista del perfil local: habilita cambiar la carátula copiando
   * la imagen al almacenamiento de la app (sin servidor de por medio).
   */
  localCoverId?: string;
  onCancel: () => void;
  onSave: (changes: PlaylistEdit) => void;
}

export function PlaylistEditSheet({
  visible,
  initial,
  coverUri,
  hidePublic,
  coverUploadId,
  localCoverId,
  onCancel,
  onSave,
}: Props) {
  const t = useT();
  const queryClient = useQueryClient();
  const auth = useAuthStore((s) => s.auth);
  const saveNativePassword = useAuthStore((s) => s.saveNativePassword);
  const [name, setName] = useState(initial.name);
  const [comment, setComment] = useState(initial.comment);
  const [isPublic, setIsPublic] = useState(initial.public);
  // Estado del cambio de carátula: imagen subida, error inline (un toast
  // quedaría oculto bajo este Modal) y contraseña pendiente si hace falta.
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [askPassword, setAskPassword] = useState(false);
  const [pendingAction, setPendingAction] = useState<CoverAction | null>(null);

  // Reinicia los campos cada vez que se abre.
  useEffect(() => {
    if (visible) {
      setName(initial.name);
      setComment(initial.comment);
      setIsPublic(initial.public);
      setPickedUri(null);
      setCoverError(null);
      setUploading(false);
      setAskPassword(false);
      setPendingAction(null);
    }
  }, [visible, initial.name, initial.comment, initial.public]);

  const canSave = name.trim().length > 0;

  async function pickCover() {
    setCoverError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset) return;
    const image: PickedImage = {
      uri: asset.uri,
      name: asset.fileName ?? 'cover.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    };
    await runCoverAction({ kind: 'upload', image });
  }

  async function runCoverAction(action: CoverAction) {
    setCoverError(null);
    if (localCoverId) {
      // Lista del perfil local: la carátula se copia/borra en el dispositivo.
      setUploading(true);
      try {
        if (action.kind === 'upload') {
          await setLocalPlaylistCover(localCoverId, action.image.uri);
          setPickedUri(action.image.uri);
        } else {
          await removeLocalPlaylistCover(localCoverId);
          setPickedUri(null);
        }
        void queryClient.invalidateQueries({ queryKey: ['playlist', localCoverId] });
        void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      } catch {
        setCoverError(t("Couldn't update the cover"));
      } finally {
        setUploading(false);
      }
      return;
    }
    if (!coverUploadId || !auth) return;
    if (!auth.ndPassword) {
      // Perfil de antes de guardar la contraseña: pedirla una vez.
      setPendingAction(action);
      setAskPassword(true);
      return;
    }
    await doCoverAction(action, auth);
  }

  async function doCoverAction(action: CoverAction, authToUse: NonNullable<typeof auth>) {
    if (!coverUploadId) return;
    setUploading(true);
    try {
      if (action.kind === 'upload') {
        await uploadPlaylistImage(authToUse, coverUploadId, action.image);
        setPickedUri(action.image.uri);
      } else {
        await deletePlaylistImage(authToUse, coverUploadId);
        setPickedUri(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['playlist', coverUploadId] });
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
    } catch (e) {
      if (e instanceof NavidromeError && e.kind === 'auth') {
        // Contraseña mala guardada: se olvida para volver a pedirla.
        void saveNativePassword('');
        setCoverError(t('Wrong password'));
      } else if (e instanceof NavidromeError && e.kind === 'unsupported') {
        setCoverError(t("Your server doesn't support playlist covers"));
      } else if (e instanceof NavidromeError && e.kind === 'forbidden') {
        setCoverError(t('Artwork upload is disabled on the server'));
      } else {
        setCoverError(t("Couldn't update the cover"));
      }
    } finally {
      setUploading(false);
    }
  }

  async function onPasswordConfirm(password: string) {
    setAskPassword(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!password || !action || !auth) return;
    await saveNativePassword(password);
    await doCoverAction(action, { ...auth, ndPassword: password });
  }

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
            <Text style={[styles.headerAction, { color: colors.accent }]}>{t('Cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('Edit playlist')}</Text>
          <Pressable
            hitSlop={12}
            disabled={!canSave}
            onPress={() => onSave({ name: name.trim(), comment: comment.trim(), public: isPublic })}
          >
            <Text style={[styles.headerAction, { color: colors.accent }, !canSave && styles.disabled]}>{t('Save')}</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.coverWrap}>
              {coverUploadId || localCoverId ? (
                <>
                  <Pressable
                    onPress={() => void pickCover()}
                    disabled={uploading}
                    accessibilityRole="button"
                    accessibilityLabel={t('Change cover')}
                    style={({ pressed }) => pressed && { opacity: 0.7 }}
                  >
                    <Cover uri={pickedUri ?? coverUri} size={160} />
                    {uploading ? (
                      <View style={styles.coverOverlay}>
                        <ActivityIndicator color={colors.text} />
                      </View>
                    ) : (
                      <View style={styles.coverBadges}>
                        <View style={styles.coverBadge}>
                          <Ionicons name="camera" size={16} color={colors.text} />
                        </View>
                        <Pressable
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={t('Remove cover')}
                          onPress={() => void runCoverAction({ kind: 'remove' })}
                          style={({ pressed }) => [styles.coverBadge, pressed && { opacity: 0.7 }]}
                        >
                          <Ionicons name="trash-outline" size={16} color={colors.text} />
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                  {coverError ? <Text style={styles.coverError}>{coverError}</Text> : null}
                </>
              ) : (
                <Cover uri={coverUri} size={160} />
              )}
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

      <Dialog
        visible={askPassword}
        title={t('Confirm your password')}
        message={t('Your password is needed to upload images and will be stored securely.')}
        input={{ placeholder: t('Password'), secure: true }}
        confirmLabel={t('Save')}
        onCancel={() => {
          setAskPassword(false);
          setPendingAction(null);
        }}
        onConfirm={(value) => void onPasswordConfirm(value)}
      />
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
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.md,
  },
  coverBadges: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  coverBadge: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.pill,
    padding: spacing.sm,
  },
  coverError: {
    color: colors.danger,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
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
