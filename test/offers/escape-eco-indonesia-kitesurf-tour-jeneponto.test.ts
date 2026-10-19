// Escape Eco Adventures Indonesia Kitesurfing Tour 2027: replays the Wix page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEeTour } from '../../src/offers/adapters/escape-eco-fiji-kitesurf-tour-korolevu.js';
import {
  eeIndonesiaPremiumRooms, escapeEcoIndonesiaKitesurfTourJeneponto, fetchEeIndonesiaSlots,
} from '../../src/offers/adapters/escape-eco-indonesia-kitesurf-tour-jeneponto.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/escape-eco-indonesia-kitesurf-tour-jeneponto');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('escape eco indonesia: weeks, base rooms and premium rooms', () => {
  const t = parseEeTour(html);
  assert.deepEqual(t.weeks.map(w => [w.start, w.end]), [['2027-06-27', '2027-07-04'], ['2027-07-04', '2027-07-11']]);
  assert.deepEqual(t.rooms.map(r => [r.unit, r.price]), [['AC twin share', 2850], ['AC private room', 3155]]);
  assert.deepEqual(eeIndonesiaPremiumRooms(t).map(r => [r.unit, r.price]), [['Premium AC twin share', 3072], ['Premium AC private room', 3598]]);
});

test('escape eco indonesia: 2 weeks x 4 rooms, AUD per person, on request', async () => {
  const slots = await fetchEeIndonesiaSlots('2026-10-19', ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 8);
  assert.equal(Math.min(...ok.map(s => s.price!)), 2850);
  assert.ok(ok.every(s => s.currency === 'AUD' && s.availability === 'on_request'));
});

test('escape eco indonesia: content is a valid camp at Batikite', async () => {
  const c = await escapeEcoIndonesiaKitesurfTourJeneponto.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.spot, 'Mallasoro, Jeneponto');
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(!c.imageUrls.some(u => /\.png$/i.test(u)), 'website screenshots (png) are skipped');
});
