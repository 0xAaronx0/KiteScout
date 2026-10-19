// WAVE CULTURE Tenerife kite week (El Médano): replays /booking, /kitesurf-school and /surf-and-yoga-camp recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { waveCultureKiteCampElMedano, buildWcSlots, parseWcPacks } from '../../src/offers/adapters/wave-culture-kite-camp-el-medano.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wave-culture-kite-camp-el-medano');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('wc: base pack rooms, kite packs, rental', () => {
  const p = parseWcPacks(read('tenerife-surfcamp.com_booking'));
  assert.deepEqual(p.rooms.map(r => [r.name, r.persons, r.price]), [
    ['Standard room', '1 person', 609], ['Standard room', '2 persons', 476], ['4 bed dorm', '1-4 persons', 434],
    ['6 bed dorm', '1-6 persons', 385], ['Superior room', '1 person', 679], ['Superior room', '2 persons', 539],
    ['Superior room', '3 persons', 476], ['Superior room', '4 persons', 413],
  ]);
  assert.deepEqual(p.kite, [{ days: 3, price: 420, hours: 6 }, { days: 5, price: 650, hours: 10 }]);
  assert.equal(p.rental, 'Kite gear rental without lessons (RRD): EUR 110 a day, EUR 450 a week');
});

test('wc: room x kite pack slots = base + kite, per person', async () => {
  const slots = await waveCultureKiteCampElMedano.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 16);
  const s = slots.find(x => x.key === '6-bed-dorm-1-6-persons|kite-3d')!;
  assert.deepEqual([s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability, s.startDate],
    [805, 'EUR', 'package', 'person', 6, 7, 'on_request', null]);
  assert.match(s.availabilityText!, /Base Pack EUR 385 per week per person \+ Kite Pack 3 days \(6 h\) EUR 420 per person/);
  assert.deepEqual(buildWcSlots({ rooms: [], kite: [], rental: null }), []);
});

test('wc: content', async () => {
  const c = await waveCultureKiteCampElMedano.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Spain', 'Canary Islands', 'El Médano, Tenerife']);
  assert.match(c.summary, /A week starts at EUR 805 per person \(6 bed dorm EUR 385 \+ 3-day Kite Pack EUR 420\)/);
  assert.ok(c.imageUrls.length >= 7);
});
