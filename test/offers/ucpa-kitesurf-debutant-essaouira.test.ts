// UCPA Kitesurf spécial débutant, Essaouira: replays both product pages + compacted calendar JSON recorded 2026-10-19
// (one departure then: 24.12.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { UCPA_ESSAOUIRA, ucpaKitesurfDebutantEssaouira } from '../../src/offers/adapters/ucpa-kitesurf-debutant-essaouira.js';
import { fetchUcpaSlots } from '../../src/offers/adapters/ucpa-kitesurf-debutant-hurghada.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/ucpa-kitesurf-debutant-essaouira');
const ctx = { note: () => {}, incomplete: () => {} };

test('ucpa essaouira: the single year-end departure per unit; none once it has started', async () => {
  const slots = await fetchUcpaSlots(UCPA_ESSAOUIRA, '2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.endDate, s.availability]), [
    ['debutant|2026-12-24', 1040, '2026-12-31', 'available'],
    ['coaching|2026-12-24', 1070, '2026-12-31', 'available'],
  ]);
  const notes: string[] = [];
  assert.deepEqual(await fetchUcpaSlots(UCPA_ESSAOUIRA, '2026-12-25', { note: t => notes.push(t), incomplete: () => {} }), []);
  assert.ok(notes.some(n => /1 past departures dropped/.test(n)));
  assert.ok(notes.some(n => /no future land-only departure/.test(n)));
});

test('ucpa essaouira: content', async () => {
  const c = await ucpaKitesurfDebutantEssaouira.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.country, c.region, c.spot, c.spotCoords], ['Morocco', 'Marrakech-Safi', 'Essaouira', null]);
  assert.match(c.summary, /Hotel Miramar/);
  assert.ok(c.imageUrls.length >= 10);
});
