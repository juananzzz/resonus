/** Modo sin conexión: elige el origen de la música y reproduce ficheros locales. */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Message } from '@/components/Message';
import { TrackRow } from '@/components/TrackRow';
import { songsLabel, useT } from '@/i18n';
import {
  ensureAudioPermission,
  loadDeviceSongs,
  loadFolderSongs,
  pickFolder,
} from '@/lib/localLibrary';
import { useAuthStore } from '@/store/auth';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { currentSong, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

function folderName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  return decoded.split(/[:/]/).filter(Boolean).pop() ?? decoded;
}

export default function OfflineScreen() {
  const t = useT();
  const logout = useAuthStore((s) => s.logout);
  const source = useAuthStore((s) => s.offlineSource);
  const setSource = useAuthStore((s) => s.setOfflineSource);
  const toast = useToast((s) => s.show);

  async function chooseDevice() {
    const ok = await ensureAudioPermission();
    if (!ok) {
      toast(t('Necesitamos permiso para leer la música del dispositivo.'));
      return;
    }
    void setSource({ mode: 'device' });
  }

  async function chooseFolder() {
    const uri = await pickFolder();
    if (uri) void setSource({ mode: 'folder', uri });
  }

  // ── Pantalla de configuración: elegir el origen ──
  if (!source) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.setupHeader}>
          <Text style={styles.heading}>{t('Modo sin conexión')}</Text>
          <Pressable
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('Salir')}
            onPress={() => logout()}
          >
            <Ionicons name="exit-outline" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.setup}>
          <Text style={styles.setupTitle}>{t('¿De dónde sacamos tu música?')}</Text>

          <Pressable style={styles.option} onPress={chooseDevice}>
            <Ionicons name="phone-portrait-outline" size={28} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>{t('Escanear todo el móvil')}</Text>
              <Text style={styles.optionSub}>{t('Toda la música del dispositivo.')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>

          <Pressable style={styles.option} onPress={chooseFolder}>
            <Ionicons name="folder-outline" size={28} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>{t('Elegir una carpeta')}</Text>
              <Text style={styles.optionSub}>{t('Solo la música de la carpeta que elijas.')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return <Library source={source} onChangeSource={() => setSource(null)} />;
}

function Library({
  source,
  onChangeSource,
}: {
  source: { mode: 'device' } | { mode: 'folder'; uri: string };
  onChangeSource: () => void;
}) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);

  const sourceLabel = source.mode === 'folder' ? folderName(source.uri) : t('Modo sin conexión');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['localSongs', source.mode, source.mode === 'folder' ? source.uri : 'device'],
    queryFn: () => (source.mode === 'folder' ? loadFolderSongs(source.uri) : loadDeviceSongs()),
  });

  const songs = data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.setupHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading} numberOfLines={1}>
            {sourceLabel}
          </Text>
          <Text style={styles.subHeading}>
            {songs.length > 0
              ? `${t('Modo sin conexión')} · ${songsLabel(songs.length, lang)}`
              : t('Modo sin conexión')}
          </Text>
        </View>
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('Cambiar origen')}
          onPress={onChangeSource}
        >
          <Ionicons name="swap-horizontal" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
      ) : isError ? (
        <Message text={t('No se pudo cargar la música local.')} onRetry={() => refetch()} />
      ) : (
        <FlatList
          data={songs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.accent} />
          }
          renderItem={({ item, index }) => (
            <TrackRow
              song={item}
              isCurrent={playing?.id === item.id}
              showFavorite={false}
              showMenu={false}
              onPress={() => playQueue(songs, index, sourceLabel)}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('No hay música en esta ubicación.')}</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  setupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  heading: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '800' },
  subHeading: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  setup: { paddingHorizontal: spacing.lg, gap: spacing.md, marginTop: spacing.lg },
  setupTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  optionTitle: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  optionSub: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
