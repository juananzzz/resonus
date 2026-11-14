/**
 * Monthly / yearly listening recap (#119): the numbers the listen log has
 * been collecting, in the shape of the recaps the streaming apps show.
 *
 * The log and the arithmetic live in `store/listenLog` and `lib/recap`; this
 * screen only chooses the period and draws the result. A month is the current
 * calendar month, a year the current calendar year: that is what "your March"
 * and "your 2026" mean to whoever opens it.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackChevron } from '@/components/BackChevron';
import { EmptyState } from '@/components/EmptyState';
import { useListPadding } from '@/hooks/useScreenSize';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { formatCount, formatTotalDuration } from '@/lib/format';
import { computeRecap, recapRange, type RecapEntry, type RecapPeriod } from '@/lib/recap';
import { useListenLog } from '@/store/listenLog';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, tracking, useTheme } from '@/theme';

export default function RecapScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const listens = useListenLog((s) => s.listens);
  const bottomPad = useScreenBottomPadding();
  const listPad = useListPadding(spacing.lg);
  const [period, setPeriod] = useState<RecapPeriod>('month');

  const recap = useMemo(() => computeRecap(listens, recapRange(period)), [listens, period]);
  const range = useMemo(() => recapRange(period), [period]);

  const title =
    period === 'year'
      ? String(new Date(range.start).getFullYear())
      : new Date(range.start).toLocaleDateString(lang, { month: 'long', year: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.bar}>
        <BackChevron size={28} />
        <Text style={styles.barTitle}>{t('Recap')}</Text>
        <View style={styles.barSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: listPad, paddingBottom: bottomPad },
        ]}
      >
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['month', 'year'] as const).map((p) => {
            const active = period === p;
            return (
              <Pressable
                key={p}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setPeriod(p)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {p === 'month' ? t('Month') : t('Year')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.period}>{title}</Text>

        <View style={styles.summary}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatTotalDuration(recap.seconds)}</Text>
            <Text style={styles.statLabel}>{t('Listening time')}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatCount(recap.plays, lang)}</Text>
            <Text style={styles.statLabel}>{t('Plays')}</Text>
          </View>
        </View>

        {recap.plays === 0 ? (
          <EmptyState
            icon="stats-chart-outline"
            title={t('No listens yet')}
            subtitle={
              period === 'month'
                ? t('Songs that count as played this month will show up here.')
                : t('Songs that count as played this year will show up here.')
            }
          />
        ) : (
          <>
            <Ranking title={t('Top artists')} entries={recap.topArtists} lang={lang} />
            <Ranking title={t('Top songs')} entries={recap.topSongs} lang={lang} />
            <Ranking title={t('Top genres')} entries={recap.topGenres} lang={lang} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Ranking({ title, entries, lang }: { title: string; entries: RecapEntry[]; lang: string }) {
  const t = useT();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {entries.map((entry, index) => (
        <View key={entry.key} style={styles.row}>
          <Text style={styles.rank}>{index + 1}</Text>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {entry.name}
            </Text>
            {entry.subtitle ? (
              <Text style={styles.rowSub} numberOfLines={1}>
                {entry.subtitle}
              </Text>
            ) : null}
          </View>
          <View style={styles.rowStats}>
            <Text style={styles.rowPlays}>
              {t('{n} plays', { n: formatCount(entry.plays, lang) })}
            </Text>
            <Text style={styles.rowSub}>{formatTotalDuration(entry.seconds)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  barTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.lg,
    letterSpacing: tracking.heading,
    fontWeight: '500',
  },
  barSpacer: { width: 28 },
  content: { paddingTop: spacing.sm },
  tabs: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  tab: {
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  tabTextActive: { color: colors.onAccent, fontWeight: '600' },
  period: {
    color: colors.text,
    fontSize: fontSize.xxl,
    letterSpacing: tracking.display,
    fontWeight: '700',
    marginTop: spacing.lg,
  },
  summary: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  stat: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  statValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: '700' },
  statLabel: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.xs },
  section: { marginTop: spacing.xl },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rank: {
    width: 22,
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 1 },
  rowStats: { alignItems: 'flex-end' },
  rowPlays: { color: colors.text, fontSize: fontSize.sm, fontVariant: ['tabular-nums'] },
}));
