/**
 * Where the JS thread goes.
 *
 * Two instruments. A heartbeat that notices when the thread was busy, by how
 * late its own timer fires, and a stopwatch around the operations we suspect.
 * Both ship in the app: a report from the phone that actually has the problem
 * beats any amount of reading the code from here (#50).
 *
 * The cost of measuring is a timer every quarter second and two `Date.now()`
 * per measured operation, so it can stay on for everyone.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';

/**
 * Whether any of this runs at all.
 *
 * The measuring is meant to be cheap enough to leave on for everyone: a timer
 * four times a second and two `Date.now()` per measured operation. Cheap is not
 * the same as free, though, and somebody chasing a slow app is right to want it
 * out of the way before believing anything else. So it can be turned off, from
 * Settings › About, and off means off: no heartbeat, no stopwatch, no counting.
 */
let enabled = true;

/** Turned on and off from the setting; off clears what was collected. */
export function setPerfEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  if (on) {
    startPerfLog();
    return;
  }
  if (timer) clearInterval(timer);
  timer = null;
  stopJsFrames();
  resetPerfLog();
}

export function perfEnabled(): boolean {
  return enabled;
}

/** How often the heartbeat checks in. */
const TICK_MS = 250;
/** Under this, being late is ordinary scheduling noise rather than a block. */
const BLOCK_MS = 120;
/** Worst blocks kept. Enough to see a pattern, small enough to read. */
const MAX_BLOCKS = 15;

export interface Block {
  /** When it happened. */
  at: number;
  /** How much longer than expected the thread took to come back. */
  ms: number;
  /** What was in flight at the time, if anything. A hint, not a verdict. */
  during: string;
}

export interface OpStat {
  tag: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

let startedAt = 0;
let lastTick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const blocks: Block[] = [];
const ops = new Map<string, OpStat>();
/** Operations in flight, for `during`. */
const running: string[] = [];

/**
 * Is the app in the foreground?
 *
 * Watched from module scope, and not from inside `startPerfLog`, because the
 * heartbeat below is not the only instrument that needs to know: the player's
 * own beat is measured precisely when this is false. One listener and a
 * boolean, so it costs the same whether or not anything is being measured.
 */
let awake = AppState.currentState === 'active';

/**
 * How the time since the last reset splits between the two states, and how
 * often it changed hands.
 *
 * Every other number in this report is one without a denominator until these
 * are here. "Fell into offline: 340" is a broken app over one night and an
 * unremarkable one over a fortnight, and nothing else written down says which.
 * The split matters as much as the total, because what a battery report blames
 * an app for is nearly always the half nobody was looking at.
 */
let stateSince = Date.now();
let foregroundMs = 0;
let backgroundMs = 0;
let trips = 0;

/**
 * Heartbeats that landed while the app was away.
 *
 * The block detector says nothing out there on purpose: Android stops handing
 * the timer its turn, so every silence would read as a freeze. Turned around,
 * that same silence is the measurement. A backgrounded app that is behaving
 * gets throttled almost to nothing, so these ticks against their own period
 * say how much of the night the JS thread was actually being run. Near the
 * whole of it is the shape of a phone whose battery went somewhere.
 */
let bgTicks = 0;

/** Books the time since the last change to whichever state it was spent in. */
function closeSpan(now: number): void {
  const span = now - stateSince;
  stateSince = now;
  if (awake) foregroundMs += span;
  else backgroundMs += span;
}

AppState.addEventListener('change', (state) => {
  const wasAwake = awake;
  const now = Date.now();
  const nowAwake = state === 'active';
  // `inactive` and `background` are both away, and Android sends them one
  // after the other: without this, one trip to the home screen would count as
  // two and the spans would be split at a moment nothing happened at.
  if (nowAwake !== wasAwake) {
    closeSpan(now);
    trips++;
  }
  awake = nowAwake;
  // Whatever happened out there is not ours to measure, and the clock starts
  // again here.
  lastTick = now;
  // Going away with a history worth keeping: if the session dies out there,
  // this file is what the next launch reads the minutes by.
  if (wasAwake && !nowAwake) {
    persistEvents();
    // The JS frame loop measures nothing while away (`onJsFrame` drops every
    // background frame) but keeps the JS thread waking up to 60×/s. On iOS the
    // audio background mode keeps timers running, so stop it out there.
    stopJsFrames();
  }
  if (!wasAwake && awake) {
    onReturn();
    if (enabled) startJsFrames();
  }
});

export interface TimeSplit {
  foregroundMs: number;
  backgroundMs: number;
  /** Trips between the two, counted once each. */
  trips: number;
  /** Of `backgroundMs`, how much the JS thread was given its turn. */
  jsAwayMs: number;
}

/** The split as it stands, with the span still open included. */
export function perfTime(): TimeSplit {
  const open = Date.now() - stateSince;
  return {
    foregroundMs: foregroundMs + (awake ? open : 0),
    backgroundMs: backgroundMs + (awake ? 0 : open),
    trips,
    jsAwayMs: bgTicks * TICK_MS,
  };
}

/**
 * Starts the heartbeat (idempotent).
 *
 * The app being in the background is not a block. Android stops handing the
 * timer its turn out there, so coming back after ten seconds away looked like a
 * ten second freeze, and those went straight to the top of the report where
 * they were the first thing anybody read. The state is watched for that reason,
 * and the tick after a return is skipped rather than blamed.
 */
export function startPerfLog(): void {
  if (timer || !enabled) return;
  startedAt = Date.now();
  lastTick = Date.now();
  // The split runs off the same clock as the rest of the report. Without this
  // it would run off module load, and measuring switched on an hour later
  // would hand back more time away than the session it is reporting on.
  stateSince = startedAt;
  foregroundMs = 0;
  backgroundMs = 0;
  trips = 0;
  bgTicks = 0;
  // No frames to count while away (see the AppState listener above, which
  // restarts them on return).
  if (awake) startJsFrames();
  timer = setInterval(() => {
    const now = Date.now();
    const late = now - lastTick - TICK_MS;
    lastTick = now;
    if (!awake) {
      // Not a block, and not nothing either: see `bgTicks`.
      bgTicks++;
      return;
    }
    if (late < BLOCK_MS) return;
    const block: Block = { at: now, ms: late, during: running[running.length - 1] ?? '—' };
    // In development it also goes to the console, where whoever is driving the
    // app can see it land on the screen that caused it.
    if (__DEV__) console.log(`[perf] BLOCK ${late} ms · during ${block.during}`);
    // The worst ones are kept, not the last ones: a single two second freeze
    // matters more than the twenty small ones that came after it.
    if (blocks.length < MAX_BLOCKS) {
      blocks.push(block);
      return;
    }
    let worstIdx = 0;
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].ms < blocks[worstIdx].ms) worstIdx = i;
    }
    if (block.ms > blocks[worstIdx].ms) blocks[worstIdx] = block;
  }, TICK_MS);
}

/** Anything slower than this gets its own line in the development console. */
const LOUD_MS = 100;

function record(tag: string, ms: number): void {
  if (__DEV__ && ms >= LOUD_MS) console.log(`[perf] ${tag} · ${ms} ms`);
  const cur = ops.get(tag);
  if (cur) {
    cur.count++;
    cur.totalMs += ms;
    if (ms > cur.maxMs) cur.maxMs = ms;
  } else {
    ops.set(tag, { tag, count: 1, totalMs: ms, maxMs: ms });
  }
}

/**
 * Records something already measured, for what cannot be wrapped in a call:
 * how long the thread took to come back after a navigation, say.
 */
export function mark(tag: string, ms: number): void {
  if (!enabled) return;
  record(tag, ms);
}

/**
 * Times an async operation. Note this is wall time, waiting included, so for
 * anything that goes to the network it says how long the answer took, not how
 * busy the thread was. Reading the response is timed apart, and that one IS
 * the thread.
 */
export async function timed<T>(tag: string, fn: () => Promise<T>): Promise<T> {
  // Not even the two `Date.now()`, so that a session with this off is the app
  // with nothing of this in it.
  if (!enabled) return fn();
  const t0 = Date.now();
  running.push(tag);
  try {
    return await fn();
  } finally {
    const i = running.lastIndexOf(tag);
    if (i >= 0) running.splice(i, 1);
    record(tag, Date.now() - t0);
  }
}

/**
 * Things that happened, counted rather than timed.
 *
 * Half of what went wrong this week was not slow, it was silent: a cover
 * looked for under a name nothing had saved it as, a picture fetched once per
 * song instead of once per album. None of that shows up as time; it shows up
 * as a tally that does not add up, which is what these are for. A count is two
 * numbers and a map lookup, so they can stay on with the rest.
 */
const counts = new Map<string, number>();

export function bump(tag: string, by = 1): void {
  if (!enabled) return;
  counts.set(tag, (counts.get(tag) ?? 0) + by);
}

/**
 * The last few things that went wrong, each with its own line.
 *
 * Kept whatever the switch says, unlike everything else here: they are rare,
 * so keeping them costs nothing, and they are what a bug report needs and what
 * nobody had turned measuring on for before it happened. In memory only.
 */
const MAX_EVENTS = 30;
const events: { at: number; text: string }[] = [];

export function note(text: string): void {
  events.push({ at: Date.now(), text });
  if (events.length > MAX_EVENTS) events.shift();
  // Backgrounded, this may be the last thing ever written down: a kill in
  // the background takes the memory with it, so notes taken out there go to
  // disk at once. They are rare by design, which is what makes each one
  // affordable to save.
  if (!awake) persistEvents();
}

/** Oldest first, as they happened. */
export function perfEvents(): { at: number; text: string }[] {
  return [...events];
}

/** Where the events wait out a death in the background: a plain file, which
 *  writes on a locked phone where SecureStore may not. */
function eventsPath(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}diag-events.json` : null;
}

/** Writes the in-memory events where the next launch finds them. */
export function persistEvents(): void {
  const path = eventsPath();
  if (!path) return;
  try {
    void FileSystem.writeAsStringAsync(path, JSON.stringify(events)).catch(() => {});
  } catch {
    // A hint that fails to save changes nothing about what it hints at.
  }
}

/** Events a previous session left behind, read once at startup. */
let past: { at: number; text: string }[] = [];
export function pastEvents(): { at: number; text: string }[] {
  return [...past];
}

/** Loads what the last session saved going away, then clears it: this
 *  session's report carries it once, and a later one has nothing stale. */
export async function loadPastEvents(): Promise<void> {
  const path = eventsPath();
  if (!path) return;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(path);
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      past = parsed
        .filter(
          (e): e is { at: number; text: string } =>
            !!e && typeof e === 'object' && typeof (e as { at: unknown }).at === 'number' &&
            typeof (e as { text: unknown }).text === 'string',
        )
        .slice(-MAX_EVENTS);
    }
  } catch {
    // Unreadable or half-written: starting with no past is the same thing a
    // first run does.
  }
}

export function clearPerfEvents(): void {
  events.length = 0;
}

// ── What went out over the network ──────────────────────────────────────────
// `ops` already times every request, but it ranks by total time and keeps the
// top twenty, which is the wrong end of the telescope for a phone whose
// battery went flat: a request that storms is fast, and a hundred thousand of
// them sit below one slow search. So the same traffic is tallied again by how
// often, with the size of the answers next to it, and nothing is cut.
//
// Not everything the app sends is here, and the report says so rather than
// implying a total: the stream is opened by the native player and never
// reaches this file, and neither do the artwork files, which is why those are
// counted apart (`cover saved` and the rest).

export interface NetStat {
  tag: string;
  calls: number;
  /** As the server declared it. Zero where it declared nothing. */
  bytes: number;
}

const net = new Map<string, NetStat>();

/** One request that reached the server and came back. */
export function netTally(tag: string, bytes = 0): void {
  if (!enabled) return;
  const cur = net.get(tag);
  if (cur) {
    cur.calls++;
    cur.bytes += bytes;
    return;
  }
  net.set(tag, { tag, calls: 1, bytes });
}

/** Most often first, which is the question being asked of it. */
export function perfNet(): NetStat[] {
  return [...net.values()].sort((a, b) => b.calls - a.calls);
}

// ── Frames ──────────────────────────────────────────────────────────────────
// Stutter is frames arriving late, far below a block. JS frames are counted
// here, UI ones in `FrameMeter`, per screen. Idle frames count, so read the
// late ones.

export const LATE_MS = 25;
export const VERY_LATE_MS = 50;
/** Longer than this is the app having been away. */
export const AWAY_GAP_MS = 1000;

export interface FrameCount {
  frames: number;
  late: number;
  veryLate: number;
  worstMs: number;
}

interface ScreenFrames {
  screen: string;
  js: FrameCount;
  ui: FrameCount;
}

const emptyCount = (): FrameCount => ({ frames: 0, late: 0, veryLate: 0, worstMs: 0 });
const frames = new Map<string, ScreenFrames>();
let screen = '—';

function screenFrames(): ScreenFrames {
  let cur = frames.get(screen);
  if (!cur) {
    cur = { screen, js: emptyCount(), ui: emptyCount() };
    frames.set(screen, cur);
  }
  return cur;
}

/** As the route pattern, `album/[id]`. */
export function setPerfScreen(name: string): void {
  screen = name || '—';
}

export function addUiFrames(delta: FrameCount): void {
  if (!enabled || delta.frames === 0) return;
  const c = screenFrames().ui;
  c.frames += delta.frames;
  c.late += delta.late;
  c.veryLate += delta.veryLate;
  if (delta.worstMs > c.worstMs) c.worstMs = delta.worstMs;
}

let rafId: number | null = null;
let lastFrame = 0;

function onJsFrame(t: number): void {
  rafId = requestAnimationFrame(onJsFrame);
  const dt = lastFrame ? t - lastFrame : 0;
  lastFrame = t;
  if (dt <= 0 || dt > AWAY_GAP_MS || !awake) return;
  const c = screenFrames().js;
  c.frames++;
  if (dt > LATE_MS) c.late++;
  if (dt > VERY_LATE_MS) c.veryLate++;
  if (dt > c.worstMs) c.worstMs = Math.round(dt);
}

function startJsFrames(): void {
  if (rafId !== null) return;
  lastFrame = 0;
  rafId = requestAnimationFrame(onJsFrame);
}

function stopJsFrames(): void {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

export function perfFrames(): ScreenFrames[] {
  return [...frames.values()].sort((a, b) => b.js.late + b.ui.late - (a.js.late + a.ui.late));
}

/** Minutes, hours and seconds, short enough to sit in a line of key: value. */
export function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── The player's own beat ───────────────────────────────────────────────────
// Everything above this line measures the app while somebody is looking at it,
// and stops measuring the moment they stop: Android takes the JS timer away in
// the background, so a heartbeat driven by one has nothing to say about the
// twenty minutes an album takes to play with the screen off. Which is exactly
// where the reports are (a notification stuck mid-song, a cover from the track
// before, ten seconds of a frozen screen on returning).
//
// The native player keeps beating out there — it is a coroutine on Android's
// main thread, not a JS timer — and every beat it sends reaches `onStatus`,
// which is what feeds the position, the notification and the queue's advance.
// So the beat itself is the instrument: if it arrives while the app is away,
// whatever went stale did so on the way to the screen; if it does not, nothing
// downstream of it could have been right either. `beat()` says nothing about
// how the app looks, and that is the point — it is the one clock that tells
// those two apart.

/** Under this a late beat is ordinary jitter around the 500 ms it asks for. */
const BEAT_GAP_MS = 2000;

/** When the last beat arrived, whatever state the app was in. */
let lastBeat = 0;
/** Beats are only judged once one has been seen; the first has no gap. */
let beatSeen = false;
/**
 * Was the player playing when it last beat?
 *
 * A player that is paused has nothing to say and stops saying it, so the
 * silence that follows a pause in the background is the player behaving. Left
 * unasked, every session where somebody paused before putting the phone away
 * came back reporting a silence the length of the walk home, and a measurement
 * that cries wolf is worse than no measurement — it is what the foreground
 * heartbeat above already had to learn.
 */
let beatPlaying = false;
/**
 * Kept apart from `ops`, which ranks by total time and answers "what is the app
 * spending its life on". A silence of twenty minutes is not time spent on
 * anything and would sit on top of that list saying nothing true.
 */
const away = new Map<string, OpStat>();

function recordAway(tag: string, ms: number): void {
  const cur = away.get(tag);
  if (cur) {
    cur.count++;
    cur.totalMs += ms;
    if (ms > cur.maxMs) cur.maxMs = ms;
    return;
  }
  away.set(tag, { tag, count: 1, totalMs: ms, maxMs: ms });
}

/**
 * A beat from the native player. Called from the status listener, which is the
 * only thing that keeps running while the app is away. `playing` is what that
 * status says, and it decides whether the next silence is worth anything.
 */
export function beat(playing: boolean): void {
  if (!enabled) return;
  const now = Date.now();
  const prev = lastBeat;
  const wasPlaying = beatPlaying;
  lastBeat = now;
  beatPlaying = playing;
  if (!beatSeen) {
    beatSeen = true;
    return;
  }
  if (awake || !wasPlaying) return;
  bump('away · beats');
  // Asked for every half second. Anything past a couple of them is the player
  // going quiet, not jitter, and the size of the silence is the whole answer.
  const gap = now - prev;
  if (gap >= BEAT_GAP_MS) recordAway('silence between beats', gap);
}

/**
 * Back to the foreground. How old the last beat is right now is the number the
 * whole section exists for: measured before anything else runs, it says how
 * stale what the screen is about to draw already was.
 */
function onReturn(): void {
  if (!enabled || !beatSeen || !beatPlaying) return;
  recordAway('on return, last beat was this old', Date.now() - lastBeat);
}

/** Worst first: one long silence is the finding, not the average. */
export function perfAway(): OpStat[] {
  return [...away.values()].sort((a, b) => b.maxMs - a.maxMs);
}

/** Biggest first, which is where the surprises are. */
export function perfCounts(): { tag: string; n: number }[] {
  return [...counts.entries()]
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n);
}

/** Worst blocks first. */
export function perfBlocks(): Block[] {
  return [...blocks].sort((a, b) => b.ms - a.ms);
}

/** Operations by total time spent, which is what adds up to a slow app. */
export function perfOps(): OpStat[] {
  return [...ops.values()].sort((a, b) => b.totalMs - a.totalMs);
}

export function perfSince(): number {
  return startedAt;
}

export function resetPerfLog(): void {
  blocks.length = 0;
  ops.clear();
  counts.clear();
  net.clear();
  frames.clear();
  startedAt = Date.now();
  lastTick = Date.now();
  stateSince = Date.now();
  foregroundMs = 0;
  backgroundMs = 0;
  trips = 0;
  bgTicks = 0;
  away.clear();
  // The next beat is the first one again: the gap across a reset belongs to
  // neither session.
  beatSeen = false;
}

/** The whole thing as text, to paste into an issue. */
export function perfReport(): string {
  const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  const t = perfTime();
  const lines: string[] = [
    `Resonus diagnostics, ${mins} min of use`,
    `  on screen ${formatMs(t.foregroundMs)} · away ${formatMs(t.backgroundMs)} · ` +
      `${t.trips} trips · JS ran ${formatMs(t.jsAwayMs)} of the time away`,
    '',
  ];
  const ns = perfNet();
  if (ns.length > 0) {
    const calls = ns.reduce((n, x) => n + x.calls, 0);
    const kb = Math.round(ns.reduce((n, x) => n + x.bytes, 0) / 1024);
    lines.push(`Requests (${calls} in total, ${kb} KB declared; the stream is not here):`);
    for (const n of ns) lines.push(`  ${n.tag}: ${n.calls}× · ${Math.round(n.bytes / 1024)} KB`);
    lines.push('');
  }
  lines.push('JS thread blocks (worst first):');
  const bs = perfBlocks();
  if (bs.length === 0) lines.push('  none over 120 ms');
  for (const b of bs) lines.push(`  ${b.ms} ms · during ${b.during}`);
  const fs = perfFrames();
  if (fs.length > 0) {
    lines.push('', `Frames by screen (late over ${LATE_MS} ms / over ${VERY_LATE_MS} ms, worst):`);
    const fmt = (c: FrameCount) => `${c.frames} · ${c.late} / ${c.veryLate} late · ${c.worstMs} ms`;
    for (const f of fs) lines.push(`  ${f.screen}: UI ${fmt(f.ui)} | JS ${fmt(f.js)}`);
  }
  const aw = perfAway();
  if (aw.length > 0) {
    lines.push('', 'While the app was away (the player is the only clock there):');
    for (const a of aw) {
      lines.push(`  ${a.tag}: ${a.count}× · ${a.maxMs} ms worst`);
    }
  }
  const cs = perfCounts();
  if (cs.length > 0) {
    lines.push('', 'Counted:');
    for (const c of cs) lines.push(`  ${c.tag}: ${c.n}`);
  }
  lines.push('', 'Operations by total time:');
  const os = perfOps();
  if (os.length === 0) lines.push('  none measured');
  for (const o of os.slice(0, 20)) {
    lines.push(`  ${o.tag}: ${o.count}× · ${o.totalMs} ms total · ${o.maxMs} ms worst`);
  }
  return lines.join('\n');
}
