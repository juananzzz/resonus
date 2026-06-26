/** Captura errores de render para no tumbar la app entera. */
import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/theme';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Algo ha fallado</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Reintentar</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  title: { color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  message: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  buttonText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
});
