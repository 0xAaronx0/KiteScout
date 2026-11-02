// errorText: a bare undici "fetch failed" carries its cause code into the run log (offer-slots cron, 2026-11-01 burst)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorText } from '../../src/offers/ingest.js';
import { BlockedByHost } from '../../src/offers/http.js';

test('fetch failed names the cause code', () => {
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND kitesurftofo.com'), { code: 'ENOTFOUND' });
  assert.equal(errorText(new TypeError('fetch failed', { cause })), 'fetch failed (ENOTFOUND)');
});

test('cause without code falls back to its message', () => {
  assert.equal(errorText(new TypeError('fetch failed', { cause: new Error('other side closed') })), 'fetch failed (other side closed)');
});

test('plain errors and non-errors stay as they were', () => {
  assert.equal(errorText(new Error('feddet-strand-resort slots: timeout after 240s')), 'feddet-strand-resort slots: timeout after 240s');
  assert.equal(errorText('boom'), 'boom');
});

test('a cause already in the message is not repeated', () => {
  const cause = Object.assign(new Error('x'), { code: 'ECONNRESET' });
  assert.equal(errorText(new Error('read ECONNRESET', { cause })), 'read ECONNRESET');
});

test('a BlockedByHost cause keeps the wrapper message', () => {
  const blocked = new BlockedByHost('HTTP 403', 'https://example.com');
  assert.equal(errorText(new Error('slots failed', { cause: blocked })), 'slots failed');
});
