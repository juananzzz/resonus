/**
 * Settings › Network: multiple URLs for the same server/account (local IP,
 * domain, Tailscale…) and automatic switching between them when network
 * changes. The app uses the first one that responds, testing local network
 * ones first (at home the local one wins; outside it falls through to the
 * remote). Only applies to server profiles.
 */
import Icon from '@/components/Icon';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Dialog } from '@/components/Dialog';
import { SettingsScroll, SettingsPage, settingsStyles, SwitchList } from '@/components/SettingsUI';
import { reachable } from '@/api/backend';
import { isLanUrl } from '@/lib/serverUrls';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { checkAutoUrlNow } from '@/store/autoUrl';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

/** Strips the scheme to show a more compact URL. */
function shown(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export default function NetworkSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const toast = useToast((s) => s.show);
  const auth = useAuthStore((s) => s.auth);
  const setActiveUrl = useAuthStore((s) => s.setActiveUrl);
  const addServerUrl = useAuthStore((s) => s.addServerUrl);
  const editServerUrl = useAuthStore((s) => s.editServerUrl);
  const removeServerUrl = useAuthStore((s) => s.removeServerUrl);
  const setAutoUrl = useAuthStore((s) => s.setAutoUrl);
  // From the store, not `colors.accent`: without subscription the active URL
  // radio and «Add address» would keep the previous accent while the screen
  // stays mounted.
  const { accent } = useTheme();

  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const activeUrl = auth?.serverUrl ?? '';

  // Checks whether the active URL responds right now (green/red check).
  useEffect(() => {
    if (!auth) return;
    let alive = true;
    setHealth('checking');
    reachable(auth, activeUrl).then((ok) => {
      if (alive) setHealth(ok ? 'ok' : 'down');
    });
    return () => {
      alive = false;
    };
  }, [auth, activeUrl]);

  if (!auth) {
    return <SettingsPage title={t('Network')}>{null}</SettingsPage>;
  }

  const urls = auth.urls ?? [activeUrl];

  async function onAdd(value: string) {
    setAdding(false);
    const result = await addServerUrl(value);
    if (result === 'duplicate') toast(t('This address is already in the list.'));
    else if (result === 'unreachable') toast(t("Couldn't reach this address with your account."));
    else toast(t('Address added'));
  }

  async function onEdit(value: string) {
    const url = editing;
    setEditing(null);
    if (!url) return;
    const result = await editServerUrl(url, value);
    if (result === 'duplicate') toast(t('This address is already in the list.'));
    else if (result === 'unreachable') toast(t("Couldn't reach this address with your account."));
    else toast(t('Address updated'));
  }

  return (
    <SettingsPage title={t('Network')}>
      <SettingsScroll>
        <Text style={[settingsStyles.sectionTitle, { marginTop: 0 }]}>
          {t('Current server address')}
        </Text>
        <View style={[settingsStyles.cardBox, styles.activeRow]}>
          {health === 'checking' ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Icon
              name={health === 'ok' ? 'checkmark-circle' : 'alert-circle'}
              size={22}
              color={health === 'ok' ? colors.success : colors.danger}
            />
          )}
          <Text style={styles.activeUrl} numberOfLines={1}>
            {shown(activeUrl)}
          </Text>
        </View>

        <SwitchList
          options={[
            {
              label: t('Automatic URL switching'),
              value: !!auth.autoUrl,
              onChange: (v) => {
                void setAutoUrl(v);
                if (v) checkAutoUrlNow();
              },
            },
          ]}
        />

        <Text style={settingsStyles.sectionTitle}>{t('Server addresses')}</Text>
        <Text style={settingsStyles.sectionDescription}>
          {t(
            'Add the address you use from outside next to the one you use at home, so the server works wherever you are.',
          )}
        </Text>
        <View style={settingsStyles.cardBox}>
          {urls.map((url, i) => {
            const isActive = url === activeUrl;
            return (
              <Pressable
                key={url}
                style={({ pressed }) => [
                  settingsStyles.row,
                  i > 0 && settingsStyles.rowBorder,
                  pressed && { opacity: 0.6 },
                ]}
                onPress={() => {
                  if (!isActive) void setActiveUrl(url);
                }}
              >
                <Icon
                  name={isActive ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={isActive ? accent : colors.textMuted}
                />
                <View style={settingsStyles.rowLabelBox}>
                  <Text style={settingsStyles.rowLabel} numberOfLines={1}>
                    {shown(url)}
                  </Text>
                  {/* Auto-detected label (Local/Remote): explains the model at
                      a glance. */}
                  <Text style={settingsStyles.rowDescription}>
                    {isLanUrl(url) ? t('Local') : t('Remote')}
                  </Text>
                </View>
                {/* Side by side, so their reach is spread out rather than
                    piled on top of each other: one of them deletes. */}
                <View style={styles.rowActions}>
                  <Pressable
                    hitSlop={ACTION_SLOP}
                    onPress={() => setEditing(url)}
                    style={({ pressed }) => pressed && { opacity: 0.6 }}
                  >
                    <Icon name="create-outline" size={20} color={colors.textMuted} />
                  </Pressable>
                  {/* An account with a single address would be left with none. */}
                  {urls.length > 1 ? (
                    <Pressable
                      hitSlop={ACTION_SLOP}
                      onPress={() => void removeServerUrl(url)}
                      style={({ pressed }) => pressed && { opacity: 0.6 }}
                    >
                      <Icon name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          style={({ pressed }) => [
            settingsStyles.cardBox,
            settingsStyles.row,
            styles.addRow,
            pressed && { opacity: 0.6 },
          ]}
          onPress={() => setAdding(true)}
        >
          <Icon name="add" size={22} color={accent} />
          <Text style={[settingsStyles.rowLabel, { color: accent }]}>
            {t('Add address')}
          </Text>
        </Pressable>
      </SettingsScroll>

      <Dialog
        visible={adding}
        title={t('Add server address')}
        input={{ placeholder: 'https://…' }}
        confirmLabel={t('Add address')}
        onCancel={() => setAdding(false)}
        onConfirm={onAdd}
      />

      <Dialog
        visible={editing !== null}
        title={t('Edit server address')}
        input={{ placeholder: 'https://…', initialValue: editing ?? '' }}
        confirmLabel={t('Save')}
        onCancel={() => setEditing(null)}
        onConfirm={onEdit}
      />
    </SettingsPage>
  );
}

/** Taller than the icon and no wider than half the space between the two. */
const ACTION_SLOP = { top: 12, bottom: 12, left: spacing.sm, right: spacing.sm };

const styles = themed((colors) => ({
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  activeUrl: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  addRow: { marginTop: spacing.sm, borderRadius: radius.md },
}));
