/**
 * Settings › Greeting: whether to show the Home greeting and with what text.
 *
 * Its own screen, even though it only has two things: in Appearance they took
 * up a toggle plus a card with its text field, and that Home row was already
 * crowded.
 */
import { ScrollView } from 'react-native';

import { SettingsPage, settingsStyles, SwitchList, TextRow } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { GREETING_MAX, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function GreetingSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const showGreeting = useSettings((s) => s.showGreeting);
  const setShowGreeting = useSettings((s) => s.setShowGreeting);
  const customGreeting = useSettings((s) => s.customGreeting);
  const setCustomGreeting = useSettings((s) => s.setCustomGreeting);

  return (
    <SettingsPage title={t('Greeting')}>
      {/* `SettingsPage` renders its children as-is: the margin and spacing
          between cards are set by this ScrollView, like the rest of Settings. */}
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <SwitchList
          options={[
            {
              label: t('Show greeting'),
              description: t('“Good morning”, “Good evening”… at the top of Home.'),
              value: showGreeting,
              onChange: setShowGreeting,
            },
          ]}
        />

        {/* Only with the greeting visible: a field for text that wouldn't render
            anywhere would be a false promise. */}
        {showGreeting ? (
          <TextRow
            label={t('Custom greeting')}
            description={t('Leave it empty to greet you by the time of day.')}
            value={customGreeting}
            placeholder={t('Good evening')}
            maxLength={GREETING_MAX}
            onChange={setCustomGreeting}
          />
        ) : null}
      </ScrollView>
    </SettingsPage>
  );
}
