/**
 * Audio output picker (Spotify Connect style): this phone, the server's own
 * speakers or a UPnP/DLNA renderer on the network. When opened it searches for
 * renderers and keeps searching while it is up.
 *
 * Sonos speakers are the reason this is more than a list. They arrive one per
 * room and can be played as a group, so while a Sonos session is on, the list
 * turns into the rooms of that system with a control each to bring a room into
 * the group or take it out; the rest of the time each group is one row, named
 * after its rooms. All of that is worked out below and none of it changes what
 * a row looks like: a row is an icon, a name, and a tick when it is the one
 * playing, the same as in every other sheet in the app.
 */
import Icon from '@/components/Icon';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native';

import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import { formatGroupedDeviceLabel, normalizeOutputDisplayName } from '@/lib/format';
import {
  jukeboxConnect,
  jukeboxDisconnect,
  refreshJukeboxAvailability,
  useJukebox,
} from '@/store/jukebox';
import { useToast } from '@/store/toast';
import {
  upnpAvailable,
  upnpConnect,
  upnpDisconnect,
  upnpJoinDevice,
  upnpSearch,
  upnpUngroupDevice,
  useUpnp,
  type UpnpDevice,
} from '@/store/upnp';
import { colors, fontSize, spacing, themed } from '@/theme';

/**
 * One output. The tick and the accent name the one that is playing, which is
 * how every list in the app says "this one"; `action` is the extra control a
 * Sonos room gets, and it sits where the tick would be because a room that
 * can be grouped is never the room already playing.
 */
function Row({
  icon,
  label,
  active,
  onPress,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onPress?: () => void;
  action?: React.ReactNode;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && !!onPress && { opacity: 0.6 }]}
      disabled={!onPress}
      onPress={onPress}
    >
      {icon}
      <Text style={[styles.actionText, active && { color: colors.accent }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.trailing}>
        {action ?? (active ? <Icon name="checkmark" size={20} color={colors.accent} /> : null)}
      </View>
    </Pressable>
  );
}

/** The icon for an output, by what it is. */
function outputIcon(kind: 'phone' | 'server' | 'group' | 'tv' | 'speaker', active?: boolean) {
  const color = active ? colors.accent : colors.text;
  if (kind === 'phone') return <Icon name="phone-portrait-outline" size={22} color={color} />;
  if (kind === 'server') return <Icon name="server-outline" size={22} color={color} />;
  if (kind === 'group') return <Icon name="volume-medium-outline" size={22} color={color} />;
  if (kind === 'tv') return <Icon name="tv-outline" size={22} color={color} />;
  return <Icon name="volume-high-outline" size={22} color={color} />;
}

export function OutputSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const toast = useToast((s) => s.show);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const upnpId = useUpnp((s) => (s.connected ? s.deviceId : null));
  const devices = useUpnp((s) => s.devices);
  const scanning = useUpnp((s) => s.scanning);
  const jukeboxActive = useJukebox((s) => s.active);
  const jukeboxAvailable = useJukebox((s) => s.available);
  const phoneActive = !upnpId && !jukeboxActive;
  // The list scrolls once there are a few speakers on the network, so the drag
  // that dismisses the sheet only takes over at the top of it — the same deal
  // the song menu makes, and for the same reason: otherwise the two gestures
  // fight and scrolling up pulls the sheet down with it.
  const [atTop, setAtTop] = useState(true);

  const activeUpnpDevice = useMemo(
    () => (upnpId ? devices.find((device) => device.id === upnpId) ?? null : null),
    [devices, upnpId],
  );
  const activeGroupKey = activeUpnpDevice?.isSonos ? activeUpnpDevice.groupId ?? activeUpnpDevice.id : null;
  const activeCoordinatorId = activeUpnpDevice?.coordinatorId ?? activeUpnpDevice?.id ?? null;
  const isSonosSession = !!activeUpnpDevice?.isSonos;

  const activeGroupMembers = activeGroupKey
    ? devices.filter((device) => device.isSonos && (device.groupId ?? device.id) === activeGroupKey)
    : [];
  const activeSonosGroupMode = activeGroupMembers.length > 1;

  const groupedUpnpRows = useMemo(() => {
    const rows: Array<{
      key: string;
      label: string;
      device: UpnpDevice;
      active: boolean;
      groupSize: number;
    }> = [];
    const coveredIds = new Set<string>();
    const groups = new Map<string, UpnpDevice[]>();

    for (const device of devices) {
      if (!device.isSonos) continue;
      const groupKey = device.groupId ?? device.id;
      const group = groups.get(groupKey) ?? [];
      group.push(device);
      groups.set(groupKey, group);
    }

    for (const [groupKey, groupDevices] of groups) {
      if (groupDevices.length === 0) continue;
      groupDevices.forEach((device) => coveredIds.add(device.id));
      const coordinator = groupDevices.find((device) => device.id === device.coordinatorId) ?? groupDevices[0];
      const label =
        groupDevices.length > 1
          ? formatGroupedDeviceLabel(groupDevices.map((device) => device.name))
          : normalizeOutputDisplayName(groupDevices[0].name);
      rows.push({
        key: `sonos-group:${groupKey}`,
        label,
        device: coordinator,
        active: !!upnpId && groupDevices.some((device) => device.id === upnpId),
        groupSize: groupDevices.length,
      });
    }

    for (const device of devices) {
      if (coveredIds.has(device.id)) continue;
      rows.push({
        key: `upnp:${device.id}`,
        label: normalizeOutputDisplayName(device.name),
        device,
        active: device.id === upnpId,
        groupSize: 1,
      });
    }

    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [devices, upnpId]);

  const sortedIndividualRows = useMemo(() => {
    if (!isSonosSession) return [] as UpnpDevice[];
    return devices
      .filter((device) => device.isSonos && (activeSonosGroupMode || device.id !== upnpId))
      .sort((a, b) => normalizeOutputDisplayName(a.name).localeCompare(normalizeOutputDisplayName(b.name)));
  }, [activeSonosGroupMode, devices, isSonosSession, upnpId]);

  /** What the phone is playing through, named the way the row would name it. */
  const currentLabel = phoneActive
    ? t('This phone')
    : jukeboxActive
      ? t('Server speakers (Jukebox)')
      : activeSonosGroupMode
        ? formatGroupedDeviceLabel(activeGroupMembers.map((device) => device.name))
        : activeUpnpDevice
          ? normalizeOutputDisplayName(activeUpnpDevice.name)
          : t('This phone');

  useEffect(() => {
    if (!visible) return;
    void upnpSearch();
    void refreshJukeboxAvailability();
    // Re-scan periodically while the sheet is open: SSDP is lossy, so repeating
    // the search lets renderers that missed the first round appear on their own
    // (upnpSearch merges results and no-ops if a scan is still running).
    // Foreground only: waking the JS thread every 10 s all night for a sheet
    // nobody looks at is pure background CPU (iOS timers keep running).
    let id: ReturnType<typeof setInterval> | null = null;
    const arm = () => {
      if (AppState.currentState === 'active' && !id) {
        id = setInterval(() => void upnpSearch(), 10000);
      }
    };
    const disarm = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    arm();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void upnpSearch();
        arm();
      } else disarm();
    });
    return () => {
      disarm();
      sub.remove();
    };
  }, [visible]);

  async function pickPhone() {
    if (upnpId) await upnpDisconnect();
    else if (jukeboxActive) await jukeboxDisconnect();
  }

  async function pickDevice(device: UpnpDevice) {
    if (device.id === upnpId) return;
    const ok = await upnpConnect(device);
    if (!ok) toast(t("Couldn't complete the action"));
  }

  async function pickJukebox() {
    if (jukeboxActive) return;
    // Silent handoff between remote outputs (does not resume on local in between).
    if (upnpId) await upnpDisconnect(true);
    const ok = await jukeboxConnect();
    if (!ok) toast(t("Couldn't complete the action"));
  }

  async function runGroupAction(key: string, action: () => Promise<boolean>) {
    setBusyAction(key);
    try {
      const ok = await action();
      if (!ok) {
        toast(t("Couldn't complete the action"));
        return;
      }
      await upnpSearch();
    } finally {
      setBusyAction(null);
    }
  }

  async function joinToCurrent(deviceId: string) {
    if (!activeCoordinatorId || deviceId === activeCoordinatorId) return;
    await runGroupAction(`join:${deviceId}`, () => upnpJoinDevice(deviceId, activeCoordinatorId));
  }

  async function ungroupDevice(deviceId: string) {
    await runGroupAction(`ungroup:${deviceId}`, () => upnpUngroupDevice(deviceId));
  }

  async function switchToSonosDevice(device: UpnpDevice) {
    if (!device.isSonos || !isSonosSession) {
      await pickDevice(device);
      return;
    }
    if (device.groupId !== activeGroupKey) {
      await pickDevice(device);
      return;
    }
    await runGroupAction(`switch:${device.id}`, async () => {
      const ungroupOk = await upnpUngroupDevice(device.id);
      if (!ungroupOk) return false;
      return upnpConnect(device);
    });
  }

  return (
    <SheetModal
      visible={visible}
      onClosed={onClose}
      /* The list scrolls once there are a few speakers on the network, so the
         drag that dismisses the sheet only takes over at the top of it: the
         scroll owns the rest, otherwise the two gestures fight and scrolling
         up pulls the sheet down with it. */
      panEnabled={atTop}
      /* This sheet caps itself: on a phone that is already showing a big
         player, a sheet over the whole screen would hide the thing you are
         listening to. The cap belongs to the sheet, so it travels with it. */
      maxSheetHeight={'84%'}
    >
      {() => (
        <>
          {/* The title says what the sheet is; the line under it says where the
              sound is going, which is the one thing you came to check and the
              answer is a whole sentence for a Sonos group. The list below
              still marks it, so this is a summary and not the only mark. */}
          <Text style={styles.sheetTitle}>{t('Output')}</Text>
          <Text style={styles.currentLine} numberOfLines={1}>
            {t('Currently playing on')}: {currentLabel}
          </Text>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            onScroll={(e) => setAtTop(e.nativeEvent.contentOffset.y <= 4)}
            scrollEventThrottle={16}
            bounces={false}
          >
            <Row
              icon={outputIcon('phone', phoneActive)}
              label={t('This phone')}
              active={phoneActive}
              onPress={phoneActive ? undefined : () => void pickPhone()}
            />

            {jukeboxAvailable ? (
              <Row
                icon={outputIcon('server', jukeboxActive)}
                label={t('Server speakers (Jukebox)')}
                active={jukeboxActive}
                onPress={jukeboxActive ? undefined : () => void pickJukebox()}
              />
            ) : null}

            {upnpAvailable
              ? isSonosSession
                ? sortedIndividualRows.map((device) => {
                    const active = device.id === upnpId;
                    const inActiveGroup = device.groupId === activeGroupKey;
                    const isActiveCoordinator = !!activeCoordinatorId && device.id === activeCoordinatorId;
                    const canJoin = !!activeGroupKey && !inActiveGroup && device.id !== activeCoordinatorId;
                    const canUngroup = inActiveGroup && (activeSonosGroupMode || !isActiveCoordinator);
                    const actionKey = canJoin ? `join:${device.id}` : `ungroup:${device.id}`;
                    const actionBusy = busyAction === actionKey;
                    // Secondary to the row it sits on: pressing the name moves
                    // the music, pressing this only changes who else is in the
                    // group, so it is drawn the way every other secondary
                    // action in the app is and not in a colour of its own.
                    const action = device.isSonos && (canJoin || canUngroup) ? (
                      <Pressable
                        hitSlop={10}
                        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                        disabled={busyAction != null}
                        accessibilityRole="button"
                        accessibilityLabel={canJoin ? t('Add to the group') : t('Remove from the group')}
                        onPress={(event) => {
                          event.stopPropagation();
                          if (canJoin) {
                            void joinToCurrent(device.id);
                            return;
                          }
                          if (!canUngroup) return;
                          void ungroupDevice(device.id);
                        }}
                      >
                        {actionBusy ? (
                          <ActivityIndicator size="small" color={colors.textSecondary} />
                        ) : (
                          <Icon
                            name={canJoin ? 'add-circle-outline' : 'remove-circle-outline'}
                            size={22}
                            color={colors.textSecondary}
                          />
                        )}
                      </Pressable>
                    ) : undefined;

                    return (
                      <Row
                        key={device.id}
                        icon={outputIcon(device.isTV ? 'tv' : 'speaker', active)}
                        label={normalizeOutputDisplayName(device.name)}
                        active={active}
                        onPress={() => void switchToSonosDevice(device)}
                        action={action}
                      />
                    );
                  })
                : groupedUpnpRows.map((row) => (
                    <Row
                      key={row.key}
                      icon={outputIcon(
                        row.groupSize > 1 ? 'group' : row.device.isTV ? 'tv' : 'speaker',
                        row.active,
                      )}
                      label={row.label}
                      active={row.active}
                      onPress={() => void pickDevice(row.device)}
                    />
                  ))
              : null}

            {/* What the search is doing, and only while it is doing it: a line
                that says it is searching whether or not it is says nothing at
                all. When it has finished and found nothing, that is the news,
                and the way to try again goes with it. */}
            {scanning ? (
              <View style={styles.scanRow}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text style={styles.scanText}>{t('Searching for devices…')}</Text>
              </View>
            ) : upnpAvailable ? (
              <>
                {devices.length === 0 ? (
                  <Text style={styles.scanText}>{t('No devices found')}</Text>
                ) : null}
                <Pressable
                  style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                  onPress={() => void upnpSearch()}
                >
                  <Icon name="refresh" size={20} color={colors.textSecondary} />
                  <Text style={[styles.actionText, { color: colors.textSecondary }]}>
                    {t('Search again')}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </>
      )}
    </SheetModal>
  );
}

const styles = themed((colors) => ({
  // The sheet's frame (backdrop, sheet, grabber) is not re-declared here: the
  // sheet takes the shared one (see `SheetModal`). Its `maxHeight: '84%'` cap is
  // not dropped either - the sheet hands it to the frame as `maxSheetHeight`.
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  currentLine: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  content: { paddingBottom: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 34,
  },
  actionText: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
  // Fixed width so the ticks and the group controls line up down the sheet
  // whatever the names are, and the names all get cut at the same place.
  trailing: { marginLeft: 'auto', minWidth: 22, alignItems: 'flex-end' },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  scanText: { color: colors.textSecondary, fontSize: fontSize.sm },
}));
