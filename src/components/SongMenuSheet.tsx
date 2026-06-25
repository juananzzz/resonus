/** Hoja inferior con acciones para una canción (menú ⋯). */
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverArtUrl, star } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useSongMenu } from '@/store/songMenu';
import { colors, fontSize, spacing } from '@/theme';
import { Cover } from './Cover';

function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export function SongMenuSheet() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const auth = useAuthStore((s) => s.auth);
  const queryClient = useQueryClient();
  const song = useSongMenu((s) => s.song);
  const close = useSongMenu((s) => s.close);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const cancelSleepTimer = usePlayerStore((s) => s.cancelSleepTimer);
  const sleepTimerMinutes = usePlayerStore((s) => s.sleepTimerMinutes);

  if (!song) return null;

  const go = (path: string) => {
    close();
    router.push(path);
  };

  const soon = () => {
    close();
    Alert.alert('Próximamente', 'Esta función llegará pronto.');
  };

  const openSleepTimer = () => {
    close();
    const minutes = [15, 30, 45, 60];
    Alert.alert(
      'Temporizador de apagado',
      sleepTimerMinutes
        ? `Activo: la música se pausará en ~${sleepTimerMinutes} min.`
        : 'Pausar la música tras…',
      [
        ...minutes.map((m) => ({
          text: `${m} min`,
          onPress: () => setSleepTimer(m),
        })),
        ...(sleepTimerMinutes
          ? [
              {
                text: 'Desactivar',
                style: 'destructive' as const,
                onPress: cancelSleepTimer,
              },
            ]
          : []),
        { text: 'Cancelar', style: 'cancel' as const },
      ],
    );
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.headerRow}>
          <Cover uri={coverArtUrl(auth!, song.coverArt ?? song.albumId, 100)} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {song.title}
            </Text>
            {song.artist ? (
              <Text style={styles.artist} numberOfLines={1}>
                {song.artist}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.divider} />

        <Action icon="add-circle-outline" label="Añadir a una playlist" onPress={soon} />
        {song.artistId ? (
          <Action
            icon="person"
            label="Ir al artista"
            onPress={() => go(`/artist/${song.artistId}`)}
          />
        ) : null}
        {song.albumId ? (
          <Action
            icon="disc"
            label="Ir al álbum"
            onPress={() => go(`/album/${song.albumId}`)}
          />
        ) : null}
        <Action
          icon="play-forward"
          label="Reproducir a continuación"
          onPress={() => {
            playNext(song);
            close();
          }}
        />
        <Action
          icon="list"
          label="Añadir a la cola"
          onPress={() => {
            addToQueue(song);
            close();
          }}
        />
        <Action
          icon="heart-outline"
          label="Añadir a favoritos"
          onPress={() => {
            if (auth) {
              star(auth, song.id).then(() =>
                queryClient.invalidateQueries({ queryKey: ['starred'] }),
              );
            }
            close();
          }}
        />
        <Action icon="musical-notes-outline" label="Letra" onPress={soon} />
        <Action icon="download-outline" label="Descargar" onPress={soon} />
        <Action
          icon="moon-outline"
          label={
            sleepTimerMinutes
              ? `Temporizador (${sleepTimerMinutes} min)`
              : 'Temporizador de apagado'
          }
          onPress={openSleepTimer}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  artist: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
});
