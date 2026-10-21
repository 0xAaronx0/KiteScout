// Kitesurf School Dubai Sri Lanka winter trip 2026/27: replays the blog post recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKsdSlots, fetchKsdSlots, kitesurfSchoolDubaiSriLankaCampKalpitiya, parseKsdPost,
} from '../../src/offers/adapters/kitesurf-school-dubai-sri-lanka-camp-kalpitiya.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-school-dubai-sri-lanka-camp-kalpitiya');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksd sri lanka: three dated trips (de-duplicated), AED 4,900 per person', () => {
  const p = parseKsdPost(html);
  assert.deepEqual(p.trips.map(t => [t.name, t.start, t.end]), [
    ['Christmas Trip', '2026-12-21', '2026-12-25'],
    ['New Year Trip', '2026-12-28', '2027-01-02'],
    ['January Trip', '2027-01-04', '2027-01-08'],
  ]);
  assert.deepEqual([p.price, p.currency, p.days, p.resort], [4900, 'AED', 5, 'Arasi Resort Kalpitiya']);
});

test('ksd sri lanka: future trips become slots, past ones are dropped', async () => {
  const slots = await fetchKsdSlots('2026-10-21', ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.packageNights]), [['2026-12-21', 4], ['2026-12-28', 5], ['2027-01-04', 4]]);
  assert.ok(ok.every(s => s.price === 4900 && s.currency === 'AED' && s.priceBasis === 'person' && s.availability === 'on_request'));
  assert.equal(buildKsdSlots(parseKsdPost(html), '2026-12-22').length, 2);
  const notes: string[] = [];
  assert.deepEqual(await fetchKsdSlots('2027-02-01', { note: t => notes.push(t) }), []);
  assert.match(notes.join(' '), /next dates not published yet/);
});

test('ksd sri lanka: content is a valid 5-day camp, breakfast only, no borrowed images', async () => {
  const c = await kitesurfSchoolDubaiSriLankaCampKalpitiya.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 5);
  assert.equal(c.mealPlan, 'breakfast');
  assert.deepEqual(c.imageUrls, []);
  assert.ok(c.includedServices.includes('Daily breakfast'));
  assert.ok(!/[–—]/.test(c.summary));
});
