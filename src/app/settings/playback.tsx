/** Ajustes › Calidad y reproducción: bitrate, crossfade y ecualizador. */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { BITRATE_OPTIONS, useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors } from '@/theme';

export default function PlaybackSettings() {
  const t = useT();
  const toast = useToast((s) => s.show);
  const maxBitRate = useSettings((s) => s.maxBitRate);
  const setMaxBitRate = useSettings((s) => s.setMaxBitRate);

  const soon = () => toast(t('Próximamente 🚧'));

  return (
    <SettingsPage title={t('Calidad y reproducción')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionTitle}>{t('Calidad de streaming')}</Text>
        <View style={settingsStyles.chips}>
          {BITRATE_OPTIONS.map((opt) => {
            const active = opt.value === maxBitRate;
            return (
              <Pressable
                key={opt.value}
                style={[settingsStyles.chip, active && settingsStyles.chipActive]}
                onPress={() => {
                  setMaxBitRate(opt.value);
                  toast(t('Calidad: {label}', { label: opt.label }));
                }}
              >
                <Text style={[settingsStyles.chipText, active && settingsStyles.chipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={settingsStyles.hint}>
          {t('«Original» usa la máxima calidad; bajar el bitrate ahorra datos.')}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Reproducción')}</Text>
        <Pressable style={settingsStyles.rowButton} onPress={soon}>
          <Ionicons name="git-compare-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Crossfade')}</Text>
          <Text style={settingsStyles.soonTag}>{t('Pronto')}</Text>
        </Pressable>
        <Pressable style={settingsStyles.rowButton} onPress={soon}>
          <Ionicons name="options-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Ecualizador')}</Text>
          <Text style={settingsStyles.soonTag}>{t('Pronto')}</Text>
        </Pressable>
      </ScrollView>
    </SettingsPage>
  );
}
