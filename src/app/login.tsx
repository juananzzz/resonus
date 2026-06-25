/** Inicio de sesión: elección de tipo de servidor + credenciales. */
import { Ionicons } from '@expo/vector-icons';
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
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  soon?: boolean;
}[] = [
  { key: 'navidrome', name: 'Navidrome', icon: 'cloud', color: '#2A5DF0' },
  { key: 'opensubsonic', name: 'OpenSubsonic', icon: 'pulse', color: '#1DB954' },
  { key: 'jellyfin', name: 'Jellyfin', icon: 'play-circle', color: '#A35BD6', soon: true },
];

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
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
      await login(serverUrl, username, password);
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

          <View style={styles.servers}>
            {SERVERS.map((s) => {
              const active = s.key === server;
              return (
                <Pressable
                  key={s.key}
                  style={[styles.serverCard, active && styles.serverCardActive]}
                  onPress={() => setServer(s.key)}
                >
                  <View style={[styles.serverIcon, { backgroundColor: s.color }]}>
                    <Ionicons name={s.icon} size={26} color="#fff" />
                  </View>
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
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
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
