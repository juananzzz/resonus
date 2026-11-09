/**
 * One radio: what its Home card opens, in the shape its siblings use - the
 * picture edge to edge from the very top of the display, artwork only (the
 * name lives in the title underneath); the radio's colour fading out
 * of it under the title and the buttons; the tracks below; and a short set
 * of suggestions at their foot.
 *
 * The definition comes from what Home saved when it has it, and is built
 * here when it doesn't (a deep link, or the section turned off). Its list is
 * made the first time it is opened and saved with it, so from then on it is
 * full on the first frame and stays that list until the radios are replaced.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { getArtist } from '@/api/data';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { Message } from '@/components/Message';
import { RadioArt } from '@/components/RadioCard';
import { openRadioMenu } from '@/components/RadioMenuSheet';
import { SuggestedTracks } from '@/components/SuggestedTracks';
import { TOPBAR_H, TrackListView } from '@/components/TrackListView';
import { tintForMode } from '@/hooks/useDominantColor';
import { useInsets } from '@/hooks/useInsets';
import { useScreenSize } from '@/hooks/useScreenSize';
import { songsLabel, useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { buildRadioDef, radioTracks } from '@/lib/radioBuild';
import { currentSong, usePlayerStore } from '@/store/player';
import { useRadios, type RadioDef } from '@/store/radios';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { themed, useTheme, useThemeMode } from '@/theme';

/** Fisher–Yates, so shuffle plays this radio's own list in another order
 *  (the queue shows exactly what is playing, which a mode flag wouldn't). */
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ArtistRadioScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { width } = useScreenSize();
  const insets = useInsets();
  // The colour was read in whichever appearance the radio was built under;
  // the header takes it in this one, as an album's does.
  const mode = useThemeMode();
  const { id } = useLocalSearchParams<{ id: string }>();
  const radioId = id ?? '';
  const t = useT();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playing = usePlayerStore(currentSong);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const lang = useSettings((s) => s.language);

  // Read live from the store, so a rebuild that keeps this seed is what the
  // screen shows next time, not a copy the query cache held on to.
  const saved = useRadios((s) => s.defs.find((d) => d.seed.id === radioId));
  const defQuery = useQuery({
    queryKey: ['radio-def', radioId],
    queryFn: async (): Promise<RadioDef> => {
      await useRadios.getState().hydrate();
      const stored = useRadios.getState().defs.find((d) => d.seed.id === radioId);
      if (stored) return stored;
      // Straight into the screen without Home having built anything: make
      // just this one (and leave it out of the store - the section's own
      // refresh decides what belongs there).
      const { artist } = await getArtist(radioId);
      const built = await buildRadioDef({ id: radioId, name: artist.name, coverArt: artist.coverArt });
      if (!built) throw new Error('radio');
      return built;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    enabled: !saved,
  });
  const def = saved ?? defQuery.data;

  const tracksQuery = useQuery({
    queryKey: ['radio-tracks', radioId],
    queryFn: async () => {
      const tracks = await radioTracks(def as RadioDef);
      // Kept with the radio, so it is this same list every time it is opened
      // (and the card on Home can say how long it is).
      const { defs, setDefs } = useRadios.getState();
      if (defs.some((d) => d.seed.id === radioId)) {
        await setDefs(defs.map((d) => (d.seed.id === radioId ? { ...d, tracks } : d)));
      }
      return tracks;
    },
    // Only for a radio not opened yet. Each build is a new draw, so asking
    // again on the way in would swap the list a few seconds after it was
    // drawn; once made, the list is the radio until the radios are replaced.
    enabled: !!def && !def.tracks?.length,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const tracks = def?.tracks?.length ? def.tracks : (tracksQuery.data ?? []);

  const title = def ? t('{artist} Radio', { artist: def.seed.name }) : '';
  const href = `/artist-radio/${radioId}`;
  const similarNames = def?.similar
    .slice(0, 3)
    .map((a) => a.name)
    .join(', ');
  // The picture takes the top of the display: 80% of its width, which the
  // list clamps so it always ends a little above where a square cover would
  // have, on any screen there is.
  const coverH = Math.round(width * 0.8);

  const play = (index: number, opts?: { shuffled?: boolean }) => {
    if (tracks.length === 0) return;
    haptic('medium');
    const list = opts?.shuffled ? shuffled(tracks) : tracks;
    void playQueue(list, index, title, href);
  };

  const emptyState =
    defQuery.isLoading || tracksQuery.isLoading ? (
      <AlbumRowsSkeleton />
    ) : defQuery.isError ? (
      <Message text={t("Couldn't build the radio.")} onRetry={() => void defQuery.refetch()} />
    ) : (
      <Message text={t("Couldn't load songs.")} onRetry={() => void tracksQuery.refetch()} />
    );

  return (
    <TrackListView
      title={title}
      subtitle={
        similarNames ? t('With {artists} and more', { artists: similarNames }) : undefined
      }
      meta={tracks.length > 0 ? songsLabel(tracks.length, lang) : undefined}
      accentColor={def?.color ? tintForMode(def.color, mode, true) : undefined}
      onMenu={def && tracks.length > 0 ? () => openRadioMenu(def, tracks) : undefined}
      songs={tracks}
      currentId={playing?.id}
      showArtwork={showListArtwork}
      wideCover={{
        height: coverH,
        render: (w, h) =>
          def ? (
            <RadioArt def={def} width={w} cropHeight={h} padTop={insets.top + TOPBAR_H} bare />
          ) : (
            <View style={[styles.placeholder, { width: w, height: h }]} />
          ),
      }}
      emptyState={emptyState}
      footer={
        tracks.length > 0 && def ? (
          <SuggestedTracks
            songs={tracks}
            subtitle={t('Based on the tracks in this radio')}
            addLabel={t('Add to queue')}
            onAdd={async (song) => {
              addToQueue(song);
              toast(t('Added to queue'));
              return true;
            }}
          />
        ) : undefined
      }
      onPlay={play}
    />
  );
}

const styles = themed((t) => ({
  placeholder: {
    backgroundColor: t.surface,
  },
}));
