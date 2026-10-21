// Ruuk Village "Zero to Hero" kite camp: replays the package page (with its price builder) recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRvZthSlots, parseRvRateCard, ruukVillageZeroToHeroKalpitiya } from '../../src/offers/adapters/ruuk-village-zero-to-hero-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ruuk-village-zero-to-hero-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ruuk zero to hero: rate card from the builder script', () => {
  const rc = parseRvRateCard(html)!;
  assert.deepEqual(rc.base, { summer: 740, quiet: 740, winter: 775, busy: 775 });
  assert.deepEqual(rc.cabanas.map(c => [c.id, c.up]), [['wadiya', 0], ['garden', 109], ['chalet', 243]]);
  assert.equal(rc.single.chalet.busy, null);
  assert.equal(rc.lessonSupplement, 100);
  assert.equal(parseRvRateCard('<html>no builder</html>'), null);
});

test('ruuk zero to hero: builder maths (two sharing / one person), chalet single in peak on request', () => {
  const slots = buildRvZthSlots(parseRvRateCard(html)!);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 24);
  const by = (k: string) => ok.find(s => s.key === k)!;
  assert.equal(by('summer|wadiya|2p').price, 740);            // the page's "from EUR 740 per person, two sharing"
  assert.equal(by('summer|wadiya|1p').price, 740 + 45 + 100);  // single surcharge + private lessons
  assert.equal(by('busy|garden|2p').price, 775 + 109);
  assert.equal(by('busy|chalet|1p').price, null);
  assert.ok(ok.every(s => s.startDate === null && s.packageNights === 7 && s.availability === 'on_request'));
});

test('ruuk zero to hero: content is a valid 8-day beginner camp at the lodge', async () => {
  const c = await ruukVillageZeroToHeroKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.deepEqual(c.spotCoords, { lat: 8.244, lng: 79.739 });
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(!c.imageUrls.some(u => /logo|\.png/i.test(u)));
  assert.ok(!/[–—]/.test(c.summary));
});
