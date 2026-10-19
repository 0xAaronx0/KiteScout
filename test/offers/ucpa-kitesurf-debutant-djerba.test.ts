// UCPA Kitesurf spécial débutant, Djerba: replays both product pages + compacted calendar JSON recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { UCPA_DJERBA, ucpaKitesurfDebutantDjerba } from '../../src/offers/adapters/ucpa-kitesurf-debutant-djerba.js';
import { fetchUcpaSlots } from '../../src/offers/adapters/ucpa-kitesurf-debutant-hurghada.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/ucpa-kitesurf-debutant-djerba');
const ctx = { note: () => {}, incomplete: () => {} };

test('ucpa djerba: promotional rows and low-stock wording', async () => {
  const slots = await fetchUcpaSlots(UCPA_DJERBA, '2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.filter(s => s.key.startsWith('debutant|')).length, 36);
  assert.equal(slots.filter(s => s.key.startsWith('coaching|')).length, 36);
  const oct28 = slots.find(s => s.key === 'debutant|2026-10-28')!;
  assert.deepEqual([oct28.price, oct28.availability, oct28.spotsLeft], [801, 'limited', 2]);
  assert.match(oct28.availabilityText!, /promotion -10% \(was EUR 890\)/);
});

test('ucpa djerba: content', async () => {
  const c = await ucpaKitesurfDebutantDjerba.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.country, c.region, c.spot], ['Tunisia', 'Djerba, Medenine', 'Mezraya, Djerba']);
  assert.equal(c.spotCoords, null); // the page's map embed says q=null,null
  assert.match(c.summary, /Hôtel Zenon in the Mezraya tourist zone/);
  assert.ok(!c.imageUrls.some(u => /kalpitiya/.test(u)));
});
