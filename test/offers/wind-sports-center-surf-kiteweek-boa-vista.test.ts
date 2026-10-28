// Wind Sports Center Surf + Kite Week (Boa Vista): replays /camps-boavista/ recorded 2026-10-28 (dateModified 2026-09-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { windSportsCenterSurfKiteweekBoaVista, fetchWsckSlots, mapWsckRows } from '../../src/offers/adapters/wind-sports-center-surf-kiteweek-boa-vista.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/wind-sports-center-surf-kiteweek-boa-vista');
const ctx = { note: () => {}, incomplete: () => {} };

test('wsck: 2-pax rows map by position despite typo labels', () => {
  const rows = mapWsckRows([
    { label: 'Single Room (1 pax)', pax: 1, total: 1105 },
    { label: 'win Room (2 pax)', pax: 2, total: 1925 },
    { label: 'Double Room (min 2 pax)', pax: 2, total: 2010 },
    { label: 'Double Room (4 pax)', pax: 4, total: 3645 },
  ]);
  assert.deepEqual(rows.map(r => [r.room, r.total]), [['single', 1105], ['double-bed', 1925], ['twin', 2010], ['double-room', 3645]]);
});

test('wsck: surf + kite camps only, 2 levels x 4 rooms x 3 future bands, per person', async () => {
  const slots = await fetchWsckSlots('2026-10-28');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 24);
  assert.equal(new Set(slots.map(s => s.key)).size, 24);
  const by = Object.fromEntries(slots.map(s => [s.key, s]));
  const b = by['beginner|single-1|2026-10-01'];
  assert.deepEqual([b.price, b.priceTotal, b.endDate, b.occupancy, b.currency, b.priceUnit, b.packageNights, b.availability],
    [1165, null, '2026-11-30', 1, 'EUR', 'package', 7, 'on_request']);
  const q = by['intermediate|double-room-4|2026-12-01'];
  assert.deepEqual([q.price, q.priceTotal, q.endDate], [1140, 4560, '2027-03-31']);
  assert.equal(by['beginner|twin-2|2027-04-01'].priceTotal, 2115);
  assert.ok(slots.every(s => /surf \+ kite/i.test(s.unit ?? '')));
  // June-September 2026 is past on 2026-10-28; earlier in the year it is a band, with the typo rows mapped
  const summer = await fetchWsckSlots('2026-09-20');
  const s = Object.fromEntries(summer.map(x => [x.key, x]));
  assert.equal(s['beginner|double-bed-2|2026-06-01'].priceTotal, 1925);
  assert.equal(s['beginner|twin-2|2026-06-01'].priceTotal, 2010);
  assert.equal(s['intermediate|twin-2|2026-06-01'].priceTotal, 2240);
});

test('wsck: content', async () => {
  const c = await windSportsCenterSurfKiteweekBoaVista.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Cape Verde', 'Boa Vista', 'Sal Rei, Boa Vista', 'half_board']);
  assert.match(c.includedServices[0], /3 days of surf course .* 2 days of kitesurf course/);
  assert.match(c.summary, /Most of the coaching is surfing/);
  assert.match(c.summary, /from EUR 1,105 for one person in a single room \(June to September\)/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => !/logo|favicon/i.test(u)));
});
