/**
 * The metal the chrome skin draws a few pieces in (see `ThemeSkin`). Both are
 * fills: they go first inside a box that clips, under its content.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { chrome } from '@/theme';

/** Polished silver with a bevel: the play button. */
export function ChromeSilver() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={chrome.silver}
        locations={chrome.silverAt}
      />
      <View style={styles.bevel} />
    </View>
  );
}

/** Brushed gunmetal with a lit top edge: the mini player and the tab bar. */
export function ChromeBar({ corner }: { corner?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={chrome.gunmetal}
        locations={chrome.gunmetalAt}
      />
      {/* A box with corners of its own gets the whole bevel; a bar across the
          screen only its top edge. */}
      <View style={corner != null ? [styles.bevel, { borderRadius: corner }] : styles.topEdge} />
    </View>
  );
}

const styles = StyleSheet.create({
  bevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    borderWidth: 1,
    borderTopColor: chrome.edgeLight,
    borderLeftColor: chrome.edgeLight,
    borderBottomColor: chrome.edgeDark,
    borderRightColor: chrome.edgeDark,
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: chrome.edgeLight,
  },
});
