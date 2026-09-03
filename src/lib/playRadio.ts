/**
 * Plays a server radio station immediately.
 *
 * A station is one song: the stream is its track, and the queue stays as the
 * single song until the player extends it. There is no station screen to
 * navigate to and back from — the player IS the radio — so every tile and
 * row that starts a station is an action, not a link.
 *
 * `sourceHref` carries the station id (`/radio/<id>`): each station keeps its
 * own recency, so the quick grid can rank "what you last played" per station
 * like it does for albums. The station route is still a placeholder that
 * leads to the station list.
 */
import { type RadioStation } from '@/api/data';
import { tg } from '@/i18n';

import { usePlayerStore } from '@/store/player';

export async function playRadio(station: RadioStation): Promise<void> {
  await usePlayerStore
    .getState()
    .playQueue(
      [
        {
          id: station.id,
          title: station.name,
          url: station.streamUrl,
          artist: tg('Radio'),
          coverArt: station.coverArt,
        },
      ],
      0,
      station.name,
      `/radio/${station.id}`,
    );
}
