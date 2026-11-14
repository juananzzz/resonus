/**
 * What the jukebox hands the server when a track starts (#333).
 *
 * In 0.8.7 the app sent `jukeboxControl` one track at a time and advanced the
 * server from a JS timer. Android freezes those timers with the screen off, so
 * the server finished the current song and waited for ever. The fix is that the
 * current track travels with the songs after it in the queue, so the server can
 * move on by itself.
 *
 * The jukebox store needs the phone (zustand, the auth store, the cast media
 * session), so this suite stubs those modules and records the API calls the
 * store makes. It is the only way to assert what the server is actually told,
 * which is the whole bug.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Song } from '@/api/subsonic';

type Call =
  | ['set', string[]]
  | ['add', string[]]
  | ['remove', number]
  | ['skip', number, number | undefined]
  | ['start']
  | ['stop'];

interface Harness {
  auth: {
    serverUrl: string;
    username: string;
    token: string;
    salt: string;
  } | null;
  calls: Call[];
  status: { currentIndex: number; playing: boolean; gain: number; position: number };
}

const state: Harness = {
  auth: { serverUrl: 'https://music.example.com', username: 'ada', token: 't', salt: 's' },
  calls: [],
  status: { currentIndex: 0, playing: false, gain: 1, position: 0 },
};
Object.assign(globalThis, { __jukeboxTest: state });

const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;
const prelude = 'const s=globalThis.__jukeboxTest;';
const hooks = registerHooks({
  resolve(name, context, next) {
    const modules: Record<string, string> = {
      // `import { type Song }` leaves an empty runtime import behind in Node.
      '@/api/backend': '',
      // `import type { Song } from '@/api/subsonic'` leaves the runtime import in
      // some loaders too, and the store's API calls are what this suite watches.
      // The only zustand this store uses: one value and a setter.
      zustand: `export function create(init){
        let s=init(()=>{},()=>s);
        return { getState:()=>s, setState:(p)=>{ s={...s,...(typeof p==='function'?p(s):p)} } };
      }`,
      '@/api/subsonic': prelude + `
        export const jukeboxSet=async(a,ids)=>{s.calls.push(['set',ids]);return s.status};
        export const jukeboxAdd=async(a,ids)=>{s.calls.push(['add',ids]);return s.status};
        export const jukeboxRemove=async(a,index)=>{s.calls.push(['remove',index]);return s.status};
        export const jukeboxSkip=async(a,index,offset)=>{s.calls.push(['skip',index,offset]);return s.status};
        export const jukeboxStart=async()=>{s.calls.push(['start']);return s.status};
        export const jukeboxStop=async()=>{s.calls.push(['stop']);return s.status};
        export const jukeboxSetGain=async()=>s.status;
        export const jukeboxStatus=async()=>s.status;
        export const hasJukeboxRole=async()=>true;
      `,
      '@/store/auth': prelude + 'export const useAuthStore={getState:()=>({auth:s.auth})};',
      '@/store/castMedia': 'export const castStop=()=>{};',
      './auth': prelude + 'export const useAuthStore={getState:()=>({auth:s.auth})};',
      './castMedia': 'export const castStop=()=>{};',
    };
    return name in modules ? { shortCircuit: true, url: stub(modules[name]) } : next(name, context);
  },
});

const jukebox = await import('@/store/jukebox');
hooks.deregister();

const song = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: id, ...extra });
const ids = () => state.calls.filter((c): c is ['set', string[]] => c[0] === 'set').map((c) => c[1]);

beforeEach(() => {
  Object.assign(state, {
    auth: { serverUrl: 'https://music.example.com', username: 'ada', token: 't', salt: 's' },
    calls: [],
    status: { currentIndex: 0, playing: true, gain: 1, position: 0 },
  });
});

afterEach(async () => {
  await jukebox.jukeboxDisconnect(true);
});

describe('starting a jukebox track hands the server the queue (#333)', () => {
  it('sends the current song and every song after it, in queue order', async () => {
    assert.equal(await jukebox.jukeboxConnect(), true);
    assert.equal(
      await jukebox.jukeboxLoad(song('a'), true, 0, [song('b'), song('c'), song('d')]),
      true,
    );
    assert.deepEqual(ids(), [['a', 'b', 'c', 'd']]);
    assert.equal(state.calls.filter((c) => c[0] === 'start').length, 1);
  });

  it('never sends a track the server cannot play (radio or local file)', async () => {
    assert.equal(await jukebox.jukeboxConnect(), true);
    const radio = song('r', { url: 'https://radio.example.com/stream' });
    const local = song('l', { localUri: 'file:///music/l.mp3' });
    await jukebox.jukeboxLoad(song('a'), true, 0, [song('b'), radio, local, song('c')]);
    // It stops at the first one it cannot play: the server cannot skip it and
    // would sit on a dead entry otherwise.
    assert.deepEqual(ids(), [['a', 'b']]);
  });

  it('loads paused without starting, for a queue put together before jukebox', async () => {
    assert.equal(await jukebox.jukeboxConnect(), true);
    await jukebox.jukeboxLoad(song('a'), false, 0, [song('b')]);
    assert.deepEqual(ids(), [['a', 'b']]);
    assert.equal(state.calls.filter((c) => c[0] === 'start').length, 0);
    assert.equal(state.calls.filter((c) => c[0] === 'stop').length, 1);
  });

  it('hands over a whole playlist, not just the next few songs', async () => {
    // 45 is longer than the 20-song window the first fix used: with the screen
    // off the server ran out there and waited, which is the same bug a few
    // minutes later on a normal playlist.
    const rest = Array.from({ length: 45 }, (_, i) => song(`s${i}`));
    assert.equal(await jukebox.jukeboxConnect(), true);
    await jukebox.jukeboxLoad(song('a'), true, 0, rest);
    assert.equal(ids()[0].length, 46);
    assert.deepEqual(ids()[0].slice(1), rest.map((s) => s.id));
  });
});
