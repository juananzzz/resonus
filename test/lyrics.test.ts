/**
 * Word-timed lyrics (#165): the TTML reader, enhanced LRC both ways, and the
 * OpenSubsonic cues. What goes wrong here goes wrong quietly, as a line that
 * lights up whole or a word that lights up under the wrong syllable.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLrc, serializeLrc } from '@/lib/lrc';
import { activeIndex } from '@/lib/lyricSweep';
import { indexOfByte, structuredSongLyrics, wordEnds, wordGroups, wordsFromCues } from '@/lib/lyricWords';
import { parseTtml, ttmlTime } from '@/lib/ttml';

/** The start of the file attached to #165, and one line from its end. */
const USSEEWA =
  '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" ' +
  'xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="ja"><head><metadata>' +
  '<ttm:agent type="person" xml:id="v1"/><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal" ' +
  'leadingSilence="0.300"><translations/><songwriters><songwriter>syudou</songwriter></songwriters>' +
  '<audio lyricOffset="-0.137" role="spatial"/></iTunesMetadata></metadata></head><body dur="3:24.920">' +
  '<div begin="0.972" end="7.446" itunes:songPart="Verse">' +
  '<p begin="0.972" end="3.351" itunes:key="L1" ttm:agent="v1"><span begin="0.972" end="1.930">正しさとは</span> ' +
  '<span begin="2.389" end="2.913">愚かさ</span><span begin="2.913" end="3.351">とは</span></p>' +
  '<p begin="2:57.507" end="3:00.958" itunes:key="L51" ttm:agent="v1"><span begin="2:57.507" end="2:58.224">何回</span>' +
  '<span begin="2:58.224" end="2:59.629">聞かせるんだ</span></p></div></body></tt>';

const pairs = (words?: { start: number; value: string }[]) => words?.map((w) => [w.start, w.value]);

describe('TTML', () => {
  it('reads the file from #165 word by word, the space between spans included', () => {
    const lyrics = parseTtml(USSEEWA);
    assert.ok(lyrics?.synced);
    assert.equal(lyrics.lines.length, 2);
    const [first, second] = lyrics.lines;
    assert.equal(first.start, 972);
    assert.equal(first.value, '正しさとは 愚かさとは');
    assert.deepEqual(pairs(first.words), [
      [972, '正しさとは '],
      [2389, '愚かさ'],
      [2913, 'とは'],
    ]);
    assert.equal(first.words?.[0].end, 1930);
    assert.equal(second.start, 177507);
    assert.equal(second.value, '何回聞かせるんだ');
  });

  it('keeps what is in the head out of the lyrics', () => {
    const text = parseTtml(USSEEWA)!.lines.map((l) => l.value).join('\n');
    assert.ok(!text.includes('syudou'));
  });

  it('leaves out backing vocals and anything else with a role', () => {
    const lyrics = parseTtml(
      '<tt><body><div><p begin="1s" end="3s"><span begin="1s">Hey</span> ' +
        '<span ttm:role="x-bg"><span begin="2s">(hey)</span></span></p></div></body></tt>',
    );
    const [line] = lyrics!.lines;
    assert.equal(line.value, 'Hey');
    assert.deepEqual(pairs(line.words), [[1000, 'Hey']]);
  });

  it('keeps backing vocals apart, under the lead line, timed', () => {
    const lyrics = parseTtml(
      '<tt><body><div><p begin="1s" end="5s"><span begin="1s" end="2s">Hey</span> ' +
        '<span role="x-bg"><span begin="2s" end="2.5s">ooh</span> ' +
        '<span begin="2.5s" end="3s">ooh</span></span></p></div></body></tt>',
    );
    const [line] = lyrics!.lines;
    assert.equal(line.value, 'Hey');
    assert.equal(line.backing?.length, 1);
    assert.equal(line.backing?.[0].value, 'ooh ooh');
    assert.equal(line.backing?.[0].start, 2000);
    assert.equal(line.backing?.[0].end, 3000);
    assert.deepEqual(pairs(line.backing?.[0].words), [
      [2000, 'ooh '],
      [2500, 'ooh'],
    ]);
  });

  it('drops a backing vocal nobody timed', () => {
    const lyrics = parseTtml(
      '<tt><body><div><p begin="1s"><span begin="1s">Hey</span> ' +
        '<span role="x-bg">ooh</span></p></div></body></tt>',
    );
    const [line] = lyrics!.lines;
    assert.equal(line.value, 'Hey');
    assert.equal(line.backing, undefined);
  });

  it('marks the first line of each later song part a new stanza', () => {
    const lyrics = parseTtml(
      '<tt><body><div><p begin="1s">One</p><p begin="2s">Two</p></div>' +
        '<div><p begin="10s">Three</p></div></body></tt>',
    );
    assert.deepEqual(
      lyrics!.lines.map((l) => [l.value, l.newStanza]),
      [
        ['One', undefined],
        ['Two', undefined],
        ['Three', true],
      ],
    );
  });

  it('reads a file timed by the line, without words', () => {
    const lyrics = parseTtml(
      '<tt><body><p begin="00:00:01.500" end="00:00:03.000">One &amp; two</p>' +
        '<p begin="00:00:04.000">Three&#x21;</p></body></tt>',
    );
    assert.ok(lyrics?.synced);
    assert.deepEqual(
      lyrics.lines.map((l) => [l.start, l.value, l.words]),
      [
        [1500, 'One & two', undefined],
        [4000, 'Three!', undefined],
      ],
    );
  });

  it('reads an untimed file as plain lyrics', () => {
    const lyrics = parseTtml('<tt><body><p>One</p><p>Two<br/>and a half</p></body></tt>');
    assert.equal(lyrics?.synced, false);
    assert.deepEqual(
      lyrics.lines.map((l) => l.value),
      ['One', 'Two and a half'],
    );
  });

  it('reads an indented file with prefixed tags', () => {
    const lyrics = parseTtml(
      '<tt:tt>\n  <tt:body>\n    <tt:p begin="1.0s">\n      <tt:span begin="1.0s">Hel</tt:span>' +
        '<tt:span begin="1.4s">lo</tt:span>\n    </tt:p>\n  </tt:body>\n</tt:tt>',
    );
    const [line] = lyrics!.lines;
    assert.equal(line.value, 'Hello');
    assert.deepEqual(pairs(line.words), [
      [1000, 'Hel'],
      [1400, 'lo'],
    ]);
  });

  it('reads every way of writing a time', () => {
    assert.equal(ttmlTime('0.972'), 972);
    assert.equal(ttmlTime('2:57.507'), 177507);
    assert.equal(ttmlTime('01:02:03.5'), 3723500);
    assert.equal(ttmlTime('1.5s'), 1500);
    assert.equal(ttmlTime('1500ms'), 1500);
    assert.equal(ttmlTime('00:00:01:12'), undefined);
  });

  it('is not fooled by a file that is not TTML', () => {
    assert.equal(parseTtml('[00:01.00]Just an LRC'), null);
  });
});

describe('Enhanced LRC', () => {
  const LINE = '[00:01.00]<00:01.00>Hello <00:01.50>world<00:02.25>';

  it('reads the word timestamps', () => {
    const [line] = parseLrc(LINE)!.lines;
    assert.equal(line.value, 'Hello world');
    assert.deepEqual(pairs(line.words), [
      [1000, 'Hello '],
      [1500, 'world'],
    ]);
    assert.equal(line.words?.[1].end, 2250);
  });

  it('writes them back as it read them', () => {
    assert.equal(serializeLrc(parseLrc(LINE)!), LINE);
  });

  it('moves the words with the offset, like the lines', () => {
    const [line] = parseLrc('[offset:500]\n[00:02.00]<00:02.00>a <00:03.00>b')!.lines;
    assert.equal(line.start, 1500);
    assert.deepEqual(pairs(line.words), [
      [1500, 'a '],
      [2500, 'b'],
    ]);
  });

  it('keeps a chorus stamped twice, without words', () => {
    const lyrics = parseLrc('[00:01.00][00:10.00]<00:01.00>La <00:01.50>la')!;
    assert.deepEqual(
      lyrics.lines.map((l) => [l.start, l.value, l.words]),
      [
        [1000, 'La la', undefined],
        [10000, 'La la', undefined],
      ],
    );
  });

  it('leaves plain LRC as it was', () => {
    const text = '[00:01.00]Hello world\n[00:02.50]Again';
    assert.equal(serializeLrc(parseLrc(text)!), text);
  });

  it('parts stanzas at blank lines, in time and in plain text', () => {
    const timed = parseLrc('[00:01.00]One\n\n[00:05.00]Two')!;
    assert.equal(timed.lines[0].newStanza, undefined);
    assert.equal(timed.lines[1].newStanza, true);
    assert.equal(parseLrc('One\n\nTwo')!.lines.map((l) => l.value).join('\n'), 'One\n\nTwo');
  });
});

describe('OpenSubsonic cues', () => {
  const LINE = '눈을 뜬 순간';

  it('cuts by byte offset, three bytes to a Korean syllable', () => {
    const words = wordsFromCues(LINE, [
      { start: 2747, end: 3018, value: '눈', byteStart: 0 },
      { start: 3018, end: 3179, value: '을', byteStart: 3 },
      { start: 3179, end: 3400, value: '뜬', byteStart: 7 },
      { start: 3400, end: 4000, value: '순간', byteStart: 11 },
    ]);
    assert.deepEqual(pairs(words), [
      [2747, '눈'],
      [3018, '을 '],
      [3179, '뜬 '],
      [3400, '순간'],
    ]);
  });

  it('falls back to the words themselves when the bytes are wrong', () => {
    // Counted in characters instead of bytes.
    const words = wordsFromCues(LINE, [
      { start: 1, value: '눈', byteStart: 0 },
      { start: 2, value: '을', byteStart: 1 },
      { start: 3, value: '뜬', byteStart: 3 },
      { start: 4, value: '순간', byteStart: 5 },
    ]);
    assert.deepEqual(
      words?.map((w) => w.value),
      ['눈', '을 ', '뜬 ', '순간'],
    );
  });

  it('applies the offset', () => {
    const words = wordsFromCues('a b', [
      { start: 1000, end: 1400, value: 'a', byteStart: 0 },
      { start: 1500, end: 1900, value: 'b', byteStart: 2 },
    ], 200);
    assert.deepEqual(
      words?.map((w) => [w.start, w.end]),
      [
        [800, 1200],
        [1300, 1700],
      ],
    );
  });

  it('counts a character outside the basic plane as four bytes and two units', () => {
    assert.equal(indexOfByte('a😀b', 5), 3);
    assert.equal(indexOfByte('a😀b', 2), -1);
  });
});

describe('Word ends', () => {
  it('takes the end the source sent', () => {
    assert.deepEqual(
      wordEnds([
        { start: 100, end: 500, value: 'hold ' },
        { start: 600, end: 800, value: 'on' },
      ]),
      [500, 800],
    );
  });

  it('never runs past the next word, whatever the source said', () => {
    assert.deepEqual(
      wordEnds([
        { start: 100, end: 900, value: 'a ' },
        { start: 300, value: 'b' },
      ]),
      [300, 300 + 2500],
    );
  });

  it('falls back to the next word when only the starts were timed', () => {
    assert.deepEqual(
      wordEnds(
        [
          { start: 0, value: 'one ' },
          { start: 250, value: 'two ' },
          { start: 900, value: 'three' },
        ],
        1400,
      ),
      [250, 900, 1400],
    );
  });

  it('holds the last word until the next line, but not through a silence', () => {
    // A real end is believed, however long the note.
    assert.deepEqual(wordEnds([{ start: 1000, end: 4000, value: 'stay' }], 9000), [4000]);
    // A gap nobody timed is not a note held that long.
    assert.deepEqual(wordEnds([{ start: 1000, value: 'stay' }], 9000), [3500]);
  });

  it('stops the last word at the handover, however long the source holds it', () => {
    // The row is gone by then: still filling would jump to full colour on
    // the way out, and the shine would vanish instead of dimming.
    assert.deepEqual(wordEnds([{ start: 1000, end: 5000, value: 'stay' }], 3000), [3000]);
    assert.deepEqual(wordEnds([{ start: 1000, value: 'stay' }], 1500), [1500]);
  });

  it('guesses when nothing follows the word at all', () => {
    assert.deepEqual(wordEnds([{ start: 1200, value: 'oh' }]), [1200 + 2500]);
  });

  it('never ends before it starts', () => {
    assert.deepEqual(wordEnds([{ start: 500, end: 100, value: 'odd' }]), [500]);
  });
});

describe('Server structured lyrics', () => {
  it('puts synced lines in the order they are sung', () => {
    // A chorus stored once with two timestamps comes back after the verses.
    const lyrics = structuredSongLyrics({
      synced: true,
      line: [
        { start: 1000, value: 'Verse one' },
        { start: 9000, value: 'Verse two' },
        { start: 5000, value: 'Chorus' },
        { start: 13000, value: 'Chorus' },
      ],
    });
    assert.deepEqual(
      lyrics?.lines.map((l) => l.start),
      [1000, 5000, 9000, 13000],
    );
    assert.equal(activeIndex(lyrics!.lines, 10_000), 2);
  });

  it('reads the lead voice like before, with no backing', () => {
    const lyrics = structuredSongLyrics({
      synced: true,
      line: [{ start: 1000, value: 'Hey' }],
      cueLine: [{ index: 0, value: 'Hey', cue: [{ start: 1000, end: 2000, value: 'Hey', byteStart: 0 }] }],
    });
    assert.ok(lyrics?.synced);
    assert.equal(lyrics.lines.length, 1);
    assert.equal(lyrics.lines[0].value, 'Hey');
    assert.equal(lyrics.lines[0].backing, undefined);
  });

  it('keeps further cue lines of an index as backing vocals', () => {
    const lyrics = structuredSongLyrics({
      synced: true,
      line: [{ start: 1000, value: 'Hey (ooh ooh)' }],
      cueLine: [
        { index: 0, value: 'Hey ', cue: [{ start: 1000, end: 2000, value: 'Hey ', byteStart: 0 }] },
        {
          index: 0,
          value: '(ooh ooh)',
          cue: [{ start: 2000, end: 3000, value: '(ooh ooh)', byteStart: 0 }],
        },
      ],
    });
    const [line] = lyrics!.lines;
    assert.equal(line.value, 'Hey ');
    assert.equal(line.backing?.length, 1);
    assert.equal(line.backing?.[0].value, '(ooh ooh)');
    assert.equal(line.backing?.[0].start, 2000);
    assert.equal(line.backing?.[0].end, 3000);
  });

  it('still times a backing vocal whose words cannot be trusted', () => {
    const lyrics = structuredSongLyrics({
      synced: true,
      line: [{ start: 1000, value: 'Hey' }],
      cueLine: [
        { index: 0, value: 'Hey', cue: [{ start: 1000, value: 'Hey', byteStart: 0 }] },
        { index: 0, value: 'ooh', cue: [{ start: 2000, end: 2500 }] },
      ],
    });
    assert.equal(lyrics!.lines[0].backing?.[0].start, 2000);
    assert.equal(lyrics!.lines[0].backing?.[0].end, 2500);
  });
});

describe('parseLrc blank lines in plain text', () => {
  it('keeps one gap per stanza break, none at either end', () => {
    const lyrics = parseLrc('\n\nFirst\n\n\n\nSecond\nThird\n\n')!;
    assert.deepEqual(
      lyrics.lines.map((l) => l.value),
      ['First', '', 'Second', 'Third'],
    );
  });

  it('is no lyrics when there are only blank lines', () => {
    assert.equal(parseLrc('\n\n  \n'), null);
  });
});

describe('wordGroups (#312)', () => {
  const words = (values: string[]) => values.map((value, i) => ({ start: i * 100, value }));

  it('keeps the syllables of one word together', () => {
    const line = parseLrc("[00:01.00]<00:01.00>L'A<00:01.30>MOUR <00:01.80>DE <00:02.40>VI<00:02.70>E")!;
    const timed = line.lines.find((l) => l.words)!.words!;
    assert.deepEqual(wordGroups(timed), [[0, 1], [2], [3, 4]]);
  });

  it('breaks anywhere in scripts written without spaces', () => {
    assert.deepEqual(wordGroups(words(['君', 'の', '声'])), [[0], [1], [2]]);
  });

  it('breaks where the space sits at the start of the next word', () => {
    assert.deepEqual(wordGroups(words(['one', ' two'])), [[0], [1]]);
  });
});
