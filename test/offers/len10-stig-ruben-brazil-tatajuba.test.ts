import { EVERGREEN_PILOT_SUMMARIES } from '../../src/offers/evergreen-pilot-summaries.js';
// LEN10 Experience Stig x Ruben Brazil (Tatajuba): replays /experience recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { len10StigRubenBrazilTatajuba, buildLen10Slots, fetchLen10Slots, parseLen10Content, parseLen10Trips } from '../../src/offers/adapters/len10-stig-ruben-brazil-tatajuba.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/len10-stig-ruben-brazil-tatajuba');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.len10.com_experience'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('len10: featured Brazil card', () => {
  const t = parseLen10Trips(html);
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].start, t[0].end, t[0].price, t[0].currency, t[0].roomsLeft, t[0].nights, t[0].place],
    ['2026-11-02', '2026-11-08', 2999, 'EUR', 4, 6, 'Tatajuba, Brazil']);
});

test('len10: one limited slot while the trip is ahead, none after', async () => {
  const s = buildLen10Slots(parseLen10Trips(html), '2026-10-19');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].key, s[0].price, s[0].currency, s[0].priceUnit, s[0].priceBasis, s[0].availability, s[0].spotsLeft],
    ['2026-11-02', 2999, 'EUR', 'package', 'person', 'limited', 4]);
  const notes: string[] = [];
  assert.deepEqual(await fetchLen10Slots('2026-11-03', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /past/);
});

test('len10: content', async () => {
  const c = parseLen10Content(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 7, 'Brazil', 'Ceará', 'Tatajuba']);
  assert.equal(c.summary, EVERGREEN_PILOT_SUMMARIES['len10-stig-ruben-brazil-tatajuba']);
  assert.equal(c.bookingUrl, 'https://tri.ps/OkCSC');
  assert.equal(len10StigRubenBrazilTatajuba.instantBooking, true);
  assert.equal(contentProblem(await len10StigRubenBrazilTatajuba.fetchContent(ctx)), null);
});
