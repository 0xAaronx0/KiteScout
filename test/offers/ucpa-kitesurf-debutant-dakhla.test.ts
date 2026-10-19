// UCPA Kitesurf spécial débutant, Dakhla: replays both product pages + compacted calendar JSON recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { UCPA_DAKHLA, ucpaKitesurfDebutantDakhla } from '../../src/offers/adapters/ucpa-kitesurf-debutant-dakhla.js';
import { fetchUcpaSlots } from '../../src/offers/adapters/ucpa-kitesurf-debutant-hurghada.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/ucpa-kitesurf-debutant-dakhla');
const ctx = { note: () => {}, incomplete: () => {} };

test('ucpa dakhla: slots from the booking calendar', async () => {
  const slots = await fetchUcpaSlots(UCPA_DAKHLA, '2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  const deb = slots.filter(s => s.key.startsWith('debutant|'));
  assert.equal(deb.length, 40);
  assert.equal(slots.filter(s => s.key.startsWith('coaching|')).length, 40);
  assert.deepEqual(deb.slice(0, 3).map(s => [s.startDate, s.price, s.availability]), [
    ['2026-10-21', 1150, 'sold_out'], ['2026-11-02', 1090, 'sold_out'], ['2026-11-09', 1130, 'sold_out'],
  ]);
  const feb = deb.find(s => s.startDate === '2027-02-15')!;
  assert.deepEqual([feb.price, feb.currency, feb.endDate, feb.availability], [1130, 'EUR', '2027-02-22', 'available']);
  assert.equal(slots.find(s => s.key === 'coaching|2027-02-15')!.price, 1160);
  // a later "today" drops started departures
  assert.equal((await fetchUcpaSlots(UCPA_DAKHLA, '2027-10-01', ctx)).length, 8);
});

test('ucpa dakhla: content', async () => {
  const c = await ucpaKitesurfDebutantDakhla.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.country, c.region, c.spot, c.durationDays], ['Morocco', 'Dakhla-Oued Ed-Dahab', 'PK25, Dakhla Lagoon', 8]);
  assert.deepEqual(c.spotCoords, { lat: 23.908982, lng: -15.780399 });
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => /International\/(\d+|[^/]*dakhla[^/]*)\.jpg$/.test(u)));
});
