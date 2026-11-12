/**
 * Bottom sheet that shows which playlists hold a batch of songs. A tap adds or
 * removes straight away and the sheet stays open for the next one. A playlist
 * holding only some of them is completed by the tap, never emptied. Lists this
 * user can't change aren't offered. Reusable from any screen.
 *
 * Favorites is not a row here any more: it is a property of the song rather
 * than a list it belongs to, and this sheet could never take one off. It is in
 * the ⋯ menu of the selection now (#164).
 */
import Icon from '@/components/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  addSongsToPlaylist,
  canEditPlaylist,
  COVER,
  coverArtUrl,
  createPlaylist,
  getPlaylists,
  playlistMembership,
  removeSongsFromPlaylist,
} from '@/api/data';
import { Grabber, SheetModal } from '@/components/SheetModal';
import { haptic } from '@/lib/haptics';
import { membershipOf, type Membership } from '@/lib/playlistMembership';
import { useScreenSize } from '@/hooks/useScreenSize';
import { type Song } from '@/api/subsonic';
import { songsLabel, useT } from '@/i18n';
import { useAutoDownloads } from '@/store/autoDownloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed } from '@/theme';
import { motion } from '@/theme/motion';
import { Cover } from './Cover';
import { Dialog } from './Dialog';

/** Maximum height of the playlist list: proportional to the screen so it
 *  doesn't look cramped on large phones (previously a fixed 400), and read
 *  while rendering so a turn does not leave it taller than the screen (#131). */
function playlistsMaxH(height: number): number {
  return Math.round(height * 0.6);
}

/** Passes its size a little and settles. */
const CHECK_IN = Easing.out(Easing.back(2));

/** The circle of a row. The check grows out of it when a tap sets it, not when a fetch corrects it. */
function Mark({ state, tapped }: { state: Membership; tapped: boolean }) {
  const checked = state === 'all';
  const scale = useSharedValue(checked ? 1 : 0);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Only a change of mark moves it: `tapped` ending early must not cut the animation.
  const shown = useRef(checked);

  useEffect(() => {
    if (shown.current === checked) return;
    shown.current = checked;
    const to = checked ? 1 : 0;
    const { decorative: reduceMotion } = motion.reduceMotion;
    if (!tapped) scale.value = to;
    else if (checked) {
      scale.value = withTiming(1, { duration: motion.duration.enter, easing: CHECK_IN, reduceMotion });
    } else {
      scale.value = withTiming(0, { duration: motion.duration.exit, easing: motion.easing.exit, reduceMotion });
    }
  }, [checked, tapped, scale]);

  return (
    <View>
      {state === 'some' ? (
        <Icon name="remove-circle-outline" size={24} color={colors.accent} />
      ) : (
        <Icon name="ellipse-outline" size={24} color={colors.textMuted} />
      )}
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <Icon name="checkmark-circle" size={24} color={colors.accent} />
      </Animated.View>
    </View>
  );
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
  /** Songs to add or remove; null = sheet hidden. */
  songs: Song[] | null;
  /** Playlist to hide from the list (the source one). */
  excludeId?: string;
  onClose: () => void;
}) {
  const { height: screenH } = useScreenSize();
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const t = useT();
  const lang = useSettings((s) => s.language);
  const visible = !!songs && songs.length > 0;
  // The list is scrolled to the top: only then does a downward drag belong to
  // the sheet, so pulling down mid-list scrolls instead of dismissing.
  const [atTop, setAtTop] = useState(true);
  const [creating, setCreating] = useState(false);
  /** Playlist id → the songs of this batch it holds; absent until known. */
  const [present, setPresent] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const asked = useRef(new Set<string>());
  // A row the user has tapped knows better than a fetch still on its way.
  const tapped = useRef(new Set<string>());
  const opening = useRef(0);

  const { data: playlists, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: () => getPlaylists(),
    enabled: visible,
  });

  const targets = useMemo(
    () => (playlists ?? []).filter((p) => p.id !== excludeId && canEditPlaylist(p)),
    [playlists, excludeId],
  );
  const wanted = useMemo(() => [...new Set((songs ?? []).map((s) => s.id))], [songs]);

  useEffect(() => {
    setPresent({});
    setBusy({});
    asked.current = new Set();
    tapped.current = new Set();
    return () => {
      opening.current++;
    };
  }, [songs]);

  useEffect(() => {
    if (!visible) return;
    const lists = targets.filter((p) => !asked.current.has(p.id));
    if (lists.length === 0) return;
    for (const p of lists) asked.current.add(p.id);
    const mine = opening.current;
    const stop = () => opening.current !== mine;
    void playlistMembership(
      lists,
      wanted,
      (id, ids) => {
        if (stop() || tapped.current.has(id)) return;
        setPresent((prev) => ({ ...prev, [id]: ids }));
      },
      stop,
    ).catch(() => {
      if (stop()) return;
      // Adding reads the playlist first, so an empty mark can't duplicate.
      setPresent((prev) => {
        const next = { ...prev };
        for (const p of lists) next[p.id] ??= [];
        return next;
      });
    });
  }, [visible, targets, wanted]);

  if (!songs || songs.length === 0) return null;

  function refreshAfter(playlistId: string) {
    queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
  }

  async function add(playlistId: string, adding: Song[]) {
    await addSongsToPlaylist(playlistId, adding);
    refreshAfter(playlistId);
    // If the list has auto-download, fetch the newly added songs now.
    void useAutoDownloads.getState().reconcile(playlistId, true);
  }

  /** Applied on the tap and put back if the server refuses. */
  async function toggle(playlistId: string) {
    if (!songs || busy[playlistId]) return;
    const before = present[playlistId] ?? [];
    const removing = membershipOf(before, wanted) === 'all';
    tapped.current.add(playlistId);
    haptic('light');
    setBusy((prev) => ({ ...prev, [playlistId]: true }));
    setPresent((prev) => ({ ...prev, [playlistId]: removing ? [] : wanted }));
    try {
      if (removing) {
        await removeSongsFromPlaylist(playlistId, wanted);
        refreshAfter(playlistId);
      } else {
        await add(playlistId, songs);
      }
    } catch {
      setPresent((prev) => ({ ...prev, [playlistId]: before }));
      toast(removing ? t("Couldn't complete the action") : t("Couldn't add to the playlist"));
    } finally {
      setBusy((prev) => ({ ...prev, [playlistId]: false }));
    }
  }

  async function createAndAdd(name: string) {
    setCreating(false);
    if (!songs || !name.trim()) return;
    let id: string;
    try {
      id = await createPlaylist(name.trim());
    } catch {
      toast(t("Couldn't create the playlist"));
      return;
    }
    asked.current.add(id);
    tapped.current.add(id);
    setPresent((prev) => ({ ...prev, [id]: wanted }));
    try {
      await add(id, songs);
    } catch {
      setPresent((prev) => ({ ...prev, [id]: [] }));
      toast(t("Couldn't add to the playlist"));
      refreshAfter(id);
    }
  }

  return (
    <SheetModal
      visible={visible}
      onClosed={onClose}
      /* The list keeps the drag once it is scrolled: pulling down mid-list
         scrolls it instead of closing the sheet on somebody trying to read. So
         this sheet places its own drags - the header's and the list's - inside
         the sheet, side by side, instead of taking the frame's one around
         everything. */
      sheetDrag={false}
      /* The confirm dialog for a new playlist belongs to the `Modal` over and
         outside the sheet: the sheet stays open behind it, so confirming is not
         cancelled by the sheet going away. */
      overSheet={() => (
        <Dialog
          visible={creating}
          title={t('New playlist')}
          input={{ placeholder: t('Playlist name') }}
          confirmLabel={t('Create')}
          onCancel={() => setCreating(false)}
          onConfirm={createAndAdd}
        />
      )}
    >
      {(close, makePan) => {
        // Second drag, for the grabber and the title (see the JSX below).
        const headerPan = makePan();
        return (
          <>
            {/* The header has its own drag, always enabled: it's the way out when
                the list below is scrolled and keeps the gesture for itself. Two
                detectors instead of one around everything so both can never fire
                at once. */}
          <GestureDetector gesture={headerPan}>
              <View>
                {/* Spotify-style grabber: the visual cue that the sheet can be
                    dragged down to dismiss. */}
                <Grabber />
                <Text style={styles.title}>{t('Add to a playlist')}</Text>
                <View style={styles.divider} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={makePan().enabled(atTop)}>
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
                    {targets.map((p) => {
                      const ids = present[p.id];
                      const state = ids ? membershipOf(ids, wanted) : null;
                      return (
                        <Pressable
                          key={p.id}
                          style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                          disabled={!ids}
                          accessibilityRole="checkbox"
                          accessibilityState={{
                            checked: state === 'some' ? 'mixed' : state === 'all',
                            disabled: !ids,
                          }}
                          onPress={() => toggle(p.id)}
                        >
                          <Cover uri={coverArtUrl(p.coverArt ?? p.id, COVER.thumb)} size={40} />
                          <View style={styles.rowBody}>
                            <Text style={styles.rowName} numberOfLines={1}>
                              {p.name}
                            </Text>
                            {state === 'some' ? (
                              <Text style={styles.rowCount} numberOfLines={1}>
                                {t('{n} of {songs}', {
                                  n: ids!.length,
                                  songs: songsLabel(wanted.length, lang),
                                })}
                              </Text>
                            ) : null}
                          </View>
                          {!ids ? (
                            <ActivityIndicator size="small" color={colors.textMuted} />
                          ) : (
                            <Mark state={state ?? 'none'} tapped={!!busy[p.id]} />
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </GestureDetector>
          </>
        );
      }}
    </SheetModal>
  );
}

const styles = themed((colors) => ({
  // The sheet's frame (backdrop, sheet, grabber) is not re-declared here: the
  // sheet takes the shared one (see `SheetModal`), and its grab-cue is drawn as
  // the frame's `Grabber` - inside the drag around this sheet's header, which is
  // where the header's drag has the gesture.
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', paddingBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  rowBody: { flex: 1 },
  rowName: { color: colors.text, fontSize: fontSize.md },
  rowCount: { color: colors.textMuted, fontSize: fontSize.sm },
  newPlaylistIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
