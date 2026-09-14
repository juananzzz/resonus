/**
 * Settings › Quality & playback › Audiobooks: remembering where a book was
 * left, and what Continue does with that.
 *
 * Its own screen for the same reason Scrobbling has one: a switch, a choice and
 * something to delete is a section in its own right, and under Playback it was
 * three rows about books sitting under a heading full of settings about music.
 * Whoever has no audiobooks in their library never has to scroll past it now.
 *
 * Nothing here is reported to anybody: the position is kept on the phone (see
 * `albumProgress`), which is why it never belonged under Scrobbling either.
 */
import { ScrollView } from 'react-native';

import {
  SettingRow,
  SettingsPage,
  settingsStyles,
  SliderRow,
  SwitchList,
} from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { useAlbumProgress } from '@/store/albumProgress';
import { useToast } from '@/store/toast';
import { AUDIOBOOK_CONTINUE_REWIND_STEPS, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

/** Where the thumb sits for a stored value, which need not be a rung: the
 *  nearest one, so a number saved by another version still shows somewhere
 *  sensible instead of falling off the left end. */
function rungOf(sec: number): number {
  let best = 0;
  for (let i = 1; i < AUDIOBOOK_CONTINUE_REWIND_STEPS.length; i++) {
    const closer =
      Math.abs(AUDIOBOOK_CONTINUE_REWIND_STEPS[i] - sec) <
      Math.abs(AUDIOBOOK_CONTINUE_REWIND_STEPS[best] - sec);
    if (closer) best = i;
  }
  return best;
}

export default function AudiobooksSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const saveAudiobookProgress = useSettings((s) => s.saveAudiobookProgress);
  const setSaveAudiobookProgress = useSettings((s) => s.setSaveAudiobookProgress);
  const audiobookContinueRewindSec = useSettings((s) => s.audiobookContinueRewindSec);
  const setAudiobookContinueRewindSec = useSettings((s) => s.setAudiobookContinueRewindSec);
  const toast = useToast((s) => s.show);

  // Seconds up to a minute and then minutes and seconds, the same way the
  // scrobbling rules next door are written: "3600 s" is a number to work out.
  const rewindLabel = (sec: number) =>
    sec === 0 ? t('Off') : sec < 60 ? `${sec} s` : formatDuration(sec);

  function deleteAudiobookProgress() {
    useAlbumProgress.getState().clearAll();
    toast(t('Audiobook progress deleted'));
  }

  return (
    <SettingsPage title={t('Audiobooks')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Save audiobook progress'),
              description: t(
                'Remember where you stopped in audiobooks so you can continue later. Stored on this device only.',
              ),
              value: saveAudiobookProgress,
              onChange: setSaveAudiobookProgress,
            },
          ]}
        />
        {/* The slider walks the rungs and the pad moves one at a time, so an
            hour is a place a finger can actually land. Both speak in rungs and
            what reaches the store is the seconds they stand for. */}
        <SliderRow
          label={t('Rewind on resume')}
          description={t(
            'Continue starts this far back from where you stopped. Long enough, and it reaches into the chapters before it.',
          )}
          value={rungOf(audiobookContinueRewindSec)}
          max={AUDIOBOOK_CONTINUE_REWIND_STEPS.length - 1}
          step={1}
          formatValue={(rung) => rewindLabel(AUDIOBOOK_CONTINUE_REWIND_STEPS[rung] ?? 0)}
          fineTune={{ step: 1, doneLabel: t('Done') }}
          disabled={!saveAudiobookProgress}
          onChange={(rung) =>
            setAudiobookContinueRewindSec(AUDIOBOOK_CONTINUE_REWIND_STEPS[rung] ?? 0)
          }
        />
        {/* Not greyed out with the switch off: what it clears is what was saved
            while it was on, which is exactly when somebody turning it off wants
            it gone. */}
        <SettingRow
          icon="trash-outline"
          label={t('Delete audiobook progress')}
          destructive
          onPress={deleteAudiobookProgress}
        />
      </ScrollView>
    </SettingsPage>
  );
}
