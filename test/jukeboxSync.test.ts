/**
 * Queue edits while the jukebox plays (#333).
 *
 * The server is given the songs after the current one so it can go on by
 * itself. When the queue changes under it - add to queue, play next, a reorder
 * - only the tail that differs is rewritten: the current song keeps playing.
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Song } from '@/api/subsonic';

type Call =
  | ['set', string[]]
  | ['add', string[]]
  | ['remove', number]
  | ['start']
  | ['stop'];

const state: {
  auth: object | null;
  calls: Call[];
  status: { currentIndex: number; playing: boolean; gain: number; position: number };
} = {
  auth: { serverUrl: 'https://music.example.com', username: 'ada', token: 't', salt: 's' },
  calls: [],
  status: { currentIndex: 0, playing: true, gain: 1, position: 10 },
};
Object.assign(globalThis, { __jukeboxSyncTest: state });

const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;
const prelude = 'const s=globalThis.__jukeboxSyncTest;';
const hooks = registerHooks({
  resolve(name, context, next) {
    const modules: Record<string, string> = {
      // `import { type Song }` leaves an empty runtime import behind in Node,
      // and that pulls the whole API graph in; only the calls below matter here.
      '@/api/backend': '',
      zustand: `export function create(init){
        let s=init(()=>{},()=>s);
        return { getState:()=>s, setState:(p)=>{ s={...s,...(typeof p==='function'?p(s):p)} } };
      }`,
      '@/api/subsonic': prelude + `
        export const jukeboxSet=async(a,ids)=>{s.calls.push(['set',ids]);return s.status};
        export const jukeboxAdd=async(a,ids)=>{s.calls.push(['add',ids]);return s.status};
        export const jukeboxRemove=async(a,index)=>{s.calls.push(['remove',index]);return s.status};
        export const jukeboxSkip=async()=>s.status;
        export const jukeboxStart=async()=>{s.calls.push(['start']);return s.status};
        export const jukeboxStop=async()=>{s.calls.push(['stop']);return s.status};
        export const jukeboxSetGain=async()=>s.status;
        export const jukeboxStatus=async()=>s.status;
        export const hasJukeboxRole=async()=>true;
      `,
      './auth': prelude + 'export const useAuthStore={getState:()=>({auth:s.auth})};',
      './castMedia': 'export const castStop=()=>{};',
    };
    return name in modules ? { shortCircuit: true, url: stub(modules[name]) } : next(name, context);
  },
});

const jukebox = await import('@/store/jukebox');
hooks.deregister();

const song = (id: string): Song => ({ id, title: id });
const tail = () =>
  state.calls.filter((c) => c[0] !== 'set').map((c) => c[0] === 'remove' ? `remove:${c[1]}` : c[0] === 'add' ? `add:${c[1].join(',')}` : c[0]);

beforeEach(async () => {
  Object.assign(state, {
    auth: { serverUrl: 'https://music.example.com', username: 'ada', token: 't', salt: 's' },
    calls: [],
    status: { currentIndex: 0, playing: true, gain: 1, position: 10 },
  });
  await jukebox.jukeboxConnect();
  await jukebox.jukeboxLoad(song('a'), true, 0, [song('b'), song('c')]);
  state.calls = [];
});

afterEach(async () => {
  await jukebox.jukeboxDisconnect(true);
});

describe('a queue edit rewrites what the server plays next', () => {
  it('appends a song added to the queue', async () => {
    await jukebox.jukeboxSyncUpcoming(song('a'), [song('b'), song('c'), song('d')]);
    assert.deepEqual(tail(), ['add:d']);
  });

  it('removes what was taken out and adds what replaced it', async () => {
    await jukebox.jukeboxSyncUpcoming(song('a'), [song('b'), song('d')]);
    assert.deepEqual(tail(), ['remove:2', 'add:d']);
  });

  it('does nothing when the queue after the current song is already there', async () => {
    await jukebox.jukeboxSyncUpcoming(song('a'), [song('b'), song('c')]);
    assert.deepEqual(tail(), []);
  });

  it('leaves the current song alone: only entries after it are touched', async () => {
    await jukebox.jukeboxSyncUpcoming(song('a'), [song('b')]);
    assert.deepEqual(tail(), ['remove:2']);
    assert.deepEqual(state.calls.filter((c) => c[0] === 'set'), []);
  });

  it('stays out of the way when the app is on another song than the server', async () => {
    // The server still has `a` at the top; the app has moved on without a load
    // (the next load sets both). Rewriting now would remove the wrong entries.
    await jukebox.jukeboxSyncUpcoming(song('b'), [song('c')]);
    assert.deepEqual(tail(), []);
  });
});
