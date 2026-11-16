/**
 * What a "browse everything" screen sits in.
 *
 * On its own it is a screen: it starts under the status bar and there is a
 * back arrow above it. Inside the Library tab it is the body of somebody
 * else's screen, and the chrome above it is theirs — the tab has already taken
 * the inset and already says which section you are in, so a second header
 * there would be the section named twice.
 *
 * Only the frame is shared. Each screen keeps its own header markup, because
 * what goes in it differs (a view menu, an add button, the swap the song list
 * does while selecting) and hiding that behind props made the headers harder
 * to read than the four lines it saved. Embedded, the one button that survives
 * is drawn by the tab instead — see `BrowserProps`.
 */
import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { themed } from '@/theme';

/**
 * What every one of them takes.
 *
 * `actionRef` is how the button in the tab's header reaches the menu it opens,
 *  which lives down here with the state it belongs to. The section fills it in
 *  while rendering, the way `SheetModal` takes its `openRef`.
 *
 * `searchOpen` is the other half of that arrangement, and it goes the other
 *  way: embedded, whether the box is there at all is the tab's to say, because
 *  the magnifier that opens it is drawn up there and turns into the X that
 *  closes it. A ref would have done for opening it, but then two places would
 *  hold the same fact and the day they disagree the icon says close and the tap
 *  opens (see `useSearchBox`).
 *
 * `downloaded`/`favorited` and their presses are the same arrangement a third
 *  time, and they split the same way the filters do: which lists are on screen
 *  is the tab's answer, one filter over every section, while the heart's state
 *  belongs to the section it is drawn in and writes its own saved switch. The
 *  value goes down, the press is handed down — a section reached as a screen of
 *  its own takes neither pair, and draws neither icon.
 */
export interface BrowserProps {
  embedded?: boolean;
  actionRef?: MutableRefObject<() => void>;
  searchOpen?: boolean;
  downloaded?: boolean;
  favorited?: boolean;
  onToggleDownloaded?: () => void;
  onToggleFavorite?: () => void;
}

/**
 * Whether to draw the search box, and the clearing that goes with putting it
 * away.
 *
 * Embedded it is the tab's answer; on a browse screen of its own the box is
 * always there, which is what it has always done. Closing it clears what was
 * typed: a filter still narrowing a list from behind a box that is no longer
 * on screen is the kind of thing you spend a minute not finding.
 */
export function useSearchBox(
  embedded: boolean | undefined,
  searchOpen: boolean | undefined,
  clear: () => void,
): boolean {
  const open = embedded ? !!searchOpen : true;
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open) clear();
    was.current = open;
  });
  return open;
}

export function BrowseFrame({ embedded, children }: { embedded?: boolean; children: ReactNode }) {
  if (embedded) return <View style={styles.frame}>{children}</View>;
  return (
    <SafeAreaView style={styles.frame} edges={['top']}>
      {children}
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  frame: { flex: 1, backgroundColor: colors.background },
}));
