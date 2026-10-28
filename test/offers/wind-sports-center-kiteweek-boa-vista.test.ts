// Wind Sports Center Kitehouse Kiteweek (Boa Vista): replays /camps-boavista/ recorded 2026-10-19 (dateModified 2026-09-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { windSportsCenterKiteweekBoaVista, fetchWscSlots, seasonGroups, bandFor } from '../../src/offers/adapters/wind-sports-center-kiteweek-boa-vista.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/wind-sports-center-kiteweek-boa-vista');
const ctx = { note: () => {}, incomplete: () => {} };

test('wsc: season labels and bands', () => {
  assert.deepEqual(seasonGroups('June to September'), [[6, 9]]);
  assert.deepEqual(seasonGroups('October, November, April &amp; May'), [[10, 11], [4, 5]]);
  assert.deepEqual(seasonGroups('December to March'), [[12, 3]]);
  assert.deepEqual(bandFor([12, 3], '2026-09-16'), { start: '2026-12-01', end: '2027-03-31' });
  assert.deepEqual(bandFor([6, 9], '2026-09-16'), { start: '2026-06-01', end: '2026-09-30' });
  assert.deepEqual(bandFor([4, 5], '2026-09-16'), { start: '2027-04-01', end: '2027-05-31' });
});

test('wsc: kite-only camps, 2 levels x 4 rooms x 3 future bands, per person', async () => {
  const slots = await fetchWscSlots('2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 24);
  const by = Object.fromEntries(slots.map(s => [s.key, s]));
  const b = by['beginner|single-1|2026-10-01'];
  assert.deepEqual([b.price, b.priceTotal, b.endDate, b.occupancy, b.currency, b.priceUnit, b.packageNights, b.availability],
    [1255, null, '2026-11-30', 1, 'EUR', 'package', 7, 'on_request']);
  const q = by['intermediate|double-room-4|2026-12-01'];
  assert.deepEqual([q.price, q.priceTotal, q.endDate], [1213.75, 4855, '2027-03-31']);
  assert.equal(by['beginner|twin-2|2027-04-01'].priceTotal, 2295);
  assert.ok(!slots.some(s => /surf/i.test(s.unit ?? '')));
  // June-September 2026 is past on 2026-10-19; earlier in the year it is a band
  assert.ok((await fetchWscSlots('2026-09-20')).some(s => s.key === 'beginner|single-1|2026-06-01'));
});

test('wsc: content', async () => {
  const c = await windSportsCenterKiteweekBoaVista.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Cape Verde', 'Boa Vista', 'Sal Rei, Boa Vista']);
  assert.equal(c.includedServices[0], '5 days of kitesurf course (15 hours)');
  // the page's lowest prices (June to September), even though that band is dated past for the slots (#267 verifier)
  assert.match(c.summary, /from EUR 1,195 for one person in a single room \(June to September\) or EUR 3,795 for 4 sharing a room \(June to September\)/);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => !/logo|favicon/i.test(u)));
  // beach and centre photos before the meal photos (2026-10-28: the vision pick had kept 8 meal photos of 10)
  assert.match(c.imageUrls[0], /\/2023\/05\/bahia/);
  const firstMeal = c.imageUrls.findIndex(u => /IMG_01\d\d/.test(u));
  assert.ok(firstMeal === -1 || firstMeal > c.imageUrls.findLastIndex(u => /\/bahia/.test(u)));
});
