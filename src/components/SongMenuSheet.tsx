/** Hoja inferior con acciones para una canción (menú ⋯). */
import Ionicons from '@expo/vector-icons/Ionicons';
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

import {
  addToPlaylist,
  coverArtUrl,
  createPlaylist,
  getPlaylists,
  removeFromPlaylist,
  star,
} from '@/api/data';
import { normKey } from '@/lib/localLibrary';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSongMenu } from '@/store/songMenu';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';

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
  const offline = useAuthStore((s) => s.offline);
  const queryClient = useQueryClient();
  const song = useSongMenu((s) => s.song);
  const context = useSongMenu((s) => s.context);
  const close = useSongMenu((s) => s.close);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAtSongEnd = usePlayerStore((s) => s.setSleepAtSongEnd);
  const cancelSleepTimer = usePlayerStore((s) => s.cancelSleepTimer);
  const sleepTimerMinutes = usePlayerStore((s) => s.sleepTimerMinutes);
  const sleepAtSongEnd = usePlayerStore((s) => s.sleepAtSongEnd);
  const toast = useToast((s) => s.show);
  const t = useT();
  const downloaded = useDownloads((s) => !!(song && s.files[song.id]));
  const downloadSong = useDownloads((s) => s.downloadSong);
  const deleteDownloads = useDownloads((s) => s.deleteSongs);

  const [mode, setMode] = useState<'actions' | 'playlists' | 'sleep'>('actions');
  const [creating, setCreating] = useState(false);

  // Al abrir el menú para una canción, volvemos siempre a la vista de acciones.
  useEffect(() => {
    if (song) setMode('actions');
  }, [song]);

  const { data: playlists, isLoading: loadingPlaylists } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: (!!auth || offline) && mode === 'playlists',
  });

  if (!song) return null;

  const go = (path: string) => {
    close();
    router.push(path);
  };

  async function addTo(playlistId: string, playlistName: string) {
    if ((!auth && !offline) || !song) return;
    close();
    try {
      await addToPlaylist(playlistId, song.id);
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      toast(t('Added to “{name}”', { name: playlistName }));
    } catch {
      toast(t("Couldn't add to the playlist"));
    }
  }

  async function createAndAdd(name: string) {
    setCreating(false);
    if ((!auth && !offline) || !song || !name.trim()) return;
    close();
    try {
      const id = await createPlaylist(name.trim());
      await addToPlaylist(id, song.id);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Added to “{name}”', { name: name.trim() }));
    } catch {
      toast(t("Couldn't create the playlist"));
    }
  }

  async function removeFromList() {
    if ((!auth && !offline) || !context) return;
    close();
    try {
      await removeFromPlaylist(context.playlistId, context.index);
      queryClient.invalidateQueries({ queryKey: ['playlist', context.playlistId] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(t('Removed from playlist'));
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.headerRow}>
          <Cover uri={coverArtUrl( song.coverArt ?? song.albumId, 100)} size={48} />
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
              <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => setCreating(true)}
            >
              <View style={styles.newPlaylistIcon}>
                <Ionicons name="add" size={24} color={colors.text} />
              </View>
              <Text style={styles.actionText}>{t('New playlist')}</Text>
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
                    <Cover uri={coverArtUrl( p.coverArt ?? p.id, 100)} size={40} />
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
              <Text style={styles.actionText}>{t('Sleep timer')}</Text>
            </Pressable>
            {[15, 30, 45, 60].map((m) => (
              <Pressable
                key={m}
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  setSleepTimer(m);
                  toast(t('Will pause in {n} min', { n: m }));
                  close();
                }}
              >
                <Ionicons name="time-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('{n} minutes', { n: m })}</Text>
              </Pressable>
            ))}
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                setSleepAtSongEnd();
                toast(t('Will pause when the song ends'));
                close();
              }}
            >
              <Ionicons name="musical-note-outline" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('When the song ends')}</Text>
            </Pressable>
            {sleepTimerMinutes || sleepAtSongEnd ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  cancelSleepTimer();
                  toast(t('Sleep timer off'));
                  close();
                }}
              >
                <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
                <Text style={[styles.actionText, { color: colors.danger }]}>
                  {t('Turn off')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <Action
              icon="add-circle-outline"
              label={t('Add to a playlist')}
              onPress={() => setMode('playlists')}
            />
            {context ? (
              <Action
                icon="remove-circle-outline"
                label={t('Remove from playlist')}
                onPress={removeFromList}
              />
            ) : null}
            {(song.artistId || song.artist) ? (
              <Action
                icon="person"
                label={t('Go to artist')}
                onPress={() => {
                  const id = song.artistId ?? (song.artist ? normKey(song.artist) : '');
                  if (id) go(`/artist/${id}`);
                }}
              />
            ) : null}
            {(song.albumId || song.album) ? (
              <Action
                icon="disc"
                label={t('Go to album')}
                onPress={() => {
                  if (song.albumId) { go(`/album/${song.albumId}`); return; }
                  if (song.album) {
                    const key = normKey(song.album) + '|' + normKey(song.artist || '');
                    go(`/album/${key}`);
                  }
                }}
              />
            ) : null}
            <Action
              icon="play-forward"
              label={t('Play next')}
              onPress={() => {
                playNext(song);
                toast(t('Playing next'));
                close();
              }}
            />
            <Action
              icon="list"
              label={t('Add to queue')}
              onPress={() => {
                addToQueue(song);
                toast(t('Added to queue'));
                close();
              }}
            />
            <Action
              icon="heart-outline"
              label={t('Add to favorites')}
              onPress={() => {
                star(song.id).then(() =>
                  queryClient.invalidateQueries({ queryKey: ['starred'] }),
                );
                toast(t('Added to favorites'));
                close();
              }}
            />
            <Action
              icon="musical-notes-outline"
              label={t('Lyrics')}
              onPress={() => go('/lyrics')}
            />
            {downloaded ? (
              <Action
                icon="arrow-down-circle"
                label={t('Remove download')}
                onPress={() => {
                  void deleteDownloads([song.id]);
                  toast(t('Download removed'));
                  close();
                }}
              />
            ) : !offline && !song.url ? (
              <Action
                icon="download-outline"
                label={t('Download')}
                onPress={() => {
                  void downloadSong(song);
                  toast(t('Downloading…'));
                  close();
                }}
              />
            ) : null}
            <Action
              icon="moon-outline"
              label={
                sleepTimerMinutes
                  ? t('Sleep timer ({n} min)', { n: sleepTimerMinutes })
                  : sleepAtSongEnd
                    ? t('Sleep timer (end of song)')
                    : t('Sleep timer')
              }
              onPress={() => setMode('sleep')}
            />
          </>
        )}
      </View>

      <Dialog
        visible={creating}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => setCreating(false)}
        onConfirm={createAndAdd}
      />
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
  newPlaylistIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
