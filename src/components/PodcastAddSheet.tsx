/** Sheet to add a podcast: find it in the Store, or paste the address of its feed. */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl } from '@/api/data';
import {
  favoriteIds,
  feedErrorMessage,
  refreshChannel,
  search as searchPodcasts,
  togglePodcastHeart,
} from '@/api/podcasts';
import { useDebounce } from '@/hooks/useDebounce';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing, themed } from '@/theme';
import { Cover } from './Cover';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onAdded: () => void;
}

export function PodcastAddSheet({ visible, onCancel, onAdded }: Props) {
  const t = useT();
  const [feedUrl, setFeedUrl] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  // Resets fields every time it opens.
  useEffect(() => {
    if (visible) {
      setFeedUrl('');
      setQuery('');
      setError(null);
      setBusy(null);
    }
  }, [visible]);

  // Errors go on the sheet: a toast would be hidden under the modal.
  async function run(feed: string) {
    setBusy(feed);
    setError(null);
    try {
      const channel = await refreshChannel(feed);
      // Adding is keeping: the heart is what lists a show as yours.
      if (!(await favoriteIds()).has(channel.id)) {
        await togglePodcastHeart(channel.id, 'channel', channel.id);
      }
      onAdded();
      onCancel();
    } catch (e) {
      setError(feedErrorMessage(t, e));
    } finally {
      setBusy(null);
    }
  }

  const term = useDebounce(query.trim());
  const results = useQuery({
    queryKey: ['podcastDiscover', term],
    queryFn: () => searchPodcasts(term),
    enabled: visible && term.length > 1,
    staleTime: 1000 * 60 * 60 * 72,
  });
  const searching = query.trim().length > 0;

  const pasted = feedUrl.trim();
  const urlOk = /^https?:\/\//i.test(pasted);
  const showUrlError = pasted.length > 0 && !urlOk;
  const canAdd = urlOk && busy === null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
      // `autoFocus` does not take inside a Modal on Android.
      onShow={() => input.current?.focus()}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={onCancel}>
            <Text style={[styles.headerAction, { color: colors.accent }]}>{t('Cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('Add podcast')}</Text>
          {/* For the address: a search result adds itself with a tap. */}
          <Pressable
            hitSlop={12}
            disabled={!canAdd || searching}
            onPress={() => void run(pasted)}
          >
            <Text
              style={[
                styles.headerAction,
                { color: colors.accent },
                (!canAdd || searching) && styles.disabled,
              ]}
            >
              {t('Add')}
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>{t('Search')}</Text>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={t('Find a podcast')}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              ref={input}
            />
            {searching ? (
              results.isError ? (
                <Text style={styles.error}>{t("Couldn't load your podcasts.")}</Text>
              ) : results.isLoading ? (
                <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.accent} />
              ) : results.data?.length === 0 && term.length > 1 ? (
                <Text style={styles.empty}>{t('No results for “{q}”', { q: term })}</Text>
              ) : (
                (results.data ?? []).map((item) => (
                  <Pressable
                    key={item.feedUrl}
                    style={({ pressed }) => [styles.result, pressed && { opacity: 0.6 }]}
                    disabled={busy !== null}
                    accessibilityLabel={t('Add')}
                    onPress={() => void run(item.feedUrl)}
                  >
                    <Cover
                      uri={coverArtUrl(item.imageUrl, COVER.thumb)}
                      size={56}
                      placeholderIcon="headset-outline"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.author ? (
                        <Text style={styles.resultSub} numberOfLines={1}>
                          {item.author}
                        </Text>
                      ) : null}
                    </View>
                    {busy === item.feedUrl ? (
                      <ActivityIndicator color={colors.accent} />
                    ) : (
                      <Icon name="add" size={24} color={colors.textSecondary} />
                    )}
                  </Pressable>
                ))
              )
            ) : (
              <>
                <Text style={styles.label}>{t('Feed URL')}</Text>
                <TextInput
                  style={styles.input}
                  value={feedUrl}
                  onChangeText={setFeedUrl}
                  placeholder="https://…"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  inputMode="url"
                />
              </>
            )}
            {busy !== null && !searching ? (
              <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.accent} />
            ) : showUrlError && !searching ? (
              <Text style={styles.error}>
                {t('The feed URL must start with http:// or https://')}
              </Text>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : null}
          </ScrollView>
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
  disabled: { color: colors.textMuted },
  content: { padding: spacing.lg, gap: spacing.sm },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.xs },
  empty: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  resultTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  resultSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
}));
