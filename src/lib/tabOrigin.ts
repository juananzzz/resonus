/**
 * Which of the tabs the screens on top of it came from (#96).
 *
 * A stack is opened from somewhere: an album reached from the Library belongs
 * to the Library, the same album reached from a search belongs to Search. The
 * navigator has no notion of that, since every one of those screens is pushed
 * onto the single Stack that sits above the tabs, so it is kept here.
 *
 * Module scope on purpose: it outlives every screen that reads it, and losing
 * it on a remount would send somebody back to a tab they were never on. It is
 * only ever written while the tabs themselves are on screen, which is the one
 * moment the answer is known for certain.
 */
export type TabSegment = 'index' | 'search' | 'library' | 'explore' | 'options';

/** Route of each tab, and the label to call it by (translated where used). */
export const TABS: { segment: TabSegment; href: string; label: string }[] = [
  { segment: 'index', href: '/', label: 'Home' },
  { segment: 'search', href: '/search', label: 'Search' },
  { segment: 'library', href: '/library', label: 'Your library' },
  { segment: 'explore', href: '/explore', label: 'Explore' },
  // Settings as a tab, off by default. Not `/settings`: that is the screen the
  // gear opens, and this tab shows the same one.
  { segment: 'options', href: '/options', label: 'Settings' },
];

let origin: TabSegment = 'index';

/** Called while the tabs are on screen: this is where any new stack starts. */
export function rememberTab(segment: string | undefined): TabSegment {
  const known = TABS.find((tb) => tb.segment === segment);
  origin = known ? known.segment : 'index';
  return origin;
}

export function tabOrigin(): TabSegment {
  return origin;
}

/** Where "out of here" leads: the tab these screens were opened from. */
export function tabOriginHref(): string {
  return TABS.find((tb) => tb.segment === origin)?.href ?? '/';
}

/** Its name, for whoever has to say it out loud (accessibility hints). */
export function tabOriginLabel(): string {
  return TABS.find((tb) => tb.segment === origin)?.label ?? 'Home';
}

// ── Tapping the tab you are already on ──────────────────────────────────────
// The tabs navigator raises `tabPress` for this, and Search listens for it to
// put the cursor in its box. But with "Always show the navigation bar" on the
// navigator draws no bar at all: the one on screen is `GlobalTabBar`, which
// moves by asking the router, and the router has no idea a tab was re-pressed.
// So the event went missing exactly for the people who turned that setting on,
// and going to Search from Search quietly did nothing.
//
// Said here rather than through the navigator because both bars can say it and
// only this module is above the two of them.

const reselectListeners = new Map<TabSegment, Set<() => void>>();

/** The tab already on screen was pressed again. */
export function reselectTab(segment: TabSegment): void {
  for (const fn of reselectListeners.get(segment) ?? []) fn();
}

/** Listens for that, and hands back the way to stop. */
export function onTabReselect(segment: TabSegment, fn: () => void): () => void {
  let set = reselectListeners.get(segment);
  if (!set) {
    set = new Set();
    reselectListeners.set(segment, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

// ── Opening Search with the cursor already in the box ────────────────────────
// The button on Home leads to a tab that may not be mounted yet, so there is
// nobody listening at the moment it is pressed. The intent is left here and
// collected by Search on its way in.

let focusRequested = false;

/** Ask Search to raise the keyboard as soon as it is on screen. */
export function requestSearchFocus(): void {
  focusRequested = true;
}

/** Takes the request, if there was one: it is good for a single arrival. */
export function takeSearchFocus(): boolean {
  const asked = focusRequested;
  focusRequested = false;
  return asked;
}
