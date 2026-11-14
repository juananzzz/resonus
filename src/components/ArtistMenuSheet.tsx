/**
 * What a long press on an artist offers: play them, their radio, the heart.
 * The rest lives in the ⋯ of the artist's own screen, a tap away.
 */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl, getAlbum, getArtist, getTopSongs, star, type Album, type Artist, type Song } from '@/api/data';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useT } from '@/i18n';
import { autoDownloadKey } from '@/lib/autoDownloadTargets';
import { applyStarChange, unstarWithUndo } from '@/lib/favoritesCache';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useAutoDownloads } from '@/store/autoDownloads';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { SheetModal } from './SheetModal';

let openMenu: ((artist: Artist) => void) | null = null;

interface PendingArtistDownload {
  songs: Song[];
  albums: Album[];
  /** The confirmation is to keep the discography downloaded, not just fetch it once. */
  auto: boolean;
}

export function openArtistMenu(artist: Artist): void {
  openMenu?.(artist);
}

export function ArtistMenuSheet() {
  const t = useT();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const offline = useAuthStore((s) => s.offline);
  const radiosEnabled = useSettings((s) => s.radiosEnabled);
  const openRef = useRef<() => void>(() => {});
  const [target, setTarget] = useState<Artist | null>(null);
  const favorites = useFavoriteIds(!!target, 'artist');
  const [pending, setPending] = useState<PendingArtistDownload | null>(null);
  const downloadMsg = useDownloadMessage(pending?.songs ?? []);
  const downloadArtist = useDownloads((s) => s.downloadArtist);
  const autoKey = target ? autoDownloadKey({ kind: 'artist', id: target.id }) : null;
  const autoDownload = useAutoDownloads((s) => !!autoKey && !!s.ids[autoKey]);
  const toggleAutoDownload = useAutoDownloads((s) => s.toggleTarget);

  useEffect(() => {
    openMenu = (artist) => {
      setTarget(artist);
      openRef.current();
    };
    return () => {
      openMenu = null;
    };
  }, []);

  /** The same popular songs the Play button of the artist's screen starts. */
  async function play(artist: Artist) {
    try {
      const songs = await queryClient.fetchQuery({
        queryKey: ['topSongs', artist.id, artist.name],
        queryFn: () => getTopSongs(artist.name, 20, artist.id),
      });
      if (songs.length > 0) await playQueue(songs, 0, artist.name, `/artist/${artist.id}`);
      else toast(t('Not available offline'));
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  async function addToFavorites(artist: Artist) {
    try {
      await star(artist.id, 'artist');
      applyStarChange('artist', artist.id, true, artist);
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  /**
   * The discography, as the artist's own screen downloads it: its albums'
   * songs, with the album objects the download needs for covers and entries.
   */
  async function gatherDiscography(artist: Artist): Promise<Omit<PendingArtistDownload, 'auto'> | null> {
    try {
      const { albums } = await getArtist(artist.id);
      const parts = await Promise.all(
        albums.map((album) =>
          queryClient.fetchQuery({
            queryKey: ['album', album.id],
            queryFn: () => getAlbum(album.id),
          }),
        ),
      );
      return { songs: parts.flatMap((part) => part.songs), albums };
    } catch {
      toast(t("Couldn't load albums."));
      return null;
    }
  }

  /** Fetches first, so the confirmation can say how many songs and how big. */
  async function askDownload(artist: Artist, auto: boolean) {
    const discography = await gatherDiscography(artist);
    if (!discography || discography.songs.length === 0) return;
    setPending({ ...discography, auto });
  }

  const row = (icon: keyof typeof Icon.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Icon name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );

  return (
    <>
    <SheetModal openRef={openRef}>
      {(close) => {
        if (!target) return null;
        const artist = target;
        const hearted = !!favorites?.has(artist.id);
        return (
          <>
            <View style={styles.headerRow}>
              <Cover uri={coverArtUrl(artist.coverArt ?? artist.id, COVER.thumb)} size={48} rounded />
              <Text style={styles.title} numberOfLines={1}>
                {artist.name}
              </Text>
            </View>
            <View style={styles.divider} />
            {row('play-outline', t('Play'), () => {
              close();
              void play(artist);
            })}
            {/* Bulk download from the Library, without opening the artist's
                screen first. Offline there is nowhere to fetch the rest from. */}
            {!offline
              ? row('download-outline', t('Download'), () => {
                  close();
                  void askDownload(artist, false);
                })
              : null}
            {!offline
              ? row(
                  autoDownload ? 'cloud-done' : 'cloud-download-outline',
                  t('Auto-download'),
                  () => {
                    close();
                    if (autoDownload) {
                      toggleAutoDownload({ kind: 'artist', id: artist.id });
                      toast(t('Auto-download off'));
                    } else {
                      void askDownload(artist, true);
                    }
                  },
                )
              : null}
            {offline || !radiosEnabled
              ? null
              : row('radio-outline', t('Go to artist radio'), () =>
                  close(() => router.push(`/artist-radio/${artist.id}`)),
                )}
            {row(
              hearted ? 'heart' : 'heart-outline',
              hearted ? t('Remove from favorites') : t('Add to favorites'),
              () => {
                close();
                if (hearted) unstarWithUndo('artist', artist.id);
                else void addToFavorites(artist);
              },
            )}
          </>
        );
      }}
    </SheetModal>
    <Dialog
      visible={!!pending}
      title={pending?.auto ? t('Turn on auto-download?') : t('Download “{name}”?', { name: target?.name ?? '' })}
      message={
        pending?.auto
          ? t('{msg} It will keep downloading new albums from this artist later.', {
              msg: downloadMsg.message,
            })
          : downloadMsg.message
      }
      confirmLabel={pending?.auto ? t('Turn on') : t('Download')}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const chosen = pending;
        if (!chosen || !target) return;
        setPending(null);
        if (chosen.auto) {
          toggleAutoDownload({ kind: 'artist', id: target.id });
          toast(t('Auto-download on'));
        }
        void downloadArtist(target.id, chosen.songs, chosen.albums);
        toast(t('Downloading…'));
      }}
    />
    </>
  );
}

const styles = themed((colors) => ({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1, color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
