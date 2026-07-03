/**
 * Piezas compartidas por la pantalla de Ajustes y sus sub-pantallas, estilo
 * Spotify actual: lista plana sin tarjetas, filas con descripción gris debajo,
 * switch a la derecha y grupos de radios siempre visibles para elegir opción.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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
 * Fila plana de ajustes: etiqueta blanca, descripción gris debajo y lo que
 * toque a la derecha (chevron con `onPress`, texto en `right`, o ambos).
 */
export function SettingRow({
  label,
  description,
  icon,
  right,
  chevron,
  destructive,
  onPress,
}: {
  label: string;
  description?: string;
  /**
   * Icono a la izquierda: lo llevan las filas de ACCIÓN (escanear, limpiar…)
   * para distinguirse a simple vista de los datos de solo lectura.
   */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Texto gris a la derecha (valor actual, "Próximamente"…). */
  right?: string;
  /** Flecha a la derecha: solo para filas que navegan a otra pantalla. */
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      {icon ? (
        <Ionicons name={icon} size={20} color={destructive ? colors.danger : colors.text} />
      ) : null}
      <View style={settingsStyles.rowLabelBox}>
        <Text style={[settingsStyles.rowLabel, destructive && { color: colors.danger }]}>
          {label}
        </Text>
        {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
      </View>
      {right ? <Text style={settingsStyles.rowValue}>{right}</Text> : null}
      {chevron ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null}
    </>
  );
  if (!onPress) return <View style={settingsStyles.row}>{body}</View>;
  return (
    <Pressable
      style={({ pressed }) => [settingsStyles.row, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

/** Alto aproximado de cada opción del menú flotante (para calcular si cabe). */
const MENU_ITEM_H = 42;

/**
 * Selector "elige una" compacto: una sola fila con el valor actual ("Calidad
 * de streaming · Original ⌄") que al tocarla abre un menú flotante pequeño
 * anclado a la derecha (estilo dropdown de Android) con las opciones; elegir
 * lo cierra. Con `collapsible: false` se pinta como lista de radios siempre a
 * la vista (p. ej. la pantalla de Idioma). Las etiquetas llegan ya traducidas
 * desde quien lo usa.
 */
export function SelectList<T extends string | number | boolean>({
  options,
  value,
  onChange,
  label,
  description,
  collapsible = true,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  description?: string;
  collapsible?: boolean;
}) {
  const [menuTop, setMenuTop] = useState<number | null>(null);
  const rowRef = useRef<View>(null);
  const active = options.find((o) => o.value === value) ?? options[0];

  function openMenu() {
    rowRef.current?.measureInWindow((_x, y, _w, h) => {
      // Debajo de la fila; si no cabe, por encima (sin salirse de pantalla).
      const winH = Dimensions.get('window').height;
      const menuH = options.length * MENU_ITEM_H + spacing.sm * 2;
      const below = y + h - spacing.xs;
      setMenuTop(
        below + menuH > winH - spacing.xl ? Math.max(spacing.xl, y - menuH) : below,
      );
    });
  }

  if (!collapsible) {
    return (
      <View>
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <Pressable
              key={String(opt.value)}
              style={({ pressed }) => [settingsStyles.row, pressed && { opacity: 0.6 }]}
              onPress={() => {
                if (!isActive) onChange(opt.value);
              }}
            >
              <Text style={[settingsStyles.rowLabel, { flex: 1 }]}>{opt.label}</Text>
              <Ionicons
                name={isActive ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={isActive ? colors.accent : colors.textMuted}
              />
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable
        ref={rowRef}
        accessibilityRole="button"
        style={({ pressed }) => [settingsStyles.row, pressed && { opacity: 0.6 }]}
        onPress={openMenu}
      >
        <View style={settingsStyles.rowLabelBox}>
          <Text style={settingsStyles.rowLabel}>{label ?? active?.label}</Text>
          {description ? <Text style={settingsStyles.rowDescription}>{description}</Text> : null}
        </View>
        {label ? <Text style={settingsStyles.rowValue}>{active?.label}</Text> : null}
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal
        transparent
        statusBarTranslucent
        animationType="fade"
        visible={menuTop != null}
        onRequestClose={() => setMenuTop(null)}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuTop(null)} />
        {menuTop != null ? (
          <View style={[settingsStyles.menu, { top: menuTop }]}>
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <Pressable
                  key={String(opt.value)}
                  style={({ pressed }) => [settingsStyles.menuItem, pressed && { opacity: 0.6 }]}
                  onPress={() => {
                    setMenuTop(null);
                    if (!isActive) onChange(opt.value);
                  }}
                >
                  <Text
                    style={[settingsStyles.menuItemText, isActive && { color: colors.accent }]}
                  >
                    {opt.label}
                  </Text>
                  {isActive ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </>
  );
}

/** Grupo de interruptores, uno por fila, con su ayuda dentro de la fila. */
export function SwitchList({
  options,
}: {
  options: {
    label: string;
    description?: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }[];
}) {
  return (
    <View>
      {options.map((opt) => (
        <View key={opt.label} style={settingsStyles.row}>
          <View style={settingsStyles.rowLabelBox}>
            <Text style={settingsStyles.rowLabel}>{opt.label}</Text>
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
  content: { padding: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  // Título de grupo estilo Spotify: negrita clara, con aire por encima.
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowLabel: { color: colors.text, fontSize: fontSize.md },
  rowLabelBox: { flex: 1 },
  rowDescription: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 2 },
  rowValue: { color: colors.textSecondary, fontSize: fontSize.sm },
  // Menú flotante anclado a la derecha (estilo dropdown de Android).
  menu: {
    position: 'absolute',
    right: spacing.lg,
    minWidth: 170,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: MENU_ITEM_H,
  },
  menuItemText: { color: colors.text, fontSize: fontSize.sm, flex: 1 },
  field: { paddingVertical: spacing.md },
  fieldLabel: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: 2 },
  fieldValue: { color: colors.text, fontSize: fontSize.md },
  // Botón píldora blanco centrado (el "Cerrar sesión" de Spotify).
  pillButton: {
    alignSelf: 'center',
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl + spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.xxl,
  },
  pillButtonText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
});
