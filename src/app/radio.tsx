/**
 * Server radio stations.
 *
 * A screen of its own and, `embedded`, the Radio section of the Explore tab.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createRadioStation,
  deleteRadioStation,
  getRadioStations,
  updateRadioStation,
  type RadioStation,
} from '@/api/backend';
import { COVER, coverArtUrl } from '@/api/data';
import { playRadio } from '@/lib/playRadio';
import { uploadCoverImage } from '@/api/navidrome';
import { Cover } from '@/components/Cover';
import { Dialog } from '@/components/Dialog';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { RadioEditSheet, type RadioEdit } from '@/components/RadioEditSheet';
import { useT } from '@/i18n';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { MAX_PINS, usePins } from '@/store/pins';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SCREEN_BOTTOM_PADDING, SHEET_MAX_WIDTH, spacing, themed, useTheme } from '@/theme';
import { BackChevron } from '@/components/BackChevron';
import { BrowseFrame, useSearchBox, type BrowserProps } from '@/components/BrowseFrame';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useListPadding } from '@/hooks/useScreenSize';
import { listPerf } from '@/lib/listPerf';

const EMPTY_EDIT: RadioEdit = { name: '', streamUrl: '', homePageUrl: '' };

/** Stations from which the list stops being read at a glance. */
const SEARCH_FROM = 8;

export default function RadioScreen() {
  return <RadioBrowser />;
}

export function RadioBrowser({ embedded, actionRef, searchOpen }: BrowserProps) {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  // Rows stop growing at a reading measure and centre themselves (#131).
  const listPad = useListPadding(spacing.lg);
  const t = useT();
  const insets = useSafeAreaInsets();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);
  const toast = useToast((s) => s.show);

  // Jellyfin doesn't manage stations; offline mode doesn't reach the server.
  const canManage = !!auth && auth.serverType !== 'jellyfin' && !offline;
  // Covers go through Navidrome's own API, so only there can they be changed.
  const canEditCover = canManage && auth.serverType === 'navidrome';

  // `editForm` holds the open form (new or edit); `menu` the row with the
  // actions menu open; `deleting` the one awaiting confirmation.
  const [editForm, setEditForm] = useState<{ station: RadioStation | null } | null>(null);
  const [menu, setMenu] = useState<RadioStation | null>(null);
  const [deleting, setDeleting] = useState<RadioStation | null>(null);
  const [query, setQuery] = useState('');
  const pins = usePins((s) => s.pins);
  const togglePin = usePins((s) => s.toggle);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['radioStations'],
    queryFn: () => getRadioStations(auth!),
    enabled: !!auth,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['radioStations'] });

  /**
   * Pinned first, then whatever the search leaves.
   *
   * Pinning is ours, not the server's, so it works on any server and offline;
   * editing a station is what needs Navidrome behind it.
   */
  const stations = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? (data ?? []).filter((s) => s.name.toLowerCase().includes(q))
      : (data ?? []);
    const pinnedFirst = matches
      .filter((s) => pins[`radio:${s.id}`])
      .sort((a, b) => pins[`radio:${a.id}`] - pins[`radio:${b.id}`]);
    return [...pinnedFirst, ...matches.filter((s) => !pins[`radio:${s.id}`])];
  }, [data, query, pins]);

  // A handful of stations is read at a glance, and a search box over three rows
  // is furniture. It appears once the list is long enough to be scanned.
  const showSearch = (data?.length ?? 0) > SEARCH_FROM;

  // Embedded the tab's magnifier is what asks for the box, and then the count
  // is beside the point: it is there because it was asked for.
  const boxOpen = useSearchBox(embedded, searchOpen, () => setQuery(''));

  async function saveStation(changes: RadioEdit, pendingCoverUri?: string) {
    const station = editForm?.station ?? null;
    setEditForm(null);
    try {
      if (station) {
        await updateRadioStation(
          auth!,
          station.id,
          changes.name,
          changes.streamUrl,
          changes.homePageUrl,
        );
      } else {
        const newId = await createRadioStation(
          auth!,
          changes.name,
          changes.streamUrl,
          changes.homePageUrl,
        );
        // Cover chosen while creating: uploaded now that the station has an id.
        // A failure here doesn't undo the station, which is already created.
        if (newId && pendingCoverUri && canEditCover) {
          await uploadCoverImage(auth!, 'radio', newId, {
            uri: pendingCoverUri,
            type: 'image/jpeg',
          }).catch(() => toast(t("Couldn't update the cover")));
        }
      }
      await refresh();
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  async function confirmDelete() {
    const station = deleting;
    setDeleting(null);
    if (!station) return;
    try {
      await deleteRadioStation(auth!, station.id);
      await refresh();
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  // Embedded, the Explore tab draws this in its own header; the form it opens
  // stays down here with the rest of the station editing.
  useEffect(() => {
    if (actionRef) actionRef.current = () => setEditForm({ station: null });
  });

  const addButton = canManage ? (
    <Pressable
      hitSlop={10}
      onPress={() => setEditForm({ station: null })}
      accessibilityLabel={t('Add station')}
    >
      <Ionicons name="add" size={28} color={colors.text} />
    </Pressable>
  ) : null;

  return (
    <BrowseFrame embedded={embedded}>
      {embedded ? null : (
        <View style={styles.header}>
          <BackChevron />
          <Text style={styles.title}>{t('Radio')}</Text>
          {addButton ?? <View style={{ width: 28 }} />}
        </View>
      )}

      {(embedded ? boxOpen : showSearch) ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('Find a station')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            autoFocus={embedded}
          />
          {query ? (
            <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityLabel={t('Clear')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError ? (
        <Message text={t("Couldn't load radio stations.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
          {...listPerf}
          // With the filter box open, a tap opens the row instead of only closing the keyboard.
          keyboardShouldPersistTaps="handled"
          data={stations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPad, paddingHorizontal: listPad },
          ]}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
          }
          renderItem={({ item }: { item: RadioStation }) => {
            const playing = playingId === item.id;
            return (
              <Pressable
                style={styles.row}
                onPress={() => void playRadio(item)}
                onLongPress={() => setMenu(item)}
              >
                <Cover
                  uri={coverArtUrl(item.coverArt, COVER.thumb)}
                  size={52}
                  rounded
                  placeholderIcon="radio"
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleLine}>
                    {pins[`radio:${item.id}`] ? (
                      <MaterialCommunityIcons
                        name="pin"
                        size={13}
                        color={colors.accent}
                        style={styles.pinIcon}
                      />
                    ) : null}
                    <Text
                      style={[styles.rowTitle, playing && { color: colors.accent }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                  </View>
                  {item.homePageUrl ? (
                    <Text style={styles.rowSub} numberOfLines={1}>{item.homePageUrl}</Text>
                  ) : null}
                </View>
                {/* Always: pinning is ours and works on any server, so there is
                    always something in the menu even where editing is not. */}
                <Pressable hitSlop={8} onPress={() => setMenu(item)} accessibilityLabel={t('More')}>
                  <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
                </Pressable>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="radio-outline"
              title={t('No radio stations')}
              subtitle={
                canManage
                  ? t('Tap + to add an internet radio station.')
                  : t("Add internet radio stations on your server and they'll show up here.")
              }
            />
          }
        />
      )}

      <RadioEditSheet
        visible={!!editForm}
        editing={!!editForm?.station}
        initial={
          editForm?.station
            ? {
                name: editForm.station.name,
                streamUrl: editForm.station.streamUrl,
                homePageUrl: editForm.station.homePageUrl ?? '',
              }
            : EMPTY_EDIT
        }
        coverId={canEditCover ? editForm?.station?.id : undefined}
        coverEditable={canEditCover}
        serverCoverUri={coverArtUrl(editForm?.station?.coverArt, COVER.card)}
        onCancel={() => setEditForm(null)}
        onSave={(changes, pendingCoverUri) => void saveStation(changes, pendingCoverUri)}
      />

      <Modal
        transparent
        visible={!!menu}
        animationType="fade"
        onRequestClose={() => setMenu(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenu(null)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.sheetTitle} numberOfLines={1}>{menu?.name}</Text>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              const station = menu;
              setMenu(null);
              if (!station) return;
              if (!togglePin(`radio:${station.id}`)) {
                toast(t('You can pin up to {n} items.', { n: MAX_PINS }));
              }
            }}
          >
            <MaterialCommunityIcons
              name={menu && pins[`radio:${menu.id}`] ? 'pin' : 'pin-outline'}
              size={24}
              color={colors.text}
              style={styles.pinIcon}
            />
            <Text style={styles.actionText}>
              {menu && pins[`radio:${menu.id}`] ? t('Unpin') : t('Pin to top')}
            </Text>
          </Pressable>
          {canManage ? (
            <>
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  const station = menu;
                  setMenu(null);
                  setEditForm({ station });
                }}
              >
                <Ionicons name="create-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Edit station')}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  const station = menu;
                  setMenu(null);
                  setDeleting(station);
                }}
              >
                <Ionicons name="trash-outline" size={24} color={colors.danger} />
                <Text style={[styles.actionText, { color: colors.danger }]}>
                  {t('Delete station')}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </Modal>

      <Dialog
        visible={!!deleting}
        title={t('Delete station')}
        message={t('Remove “{name}” from your server?', { name: deleting?.name ?? '' })}
        confirmLabel={t('Delete')}
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </BrowseFrame>
  );
}

const styles = themed((colors) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 },
  // The MCI pin comes vertical; rotated 45° it looks like Spotify's, which is
  // how it is drawn everywhere else in the app.
  pinIcon: { transform: [{ rotate: '45deg' }] },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  // The box "Your library" has, to the same measurements, which is what every
  // section of Explore now opens.
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: fontSize.md, padding: 0 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    position: 'absolute',
    bottom: 0,
    // Centred and no wider than a sheet wants to be (#131).
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
