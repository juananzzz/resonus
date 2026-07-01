/** Piezas compartidas por la pantalla de Ajustes y sus sub-pantallas. */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

/** Cabecera con flecha de volver y título centrado. */
export function ScreenHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={settingsStyles.header}>
      <Pressable hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </Pressable>
      <Text style={settingsStyles.headerTitle}>{title}</Text>
      <View style={{ width: 28 }} />
    </View>
  );
}

/** Contenedor de pantalla de ajustes (safe-area + cabecera). */
export function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={settingsStyles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      {children}
    </SafeAreaView>
  );
}

/**
 * Lista de opciones "elige una" agrupada en una tarjeta, con checkmark en la
 * activa. Sustituye a los chips: más limpia y sin saltos de línea. Las
 * etiquetas llegan ya traducidas desde quien la usa.
 */
export function SelectList<T extends string | number | boolean>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={settingsStyles.selectCard}>
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            style={({ pressed }) => [
              settingsStyles.selectRow,
              i > 0 && settingsStyles.selectRowBorder,
              pressed && { opacity: 0.6 },
            ]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[settingsStyles.selectRowText, active && settingsStyles.selectRowTextActive]}>
              {opt.label}
            </Text>
            {active ? (
              <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
            ) : (
              <View style={{ width: 22 }} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pareja etiqueta/valor para datos de solo lectura. */
export function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={settingsStyles.field}>
      <Text style={settingsStyles.fieldLabel}>{label}</Text>
      <Text style={settingsStyles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export const settingsStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: SCREEN_BOTTOM_PADDING },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  field: { paddingVertical: spacing.md },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: 2 },
  fieldValue: { color: colors.text, fontSize: fontSize.md },
  divider: { height: 1, backgroundColor: colors.border },
  selectCard: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  selectRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  selectRowText: { color: colors.textSecondary, fontSize: fontSize.md, flex: 1 },
  selectRowTextActive: { color: colors.text, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  chipTextActive: { color: '#000' },
  hint: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: spacing.xs },
  rowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  rowText: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  soonTag: { color: colors.textMuted, fontSize: fontSize.xs },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  logoutText: { color: colors.danger, fontSize: fontSize.md, fontWeight: '600' },
});
