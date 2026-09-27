/**
 * Where a Resonus link lands (#176): `resonus://album/<id>?server=<host>`,
 * rewritten here by `+native-intent`, or pasted into Search.
 *
 * The id only means something on its own server, so the first job is finding a
 * profile there. The one signed in wins when it matches; otherwise the profiles
 * on that host are offered, since switching stops what is playing and there
 * may be more than one account on the same server. Nothing matching is said
 * as much, rather than opening the id in the wrong library.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackChevron } from '@/components/BackChevron';
import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { hostOf, linkRoute, profileOnHost, type LinkKind } from '@/lib/resonusLink';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore, type ServerProfile } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, tracking, useTheme } from '@/theme';

const KINDS: LinkKind[] = ['album', 'artist', 'playlist'];

export default function OpenLinkScreen() {
  useTheme();
  const t = useT();
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const params = useLocalSearchParams<{ kind?: string; id?: string; server?: string }>();
  const kind = KINDS.includes(params.kind as LinkKind) ? (params.kind as LinkKind) : null;
  const id = params.id ?? '';
  const server = (params.server ?? '').toLowerCase();
  const auth = useAuthStore((s) => s.auth);
  const profiles = useAuthStore((s) => s.profiles);
  const hydrating = useAuthStore((s) => s.hydrating);
  const switchProfile = useAuthStore((s) => s.switchProfile);
  const hasQueue = usePlayerStore((s) => s.queue.length > 0);
  const [switching, setSwitching] = useState<ServerProfile | null>(null);
  const went = useRef(false);

  const valid = !!kind && !!id && !!server;
  const matches = valid
    ? profiles.filter((p): p is ServerProfile => p._type === 'server' && profileOnHost(p, server))
    : [];
  const activeMatches = valid && !!auth && profileOnHost(auth, server);

  function go() {
    if (went.current || !kind) return;
    went.current = true;
    const route = linkRoute({ kind, id });
    if (router.canGoBack()) {
      router.replace(route);
    } else {
      // Opened cold: something has to be under the screen for Back to land on.
      router.replace('/(tabs)');
      router.push(route);
    }
  }

  useEffect(() => {
    if (!hydrating && activeMatches) go();
  });

  async function openWith(profile: ServerProfile) {
    if (switching) return;
    setSwitching(profile);
    try {
      await switchProfile(profile);
      go();
    } catch {
      toast(t("Couldn't sign in; check the account"));
      setSwitching(null);
    }
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  const waiting = hydrating || activeMatches;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <BackChevron size={28} label={t('Close')} onPress={close} />
        <Text style={styles.barTitle}>{t('Open link')}</Text>
      </View>
      {waiting ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {!valid ? (
            <Text style={styles.message}>{t("This link isn't one Resonus can open.")}</Text>
          ) : matches.length === 0 ? (
            <Text style={styles.message}>
              {t('None of your profiles is on {server}. Add an account on that server to open it.', {
                server,
              })}
            </Text>
          ) : (
            <>
              <Text style={styles.message}>
                {t('This link is for {server}. Open it with:', { server })}
              </Text>
              {matches.map((p) => {
                const busy = switching === p;
                return (
                  <Pressable
                    key={`${primaryUrl(p)}|${p.username}`}
                    style={({ pressed }) => [styles.profile, pressed && { opacity: 0.6 }]}
                    disabled={!!switching}
                    onPress={() => void openWith(p)}
                  >
                    <Icon name="server-outline" size={22} color={colors.text} />
                    <View style={styles.profileText}>
                      <Text style={styles.profileName} numberOfLines={1}>
                        {p.username}
                      </Text>
                      <Text style={styles.profileHost} numberOfLines={1}>
                        {hostOf(primaryUrl(p)) ?? primaryUrl(p)}
                      </Text>
                    </View>
                    {busy ? <ActivityIndicator color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
              {hasQueue ? (
                <Text style={styles.note}>{t('Switching profile stops what is playing.')}</Text>
              ) : null}
            </>
          )}
          <Pressable
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}
            onPress={close}
          >
            <Text style={styles.closeText}>{t('Close')}</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  barTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
  },
  center: { flex: 1, justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  message: { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  note: { color: colors.textSecondary, fontSize: fontSize.sm },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  profileHost: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  closeButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  closeText: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '500' },
}));
