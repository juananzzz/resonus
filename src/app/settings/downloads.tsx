/** Ajustes › Descargas: calidad, espacio ocupado y limpieza. */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Dialog } from '@/components/Dialog';
import { Field, SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { songsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { BITRATE_OPTIONS, useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors } from '@/theme';

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export default function DownloadsSettings() {
  const t = useT();
  const toast = useToast((s) => s.show);
  const offline = useAuthStore((s) => s.offline);
  const lang = useSettings((s) => s.language);
  const downloadBitRate = useSettings((s) => s.downloadBitRate);
  const setDownloadBitRate = useSettings((s) => s.setDownloadBitRate);
  const files = useDownloads((s) => s.files);
  const usageBytes = useDownloads((s) => s.usageBytes);
  const clearAll = useDownloads((s) => s.clearAll);

  const [usage, setUsage] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const count = Object.keys(files).length;

  useEffect(() => {
    let active = true;
    usageBytes().then((n) => {
      if (active) setUsage(n);
    });
    return () => {
      active = false;
    };
  }, [usageBytes, count]);

  return (
    <SettingsPage title={t('Downloads')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {!offline ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Download quality')}</Text>
            <SelectList
              options={BITRATE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
              value={downloadBitRate}
              onChange={(value) => {
                const opt = BITRATE_OPTIONS.find((o) => o.value === value);
                setDownloadBitRate(value);
                if (opt) toast(t('Quality: {label}', { label: opt.label }));
              }}
            />
            <Text style={settingsStyles.hint}>
              {t('“Original” uses the highest quality; a lower bitrate saves data.')}
            </Text>
          </>
        ) : null}

        <Text style={settingsStyles.sectionTitle}>{t('Storage')}</Text>
        <View style={settingsStyles.card}>
          <Field
            label={t('Storage used')}
            value={
              usage == null
                ? '…'
                : `${formatBytes(usage)} · ${songsLabel(count, lang)}`
            }
          />
        </View>

        {count > 0 ? (
          <Pressable style={settingsStyles.logout} onPress={() => setConfirm(true)}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
            <Text style={settingsStyles.logoutText}>{t('Delete all downloads')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Dialog
        visible={confirm}
        title={t('Delete all downloads?')}
        message={t('All downloaded music will be removed from this device.')}
        confirmLabel={t('Delete')}
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await clearAll();
          setUsage(0);
          toast(t('Downloads deleted'));
        }}
      />
    </SettingsPage>
  );
}
