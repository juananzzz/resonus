/**
 * Settings › Diagnostics: what has been keeping the JS thread busy.
 *
 * Reachable by tapping the version five times in About, because it is for
 * chasing a report, not for browsing. The share button hands over the same
 * thing as plain text, which is easier to paste into an issue than a
 * screenshot is to read.
 */
import { useRootNavigationState } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';

import { SettingRow, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { eventLines, fullReport, profileLines, stateLines } from '@/lib/diagnosticsReport';
import {
  clearPerfEvents,
  perfAway,
  perfBlocks,
  perfCounts,
  perfNet,
  perfOps,
  perfSince,
  resetPerfLog,
} from '@/lib/perfLog';
import { useSettings } from '@/store/settings';
import { fontSize, spacing, themed, useTheme } from '@/theme';

export default function DiagnosticsSettings() {
  // Out of the React Compiler: every number here is read from module state,
  // and `tick` only redraws it if nothing was memoized.
  'use no memo';
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  // Nothing here is reactive: it is a snapshot, refreshed by pulling or by
  // resetting, so reading it doesn't add work of its own.
  const [tick, setTick] = useState(0);
  const blocks = perfBlocks();
  const nets = perfNet();
  const netCalls = nets.reduce((n, x) => n + x.calls, 0);
  const netKb = Math.round(nets.reduce((n, x) => n + x.bytes, 0) / 1024);
  const ops = perfOps();
  const away = perfAway();
  const counts = perfCounts();
  const enabled = useSettings((s) => s.diagnostics);
  const navState = useRootNavigationState();
  const screensOpen = navState?.routes?.length;
  const profile = profileLines();
  const state = stateLines(screensOpen);
  const events = eventLines();
  const minutes = Math.max(1, Math.round((Date.now() - perfSince()) / 60000));

  return (
    <SettingsPage title={t('Diagnostics')}>
      <ScrollView
        contentContainerStyle={settingsStyles.content}
        // Any scroll refreshes the numbers; no timer polling behind this.
        onScrollEndDrag={() => setTick(tick + 1)}
      >
        {/* The measurements are in English in every language, on purpose, and
            kept out of `t()` so no locale can translate them: they end up in
            GitHub issues, often as a screenshot, read by people who don't speak
            every language we ship. The shared report is English for the same
            reason. */}
        <Text style={settingsStyles.sectionDescription}>
          {enabled
            ? `Measured over the last ${minutes} min of use.`
            : t('Measuring is off (Settings › About), so there is nothing to show.')}
        </Text>

        <Text style={settingsStyles.sectionTitle}>{t('Profile')}</Text>
        {profile.map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}

        <Text style={settingsStyles.sectionTitle}>{t('State')}</Text>
        {state.map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}

        <Text style={settingsStyles.sectionTitle}>Recent problems</Text>
        <Text style={settingsStyles.sectionDescription}>
          Kept even with measuring off, the last 30.
        </Text>
        {events.length === 0 ? (
          <Text style={styles.line}>None.</Text>
        ) : (
          events.map((line, i) => (
            <Text key={i} style={styles.line}>
              {line}
            </Text>
          ))
        )}

        {nets.length > 0 ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Requests')}</Text>
            <Text style={settingsStyles.sectionDescription}>
              {t(
                'Everything asked of the server, most often first. The music itself is not here: the player opens that connection and this never sees it.',
              )}
            </Text>
            <Text style={styles.line}>{`${netCalls} in total · ${netKb} KB declared`}</Text>
            {nets.map((n) => (
              <View key={n.tag} style={styles.row}>
                <Text style={styles.tag} numberOfLines={1}>
                  {n.tag}
                </Text>
                <Text style={styles.value}>
                  {n.calls}× · {Math.round(n.bytes / 1024)} KB
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <Text style={settingsStyles.sectionTitle}>Interface freezes</Text>
        <Text style={settingsStyles.sectionDescription}>
          Moments when the app stopped responding, longest first.
        </Text>
        {blocks.length === 0 ? (
          <Text style={styles.line}>None over 120 ms.</Text>
        ) : (
          blocks.map((b, i) => (
            <Text key={i} style={styles.line}>
              {b.ms} ms · {b.during}
            </Text>
          ))
        )}

        <Text style={settingsStyles.sectionTitle}>Time spent</Text>
        {ops.length === 0 ? (
          <Text style={styles.line}>Nothing measured yet.</Text>
        ) : (
          ops.slice(0, 20).map((o) => (
            <View key={o.tag} style={styles.row}>
              <Text style={styles.tag} numberOfLines={1}>
                {o.tag}
              </Text>
              <Text style={styles.value}>
                {o.count}× · {o.totalMs} ms · {o.maxMs} ms
              </Text>
            </View>
          ))
        )}

        {away.length > 0 ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('While minimized')}</Text>
            <Text style={settingsStyles.sectionDescription}>
              {t(
                'The player keeps beating twice a second while the app is away. Long silences here mean the app stopped following what it was playing.',
              )}
            </Text>
            {away.map((a) => (
              <View key={a.tag} style={styles.row}>
                <Text style={styles.tag} numberOfLines={2}>
                  {a.tag}
                </Text>
                <Text style={styles.value}>
                  {a.count}× · {a.maxMs} ms
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {counts.length > 0 ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Counted')}</Text>
            <Text style={settingsStyles.sectionDescription}>
              {t('What happened, rather than how long it took.')}
            </Text>
            {counts.map((c) => (
              <View key={c.tag} style={styles.row}>
                <Text style={styles.tag} numberOfLines={1}>
                  {c.tag}
                </Text>
                <Text style={styles.value}>{c.n}</Text>
              </View>
            ))}
          </>
        ) : null}

        <SettingRow
          icon="share-outline"
          label={t('Share report')}
          onPress={() =>
            void Share.share({
              message: fullReport(screensOpen),
            })
          }
        />
        <SettingRow
          icon="refresh"
          label={t('Start over')}
          onPress={() => {
            resetPerfLog();
            clearPerfEvents();
            setTick(tick + 1);
          }}
        />
      </ScrollView>
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  line: { color: colors.textSecondary, fontSize: fontSize.sm, paddingVertical: 2 },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: 2 },
  tag: { color: colors.text, fontSize: fontSize.sm, flex: 1 },
  value: { color: colors.textSecondary, fontSize: fontSize.sm },
}));
