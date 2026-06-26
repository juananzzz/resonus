/** Inicio de sesión: elección de tipo de servidor + credenciales. */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
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

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const profiles = useAuthStore((s) => s.profiles);
  const switchProfile = useAuthStore((s) => s.switchProfile);
  const removeProfile = useAuthStore((s) => s.removeProfile);
  const toast = useToast((s) => s.show);
  const [server, setServer] = useState<ServerKey>('navidrome');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isJellyfin = server === 'jellyfin';
  const canSubmit = serverUrl.trim() && username.trim() && password && !loading;

  async function onSubmit() {
    if (isJellyfin) {
      toast('Jellyfin estará disponible pronto 🚧');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Navidrome y OpenSubsonic comparten la API Subsonic.
      await login(serverUrl, username, password, server);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
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
          <Text style={styles.subtitle}>Conéctate a tu servidor de música</Text>

          {profiles.length > 0 ? (
            <View style={styles.profiles}>
              <Text style={styles.groupTitle}>Tus cuentas</Text>
              {profiles.map((p) => (
                <View key={`${p.serverUrl}-${p.username}`} style={styles.profileRow}>
                  <Pressable
                    style={styles.profileMain}
                    onPress={async () => {
                      try {
                        await switchProfile(p);
                      } catch {
                        toast('No se pudo entrar; revisa la cuenta');
                      }
                    }}
                  >
                    <Image
                      source={logoFor(p.serverType)}
                      style={styles.profileLogo}
                      contentFit="contain"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.profileUser} numberOfLines={1}>
                        {p.username}
                      </Text>
                      <Text style={styles.profileUrl} numberOfLines={1}>
                        {p.serverUrl}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable hitSlop={10} onPress={() => removeProfile(p)}>
                    <Ionicons name="close" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
              <Text style={styles.groupTitle}>Añadir otra cuenta</Text>
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
                  {s.soon ? <Text style={styles.soon}>Pronto</Text> : null}
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
              placeholder="Usuario"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
            />
            <TextInput
              style={styles.input}
              placeholder="Contraseña"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            {isJellyfin ? (
              <Text style={styles.notice}>
                El soporte de Jellyfin llegará pronto. Por ahora usa Navidrome u
                OpenSubsonic.
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
                <Text style={styles.buttonText}>Entrar</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  serverIcon: {
    width: 48,
    height: 48,
  },
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
});
