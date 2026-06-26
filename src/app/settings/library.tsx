/** Ajustes › Biblioteca: estado del escaneo y limpieza de caché. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { rescanLocal } from '@/api/data';
import { getScanStatus, startScan } from '@/api/subsonic';
import { Field, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';
import { colors } from '@/theme';

export default function LibrarySettings() {
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const source = useAuthStore((s) => s.offlineSource);
  const setSource = useAuthStore((s) => s.setOfflineSource);
  const toast = useToast((s) => s.show);
  const [rescanning, setRescanning] = useState(false);

  async function rescanNow() {
    if (rescanning) return;
    setRescanning(true);
    toast(t('Volviendo a escanear tu música…'));
    try {
      await rescanLocal();
      queryClient.invalidateQueries();
      toast(t('Biblioteca actualizada'));
    } catch {
      toast(t('No se pudo volver a escanear'));
    } finally {
      setRescanning(false);
    }
  }

  const { data: scan, refetch: refetchScan } = useQuery({
    queryKey: ['scanStatus'],
    queryFn: () => getScanStatus(auth!),
    enabled: !!auth,
  });

  async function scanNow() {
    if (!auth) return;
    try {
      await startScan(auth);
      toast(t('Escaneo iniciado'));
      setTimeout(() => refetchScan(), 1500);
    } catch {
      toast(t('No se pudo iniciar el escaneo'));
    }
  }

  async function clearCache() {
    queryClient.clear();
    await Promise.all([Image.clearMemoryCache(), Image.clearDiskCache()]).catch(() => {});
    toast(t('Caché limpiada'));
  }

  return (
    <SettingsPage title={t('Biblioteca')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {offline ? (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Modo sin conexión')}</Text>
            <View style={settingsStyles.card}>
              <Field label={t('Origen')} value={source?.mode === 'folder' ? 'Carpeta' : 'Dispositivo'} />
            </View>
            <Pressable
              style={settingsStyles.rowButton}
              disabled={rescanning}
              onPress={rescanNow}
            >
              {rescanning ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="refresh" size={22} color={colors.text} />
              )}
              <Text style={settingsStyles.rowText}>{t('Volver a escanear')}</Text>
            </Pressable>
            <Pressable
              style={settingsStyles.rowButton}
              onPress={() => { void setSource(null); }}
            >
              <Ionicons name="swap-horizontal" size={22} color={colors.text} />
              <Text style={settingsStyles.rowText}>{t('Cambiar origen')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={settingsStyles.sectionTitle}>{t('Biblioteca')}</Text>
            <View style={settingsStyles.card}>
              <Field
                label={t('Estado del escaneo')}
                value={scan?.scanning ? t('Escaneando…') : t('{n} elementos', { n: scan?.count ?? 0 })}
              />
              <View style={settingsStyles.divider} />
              <Pressable style={settingsStyles.linkRow} onPress={scanNow}>
                <Ionicons name="refresh" size={22} color={colors.text} />
                <Text style={settingsStyles.rowText}>{t('Escanear ahora')}</Text>
              </Pressable>
            </View>
          </>
        )}

        <Text style={settingsStyles.sectionTitle}>{t('Almacenamiento')}</Text>
        <Pressable style={settingsStyles.rowButton} onPress={clearCache}>
          <Ionicons name="trash-outline" size={22} color={colors.text} />
          <Text style={settingsStyles.rowText}>{t('Limpiar caché')}</Text>
        </Pressable>
      </ScrollView>
    </SettingsPage>
  );
}
