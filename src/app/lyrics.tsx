/** Letra de la canción que está sonando. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLyrics } from '@/api/subsonic';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

export default function LyricsScreen() {
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const t = useT();
  const song = usePlayerStore(currentSong);

  const { data, isLoading } = useQuery({
    queryKey: ['lyrics', song?.id],
    queryFn: () => getLyrics(auth!, song?.artist ?? '', song?.title ?? ''),
    enabled: !!auth && !!song,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {song?.title ?? t('Letra')}
          </Text>
          {song?.artist ? (
            <Text style={styles.artist} numberOfLines={1}>
              {song.artist}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 28 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.accent} />
      ) : data ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.lyrics}>{data}</Text>
        </ScrollView>
      ) : (
        <Text style={styles.empty}>{t('No hay letra disponible para esta canción.')}</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  titleBox: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs },
  content: { padding: spacing.xl, paddingBottom: SCREEN_BOTTOM_PADDING },
  lyrics: { color: colors.text, fontSize: fontSize.lg, lineHeight: 32 },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
});
