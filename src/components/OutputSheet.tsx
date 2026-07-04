/**
 * Selector de salida de audio (estilo Spotify Connect): este teléfono, un
 * renderer UPnP/DLNA de la red o Chromecast. Al abrirse busca renderers
 * (~5 s); la fila de Chromecast abre el selector nativo del SDK de Google, y
 * si su sesión está activa aparece aquí como salida actual (elegir otra cosa
 * la termina).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useT } from '@/i18n';
import { castAvailable, castDisconnect, castShowDialog, useCast } from '@/store/cast';
import { useToast } from '@/store/toast';
import {
  upnpAvailable,
  upnpConnect,
  upnpDisconnect,
  upnpSearch,
  useUpnp,
  type UpnpDevice,
} from '@/store/upnp';
import { colors, fontSize, spacing } from '@/theme';

export function OutputSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const toast = useToast((s) => s.show);
  const castName = useCast((s) => (s.connected ? s.deviceName : null));
  const upnpId = useUpnp((s) => (s.connected ? s.deviceId : null));
  const devices = useUpnp((s) => s.devices);
  const scanning = useUpnp((s) => s.scanning);
  const phoneActive = !castName && !upnpId;
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(visible);
  // Cierre animado: la hoja baja y después avisa al padre (que oculta el Modal).
  const close = () => dismiss(onClose);

  useEffect(() => {
    if (visible) void upnpSearch();
  }, [visible]);

  async function pickPhone() {
    close();
    if (castName) await castDisconnect();
    else if (upnpId) await upnpDisconnect();
  }

  async function pickDevice(device: UpnpDevice) {
    close();
    if (device.id === upnpId) return;
    const ok = await upnpConnect(device);
    if (!ok) toast(t("Couldn't complete the action"));
  }

  function Row({
    icon,
    label,
    active,
    onPress,
  }: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    onPress?: () => void;
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
        {active ? (
          <Ionicons name="checkmark" size={20} color={colors.accent} style={{ marginLeft: 'auto' }} />
        ) : null}
      </Pressable>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
        onLayout={onSheetLayout}
      >
        <Text style={styles.sheetTitle}>{t('Output')}</Text>

        <Row
          icon={
            <Ionicons
              name="phone-portrait-outline"
              size={22}
              color={phoneActive ? colors.accent : colors.text}
            />
          }
          label={t('This phone')}
          active={phoneActive}
          onPress={phoneActive ? undefined : pickPhone}
        />

        {castName ? (
          <Row
            icon={<MaterialIcons name="cast-connected" size={22} color={colors.accent} />}
            label={castName}
            active
          />
        ) : castAvailable() ? (
          <Row
            icon={<MaterialIcons name="cast" size={22} color={colors.text} />}
            label={t('Chromecast')}
            onPress={() => {
              close();
              void castShowDialog();
            }}
          />
        ) : null}

        {upnpAvailable
          ? devices.map((d) => {
              const active = d.id === upnpId;
              return (
                <Row
                  key={d.id}
                  icon={
                    d.isTV ? (
                      <Ionicons name="tv-outline" size={22} color={active ? colors.accent : colors.text} />
                    ) : (
                      <MaterialIcons name="speaker" size={22} color={active ? colors.accent : colors.text} />
                    )
                  }
                  label={d.name}
                  active={active}
                  onPress={() => void pickDevice(d)}
                />
              );
            })
          : null}

        {scanning ? (
          <View style={styles.scanRow}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.scanText}>{t('Searching for devices…')}</Text>
          </View>
        ) : upnpAvailable ? (
          <>
            {devices.length === 0 ? <Text style={styles.scanText}>{t('No devices found')}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => void upnpSearch()}
            >
              <Ionicons name="refresh" size={20} color={colors.textSecondary} />
              <Text style={[styles.actionText, { color: colors.textSecondary }]}>{t('Search again')}</Text>
            </Pressable>
          </>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  scanText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    paddingVertical: spacing.sm,
  },
});
