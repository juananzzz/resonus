/**
 * Cabecera con carátula + botón de reproducir y la lista de canciones.
 * Compartida por las pantallas de álbum y de lista de reproducción.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type Song } from '@/api/subsonic';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { Cover } from './Cover';
import { TrackRow } from './TrackRow';

interface Props {
  title: string;
  subtitle?: string;
  /** Si se indica, el subtítulo lleva al artista al pulsarlo. */
  artistId?: string;
  coverUri?: string;
  songs: Song[];
  currentId?: string;
  /** Numera las pistas (útil en álbumes). */
  numbered?: boolean;
  onPlay: (startIndex: number) => void;
}

export function TrackListView({
  title,
  subtitle,
  artistId,
  coverUri,
  songs,
  currentId,
  numbered,
  onPlay,
}: Props) {
  const router = useRouter();
  const t = useT();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Pressable style={styles.back} hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-down" size={28} color={colors.text} />
      </Pressable>

      <FlatList
        data={songs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Cover uri={coverUri} size={220} />
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {subtitle ? (
              artistId ? (
                <Pressable
                  hitSlop={6}
                  onPress={() => router.push(`/artist/${artistId}`)}
                >
                  <Text style={[styles.subtitle, styles.subtitleLink]}>
                    {subtitle}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.subtitle}>{subtitle}</Text>
              )
            ) : null}
            <Pressable
              style={styles.playButton}
              onPress={() => songs.length > 0 && onPlay(0)}
            >
              <Ionicons name="play" size={22} color="#000" />
              <Text style={styles.playText}>{t('Reproducir')}</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item, index }) => (
          <TrackRow
            song={item}
            position={numbered ? item.track ?? index + 1 : undefined}
            isCurrent={currentId === item.id}
            onPress={() => onPlay(index)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  back: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  subtitleLink: {
    color: colors.text,
    fontWeight: '700',
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  playText: {
    color: '#000',
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
