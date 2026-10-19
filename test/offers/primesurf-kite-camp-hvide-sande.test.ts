// Primesurf Denmark Kite Camp (Hvide Sande): replays the kite-camps, accommodation and Denmark pages recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { primesurfKiteCampHvideSande, buildPsSlots, parsePsPrices } from '../../src/offers/adapters/primesurf-kite-camp-hvide-sande.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/primesurf-kite-camp-hvide-sande');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ps: price infos per room option, per person, camp included', () => {
  const p = parsePsPrices(read('primesurf.com_destinations_denmark_accommodation_'));
  assert.deepEqual(p.rows.map(r => [r.label, r.variant, r.price]), [
    ['Dorm 1 + 2', null, 990], ['Room 3 + 4', null, 1090], ['Room 5 + 6', 'single room', 1490], ['Room 5 + 6', 'double room', 1190], ['Camper', null, 990],
  ]);
  assert.deepEqual([p.food, p.perPerson, p.includesCamp], [350, true, true]);
});

test('ps: undated slots', async () => {
  const slots = await primesurfKiteCampHvideSande.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [
    ['dorm-1-2', 990, null], ['room-3-4', 1090, null], ['room-5-6-single-room', 1490, 1], ['room-5-6-double-room', 1190, 2], ['camper', 990, 1],
  ]);
  const s = slots[0];
  assert.deepEqual([s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.availability, s.startDate], ['EUR', 'package', 'person', 7, 'unknown', null]);
  assert.deepEqual(buildPsSlots({ rows: [], food: null, perPerson: true, includesCamp: true }), []);
});

test('ps: content', async () => {
  const c = await primesurfKiteCampHvideSande.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Denmark', 'Hvide Sande, West Jutland', 'Hvide Sande']);
  assert.match(c.summary, /Prices start at EUR 990 per person for the week including the kite camp; a food package \(EUR 350\) is optional/);
  assert.equal(c.rooms.length, 6);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(!c.imageUrls.some(u => /-uai\./.test(u) && c.imageUrls.includes(u.replace('-uai', ''))));
});
