/** Resonus links: what goes in them and what comes back out (#176). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildResonusLink,
  linkHost,
  openRoute,
  parseResonusLink,
  profileOnHost,
} from '@/lib/resonusLink';
import type { SubsonicAuth } from '@/api/subsonic';

const auth = (urls: string[]) => ({ serverUrl: urls[0], urls }) as unknown as SubsonicAuth;

describe('linkHost', () => {
  it('skips LAN addresses for one that works from elsewhere', () => {
    assert.equal(
      linkHost(auth(['http://192.168.1.5:4533', 'https://Music.Example.com/nd'])),
      'music.example.com',
    );
  });

  it('keeps a LAN address when that is all there is', () => {
    assert.equal(linkHost(auth(['http://192.168.1.5:4533'])), '192.168.1.5');
  });
});

describe('parseResonusLink', () => {
  it('reads back what was built', () => {
    const url = buildResonusLink('album', 'a b/c', 'music.example.com');
    assert.deepEqual(parseResonusLink(url), {
      kind: 'album',
      id: 'a b/c',
      server: 'music.example.com',
    });
  });

  it('finds the link inside a pasted message', () => {
    const text = 'Check out X by Y on music.example.com resonus://playlist/42?server=music.example.com';
    assert.deepEqual(parseResonusLink(text), {
      kind: 'playlist',
      id: '42',
      server: 'music.example.com',
    });
  });

  it('reads the path the router is handed', () => {
    assert.deepEqual(parseResonusLink('/artist/7?server=Host.Org'), {
      kind: 'artist',
      id: '7',
      server: 'host.org',
    });
  });

  it('leaves alone what has no server', () => {
    assert.equal(parseResonusLink('resonus://album/1'), null);
    assert.equal(parseResonusLink('/album/1?foo=bar'), null);
    assert.equal(parseResonusLink('https://x.org/album/1?server=x.org'), null);
    assert.equal(parseResonusLink('resonus://song/1?server=x.org'), null);
  });
});

describe('profileOnHost', () => {
  it('matches any of the addresses, by host only', () => {
    const a = auth(['http://10.0.0.2:4533', 'https://music.example.com:8443']);
    assert.equal(profileOnHost(a, 'music.example.com'), true);
    assert.equal(profileOnHost(a, 'example.com'), false);
  });
});

describe('openRoute', () => {
  it('escapes the id', () => {
    assert.equal(
      openRoute({ kind: 'album', id: 'a&b', server: 'x.org' }),
      '/open?kind=album&id=a%26b&server=x.org',
    );
  });
});
