/**
 * The size of the screen, as it is right now (#131).
 *
 * Every measurement in the app used to be a module constant, read once from
 * `Dimensions.get('window')` when the file was first imported. That is the
 * width the app started at, and it never changes again: turning the phone
 * sideways left every card, every grid and the whole player laid out for a
 * screen that is no longer there. So the rule from here on is that anything
 * derived from the width is derived during the render, from this hook, which
 * is `useWindowDimensions` with names on the numbers.
 *
 * Three questions get asked of a screen, and they are not the same question:
 *
 * `landscape` is only which way round it is. A phone on its side is landscape
 * and is still a phone.
 *
 * `wide` is whether there is room for more than one thing across, and it goes
 * by the SHORTEST side, so a tablet stays a tablet when it is turned. Six
 * hundred is Android's own line between a phone and a tablet, and using
 * anybody else's number here would only mean disagreeing with the system about
 * what the device is.
 *
 * `short` is the one that actually bites on a phone in landscape: 400-odd
 * points of height, where anything that wanted a square cover and a column of
 * controls underneath has to be laid out side by side instead.
 */
import { useWindowDimensions } from 'react-native';

import { gridCardWidth } from '@/lib/gridLayout';

export interface ScreenSize {
  width: number;
  height: number;
  /** Wider than it is tall. */
  landscape: boolean;
  /** A tablet: 600dp on the shortest side, whichever way it is held. */
  wide: boolean;
  /** Little vertical room, which is a phone turned on its side. */
  short: boolean;
}

/** Android's own line between a phone and a tablet, in dp. */
export const TABLET_WIDTH = 600;

/**
 * Below this there is not enough height for a cover with the controls under
 * it. It is a phone in landscape (411 × 891 on the one this was measured on)
 * and not much else: a small tablet on its side still has 800.
 */
const SHORT_HEIGHT = 500;

export function useScreenSize(): ScreenSize {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    landscape: width > height,
    wide: Math.min(width, height) >= TABLET_WIDTH,
    short: height < SHORT_HEIGHT,
  };
}

/**
 * How wide a run of text or of full-width rows is allowed to get, and how much
 * padding puts it in the middle of what is left.
 *
 * A settings list, a tracklist, an album: on a phone these are the screen and
 * there is nothing to decide. Across 1280 points of tablet the same rows
 * become a title on the far left and a duration on the far right with a hand's
 * width of nothing in between, which is not a layout, it is a phone screen
 * that was stretched. So they stop growing and sit in the middle.
 *
 * The number is a reading measure rather than a device: around seven hundred
 * points is where a row still reads as one thing.
 */
export const CONTENT_MAX_WIDTH = 720;

/** The side padding that centres content of at most `CONTENT_MAX_WIDTH`. */
export function centredPadding(width: number, base: number): number {
  return Math.max(base, (width - CONTENT_MAX_WIDTH) / 2);
}

/**
 * The same, as a hook, for the many screens whose only question is how much
 * padding their list wants. Rows only: a grid is meant to fill the width, and
 * what it does with the room is add columns (see `useGridColumns`).
 */
export function useListPadding(base = 16): number {
  const { width } = useWindowDimensions();
  return centredPadding(width, base);
}

/**
 * How many cards fit across, given how wide one should be.
 *
 * The screens that draw grids each have a number of columns they open on, and
 * on a phone that number IS the layout. On a tablet it is a promise about card
 * size that the screen can no longer keep: two columns across 1280 points are
 * two covers the size of a hand. So the count is worked out from the space
 * instead, from the width one card wants to be, and the phone's number becomes
 * the floor rather than the answer.
 */
export function columnsFor(width: number, ideal: number, min = 2, max = 8): number {
  const usable = width - 32; // the screens' own horizontal padding, near enough
  return Math.max(min, Math.min(max, Math.round(usable / ideal)));
}

/**
 * The width of one card in a fixed-column grid, measured during the render.
 *
 * The grids in the app used to work this out from `Dimensions.get('window')`
 * when their module was imported, so a turn left every card at the old width
 * (#131). This is the same arithmetic with the live width.
 */
export function useGridCardWidth(
  columns: number,
  gap: number,
  sidePadding: number,
): number {
  const { width } = useWindowDimensions();
  return gridCardWidth(width, columns, gap, sidePadding);
}
