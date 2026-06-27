/** Discografía completa de un artista: cuadrícula vertical de 3 columnas. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getArtist } from '@/api/data';
import { AlbumGrid } from '@/components/AlbumGrid';
import { Message } from '@/components/Message';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

export default function DiscographyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id),
    enabled: canFetch && !!id,
  });

  const albums = [...(data?.albums ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {data?.artist.name ?? t('Discography')}
        </Text>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError || !data ? (
        <Message text={t("Couldn't load the artist.")} onRetry={() => refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: SCREEN_BOTTOM_PADDING }}>
          <Text style={styles.sectionTitle}>{t('Discography')}</Text>
          <AlbumGrid albums={albums} columns={3} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', flex: 1 },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
});
