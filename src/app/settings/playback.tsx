/** Ajustes › Calidad y reproducción: bitrate, crossfade y ecualizador. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, Text } from 'react-native';

import { SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
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

  const soon = () => toast(t('Coming soon'));

  return (
    <SettingsPage title={t('Quality & playback')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {!offline ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Streaming quality')}</Text>
            <SelectList
              options={BITRATE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
              value={maxBitRate}
              onChange={(value) => {
                const opt = BITRATE_OPTIONS.find((o) => o.value === value);
                setMaxBitRate(value);
                if (opt) toast(t('Quality: {label}', { label: opt.label }));
              }}
            />
            <Text style={settingsStyles.hint}>
              {t('“Original” uses the highest quality; a lower bitrate saves data.')}
            </Text>
          </>
        ) : null}

        <Text style={settingsStyles.sectionTitle}>{t('Playback')}</Text>
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
