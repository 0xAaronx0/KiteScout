// UCPA Kitesurf & Safari, Cape Town: replays the product page + compacted calendar JSON recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { UCPA_CAPE_TOWN, ucpaKitesurfSafariCapeTown } from '../../src/offers/adapters/ucpa-kitesurf-safari-cape-town.js';
import { fetchUcpaSlots } from '../../src/offers/adapters/ucpa-kitesurf-debutant-hurghada.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/ucpa-kitesurf-safari-cape-town');
const ctx = { note: () => {}, incomplete: () => {} };

test('ucpa cape town: 6 Friday departures, 7 nights land only, one place left each', async () => {
  const notes: string[] = [];
  const slots = await fetchUcpaSlots(UCPA_CAPE_TOWN, '2026-10-19', { note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => s.startDate), ['2026-10-23', '2026-12-04', '2026-12-11', '2027-02-05', '2027-02-12', '2027-02-19']);
  assert.deepEqual(slots.map(s => s.price), [1330, 1270, 1270, 1310, 1310, 1310]);
  assert.ok(slots.every(s => s.availability === 'limited' && s.spotsLeft === 1 && s.packageNights === 7));
  assert.equal(slots[0].endDate, '2026-10-30');
  assert.deepEqual(notes, []);
});

test('ucpa cape town: content (not for beginners)', async () => {
  const c = await ucpaKitesurfSafariCapeTown.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.beginnerFriendly], ['camp', 8, 'South Africa', 'Western Cape', 'Cape Town', false]);
  assert.deepEqual(c.skillLevels, ['intermediate', 'advanced']);
  assert.match(c.summary, /Buffelsfontein game reserve/);
  assert.ok(c.imageUrls.every(u => /cape-town/.test(u)));
});
