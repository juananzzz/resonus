/** Custom HTTP headers per server profile (#160). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatHeaderLines,
  mergeHeaders,
  parseHeaderLines,
  serverHeaders,
} from '@/lib/customHeaders';

describe('parseHeaderLines', () => {
  it('reads one `Name: value` per line', () => {
    const { headers, errors } = parseHeaderLines(
      'X-Api-Key: s3cret\n\n  X-Family: mike  \n',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(headers, { 'X-Api-Key': 's3cret', 'X-Family': 'mike' });
  });

  it('keeps the first colon in a value', () => {
    const { headers, errors } = parseHeaderLines('Authorization: Bearer a:b');
    assert.deepEqual(errors, []);
    assert.equal(headers.Authorization, 'Bearer a:b');
  });

  it('ignores comments and blank lines', () => {
    const { headers, errors } = parseHeaderLines('# reverse proxy secret\n\nX-Key: v\n');
    assert.deepEqual(headers, { 'X-Key': 'v' });
    assert.deepEqual(errors, []);
  });

  it('reports a line without a colon instead of dropping it silently', () => {
    const { headers, errors } = parseHeaderLines('X-Key: v\nnot a header');
    assert.deepEqual(headers, { 'X-Key': 'v' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /line 2/i);
  });

  it('rejects a header name that is not a token', () => {
    const { headers, errors } = parseHeaderLines('Bad Header: v\nX-Key: v');
    assert.deepEqual(headers, { 'X-Key': 'v' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /name/i);
  });

  it('rejects an empty value', () => {
    const { headers, errors } = parseHeaderLines('X-Key:   ');
    assert.deepEqual(headers, {});
    assert.equal(errors.length, 1);
  });

  it('rejects the same header twice, whatever its case', () => {
    const { headers, errors } = parseHeaderLines('X-Key: one\nx-key: two');
    assert.deepEqual(headers, { 'X-Key': 'one' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /more than once/i);
  });
});

describe('formatHeaderLines', () => {
  it('round-trips through the parser', () => {
    const headers = { 'X-Api-Key': 's3cret', 'X-Family': 'mike' };
    assert.deepEqual(parseHeaderLines(formatHeaderLines(headers)).headers, headers);
  });

  it('says nothing for no headers', () => {
    assert.equal(formatHeaderLines(undefined), '');
    assert.equal(formatHeaderLines({}), '');
  });
});

describe('mergeHeaders', () => {
  it('adds custom headers next to the app’s own', () => {
    assert.deepEqual(
      mergeHeaders({ 'Content-Type': 'application/json' }, { 'X-Secret': 'v' }),
      { 'X-Secret': 'v', 'Content-Type': 'application/json' },
    );
  });

  it('lets the app’s own header win, whatever its case', () => {
    assert.deepEqual(
      mergeHeaders({ Authorization: 'Bearer app' }, { authorization: 'Bearer custom' }),
      { Authorization: 'Bearer app' },
    );
  });

  it('does not send an undefined built-in header', () => {
    assert.deepEqual(mergeHeaders({ 'X-Blank': undefined }, { 'X-Key': 'v' }), { 'X-Key': 'v' });
  });
});

describe('serverHeaders', () => {
  it('is the profile’s headers, or an empty object', () => {
    const headers = { 'X-Key': 'v' };
    assert.equal(serverHeaders({ headers }), headers);
    assert.deepEqual(serverHeaders({}), {});
    assert.deepEqual(serverHeaders(null), {});
  });
});
