// Surfari Afrika land tours: replays the three pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSaPrimalTiers, parseSaXlDates, parseSaXlPrices,
  surfariafrikaDownwinderXl, surfariafrikaNamibiaDownwinder, surfariafrikaPrimalExplorer,
} from '../../src/offers/adapters/surfariafrika.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import type { OfferAdapter } from '../../src/offers/types.js';

const FIX = join(import.meta.dirname, '../fixtures/offers');
const html = (key: string) => readFileSync(join(FIX, key, readdirSync(join(FIX, key))[0]), 'utf8');
const ctx = () => { const notes: string[] = []; return { notes, note: (t: string) => notes.push(t), incomplete: (r: string) => notes.push(r) }; };
async function run(a: OfferAdapter) {
  process.env.OFFERS_FIXTURE_DIR = join(FIX, a.key);
  const content = await a.fetchContent(ctx());
  const slots = await a.fetchSlots(ctx());
  return { content, slots };
}
const clean = (s: string) => assert.ok(!/[—–]/.test(s), 'no em/en dashes');

test('primal explorer: group-size tiers + budget, undated on request', async () => {
  assert.deepEqual(parseSaPrimalTiers(html('surfariafrika-primal-explorer')), [
    { guests: '6', premium: 2400, budget: 1400 },
    { guests: '8', premium: 2300, budget: 1300 },
    { guests: '10', premium: 2200, budget: 1200 },
    { guests: '12+', premium: 2100, budget: 1200 },
  ]);
  const { content, slots } = await run(surfariafrikaPrimalExplorer);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 8);
  assert.ok(ok.every(s => s.startDate === null && s.availability === 'on_request' && s.currency === 'EUR' && s.availabilityText === 'dates to be confirmed'));
  assert.equal(contentProblem(content), null);
  assert.equal(content.durationDays, 9);
  assert.match(content.summary, /EUR 2,100 to 2,400.*EUR 1,200 to 1,400/);
  assert.ok(content.imageUrls.length >= 10 && content.imageUrls.every(u => !/196977156_/.test(u)));
  clean(content.summary + content.title);
});

test('downwinder xl: date from the site-wide card, sharing + single price', async () => {
  const page = html('surfariafrika-downwinder-xl');
  assert.deepEqual(parseSaXlDates(page), { start: '2027-01-31', end: '2027-02-09' });
  assert.deepEqual(parseSaXlPrices(page), { sharing: 2100, single: 2450 });
  const { content, slots } = await run(surfariafrikaDownwinderXl);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.unit, s.price, s.startDate, s.endDate]), [
    ['Shared room', 2100, '2027-01-31', '2027-02-09'], ['Single room', 2450, '2027-01-31', '2027-02-09'],
  ]);
  assert.equal(contentProblem(content), null);
  assert.equal(content.durationDays, 10);
  assert.equal(content.itinerarySpots.length, 6);
  clean(content.summary + content.title);
});

test('namibia downwinder: no price on the page → one on-request slot, low confidence', async () => {
  const { content, slots } = await run(surfariafrikaNamibiaDownwinder);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.availability]), [['expedition', null, 'on_request']]);
  assert.equal(surfariafrikaNamibiaDownwinder.confidence, 'low');
  assert.equal(contentProblem(content), null);
  assert.deepEqual(content.skillLevels, ['advanced']);
  assert.ok(content.imageUrls.length >= 3);
  assert.ok(content.imageUrls.every(u => !/324846706_|82329993_|IMG_20211029_154320/.test(u)), 'no site-wide Kenya photos on Namibia');
  clean(content.summary + content.title);
});
