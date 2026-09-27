/**
 * Reading a podcast feed: RSS 2.0 and Atom, the two shapes every publisher
 * actually sends, and the ways dates and durations are written in them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDuration, parseFeed, parseFeedDate, sortEpisodes } from '@/lib/podcastFeed';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>The Show</title>
    <link>https://example.org/show</link>
    <description><![CDATA[<p>A show about <b>things</b>.</p>]]></description>
    <itunes:author>Ada Lovelace</itunes:author>
    <itunes:image href="https://example.org/art.jpg"/>
    <item>
      <title>Episode Two</title>
      <description><![CDATA[<p>Second &amp; last</p>]]></description>
      <guid isPermaLink="false">ep-2</guid>
      <pubDate>Tue, 27 Aug 2024 10:00:00 GMT</pubDate>
      <itunes:duration>1:02:03</itunes:duration>
      <enclosure url="https://example.org/2.mp3" type="audio/mpeg" length="12345"/>
    </item>
    <item>
      <title>Episode One</title>
      <guid>ep-1</guid>
      <pubDate>Mon, 05 Feb 2024 08:30:00 +0200</pubDate>
      <enclosure url="https://example.org/1.mp3" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Cast</title>
  <subtitle>Entries, not items</subtitle>
  <logo>https://example.org/logo.png</logo>
  <link rel="self" href="https://example.org/feed.xml"/>
  <link rel="alternate" href="https://example.org/"/>
  <author><name>Grace Hopper</name></author>
  <entry>
    <title>Only Entry</title>
    <id>urn:uuid:abc</id>
    <updated>2024-08-27T10:00:00Z</updated>
    <summary type="html">&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;</summary>
    <link rel="enclosure" href="https://example.org/a.m4a" type="audio/mp4" length="99"/>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('reads a channel from RSS without taking an item for its own', () => {
    const feed = parseFeed(RSS, 'c1');
    assert.equal(feed.title, 'The Show');
    assert.equal(feed.author, 'Ada Lovelace');
    assert.equal(feed.imageUrl, 'https://example.org/art.jpg');
    assert.equal(feed.siteUrl, 'https://example.org/show');
    assert.equal(feed.items.length, 2);
  });

  it('resolves a CDATA description to the text it stands for', () => {
    const feed = parseFeed(RSS, 'c1');
    assert.equal(feed.description, 'A show about things.');
    assert.equal(feed.items[0].description, 'Second & last');
  });

  it('reads an enclosure, its type and its length', () => {
    const [two, one] = parseFeed(RSS, 'c1').items;
    assert.equal(two.url, 'https://example.org/2.mp3');
    assert.equal(two.mimeType, 'audio/mpeg');
    assert.equal(two.size, 12345);
    assert.equal(one.size, undefined);
  });

  it('namespaces ids by channel, so two feeds cannot collide on a guid', () => {
    const a = parseFeed(RSS, 'c1').items;
    const b = parseFeed(RSS, 'c2').items;
    assert.equal(a[0].id, 'c1/ep-2');
    assert.equal(b[0].id, 'c2/ep-2');
  });

  it('falls back to the enclosure, then to title and date, for a guidless item', () => {
    const feed = parseFeed(
      `<rss><channel><title>T</title>
       <item><title>No guid</title><enclosure url="https://e/x.mp3"/></item>
       <item><title>Bare</title><pubDate>Mon, 05 Feb 2024 08:30:00 GMT</pubDate></item>
       </channel></rss>`,
      'c',
    );
    assert.equal(feed.items[0].id, 'c/https://e/x.mp3');
    assert.equal(feed.items[1].id, 'c/Bare|1707121800000');
  });

  it('reads Atom, where the enclosure is a link and the art is a logo', () => {
    const feed = parseFeed(ATOM, 'c1');
    assert.equal(feed.title, 'Atom Cast');
    assert.equal(feed.description, 'Entries, not items');
    assert.equal(feed.author, 'Grace Hopper');
    assert.equal(feed.imageUrl, 'https://example.org/logo.png');
    assert.equal(feed.siteUrl, 'https://example.org/');
    const [entry] = feed.items;
    assert.equal(entry.id, 'c1/urn:uuid:abc');
    assert.equal(entry.url, 'https://example.org/a.m4a');
    assert.equal(entry.mimeType, 'audio/mp4');
    assert.equal(entry.size, 99);
    assert.equal(entry.description, 'Hi & bye');
  });

  it('leaves a missing title empty rather than inventing one', () => {
    const feed = parseFeed('<rss><channel><item><guid>g</guid></item></channel></rss>', 'c');
    assert.equal(feed.items[0].title, '');
  });

  it('keeps block-level tags from running paragraphs together', () => {
    const feed = parseFeed(
      '<rss><channel><item><description><![CDATA[<p>One</p><p>Two</p>]]></description></item></channel></rss>',
      'c',
    );
    assert.equal(feed.items[0].description, 'One Two');
  });
});

describe('parseFeedDate', () => {
  const utc = (s: string) => new Date(s).getTime();

  it('reads ISO 8601 and RFC 822', () => {
    assert.equal(parseFeedDate('2024-08-27T10:00:00Z'), utc('2024-08-27T10:00:00Z'));
    assert.equal(parseFeedDate('Tue, 27 Aug 2024 10:00:00 GMT'), utc('2024-08-27T10:00:00Z'));
  });

  it('honours a numeric offset', () => {
    assert.equal(
      parseFeedDate('Mon, 05 Feb 2024 08:30:00 +0200'),
      utc('2024-02-05T06:30:00Z'),
    );
  });

  it('honours a zone spelled out', () => {
    assert.equal(parseFeedDate('Mon, 05 Feb 2024 08:30:00 EST'), utc('2024-02-05T13:30:00Z'));
    assert.equal(parseFeedDate('Mon, 05 Feb 2024 08:30:00 UT'), utc('2024-02-05T08:30:00Z'));
  });

  it('reads a day without its leading zero, and an hour without seconds', () => {
    assert.equal(parseFeedDate('5 Feb 2024 08:30 GMT'), utc('2024-02-05T08:30:00Z'));
  });

  it('reads a two-digit year as the POSIX shorthand it is', () => {
    assert.equal(parseFeedDate('05 Feb 24 08:30:00 GMT'), utc('2024-02-05T08:30:00Z'));
    assert.equal(parseFeedDate('05 Feb 99 08:30:00 GMT'), utc('1999-02-05T08:30:00Z'));
  });

  it('gives up rather than guessing', () => {
    assert.equal(parseFeedDate('whenever'), undefined);
    assert.equal(parseFeedDate('05 Smarch 2024 08:30:00 GMT'), undefined);
    assert.equal(parseFeedDate(undefined), undefined);
  });
});

describe('parseDuration', () => {
  it('reads the three ways it is written', () => {
    assert.equal(parseDuration('1:02:03'), 3723);
    assert.equal(parseDuration('05:00'), 300);
    assert.equal(parseDuration('3600'), 3600);
  });

  it('tells an hour from minutes by the leading zero', () => {
    assert.equal(parseDuration('0:05:00'), 300);
    assert.equal(parseDuration('1:05:00'), 3900);
  });

  it('gives up on what is not a duration', () => {
    assert.equal(parseDuration('about an hour'), undefined);
    assert.equal(parseDuration('0'), undefined);
    assert.equal(parseDuration(undefined), undefined);
  });
});

describe('sortEpisodes', () => {
  it('puts the newest first and the undated last, keeping listed order among them', () => {
    const feed = parseFeed(
      `<rss><channel>
       <item><title>old</title><pubDate>Mon, 05 Feb 2024 08:30:00 GMT</pubDate></item>
       <item><title>undated a</title></item>
       <item><title>new</title><pubDate>Tue, 27 Aug 2024 10:00:00 GMT</pubDate></item>
       <item><title>undated b</title></item>
       </channel></rss>`,
      'c',
    );
    assert.deepEqual(
      sortEpisodes(feed.items).map((i) => i.title),
      ['new', 'old', 'undated a', 'undated b'],
    );
  });
});
