/**
 * Orden reutilizable de una lista de canciones (Recientes/Alfabético +
 * dirección) con su menú inferior. Lo usan playlist y favoritos.
 *
 * Devuelve la lista ya ordenada, el mapeo a los índices originales (para
 * acciones como "quitar de la lista"), un disparador para abrir el menú y el
 * propio menú como nodo a renderizar. Con `persistKey` el orden elegido se
 * guarda en disco y se recuerda entre visitas.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Song } from '@/api/subsonic';
import { useT } from '@/i18n';
import {
  DEFAULT_SORT,
  useSortPrefs,
  type SortDir,
  type SortField,
  type SortPref,
} from '@/store/sortPrefs';
import { colors, fontSize, radius, spacing } from '@/theme';

const SORT_LABEL: Record<SortField, string> = {
  recent: 'Recent',
  alpha: 'Alphabetical',
  artist: 'Artist',
  album: 'Album',
};

interface SortResult {
  /** Canciones en el orden visible. */
  songs: Song[];
  /** Índice original (en el servidor) de cada canción visible. */
  indices: number[];
  /** Abre el menú de orden. */
  openSort: () => void;
  /** El menú de orden, para renderizar en el árbol. */
  sortSheet: ReactNode;
}

export function useSongSort(source: Song[], persistKey?: string): SortResult {
  const t = useT();
  const insets = useSafeAreaInsets();
  const stored = useSortPrefs((s) => (persistKey ? s.prefs[persistKey] : undefined));
  const setPref = useSortPrefs((s) => s.setPref);
  const [local, setLocal] = useState<SortPref>(DEFAULT_SORT);
  const [open, setOpen] = useState(false);

  const { field, dir } = persistKey ? (stored ?? DEFAULT_SORT) : local;
  function update(next: SortPref) {
    if (persistKey) setPref(persistKey, next);
    else setLocal(next);
  }

  // La lista llega del servidor en orden de adición (recientes ascendente).
  const cmp = (a?: string, b?: string) => (a ?? '').localeCompare(b ?? '');
  const ordered = source.map((song, idx) => ({ song, idx }));
  if (field === 'alpha') ordered.sort((a, b) => cmp(a.song.title, b.song.title));
  if (field === 'artist')
    ordered.sort((a, b) => cmp(a.song.artist, b.song.artist) || cmp(a.song.title, b.song.title));
  if (field === 'album')
    ordered.sort(
      (a, b) =>
        cmp(a.song.album, b.song.album) ||
        (a.song.track ?? 0) - (b.song.track ?? 0) ||
        cmp(a.song.title, b.song.title),
    );
  if (dir === 'desc') ordered.reverse();

  const sortSheet = (
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <Text style={styles.sheetTitle}>{t('Sort by')}</Text>
        {(['recent', 'alpha', 'artist', 'album'] as SortField[]).map((f) => {
          const active = field === f;
          return (
            <Pressable
              key={f}
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => update({ field: f, dir })}
            >
              <Text style={[styles.actionText, active && { color: colors.accent }]}>
                {t(SORT_LABEL[f])}
              </Text>
              {active ? (
                <Ionicons
                  name="checkmark"
                  size={20}
                  color={colors.accent}
                  style={{ marginLeft: 'auto' }}
                />
              ) : null}
            </Pressable>
          );
        })}

        <View style={styles.divider} />
        <Text style={styles.sheetTitle}>{t('Direction')}</Text>
        <View style={styles.dirRow}>
          {(['asc', 'desc'] as SortDir[]).map((d) => {
            const active = dir === d;
            return (
              <Pressable
                key={d}
                style={[styles.dirChip, active && styles.dirChipActive]}
                onPress={() => update({ field, dir: d })}
              >
                <Ionicons
                  name={d === 'asc' ? 'arrow-up' : 'arrow-down'}
                  size={16}
                  color={active ? '#000' : colors.text}
                />
                <Text style={[styles.dirChipText, active && { color: '#000' }]}>
                  {d === 'asc' ? t('Ascending') : t('Descending')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );

  return {
    songs: ordered.map((o) => o.song),
    indices: ordered.map((o) => o.idx),
    openSort: () => setOpen(true),
    sortSheet,
  };
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
  actionText: { color: colors.text, fontSize: fontSize.md },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  dirRow: { flexDirection: 'row', gap: spacing.sm },
  dirChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  dirChipActive: { backgroundColor: colors.accent },
  dirChipText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
});
