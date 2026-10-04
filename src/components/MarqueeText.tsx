/**
 * Single-line text that, if it overflows, scrolls in a loop (Spotify-style
 * marquee): pause, linear pass with a second copy chasing the text, and start
 * over. If it fits, it stays as a normal Text that hugs its content (so the
 * wrapping Pressable is only tappable over the text, not the full row width).
 *
 * The reliable real-width measurement comes from an invisible horizontal
 * ScrollView: its content is not constrained by the parent width. (A bare
 * Text inside a View measures at most the available width, so overflow would
 * never be detected.)
 */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Gap between the end of the text and the copy chasing it. */
const GAP = 48;
/** Scrolling speed (px/s). */
const SPEED = 30;
/** Wait before each pass. */
const PAUSE_MS = 2500;

export function MarqueeText({
  text,
  style,
  enabled = true,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  /** With false it never scrolls: long text is truncated with ellipsis. */
  enabled?: boolean;
}) {
  // Container width (with short text ≈ the text itself; with long text, the
  // available space, because maxWidth caps it) and real text width.
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);
  const offset = useSharedValue(0);

  const overflows = enabled && containerW > 0 && textW > containerW + 1;

  useEffect(() => {
    cancelAnimation(offset);
    offset.set(0);
    if (!overflows) return;
    const distance = textW + GAP;
    // reduceMotion Never: without marquee the long title gets cut off with no
    // way to read it, so it animates even with "reduce motion".
    offset.set(withRepeat(
      withDelay(
        PAUSE_MS,
        withTiming(-distance, {
          duration: (distance / SPEED) * 1000,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        }),
        ReduceMotion.Never,
      ),
      -1,
      false,
      undefined,
      ReduceMotion.Never,
    ));
    return () => cancelAnimation(offset);
  }, [overflows, textW, text, offset]);

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));

  return (
    <View style={styles.hug} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
      {/* Invisible real-width measurer, out of flow. */}
      <ScrollView
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        pointerEvents="none"
        style={styles.measurer}
      >
        {/* key: when the text changes it remounts and onLayout always re-measures. */}
        <Text
          key={text}
          numberOfLines={1}
          style={style}
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
        >
          {text}
        </Text>
      </ScrollView>

      {overflows ? (
        <View style={[styles.clip, { width: containerW }]}>
          <ScrollView
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            pointerEvents="none"
          >
            <Animated.View style={[styles.row, anim]}>
              <Text numberOfLines={1} style={style}>
                {text}
              </Text>
              <Text numberOfLines={1} style={[style, { paddingLeft: GAP }]}>
                {text}
              </Text>
            </Animated.View>
          </ScrollView>
        </View>
      ) : (
        <Text numberOfLines={1} style={style}>
          {text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Hugs the content without exceeding the space (like the old `tapText`).
  hug: { alignSelf: 'flex-start', maxWidth: '100%' },
  measurer: { position: 'absolute', opacity: 0, height: 0 },
  clip: { overflow: 'hidden' },
  row: { flexDirection: 'row' },
});
