/** Ajustes › Calidad y reproducción: bitrate, crossfade y ecualizador. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, Text } from 'react-native';

import { SelectList, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { BITRATE_OPTIONS, useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors } from '@/theme';

import { useAuthStore } from '@/store/auth';

export default function PlaybackSettings() {
  const t = useT();
  const toast = useToast((s) => s.show);
  const offline = useAuthStore((s) => s.offline);
  const maxBitRate = useSettings((s) => s.maxBitRate);
  const setMaxBitRate = useSettings((s) => s.setMaxBitRate);
  const autoplaySimilar = useSettings((s) => s.autoplaySimilar);
  const setAutoplaySimilar = useSettings((s) => s.setAutoplaySimilar);

  const soon = () => toast(t('Coming soon'));

  return (
    <SettingsPage title={t('Quality & playback')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {!offline ? (
          <>
            <SelectList
              label={t('Streaming quality')}
              description={t('“Original” uses the highest quality; a lower bitrate saves data.')}
              options={BITRATE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
              value={maxBitRate}
              onChange={setMaxBitRate}
            />
            <SwitchList
              options={[
                {
                  label: t('Autoplay'),
                  description: t('Keep playing similar songs when your queue ends.'),
                  value: autoplaySimilar,
                  onChange: setAutoplaySimilar,
                },
              ]}
            />
          </>
        ) : null}
        <Pressable style={settingsStyles.rowButton} onPress={soon}>
          <Ionicons name="git-compare-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Crossfade')}</Text>
          <Text style={settingsStyles.soonTag}>{t('Soon')}</Text>
        </Pressable>
        <Pressable style={settingsStyles.rowButton} onPress={soon}>
          <Ionicons name="options-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Equalizer')}</Text>
          <Text style={settingsStyles.soonTag}>{t('Soon')}</Text>
        </Pressable>
      </ScrollView>
    </SettingsPage>
  );
}
