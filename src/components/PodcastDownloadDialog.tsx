/**
 * Asks before downloading a whole show, as a playlist does: a long-running show
 * is hundreds of episodes. Feeds give no sizes, so it says how many and how
 * long rather than guessing the megabytes.
 */
import { useEffect, useState } from 'react';

import { listAllEpisodes } from '@/api/podcasts';
import type { PodcastChannel, PodcastEpisode } from '@/api/subsonic';
import { episodesLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { useDownloads } from '@/store/downloads';
import { useSettings } from '@/store/settings';
import { Dialog } from './Dialog';

interface Props {
  channel: PodcastChannel | null;
  onClose: () => void;
}

export function PodcastDownloadDialog({ channel, onClose }: Props) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const files = useDownloads((s) => s.files);
  const downloadPodcast = useDownloads((s) => s.downloadPodcast);
  const [episodes, setEpisodes] = useState<PodcastEpisode[] | null>(null);

  useEffect(() => {
    setEpisodes(null);
    if (!channel) return;
    let live = true;
    void listAllEpisodes(channel.id).then((all) => {
      if (live) setEpisodes(all);
    });
    return () => {
      live = false;
    };
  }, [channel]);

  // What the download would actually fetch: not what is on disk already.
  const missing = (episodes ?? []).filter((e) => e.url && !files[e.id]);
  const seconds = missing.reduce((sum, e) => sum + (e.duration ?? 0), 0);
  const count = episodesLabel(missing.length, lang);

  // Everything is on the phone already: nothing to ask about.
  useEffect(() => {
    if (channel && episodes && missing.length === 0) onClose();
  }, [channel, episodes, missing.length, onClose]);

  return (
    <Dialog
      visible={!!channel && missing.length > 0}
      title={t('Download “{name}”?', { name: channel?.title ?? '' })}
      message={
        seconds > 0
          ? t('{episodes} will be saved to this device ({duration}).', {
              episodes: count,
              duration: formatTotalDuration(seconds),
            })
          : t('{episodes} will be saved to this device.', { episodes: count })
      }
      confirmLabel={t('Download')}
      onCancel={onClose}
      onConfirm={() => {
        const ch = channel;
        onClose();
        if (ch) void downloadPodcast(ch.id);
      }}
    />
  );
}
