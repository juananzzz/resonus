/**
 * Bottom sheet to pick a target playlist and add songs in bulk (multi-select).
 * Allows creating a new playlist. Handles the addition and toasts itself, so
 * it can be reused from any screen.
 *
 * Favorites is not a row here any more: it is a property of the song rather
 * than a list it belongs to, and this sheet could never take one off. It is in
 * the ⋯ menu of the selection now (#164).
 */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addToPlaylist, COVER, createPlaylist, getPlaylist, getPlaylists } from '@/api/data';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useScreenSize } from '@/hooks/useScreenSize';
import { type Song } from '@/api/subsonic';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { songsLabel, useT } from '@/i18n';
import { useAutoDownloads } from '@/store/autoDownloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';

/** Maximum height of the playlist list: proportional to the screen so it
 *  doesn't look cramped on large phones (previously a fixed 400), and read
 *  while rendering so a turn does not leave it taller than the screen (#131). */
function playlistsMaxH(height: number): number {
  return Math.round(height * 0.6);
}

/** Global instance (mounted once in the root layout): any place can open it
 *  via `usePlaylistPicker.open(songs)` without rendering its own sheet. */
export function GlobalPlaylistPicker() {
  const songs = usePlaylistPicker((s) => s.songs);
  const close = usePlaylistPicker((s) => s.close);
  return <PlaylistPickerSheet songs={songs} onClose={close} />;
}


export function PlaylistPickerSheet({
  songs,
  excludeId,
  onClose,
}: {
  /** Songs to add; null = sheet hidden. */
  songs: Song[] | null;
  /** Playlist to hide from the list (the source one). */
  excludeId?: string;
  onClose: () => void;
}) {
  const { coverArtUrl } = useCoverUrls();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useScreenSize();
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const visible = !!songs && songs.length > 0;
  const { dismiss, pan, makePan, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(
    visible,
    onClose,
  );
  // Second drag, for the grabber and the title (see the JSX below).
  const headerPan = makePan();
  // The list is scrolled to the top: only then does a downward drag belong to
  // the sheet, so pulling down mid-list scrolls instead of dismissing.
  const [atTop, setAtTop] = useState(true);
  const close = () => dismiss(onClose);
  const [creating, setCreating] = useState(false);
  // "Already in the playlist" prompt pending confirmation (Spotify style).
  const [dupPrompt, setDupPrompt] = useState<{
    playlistId: string;
    name: string;
    /** The ones not in that playlist yet. Empty when every one of them is. */
    fresh: Song[];
  } | null>(null);

  const { data: playlists, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: visible,
  });

  if (!songs || songs.length === 0) return null;

  /** Actually adds (without checking duplicates) and closes with a toast.
   *  `which` is what to add, for when the answer to the warning was to leave
   *  the ones that are already there alone. */
  async function doAdd(playlistId: string, name: string, which?: Song[]) {
    const adding = which ?? songs;
    if (!adding || adding.length === 0) return;
    close();
    try {
      for (const s of adding) await addToPlaylist(playlistId, s.id);
      // Optimistic count in the Library (`songsLabel`): without this the
      // subtitle doesn't update until that screen is reloaded.
      queryClient.setQueryData<{ id: string; songCount?: number }[]>(['playlists'], (list) =>
        list?.map((p) =>
          p.id === playlistId ? { ...p, songCount: (p.songCount ?? 0) + adding.length } : p,
        ),
      );
      queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      // If the list has auto-download, fetch the newly added songs now.
      void useAutoDownloads.getState().reconcile(playlistId, true);
      toast(
        adding.length === 1
          ? t('Added to “{name}”', { name })
          : t('{n} added to “{name}”', { n: adding.length, name }),
      );
    } catch {
      toast(t("Couldn't add to the playlist"));
    }
  }

  async function addAllTo(playlistId: string, name: string) {
    if (!songs) return;
    // Spotify-style duplicate warning: if any already present, ask first. If
    // the check fails (network), add without warning: better than blocking.
    try {
      const { songs: existing } = await getPlaylist(playlistId);
      const have = new Set(existing.map((s) => s.id));
      const fresh = songs.filter((s) => !have.has(s.id));
      if (fresh.length < songs.length) {
        setDupPrompt({ playlistId, name, fresh });
        return;
      }
    } catch {
      // ignore
    }
    await doAdd(playlistId, name);
  }

  /** The warning has something to offer besides adding them all again. */
  const hasFresh = !!dupPrompt && dupPrompt.fresh.length > 0;

  async function createAndAdd(name: string) {
    setCreating(false);
    if (!name.trim()) return;
    try {
      const id = await createPlaylist(name.trim());
      await addAllTo(id, name.trim());
    } catch {
      close();
      toast(t("Couldn't create the playlist"));
    }
  }

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      {/* Gestures inside an RN Modal need a root view of their own: the Modal
          renders in a native hierarchy outside the app's. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
          onLayout={onSheetLayout}
        >
          {/* The header has its own drag, always enabled: it's the way out when
              the list below is scrolled and keeps the gesture for itself. Two
              detectors instead of one around everything so both can never fire
              at once. */}
          <GestureDetector gesture={headerPan}>
            <View>
              {/* Spotify-style grabber: the visual cue that the sheet can be
                  dragged down to dismiss. */}
              <View style={styles.grabber} />
              <Text style={styles.title}>{t('Add to a playlist')}</Text>
              <View style={styles.divider} />
            </View>
          </GestureDetector>
          <GestureDetector gesture={pan.enabled(atTop)}>
            <View style={{ maxHeight: playlistsMaxH(screenH) }}>
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                onPress={() => setCreating(true)}
              >
                <View style={styles.newPlaylistIcon}>
                  <Icon name="add" size={24} color={colors.text} />
                </View>
                <Text style={styles.rowText}>{t('New playlist')}</Text>
              </Pressable>
              {isLoading ? (
                <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
              ) : (
                <ScrollView
                  scrollEventThrottle={16}
                  onScroll={(e) => setAtTop(e.nativeEvent.contentOffset.y <= 0)}
                >
                  {(playlists ?? [])
                    .filter((p) => p.id !== excludeId)
                    .map((p) => (
                      <Pressable
                        key={p.id}
                        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                        onPress={() => addAllTo(p.id, p.name)}
                      >
                        <Cover uri={coverArtUrl(p.coverArt ?? p.id, COVER.thumb)} size={40} />
                        <Text style={styles.rowText} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </Pressable>
                    ))}
                </ScrollView>
              )}
            </View>
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>

      <Dialog
        visible={creating}
        title={t('New playlist')}
        input={{ placeholder: t('Playlist name') }}
        confirmLabel={t('Create')}
        onCancel={() => setCreating(false)}
        onConfirm={createAndAdd}
      />

      {/* Three ways out rather than a switch inside the dialog (#132). A switch
          would be state to read and understand before pressing a button that no
          longer does what it says; each of these says what it does. With none
          of them new there is nothing to skip, so the pair collapses back into
          the single button it always was. */}
      <Dialog
        visible={!!dupPrompt}
        title={t('Already added')}
        // The counts are in the sentence because the two cases used to be one
        // word apart ("some of these" against "these"), and the one where none
        // of them are new drops the second button as well, so it came out
        // looking like the old warning that could only be answered by putting
        // every song in again (#132). "All" rather than "12 of 12": nothing to
        // skip should read as its own sentence, not as arithmetic.
        message={
          dupPrompt
            ? songs.length === 1
              ? t('This song is already in “{name}”.', { name: dupPrompt.name })
              : hasFresh
                ? t('{n} of {songs} are already in “{name}”.', {
                    n: songs.length - dupPrompt.fresh.length,
                    songs: songsLabel(songs.length, lang),
                    name: dupPrompt.name,
                  })
                : t('All {songs} are already in “{name}”.', {
                    songs: songsLabel(songs.length, lang),
                    name: dupPrompt.name,
                  })
            : undefined
        }
        // Adding only the new ones is the confirm, in the corner and in the
        // accent: it is the one nearly everybody wants and the only one that
        // cannot go wrong. Adding them all again sits right on top of it, not
        // off in the left corner where "Don't remind me" goes: these two are
        // both answers to the same question and get read one against the
        // other, so they belong in the same column.
        neutral={
          hasFresh
            ? {
                label: t('Add anyway'),
                align: 'end',
                onPress: () => {
                  const d = dupPrompt;
                  setDupPrompt(null);
                  if (d) void doAdd(d.playlistId, d.name);
                },
              }
            : undefined
        }
        confirmLabel={hasFresh ? t('Add only the new ones') : t('Add anyway')}
        onCancel={() => setDupPrompt(null)}
        onConfirm={() => {
          const d = dupPrompt;
          setDupPrompt(null);
          if (d) void doAdd(d.playlistId, d.name, hasFresh ? d.fresh : undefined);
        }}
      />
    </Modal>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    // Smaller than the old spacing.lg because the grabber below already brings
    // its own margin: together they add up to the same top gap as before.
    paddingTop: spacing.sm,
  },
  // Spotify's little handle. Its only job is to advertise the drag gesture, so
  // it stays discreet: it must read as an affordance, not as a control.
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', paddingBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  newPlaylistIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
