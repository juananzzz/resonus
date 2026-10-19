/**
 * What the ⋯ of a selection offers on every screen, built once here (#164).
 *
 * Favouriting is two fixed entries rather than one that flips, because a
 * selection can hold songs on both sides of the heart and one button would
 * have to pick a direction for it. Each entry touches only the songs it
 * applies to: starring a favorite again moves it to the top of the list for
 * nothing.
 *
 * Exporting and deleting downloads are about files, so they only show up where
 * this profile has any, and they say so when none of the songs marked is one
 * of them. Which songs those are is not known until the action runs, so the
 * entry cannot hide itself for a selection that has nothing to give.
 *
 * The export question comes back as a node for the screen to render: the bar
 * is gone by the time it is asked, since choosing an action leaves selection
 * mode.
 */
import { type ReactNode, useState } from 'react';

import { star, unstar } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { type SelectionAction } from '@/components/SelectionBar';
import { Dialog } from '@/components/Dialog';
import { songsLabel, useT } from '@/i18n';
import { exportManyToFolder, totalBytes } from '@/lib/exportSong';
import { applyStarChange, resyncFavorites } from '@/lib/favoritesCache';
import { formatBytes } from '@/lib/format';
import { pickFolder } from '@/lib/localLibrary';
import { anyDownloads, useDownloads } from '@/store/downloads';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { useFavoriteIds } from './useFavoriteIds';

/** Runs an action with the marked songs and leaves selection mode. */
export type SelectionRunner = (fn: (songs: Song[]) => void) => void;

export function useSelectionMenu(
  run: SelectionRunner,
  opts?: {
    /** Favorites screen: there, "Remove" already is unfavouriting. */
    favorites?: boolean;
  },
): { actions: SelectionAction[]; dialogs: ReactNode } {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);
  const favIds = useFavoriteIds();
  // Only whether there are any, not the map itself: subscribing to `files`
  // would repaint the whole list every time a download lands.
  const hasDownloads = useDownloads(anyDownloads);
  const [pendingExport, setPendingExport] = useState<{ songs: Song[]; bytes: number } | null>(null);

  async function applyFavorite(songs: Song[], add: boolean) {
    // Without the list at hand, everything marked goes: the request is
    // harmless either way and doing nothing would be worse.
    const which = favIds ? songs.filter((s) => favIds.has(s.id) !== add) : songs;
    if (which.length === 0) {
      toast(t('Nothing to change'));
      return;
    }
    try {
      for (const s of which) {
        if (add) await star(s.id, 'song');
        else await unstar(s.id, 'song');
        // The cached list is patched, not thrown away: see `favoritesCache`.
        applyStarChange('song', s.id, add, s);
      }
      const n = which.length;
      toast(
        add
          ? n === 1
            ? t('Added to favorites')
            : t('{n} added to favorites', { n })
          : n === 1
            ? t('Removed from favorites')
            : t('{n} removed from favorites', { n }),
      );
    } catch {
      resyncFavorites();
      toast(t("Couldn't complete the action"));
    }
  }

  /** Copies them into the folder that gets picked, and says how many made it. */
  async function runExport(songs: Song[]) {
    const folder = await pickFolder();
    if (!folder) return;
    toast(t('Exporting…'));
    const files = useDownloads.getState().files;
    const items = songs.map((s) => ({ song: s, uri: files[s.id] }));
    // No folder of their own, unlike a whole album: a handful of songs picked
    // by hand has no name to give one.
    const { saved, failed } = await exportManyToFolder(items, folder, '');
    toast(
      failed > 0
        ? t('{n} of {m} songs exported', { n: saved, m: songs.length })
        : t('{n} songs exported', { n: saved }),
    );
  }

  const favorites: SelectionAction[] =
    opts?.favorites === false
      ? []
      : [
          {
            icon: 'add-circle-outline',
            label: t('Add to favorites'),
            onPress: () => run((sel) => void applyFavorite(sel, true)),
          },
          {
            icon: 'add-circle-outline',
            label: t('Remove from favorites'),
            onPress: () => run((sel) => void applyFavorite(sel, false)),
          },
        ];

  const downloaded: SelectionAction[] = hasDownloads
    ? [
        {
          icon: 'save-outline',
          label: t('Export'),
          onPress: () =>
            run((sel) => {
              const files = useDownloads.getState().files;
              const have = sel.filter((s) => files[s.id]);
              if (have.length === 0) {
                toast(t('Nothing here is downloaded'));
                return;
              }
              setPendingExport({ songs: have, bytes: totalBytes(have.map((s) => files[s.id])) });
            }),
        },
        {
          // Last, and not in red: a download comes back with one tap, and red
          // is kept for what does not.
          icon: 'trash-outline',
          label: t('Delete downloads'),
          onPress: () =>
            run((sel) => {
              const files = useDownloads.getState().files;
              const ids = sel.filter((s) => files[s.id]).map((s) => s.id);
              if (ids.length === 0) {
                toast(t('Nothing here is downloaded'));
                return;
              }
              void useDownloads.getState().deleteSongs(ids);
              toast(t('{n} songs deleted', { n: ids.length }));
            }),
        },
      ]
    : [];

  return {
    actions: [...favorites, ...downloaded],
    dialogs: (
      // Asked before the folder picker, not after: the size is the part worth
      // knowing while there is still nothing to undo.
      <Dialog
        visible={!!pendingExport}
        title={t('Export {songs}?', { songs: songsLabel(pendingExport?.songs.length ?? 0, lang) })}
        message={
          pendingExport
            ? t('{size} copied into the folder you pick.', {
                size: formatBytes(pendingExport.bytes),
              })
            : undefined
        }
        confirmLabel={t('Export')}
        onCancel={() => setPendingExport(null)}
        onConfirm={() => {
          const songs = pendingExport?.songs ?? [];
          setPendingExport(null);
          void runExport(songs);
        }}
      />
    ),
  };
}
