// Surfari Afrika land tours: replays the three pages recorded 2026-10-12 (+ the Walvis Bay camp, 2026-10-31).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSaNamibiaSeason, parseSaNamibiaSlots, parseSaPrimalTiers, parseSaWalvisPrice, parseSaWalvisSeason, parseSaWalvisSlots,
  parseSaXlDates, parseSaXlPrices, surfariafrikaDownwinderXl, surfariafrikaNamibiaDownwinder, surfariafrikaPrimalExplorer,
  surfariafrikaWalvisBayCamp,
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

test('namibia downwinder: no price on the page, the Namibia season card → one on-request season slot', async () => {
  const page = html('surfariafrika-namibia-downwinder');
  assert.deepEqual(parseSaNamibiaSeason(page), { start: '2026-10-01', end: '2026-12-31', label: 'October to December 2026' });
  const slots = parseSaNamibiaSlots(page, '2026-10-28');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.datePrecision, s.price, s.availability, s.availabilityText]), [
    ['season|2026-10', '2026-10-01', '2026-12-31', 'season', null, 'on_request', 'Namibia season October to December 2026; exact dates and price on request'],
  ]);
  // once the season is over: back to one undated slot (price on request)
  assert.deepEqual(parseSaNamibiaSlots(page, '2027-01-05').map(s => [s.key, s.startDate, s.price]), [['expedition', null, null]]);
  assert.equal(surfariafrikaNamibiaDownwinder.confidence, 'low');
  const { content } = await run(surfariafrikaNamibiaDownwinder);
  assert.equal(contentProblem(content), null);
  assert.deepEqual(content.skillLevels, ['advanced']);
  assert.ok(content.imageUrls.length >= 3);
  assert.ok(content.imageUrls.every(u => !/324846706_|82329993_|IMG_20211029_154320/.test(u)), 'no site-wide Kenya photos on Namibia');
  clean(content.summary + content.title);
});

test('walvis bay camp: "starting at" weekly price + the camp season, own photos only', async () => {
  const page = html('surfariafrika-walvis-bay-camp');
  assert.equal(parseSaWalvisPrice(page), 800);
  assert.deepEqual(parseSaWalvisSeason(page), { start: '2026-10-10', end: '2026-11-30', label: '10 October 2026 to 30 November 2026' });
  const slots = parseSaWalvisSlots(page, '2026-10-31');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.datePrecision, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability]), [
    ['season|2026-10', '2026-10-31', '2026-11-30', 'season', 800, 'EUR', 'per_week', 'person', 'on_request'],
  ]);
  // before the season: the band starts on the printed day; after it: one undated weekly slot
  assert.equal(parseSaWalvisSlots(page, '2026-09-01')[0].startDate, '2026-10-10');
  assert.deepEqual(parseSaWalvisSlots(page, '2026-12-05').map(s => [s.key, s.startDate, s.price, s.priceUnit]), [['weekly', null, 800, 'per_week']]);
  const { content } = await run(surfariafrikaWalvisBayCamp);
  assert.equal(contentProblem(content), null);
  assert.equal(content.kind, 'camp');
  assert.equal(content.country, 'Namibia');
  // own photos only (Aaron 2026-10-31): pexels, tourism site, Bing OIP, press and stock stay out; "b go" adds two by name
  assert.deepEqual(content.imageUrls.map(u => u.split('/').pop()),
    ['L1030941-1920w.JPG', '606361068-2880w.jpg', '196977156_10158294017393511_6984936948171509730_n-337210eb-1920w.jpg']);
  assert.ok(content.imageUrls.every(u => !/-640w\./.test(u)), 'one size per photo');
  assert.ok(content.imageUrls.every(u => !/324846706_|82329993_|IMG_20211029_154320|ChatGPT|lamu1-/.test(u)), 'no site-wide card photos');
  clean(content.summary + content.title);
});
