/**
 * What a download asks for, and in what order (#328).
 *
 * A server can refuse to produce the transcoded copy it was asked for — a
 * missing or unwritable transcoding cache, ffmpeg not answering — while the
 * original file is right there. The download then has to ask for the original
 * rather than report the song as one that cannot be downloaded. The original
 * may also be unavailable through `/rest/download` on a server that still
 * streams it, so the stream endpoint serving the same original bytes is the
 * last answer.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { downloadSources } from '@/lib/downloadSources';

const urls = {
  transcode: 'transcode',
  download: 'download',
  stream: 'stream',
};

describe('downloadSources', () => {
  it('asks for the transcode first, then the original through both endpoints', () => {
    assert.deepEqual(downloadSources({ suffix: 'flac' }, { bitRate: 320, format: 'mp3' }, urls), [
      { kind: 'transcode', url: 'transcode', ext: 'mp3', bitRate: 320 },
      { kind: 'download', url: 'download', ext: 'flac' },
      { kind: 'stream', url: 'stream', ext: 'flac' },
    ]);
  });

  it('asks for the original file first when no transcode was requested', () => {
    assert.deepEqual(downloadSources({ suffix: 'opus' }, { bitRate: 0, format: '' }, urls), [
      { kind: 'download', url: 'download', ext: 'opus' },
      { kind: 'stream', url: 'stream', ext: 'opus' },
    ]);
  });

  it('uses the server default transcoder extension when no format was named', () => {
    assert.equal(
      downloadSources({ suffix: 'flac' }, { bitRate: 192, format: '' }, urls)[0].ext,
      'mp3',
    );
  });

  it('never repeats an address', () => {
    const plan = downloadSources({ suffix: 'mp3' }, { bitRate: 0, format: '' }, urls);
    assert.equal(plan.filter((s) => s.kind === 'download').length, 1);
    assert.equal(new Set(plan.map((s) => s.url)).size, plan.length);
  });

  it('falls back to mp3 when the server did not say what the file is', () => {
    assert.deepEqual(downloadSources({}, { bitRate: 0, format: '' }, urls), [
      { kind: 'download', url: 'download', ext: 'mp3' },
      { kind: 'stream', url: 'stream', ext: 'mp3' },
    ]);
  });

  it('runs the fallbacks at the original quality', () => {
    const plan = downloadSources({ suffix: 'alac' }, { bitRate: 320, format: 'aac' }, urls);
    assert.deepEqual(
      plan.map((s) => s.bitRate),
      [320, undefined, undefined],
    );
  });
});
