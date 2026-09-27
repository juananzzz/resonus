/**
 * Sheet to subscribe to a podcast.
 *
 * Two ways in, because the iTunes directory only knows shows that are listed
 * in it and a feed URL is the only thing a lot of shows have. The search is
 * for finding a show; the field under it is for pasting the address a show's
 * own website publishes, and either one is enough.
 */
import Icon from '@/components/Icon';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { search as searchPodcasts, subscribe, type PodcastSearchResult } from '@/api/podcasts';
import { Cover } from '@/components/Cover';
import { Message } from '@/components/Message';
import { useDebounce } from '@/hooks/useDebounce';
import { useT } from '@/i18n';
import { listPerf } from '@/lib/listPerf';
import { colors, fontSize, radius, spacing, themed } from '@/theme';

interface Props {
  visible: boolean;
  /** Feed URLs already subscribed to, which the results mark as taken. */
  subscribed: string[];
  onCancel: () => void;
  onSubscribed: () => void;
}

export function PodcastAddSheet({ visible, subscribed, onCancel, onSubscribed }: Props) {
  const t = useT();
  const [term, setTerm] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A keystroke's worth of waiting: any less and every character typed is a
  // request to a third party, which is both rude and slow enough to feel.
  const debounced = useDebounce(term, 400);

  useEffect(() => {
    if (visible) {
      setTerm('');
      setFeedUrl('');
      setError(null);
      setBusy(null);
    }
  }, [visible]);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['podcastSearch', debounced],
    queryFn: () => searchPodcasts(debounced),
    enabled: visible && debounced.trim().length > 1,
    // A show that isn't in the directory today is not going to be in it in
    // five minutes, and this is a list somebody is scrolling through.
    staleTime: 1000 * 60 * 10,
  });

  /**
   * Subscribes, and says what went wrong in place.
   *
   * The message is on the sheet rather than in a toast because a toast would
   * be hidden under this modal, and "nothing happened" is the failure this is
   * most likely to produce: a feed that has moved, or a show that never had
   * a feed to begin with.
   */
  async function run(what: string, subscribeTo: string) {
    setBusy(what);
    setError(null);
    try {
      await subscribe(subscribeTo);
      onSubscribed();
      onCancel();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : t("Couldn't read that feed."),
      );
    } finally {
      setBusy(null);
    }
  }

  const pasted = feedUrl.trim();
  const canPaste = pasted.length > 0 && busy === null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={onCancel}>
            <Text style={[styles.headerAction, { color: colors.accent }]}>{t('Cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('Add podcast')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.searchBar}>
            <Icon name="search" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={term}
              onChangeText={setTerm}
              placeholder={t('Search for a podcast')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            {term ? (
              <Pressable hitSlop={8} onPress={() => setTerm('')} accessibilityLabel={t('Clear')}>
                <Icon name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {debounced.trim().length > 1 ? (
            isFetching && !data ? (
              <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
            ) : isError ? (
              <Message text={t("Couldn't search for podcasts.")} onRetry={() => refetch()} />
            ) : (
              <FlatList
                {...listPerf}
                keyboardShouldPersistTaps="handled"
                data={data ?? []}
                keyExtractor={(item) => item.feedUrl}
                contentContainerStyle={styles.results}
                renderItem={({ item }: { item: PodcastSearchResult }) => {
                  const taken = subscribed.includes(item.feedUrl);
                  const working = busy === item.feedUrl;
                  return (
                    <Pressable
                      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                      disabled={taken || busy !== null}
                      onPress={() => void run(item.feedUrl, item.feedUrl)}
                    >
                      <Cover
                        uri={item.imageUrl}
                        size={44}
                        rounded
                        placeholderIcon="headset-outline"
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {item.author ? (
                          <Text style={styles.rowSub} numberOfLines={1}>
                            {item.author}
                          </Text>
                        ) : null}
                      </View>
                      {working ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : taken ? (
                        <Icon name="checkmark-circle" size={22} color={colors.accent} />
                      ) : (
                        <Icon name="add-circle-outline" size={22} color={colors.textSecondary} />
                      )}
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.empty}>
                    {t('No podcast found for “{term}”. Try pasting the feed address below.', {
                      term: debounced.trim(),
                    })}
                  </Text>
                }
              />
            )
          ) : (
            <Text style={styles.empty}>
              {t('Search for a show, or paste the address of a feed below.')}
            </Text>
          )}

          <View style={styles.pasteRow}>
            <TextInput
              style={styles.pasteInput}
              value={feedUrl}
              onChangeText={setFeedUrl}
              placeholder="https://…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
            />
            <Pressable
              disabled={!canPaste}
              onPress={() => void run(pasted, pasted)}
              accessibilityRole="button"
              accessibilityLabel={t('Subscribe')}
              style={({ pressed }) => [
                styles.subscribe,
                !canPaste && styles.subscribeOff,
                pressed && canPaste ? { opacity: 0.7 } : null,
              ]}
            >
              {busy === pasted ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.subscribeText}>{t('Subscribe')}</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  headerAction: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
  headerSpacer: { width: 52 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.md, padding: 0 },
  results: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.sm, marginHorizontal: spacing.lg },
  pasteRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pasteInput: {
    flex: 1,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  subscribe: {
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  subscribeOff: { opacity: 0.4 },
  subscribeText: { color: colors.onAccent, fontSize: fontSize.sm, fontWeight: '600' },
}));
