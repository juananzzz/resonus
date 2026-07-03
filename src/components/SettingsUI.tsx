/** Piezas compartidas por la pantalla de Ajustes y sus sub-pantallas. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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
 * Selector "elige una" plegable (estilo Spotify): colapsado muestra solo la
 * opción activa; al tocarla se despliega en el sitio la lista completa con
 * checkmark en la activa, y elegir vuelve a plegar. Con `collapsible: false`
 * la lista se muestra siempre completa (p. ej. la pantalla de Idioma). Con
 * `label` la fila plegada se explica sola ("Etiquetas de calidad · Nunca") y
 * puede vivir dentro de una tarjeta junto a otras filas (`embedded`). Las
 * etiquetas llegan ya traducidas desde quien lo usa.
 */
export function SelectList<T extends string | number | boolean>({
  options,
  value,
  onChange,
  collapsible = true,
  label,
  description,
  embedded = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  collapsible?: boolean;
  label?: string;
  description?: string;
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = options.find((o) => o.value === value) ?? options[0];
  const wrapStyle = embedded ? undefined : settingsStyles.selectCard;

  function toggle(next: boolean) {
    if (!collapsible) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(next);
  }

  if (collapsible && !expanded) {
    return (
      <View style={wrapStyle}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            settingsStyles.selectRow,
            embedded && settingsStyles.selectRowBorder,
            pressed && { opacity: 0.6 },
          ]}
          onPress={() => toggle(true)}
        >
          <View style={settingsStyles.rowLabelBox}>
            <Text style={settingsStyles.selectRowTextActive}>{label ?? active?.label}</Text>
            {description ? (
              <Text style={settingsStyles.rowDescription}>{description}</Text>
            ) : null}
          </View>
          {label ? <Text style={settingsStyles.selectRowValue}>{active?.label}</Text> : null}
          <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={wrapStyle}>
      {label ? (
        <Pressable
          style={[settingsStyles.selectRow, embedded && settingsStyles.selectRowBorder]}
          onPress={() => toggle(false)}
        >
          <Text style={[settingsStyles.selectRowTextActive, { flex: 1 }]}>{label}</Text>
          <Ionicons name="chevron-up" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
      {options.map((opt, i) => {
        const isActive = opt.value === value;
        return (
          <Pressable
            key={String(opt.value)}
            style={({ pressed }) => [
              settingsStyles.selectRow,
              (i > 0 || !!label || embedded) && settingsStyles.selectRowBorder,
              pressed && { opacity: 0.6 },
            ]}
            onPress={() => {
              toggle(false);
              if (!isActive) onChange(opt.value);
            }}
          >
            <Text style={[settingsStyles.selectRowText, isActive && settingsStyles.selectRowTextActive]}>
              {opt.label}
            </Text>
            {isActive ? (
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

/**
 * Grupo de interruptores agrupado en una tarjeta (estilo Spotify). La
 * explicación de cada ajuste va en `description`, dentro de la propia fila
 * (nada de párrafos sueltos entre tarjetas). `children` permite colar filas
 * extra al final de la misma tarjeta (p. ej. un SelectList embebido).
 */
export function SwitchList({
  options,
  children,
}: {
  options: {
    label: string;
    description?: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }[];
  children?: React.ReactNode;
}) {
  return (
    <View style={settingsStyles.selectCard}>
      {options.map((opt, i) => (
        <View
          key={opt.label}
          style={[settingsStyles.selectRow, i > 0 && settingsStyles.selectRowBorder]}
        >
          <View style={settingsStyles.rowLabelBox}>
            <Text style={settingsStyles.selectRowTextActive}>{opt.label}</Text>
            {opt.description ? (
              <Text style={settingsStyles.rowDescription}>{opt.description}</Text>
            ) : null}
          </View>
          <Switch
            value={opt.value}
            onValueChange={opt.onChange}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.text}
          />
        </View>
      ))}
      {children}
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
  // Título de sección estilo Spotify: negrita normal, sin mayúsculas gritonas.
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
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
  selectRowTextActive: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  // Columna etiqueta + descripción dentro de una fila (la ayuda vive aquí).
  rowLabelBox: { flex: 1, paddingRight: spacing.md },
  rowDescription: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  selectRowValue: { color: colors.textSecondary, fontSize: fontSize.sm, marginRight: spacing.xs },
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
