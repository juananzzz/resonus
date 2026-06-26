/** Inicio de sesión: elección de tipo de servidor + credenciales. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type OfflineProfile,
  type Profile,
  type ServerProfile,
  useAuthStore,
} from '@/store/auth';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';

type ServerKey = 'navidrome' | 'opensubsonic' | 'jellyfin';

const SERVERS: {
  key: ServerKey;
  name: string;
  logo: number;
  soon?: boolean;
}[] = [
  { key: 'navidrome', name: 'Navidrome', logo: require('@/assets/images/servers/navidrome.png') },
  { key: 'opensubsonic', name: 'OpenSubsonic', logo: require('@/assets/images/servers/opensubsonic.png') },
  { key: 'jellyfin', name: 'Jellyfin', logo: require('@/assets/images/servers/jellyfin.png'), soon: true },
];

function logoFor(type?: string): number {
  return SERVERS.find((s) => s.key === type)?.logo ?? SERVERS[0].logo;
}

function isServer(p: Profile): p is ServerProfile {
  return p._type === 'server';
}

function isOffline(p: Profile): p is OfflineProfile {
  return p._type === 'offline';
}

function ProfileRow({ profile, onTap, onRemove }: {
  profile: Profile;
  onTap: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  if (isOffline(profile)) {
    return (
      <View style={styles.profileRow}>
        <Pressable style={styles.profileMain} onPress={onTap}>
          <View style={styles.offlineIcon}>
            <Ionicons name="cloud-offline-outline" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileUser} numberOfLines={1}>
              {t('Modo sin conexión')}
            </Text>
            <Text style={styles.profileUrl} numberOfLines={1}>
              {profile.name}
            </Text>
          </View>
        </Pressable>
        <Pressable hitSlop={10} onPress={onRemove}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.profileRow}>
      <Pressable style={styles.profileMain} onPress={onTap}>
        <Image
          source={logoFor(profile.serverType)}
          style={styles.profileLogo}
          contentFit="contain"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.profileUser} numberOfLines={1}>
            {profile.username}
          </Text>
          <Text style={styles.profileUrl} numberOfLines={1}>
            {profile.serverUrl}
          </Text>
        </View>
      </Pressable>
      <Pressable hitSlop={10} onPress={onRemove}>
        <Ionicons name="close" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const MAX_VISIBLE = 3;

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const profiles = useAuthStore((s) => s.profiles);
  const switchProfile = useAuthStore((s) => s.switchProfile);
  const removeProfile = useAuthStore((s) => s.removeProfile);
  const enterOffline = useAuthStore((s) => s.enterOffline);
  const toast = useToast((s) => s.show);
  const t = useT();
  const [server, setServer] = useState<ServerKey>('navidrome');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const isJellyfin = server === 'jellyfin';
  const canSubmit = serverUrl.trim() && username.trim() && password && !loading;
  const visible = profiles.slice(0, MAX_VISIBLE);
  const overflow = profiles.length > MAX_VISIBLE;

  async function onSubmit() {
    if (isJellyfin) {
      toast(t('Jellyfin estará disponible pronto 🚧'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(serverUrl, username, password, server);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('No se pudo iniciar sesión'));
    } finally {
      setLoading(false);
    }
  }

  async function onProfileTap(p: Profile) {
    try {
      await switchProfile(p);
    } catch {
      if (isServer(p)) {
        toast(t('No se pudo entrar; revisa la cuenta'));
      }
    }
  }

  function onProfileRemove(p: Profile) {
    removeProfile(p);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.logo}>Resonus</Text>
          <Text style={styles.subtitle}>{t('Conéctate a tu servidor de música')}</Text>

          {profiles.length > 0 ? (
            <View style={styles.profiles}>
              <Text style={styles.groupTitle}>{t('Perfiles guardados')}</Text>
              {visible.map((p, i) => (
                <ProfileRow
                  key={isOffline(p) ? `offline-${i}` : `${p.serverUrl}-${p.username}`}
                  profile={p}
                  onTap={() => onProfileTap(p)}
                  onRemove={() => onProfileRemove(p)}
                />
              ))}
              {overflow ? (
                <Pressable style={styles.showMore} onPress={() => setShowAll(true)}>
                  <Text style={styles.showMoreText}>
                    {t('Mostrar todos')} ({profiles.length})
                  </Text>
                  <Ionicons name="chevron-down" size={18} color={colors.accent} />
                </Pressable>
              ) : null}
              <Text style={styles.groupTitle}>{t('Añadir otra cuenta')}</Text>
            </View>
          ) : null}

          <View style={styles.servers}>
            {SERVERS.map((s) => {
              const active = s.key === server;
              return (
                <Pressable
                  key={s.key}
                  style={[styles.serverCard, active && styles.serverCardActive]}
                  onPress={() => setServer(s.key)}
                >
                  <Image
                    source={s.logo}
                    style={styles.serverIcon}
                    contentFit="contain"
                  />
                  <Text style={styles.serverName} numberOfLines={1}>
                    {s.name}
                  </Text>
                  {s.soon ? <Text style={styles.soon}>{t('Pronto')}</Text> : null}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="https://musica.midominio.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={serverUrl}
              onChangeText={setServerUrl}
            />
            <TextInput
              style={styles.input}
              placeholder={t('Usuario')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
            />
            <TextInput
              style={styles.input}
              placeholder={t('Contraseña')}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            {isJellyfin ? (
              <Text style={styles.notice}>
                {t('El soporte de Jellyfin llegará pronto. Por ahora usa Navidrome u OpenSubsonic.')}
              </Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.button, (!canSubmit || isJellyfin) && styles.buttonDisabled]}
              disabled={!canSubmit}
              onPress={onSubmit}
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.buttonText}>{t('Entrar')}</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('o')}</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable style={styles.offlineButton} onPress={() => enterOffline()}>
              <Ionicons name="cloud-offline-outline" size={20} color={colors.text} />
              <Text style={styles.offlineText}>{t('Modo sin conexión')}</Text>
            </Pressable>
            <Text style={styles.offlineHint}>
              {t('Escucha la música guardada en tu dispositivo, sin servidor.')}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showAll}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAll(false)}
      >
        <SafeAreaView style={styles.modalSafe} edges={['top']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('Perfiles guardados')}</Text>
            <Pressable hitSlop={12} onPress={() => setShowAll(false)}>
              <Text style={styles.modalDone}>{t('Cerrar')}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalList}>
            {profiles.map((p, i) => (
              <ProfileRow
                key={isOffline(p) ? `all-offline-${i}` : `all-${p.serverUrl}-${p.username}`}
                profile={p}
                onTap={() => {
                  setShowAll(false);
                  void onProfileTap(p);
                }}
                onRemove={() => onProfileRemove(p)}
              />
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  logo: {
    color: colors.accent,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  profiles: { gap: spacing.sm, marginBottom: spacing.lg },
  groupTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  profileMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileLogo: { width: 36, height: 36 },
  profileUser: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  profileUrl: { color: colors.textMuted, fontSize: fontSize.xs },
  offlineIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  showMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  showMoreText: { color: colors.accent, fontSize: fontSize.sm, fontWeight: '600' },
  servers: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  serverCard: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  serverCardActive: { borderColor: colors.accent },
  serverIcon: { width: 48, height: 48 },
  serverName: { color: colors.text, fontSize: fontSize.xs, fontWeight: '600' },
  soon: { color: colors.textMuted, fontSize: 10 },
  form: { gap: spacing.md },
  input: {
    backgroundColor: colors.surfaceHighlight,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  notice: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: fontSize.sm },
  offlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  offlineText: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  offlineHint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  modalDone: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
  modalList: { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xl },
});
