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
import { ensureAudioPermission, pickFolder } from '@/lib/localLibrary';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';

type ServerKey = 'navidrome' | 'opensubsonic' | 'jellyfin' | 'ampache';

const APP_ICON = require('@/assets/images/icon.png');

const SERVERS: {
  key: ServerKey;
  name: string;
  logo: number;
  sub: string;
  soon?: boolean;
}[] = [
  { key: 'navidrome', name: 'Navidrome', logo: require('@/assets/images/servers/navidrome.png'), sub: 'Subsonic server' },
  { key: 'opensubsonic', name: 'OpenSubsonic', logo: require('@/assets/images/servers/opensubsonic.png'), sub: 'Subsonic-compatible' },
  { key: 'jellyfin', name: 'Jellyfin', logo: require('@/assets/images/servers/jellyfin.png'), sub: 'Not available yet', soon: true },
  { key: 'ampache', name: 'Ampache', logo: require('@/assets/images/servers/ampache.png'), sub: 'Subsonic-compatible' },
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
            <Ionicons name="phone-portrait-outline" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileUser} numberOfLines={1}>
              {t('Local profile')}
            </Text>
            <Text style={styles.profileUrl} numberOfLines={1}>
              {t('Music on your device')}
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

const MAX_VISIBLE = 5;

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const profiles = useAuthStore((s) => s.profiles);
  const switchProfile = useAuthStore((s) => s.switchProfile);
  const removeProfile = useAuthStore((s) => s.removeProfile);
  const enterOffline = useAuthStore((s) => s.enterOffline);
  const setOfflineSource = useAuthStore((s) => s.setOfflineSource);
  const toast = useToast((s) => s.show);
  const t = useT();
  const [server, setServer] = useState<ServerKey | 'local'>('navidrome');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Flujo para añadir perfil: home → elegir servidor → credenciales.
  const [step, setStep] = useState<'home' | 'server' | 'form'>('home');

  const isJellyfin = server === 'jellyfin';
  const isLocal = server === 'local';
  const canSubmit = serverUrl.trim() && username.trim() && password && !loading;
  const visible = profiles.slice(0, MAX_VISIBLE);
  const overflow = profiles.length > MAX_VISIBLE;

  function goBack() {
    setError(null);
    setStep((s) => (s === 'form' ? 'server' : 'home'));
  }
  function pickServer(key: ServerKey | 'local') {
    setServer(key);
    setError(null);
    setStep('form');
  }

  // Modo sin conexión: fija el origen y entra directamente (sin pantalla intermedia).
  async function startLocalDevice() {
    const ok = await ensureAudioPermission();
    if (!ok) {
      toast(t('We need permission to read your device music.'));
      return;
    }
    await setOfflineSource({ mode: 'device' });
    await enterOffline();
  }

  async function startLocalFolder() {
    const uri = await pickFolder();
    if (!uri) return;
    await setOfflineSource({ mode: 'folder', uri });
    await enterOffline();
  }

  async function onSubmit() {
    if (isJellyfin) {
      toast(t('Jellyfin is not available yet 🚧'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(serverUrl, username, password, server);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't sign in"));
    } finally {
      setLoading(false);
    }
  }

  async function onProfileTap(p: Profile) {
    try {
      await switchProfile(p);
    } catch {
      if (isServer(p)) {
        toast(t("Couldn't sign in; check the account"));
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
          {step === 'home' ? (
            <>
              <View style={styles.topBar} />
              <View style={styles.hero}>
                <Image source={APP_ICON} style={styles.appIcon} contentFit="cover" />
                <Text style={styles.logo}>Resonus</Text>
              </View>

              {profiles.length > 0 ? (
                <View style={styles.profiles}>
                  <Text style={styles.groupTitle}>{t('Saved profiles')}</Text>
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
                      <Text style={styles.showMoreText}>{t('Show all')}</Text>
                      <Ionicons name="chevron-down" size={18} color={colors.accent} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <Pressable style={styles.addAccount} onPress={() => setStep('server')}>
                <Ionicons name="add" size={22} color={colors.background} />
                <Text style={styles.addAccountText}>{t('Add profile')}</Text>
              </Pressable>
            </>
          ) : step === 'server' ? (
            <>
              <View style={styles.topBar}>
                <Pressable
                  style={styles.backBtn}
                  onPress={goBack}
                  hitSlop={12}
                  accessibilityLabel={t('Back')}
                >
                  <Ionicons name="chevron-back" size={26} color={colors.text} />
                </Pressable>
              </View>
              <Text style={styles.stepTitle}>{t('Add profile')}</Text>
              <Text style={styles.stepHint}>{t('Choose the server type')}</Text>

              <View style={styles.srvList}>
                {SERVERS.map((s) => (
                  <Pressable
                    key={s.key}
                    style={[styles.srvRow, s.soon && styles.srvRowDisabled]}
                    onPress={() =>
                      s.soon
                        ? toast(t('{name} is not available yet 🚧', { name: s.name }))
                        : pickServer(s.key)
                    }
                  >
                    <Image source={s.logo} style={styles.srvLogo} contentFit="contain" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.srvName}>{s.name}</Text>
                      <Text style={styles.srvSub}>{t(s.sub)}</Text>
                    </View>
                    {s.soon ? null : (
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    )}
                  </Pressable>
                ))}
                <Pressable style={styles.srvRow} onPress={() => pickServer('local')}>
                  <View style={styles.srvLocalIcon}>
                    <Ionicons name="phone-portrait-outline" size={26} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.srvName}>{t('Local')}</Text>
                    <Text style={styles.srvSub}>{t('Music on your device')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.topBar}>
                <Pressable
                  style={styles.backBtn}
                  onPress={goBack}
                  hitSlop={12}
                  accessibilityLabel={t('Back')}
                >
                  <Ionicons name="chevron-back" size={26} color={colors.text} />
                </Pressable>
              </View>
              <View style={styles.serverHero}>
                {isLocal ? (
                  <Ionicons name="phone-portrait-outline" size={44} color={colors.accent} />
                ) : (
                  <Image
                    source={SERVERS.find((s) => s.key === server)?.logo ?? SERVERS[0].logo}
                    style={styles.serverHeroLogo}
                    contentFit="contain"
                  />
                )}
              </View>

              {isLocal ? (
                <View style={styles.form}>
                  <Text style={styles.localDesc}>
                    {t('Listen to music stored on your device, without a server. Choose where from:')}
                  </Text>

                  <Pressable style={styles.localOption} onPress={startLocalFolder}>
                    <Ionicons name="folder-outline" size={26} color={colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.localOptTitle}>{t('Choose a folder (recommended)')}</Text>
                      <Text style={styles.localOptSub}>{t('Only the music in the folder you choose.')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </Pressable>

                  <Pressable style={styles.localOption} onPress={startLocalDevice}>
                    <Ionicons name="phone-portrait-outline" size={26} color={colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.localOptTitle}>{t('Scan the whole phone')}</Text>
                      <Text style={styles.localOptSub}>{t('All the music on your device.')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.form}>
                  <View style={styles.inputRow}>
                    <Ionicons name="globe-outline" size={20} color={colors.textMuted} />
                    <TextInput
                      style={styles.inputFlex}
                       placeholder="https://my-music-server.com"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      value={serverUrl}
                      onChangeText={setServerUrl}
                    />
                  </View>
                  <View style={styles.inputRow}>
                    <Ionicons name="person-outline" size={20} color={colors.textMuted} />
                    <TextInput
                      style={styles.inputFlex}
                      placeholder={t('Username')}
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={username}
                      onChangeText={setUsername}
                    />
                  </View>
                  <View style={styles.inputRow}>
                    <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} />
                    <TextInput
                      style={styles.inputFlex}
                      placeholder={t('Password')}
                      placeholderTextColor={colors.textMuted}
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                    />
                  </View>

                  {isJellyfin ? (
                    <Text style={styles.notice}>
                      {t('Jellyfin support is not available yet. For now use Navidrome or OpenSubsonic.')}
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
                      <Text style={styles.buttonText}>{t('Sign in')}</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </>
          )}
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
            <Text style={styles.modalTitle}>{t('Saved profiles')}</Text>
            <Pressable hitSlop={12} onPress={() => setShowAll(false)}>
              <Text style={styles.modalDone}>{t('Close')}</Text>
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
  container: { flexGrow: 1, padding: spacing.xl, paddingTop: spacing.xxl },
  logo: {
    color: colors.accent,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    textAlign: 'center',
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
  addAccount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  addAccountText: { color: colors.background, fontSize: fontSize.md, fontWeight: '700' },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  appIcon: { width: 88, height: 88, borderRadius: 22, marginBottom: spacing.md },
  topBar: { height: 32, justifyContent: 'center', marginBottom: spacing.md },
  backBtn: { alignSelf: 'flex-start' },
  stepTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  stepHint: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  srvList: { gap: spacing.sm },
  srvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  srvRowDisabled: { opacity: 0.5 },
  srvLogo: { width: 40, height: 40 },
  srvLocalIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  srvName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  srvSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  serverHero: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 72,
    marginBottom: spacing.lg,
  },
  serverHeroLogo: { width: 64, height: 64 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  inputFlex: { flex: 1, color: colors.text, paddingVertical: spacing.md, fontSize: fontSize.md },
  localDesc: { color: colors.textSecondary, fontSize: fontSize.sm, marginBottom: spacing.xs },
  localOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  localOptTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  localOptSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  form: { gap: spacing.md },
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
