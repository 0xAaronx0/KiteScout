// Gnaraloo Station 3 Mile Camp: replays /3-mile-camp/, /3-mile-tariffs/ and /kitesurfing/ recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGnSlots, g3mRoomOf, gnaralooStation3MileCamp, parseGnRooms, parseGnTariffs,
} from '../../src/offers/adapters/gnaraloo-station-3-mile-camp.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/gnaraloo-station-3-mile-camp');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('gnaraloo 3 mile: 2026 tariffs, 5 site types x 3 periods', () => {
  const t = parseGnTariffs(read('3-mile-tariffs'));
  assert.equal(t.year, 2026);
  assert.equal(t.rates.length, 15);
  const hiltonPeak = t.rates.find(r => r.unit === 'Hilton' && r.period === 'peak')!;
  assert.deepEqual([hiltonPeak.pax, hiltonPeak.base, hiltonPeak.addAdult, hiltonPeak.addChild], [3, 123, 41, 20.5]);
  const goldStd = t.rates.find(r => /Gold/.test(r.unit) && r.period === 'standard')!;
  assert.deepEqual([goldStd.pax, goldStd.base], [4, 104]);
  assert.match(t.periods.peak!, /school holiday/);
});

test('gnaraloo 3 mile: undated per-night slots per site, AUD, on request', () => {
  const slots = buildGnSlots(parseGnTariffs(read('3-mile-tariffs')), g3mRoomOf);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 15);
  assert.ok(ok.every(s => s.startDate === null && s.currency === 'AUD' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'));
  assert.equal(Math.min(...ok.map(s => s.price!)), 20);
  assert.equal(ok.find(s => s.key === 'hilton|standard')!.room, 'The Hilton');
  assert.equal(ok.find(s => s.key === 'general-camp-sites|off_peak')!.room, 'Basic Sites');
});

test('gnaraloo 3 mile: content with the four site styles, kite text and own photos', async () => {
  const c = await gnaralooStation3MileCamp.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.deepEqual(parseGnRooms(read('3-mile-camp')).map(r => r.name), ['Basic Sites', 'Primo Sites', 'The Lagoon', 'The Hilton']);
  assert.match(c.sourceText!, /TOMBSTONES/);
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://gnaraloostation.com/wp-content/uploads/') && !/map/i.test(u)), c.imageUrls.join('\n'));
  assert.doesNotMatch(c.summary, /[–—]/);
});
