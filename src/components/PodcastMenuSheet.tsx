/**
 * The ⋯ menu for a podcast show: a bottom sheet with the things worth doing to
 * a show from wherever it was opened — start it, deal it, put it into the queue,
 * download every episode, read it fresh from the publisher, open its website,
 * keep it as a favourite, take the downloaded episodes off the phone, and take
 * the show itself off it. It
 * mirrors the album's ⋯ sheet in the same order: what you do WITH the show first
 * (playback, queue), then what it takes to get it (download), then the way
 * around it (refresh, website), then where it lives (the heart), and the
 * things that take something away last. It opens through `openPodcastMenu`, so
 * the same sheet opens from the show's own screen and from a long-press on a
 * show in the Library — which is why it plays at all: a row in the Library has
 * no play button, and this sheet is the way into one.
 */
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';

import Icon from '@/components/Icon';
import { Cover } from '@/components/Cover';
import { Dialog } from './Dialog';
import { SheetModal } from './SheetModal';
import { COVER, coverArtUrl, type Song } from '@/api/data';
import {
  episodeToSong,
  feedErrorMessage,
  refreshChannel,
  addChannel,
  removeChannel,
  setChannelAutoDownload,
  listAllEpisodes,
  downloadedForChannel,
  podcastCover,
  togglePodcastHeart,
  type PodcastChannel,
} from '@/api/podcasts';
import { useQuery } from '@tanstack/react-query';
import { isManualOffline } from '@/api/netGate';
import { useT } from '@/i18n';
import { formatAge } from '@/lib/format';
import { invalidatePodcastCaches, invalidatePodcastFavorites } from '@/lib/query';
import {
  usePodcastAddedIds,
  usePodcastAutoDownloadIds,
  usePodcastFavoriteIds,
} from '@/lib/podcastFavorites';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed } from '@/theme';

let openMenu: ((channel: PodcastChannel) => void) | null = null;

/** Opens the sheet for a show, from wherever the show was opened. */
export function openPodcastMenu(channel: PodcastChannel): void {
  openMenu?.(channel);
}

export function PodcastMenuSheet() {
  const t = useT();
  const toast = useToast((s) => s.show);
  // The show's heart, read from the same SQLite set every surface asks for.
  const favIds = usePodcastFavoriteIds();
  const addedIds = usePodcastAddedIds();
  const autoDownloadIds = usePodcastAutoDownloadIds();
  // Playback too: a show in the Library has no play button, and this sheet is
  // the way into one (as the album's has Play for the same reason).
  const playQueue = usePlayerStore((s) => s.playQueue);
  const queueMany = usePlayerStore((s) => s.queueMany);
  const downloadPodcast = useDownloads((s) => s.downloadPodcast);
  const deletePodcastChannelDownloads = useDownloads(
    (s) => s.deletePodcastChannelDownloads,
  );

  const openRef = useRef<() => void>(() => {});
  const [target, setTarget] = useState<PodcastChannel | null>(null);
  const [removing, setRemoving] = useState<PodcastChannel | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    openMenu = (channel) => {
      setTarget(channel);
      openRef.current();
    };
    return () => {
      openMenu = null;
    };
  }, []);

  // Whether this show has anything downloaded, from the record and not from
  // a loaded list: downloads sitting beyond the first page still count. The
  // download and delete actions invalidate this key when they land.
  const downloaded = useQuery({
    queryKey: ['podcastDownloads', target?.id ?? ''],
    queryFn: async () => (await downloadedForChannel(target?.id ?? '')).count,
    enabled: !!target,
    staleTime: Infinity,
  });

  const row = (
    icon: keyof typeof Icon.glyphMap,
    label: string,
    onPress: () => void,
  ) => (
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
        const ch = target;
        const siteUrl = ch.siteUrl;
        const hearted = favIds.has(ch.id);
        const href = `/podcast/${ch.id}`;

        /** Reads the episodes from SQLite and runs the action on them. */
        const withEpisodes = (fn: (songs: Song[]) => void) => {
          void (async () => {
            try {
              const list = await listAllEpisodes(ch.id);
              if (list.length > 0) fn(list.map((e) => episodeToSong(e, ch)));
            } catch {
              toast(t("Couldn't complete the action"));
            }
          })();
        };

        return (
          <>
            <View style={styles.headerRow}>
              {ch.imageUrl ? (
                <Cover
                  uri={coverArtUrl(podcastCover(ch), COVER.thumb)}
                  size={48}
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {ch.title}
                </Text>
                {ch.author ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {ch.author}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.divider} />

            {/* Playback first, as on the album's sheet: this is the way into a
                show long-pressed in the Library, which has no play button. The
                episodes come from SQLite, bridged to songs, and the queue takes
                them the same way it takes an album's. */}
            {row('play-outline', t('Play'), () => {
              close();
              withEpisodes((songs) => void playQueue(songs, 0, ch.title, href));
            })}
            {row('shuffle-outline', t('Shuffle'), () => {
              close();
              withEpisodes(
                (songs) => void playQueue(songs, 0, ch.title, href, { shuffled: true }),
              );
            })}
            {row('play-forward-outline', t('Play next'), () => {
              close();
              withEpisodes((songs) => {
                queueMany(songs, 'next');
                toast(t('Playing next'));
              });
            })}
            {row('list-outline', t('Add to queue'), () => {
              close();
              withEpisodes((songs) => {
                queueMany(songs, 'end');
                toast(t('Added to queue'));
              });
            })}

            {/* Download every episode of the show. The episodes are read from
                SQLite on the tap, so the sheet needs nothing carried to it. */}
            {row('download-outline', t('Download'), () => {
              close();
              // A download is a transfer, and a manual "use no network" makes
              // none — said here, because the transfer goes through expo-file-
              // system and the gate under the API layer cannot see it.
              if (isManualOffline()) {
                toast(t("You're offline"));
                return;
              }
              void (async () => {
                try {
                  await downloadPodcast(ch.id);
                } catch {
                  toast(t("Couldn't complete the action"));
                }
              })();
            })}

            {row(
              'refresh',
              // The label answers before the tap: the last read is filed with the
              // episodes, so the sheet can say what is behind it and let the eye
              // decide whether it is worth pressing at all. The clock is the
              // moment the writes happened, and one coarse step is enough — the
              // sheet has the tap, it has no use for a stopwatch. A show whose
              // clock is missing (never written) keeps the plain word.
              ch.refreshedAt === undefined
                ? t('Refresh')
                : t('Refresh ({when} ago)', { when: formatAge(ch.refreshedAt) }),
              () => {
                close();
                void refreshChannel(ch.feedUrl)
                  .then(() => invalidatePodcastCaches())
                  .catch((e) => toast(feedErrorMessage(t, e)));
              },
            )}

            {siteUrl
              ? row('link-outline', t('Website'), () => {
                  close();
                  void Linking.openURL(siteUrl).catch(() => {});
                })
              : null}

            {!addedIds.has(ch.id)
              ? row('add', t('Add podcast'), () => {
                  close();
                  addChannel(ch.id).catch(() => toast(t("Couldn't complete the action")));
                })
              : null}

            {/* Where the show lives: its heart, filed in SQLite — the same heart
                the show's screen lights, so a show can be kept from wherever it
                was opened, as the album's sheet does with «Add to favorites». It
                sits here, not on top: the album side keeps the favorites group
                next to the thing that takes something away. */}
            {row(
              hearted ? 'heart' : 'heart-outline',
              hearted ? t('Remove from favorites') : t('Add to favorites'),
              () => {
                close();
                void (async () => {
                  try {
                    await togglePodcastHeart(ch.id, 'channel', ch.id);
                  } catch {
                    toast(t("Couldn't complete the action"));
                  }
                })();
              },
            )}

            {/* The latest 3 of each new batch, over Wi-Fi only. */}
            {row(
              autoDownloadIds.has(ch.id) ? 'cloud-done' : 'cloud-download-outline',
              t('Download new episodes'),
              () => {
                const on = !autoDownloadIds.has(ch.id);
                close();
                setChannelAutoDownload(ch.id, on)
                  .then(() => toast(on ? t('Auto-download on') : t('Auto-download off')))
                  .catch(() => toast(t("Couldn't complete the action")));
              },
            )}

            {/* Near the end, because it takes something away.
                Offered only while the show has something downloaded — the album
                sheet hides its trash action exactly the same way — and it clears
                every episode the record holds, not just the ones a loaded list
                showed (#47 on the album side). */}
            {(downloaded.data ?? 0) > 0
              ? row('trash-outline', t('Delete downloads'), () => {
                  close();
                  void (async () => {
                    try {
                      const n = await deletePodcastChannelDownloads(ch.id);
                      toast(
                        n === 0
                          ? t('Nothing here is downloaded')
                          : t('{n} episodes deleted', { n }),
                      );
                    } catch {
                      toast(t("Couldn't complete the action"));
                    }
                  })();
                })
              : null}

            {/* The show itself, with its episodes, hearts and files. Without
                it a show opened once to have a look would stay, and be read
                again on every refresh, for good. */}
            {row('trash-outline', t('Remove from this device'), () => {
              close();
              setRemoving(ch);
            })}
          </>
        );
      }}
      </SheetModal>
      <Dialog
        visible={!!removing}
        title={t('Remove from this device')}
        message={t('Remove “{name}” and its episodes from this device?', {
          name: removing?.title ?? '',
        })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const ch = removing;
          setRemoving(null);
          if (!ch) return;
          // Off the show's own screen first: one opened from a feed address
          // would otherwise read the feed again and file the show right back.
          if (pathname.startsWith('/podcast/')) {
            if (router.canGoBack()) router.back();
            else router.replace('/podcasts');
          }
          void (async () => {
            try {
              await deletePodcastChannelDownloads(ch.id);
              await removeChannel(ch.id);
              invalidatePodcastCaches();
              invalidatePodcastFavorites();
            } catch {
              toast(t("Couldn't complete the action"));
            }
          })();
        }}
      />
    </>
  );
}

const styles = themed((colors) => ({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
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
