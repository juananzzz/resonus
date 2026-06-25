/** Hoja inferior con acciones para una canción (menú ⋯). */
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addToPlaylist, coverArtUrl, getPlaylists, star } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
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
  const toast = useToast((s) => s.show);

  const [mode, setMode] = useState<'actions' | 'playlists' | 'sleep'>('actions');

  // Al abrir el menú para una canción, volvemos siempre a la vista de acciones.
  useEffect(() => {
    if (song) setMode('actions');
  }, [song]);

  const { data: playlists, isLoading: loadingPlaylists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(auth!),
    enabled: !!auth && mode === 'playlists',
  });

  if (!song) return null;

  const go = (path: string) => {
    close();
    router.push(path);
  };

  async function addTo(playlistId: string, playlistName: string) {
    if (!auth || !song) return;
    close();
    try {
      await addToPlaylist(auth, playlistId, song.id);
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      toast(`Añadida a "${playlistName}"`);
    } catch {
      toast('No se pudo añadir a la lista');
    }
  }

  const soon = () => {
    close();
    toast('Próximamente 🚧');
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

        {mode === 'playlists' ? (
          <View style={{ maxHeight: 360 }}>
            <Pressable
              style={styles.action}
              onPress={() => setMode('actions')}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
              <Text style={styles.actionText}>Añadir a una playlist</Text>
            </Pressable>
            {loadingPlaylists ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : (
              <ScrollView>
                {(playlists ?? []).map((p) => (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                    onPress={() => addTo(p.id, p.name)}
                  >
                    <Cover uri={coverArtUrl(auth!, p.coverArt ?? p.id, 100)} size={40} />
                    <Text style={styles.actionText} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        ) : mode === 'sleep' ? (
          <View>
            <Pressable style={styles.action} onPress={() => setMode('actions')}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
              <Text style={styles.actionText}>Temporizador de apagado</Text>
            </Pressable>
            {[15, 30, 45, 60].map((m) => (
              <Pressable
                key={m}
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  setSleepTimer(m);
                  toast(`Se pausará en ${m} min`);
                  close();
                }}
              >
                <Ionicons name="time-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{m} minutos</Text>
              </Pressable>
            ))}
            {sleepTimerMinutes ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  cancelSleepTimer();
                  toast('Temporizador desactivado');
                  close();
                }}
              >
                <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
                <Text style={[styles.actionText, { color: colors.danger }]}>
                  Desactivar
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <Action
              icon="add-circle-outline"
              label="Añadir a una playlist"
              onPress={() => setMode('playlists')}
            />
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
                toast('Añadida a favoritos');
                close();
              }}
            />
            <Action
              icon="musical-notes-outline"
              label="Letra"
              onPress={() => go('/lyrics')}
            />
            <Action icon="download-outline" label="Descargar" onPress={soon} />
            <Action
              icon="moon-outline"
              label={
                sleepTimerMinutes
                  ? `Temporizador (${sleepTimerMinutes} min)`
                  : 'Temporizador de apagado'
              }
              onPress={() => setMode('sleep')}
            />
          </>
        )}
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
