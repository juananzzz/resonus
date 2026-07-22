/** Ajustes › Reproductor: aspecto y extras de la pantalla de reproducción. */
import { ScrollView, Text } from 'react-native';

import { SelectList, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { type CoverTapAction, type PreviousButtonMode, useSettings } from '@/store/settings';

export default function PlayerSettings() {
  const t = useT();
  // La valoración es cosa de Subsonic: necesita cuenta de servidor y no aplica a
  // Jellyfin. Sí funciona offline (se apunta en el outbox y sube al reconectar),
  // así que su toggle se muestra también sin conexión, igual que en el player.
  // El botón de dispositivos, en cambio, no tiene destino offline y se oculta.
  const offline = useAuthStore((s) => s.offline);
  const hasAccount = useAuthStore((s) => !!s.auth);
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const canRate = hasAccount && serverType !== 'jellyfin';
  const showAudioQuality = useSettings((s) => s.showAudioQuality);
  const setShowAudioQuality = useSettings((s) => s.setShowAudioQuality);
  const showRating = useSettings((s) => s.showRating);
  const setShowRating = useSettings((s) => s.setShowRating);
  const showAlbumInfo = useSettings((s) => s.showAlbumInfo);
  const setShowAlbumInfo = useSettings((s) => s.setShowAlbumInfo);
  const showPlayedInQueue = useSettings((s) => s.showPlayedInQueue);
  const setShowPlayedInQueue = useSettings((s) => s.setShowPlayedInQueue);
  const playerColorBackground = useSettings((s) => s.playerColorBackground);
  const setPlayerColorBackground = useSettings((s) => s.setPlayerColorBackground);
  const miniPlayerColorBackground = useSettings((s) => s.miniPlayerColorBackground);
  const setMiniPlayerColorBackground = useSettings((s) => s.setMiniPlayerColorBackground);
  const lyricsColorBackground = useSettings((s) => s.lyricsColorBackground);
  const setLyricsColorBackground = useSettings((s) => s.setLyricsColorBackground);
  const showLyricsCard = useSettings((s) => s.showLyricsCard);
  const setShowLyricsCard = useSettings((s) => s.setShowLyricsCard);
  const coverTapAction = useSettings((s) => s.coverTapAction);
  const setCoverTapAction = useSettings((s) => s.setCoverTapAction);
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  const setMarqueeTitles = useSettings((s) => s.setMarqueeTitles);
  const showQueueButton = useSettings((s) => s.showQueueButton);
  const setShowQueueButton = useSettings((s) => s.setShowQueueButton);
  const showDevicesButton = useSettings((s) => s.showDevicesButton);
  const setShowDevicesButton = useSettings((s) => s.setShowDevicesButton);
  const seekButtonsSec = useSettings((s) => s.seekButtonsSec);
  const setSeekButtonsSec = useSettings((s) => s.setSeekButtonsSec);
  const previousButtonMode = useSettings((s) => s.previousButtonMode);
  const setPreviousButtonMode = useSettings((s) => s.setPreviousButtonMode);

  return (
    <SettingsPage title={t('Player')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* El primer título va pegado a la cabecera (sin el margen de sección). */}
        <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>{t('Color')}</Text>
        <SwitchList
          options={[
            {
              label: t('Colored background'),
              description: t('Tint the player background with the cover color.'),
              value: playerColorBackground,
              onChange: setPlayerColorBackground,
            },
            {
              label: t('Colored mini player'),
              description: t('Tint the mini player with the cover color.'),
              value: miniPlayerColorBackground,
              onChange: setMiniPlayerColorBackground,
            },
            {
              label: t('Colored lyrics screen'),
              description: t('Tint the lyrics screen with the cover color.'),
              value: lyricsColorBackground,
              onChange: setLyricsColorBackground,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Elements')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show album & year'),
              description: t('Show the album name and release year under the title.'),
              value: showAlbumInfo,
              onChange: setShowAlbumInfo,
            },
            {
              label: t('Show quality label'),
              description: t('Show format, bitrate and Lossless / Hi-Res in the player.'),
              value: showAudioQuality,
              onChange: setShowAudioQuality,
            },
            ...(canRate
              ? [
                  {
                    label: t('Show rating'),
                    description: t('Show a star rating bar to rate the current song.'),
                    value: showRating,
                    onChange: setShowRating,
                  },
                ]
              : []),
            {
              label: t('Show lyrics card'),
              description: t('The lyrics card below the player controls.'),
              value: showLyricsCard,
              onChange: setShowLyricsCard,
            },
            {
              label: t('Scroll long titles'),
              description: t("Song and artist names that don't fit scroll across."),
              value: marqueeTitles,
              onChange: setMarqueeTitles,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Queue')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show played tracks'),
              description: t('Keep already-played tracks in the queue, dimmed. Tap one to go back.'),
              value: showPlayedInQueue,
              onChange: setShowPlayedInQueue,
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Buttons')}</Text>
        <SwitchList
          options={[
            {
              label: t('Show queue button'),
              value: showQueueButton,
              onChange: setShowQueueButton,
            },
            ...(offline
              ? []
              : [
                  {
                    label: t('Show devices button'),
                    value: showDevicesButton,
                    onChange: setShowDevicesButton,
                  },
                ]),
          ]}
        />
        <SelectList
          label={t('Skip buttons')}
          description={t('Jump back or forward next to the play button.')}
          options={[
            { value: 0, label: t('No') },
            { value: 5, label: '5 s' },
            { value: 10, label: '10 s' },
            { value: 30, label: '30 s' },
          ]}
          value={seekButtonsSec}
          onChange={setSeekButtonsSec}
        />
        <SelectList<PreviousButtonMode>
          label={t('Previous button')}
          description={t('What the previous button does partway through a song.')}
          options={[
            { value: 'restart', label: t('Restart, then previous track') },
            { value: 'always', label: t('Always previous track') },
          ]}
          value={previousButtonMode}
          onChange={setPreviousButtonMode}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Lyrics')}</Text>
        <SelectList<CoverTapAction>
          label={t('On cover tap')}
          description={t('What tapping the cover art in the player does.')}
          options={[
            { value: 'none', label: t('Nothing') },
            { value: 'screen', label: t('Open lyrics screen') },
            { value: 'inline', label: t('Show lyrics on the cover') },
          ]}
          value={coverTapAction}
          onChange={setCoverTapAction}
        />
      </ScrollView>
    </SettingsPage>
  );
}
