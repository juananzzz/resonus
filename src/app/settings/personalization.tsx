/** Appearance — theme, accent color, and layout options. Placeholder UI only. */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useToast } from '@/store/toast';
import { colors } from '@/theme';

export default function AppearanceSettings() {
  const t = useT();
  const toast = useToast((s) => s.show);

  const soon = () => toast(t('Coming soon 🚧'));

  return (
    <SettingsPage title={t('Appearance')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={settingsStyles.sectionTitle}>{t('Theme')}</Text>
        <Pressable style={settingsStyles.rowButton} onPress={soon}>
          <Ionicons name="moon-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>Dark</Text>
          <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
        </Pressable>

        <Text style={settingsStyles.sectionTitle}>{t('Accent color')}</Text>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          {[
            { color: '#6366F1', label: 'Violet' },
            { color: '#22C55E', label: 'Green' },
            { color: '#F59E0B', label: 'Amber' },
            { color: '#EF4444', label: 'Red' },
            { color: '#3B82F6', label: 'Blue' },
            { color: '#EC4899', label: 'Pink' },
          ].map((opt) => (
            <Pressable key={opt.color} onPress={soon}>
              <View style={{
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: opt.color,
                borderWidth: 3, borderColor: opt.color === '#6366F1' ? colors.text : 'transparent',
              }} />
            </Pressable>
          ))}
        </View>

        <Text style={settingsStyles.sectionTitle}>{t('Layout')}</Text>
        <Pressable style={settingsStyles.rowButton} onPress={soon}>
          <Ionicons name="grid-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Tab bar style')}</Text>
          <Text style={[settingsStyles.soonTag, { color: colors.textSecondary }]}>Default</Text>
        </Pressable>
        <Pressable style={settingsStyles.rowButton} onPress={soon}>
          <Ionicons name="disc-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Now playing style')}</Text>
          <Text style={[settingsStyles.soonTag, { color: colors.textSecondary }]}>Full</Text>
        </Pressable>
      </ScrollView>
    </SettingsPage>
  );
}
