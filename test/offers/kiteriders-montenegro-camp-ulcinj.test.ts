// Kiteriders Montenegro kite camp (Garden Villas, Ulcinj): replays the one-pager recorded 2026-10-19 (trimmed).
// Only 2026 rates are printed and the season ended 2026-09-06 -> 0 slots on the recording day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteridersMontenegroCampUlcinj, parseKrmRates, buildKrmSlots, fetchKrmSlots, parseKrmContent, parseKrmCourses, krmCoords,
} from '../../src/offers/adapters/kiteriders-montenegro-camp-ulcinj.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteriders-montenegro-camp-ulcinj');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');

test('krm: 2026 room rates and season limits', () => {
  const r = parseKrmRates(html);
  assert.equal(r.year, 2026);
  assert.equal(r.localTax, 1);
  assert.deepEqual(r.seasons, [
    { season: 'low', start: '2026-05-16', end: '2026-07-05' }, { season: 'high', start: '2026-07-06', end: '2026-09-06' },
  ]);
  assert.deepEqual(r.rates.map(x => [x.season, x.key, x.occupancy, x.price]), [
    ['low', 'apt2', 2, 50], ['low', 'single', 1, 61], ['low', 'apt3', 3, 39],
    ['high', 'apt2', 2, 56], ['high', 'single', 1, 79], ['high', 'apt3', 3, 43],
  ]);
});

test('krm: bands that have not ended; [] after the season', async () => {
  const r = parseKrmRates(html);
  const s = buildKrmSlots(r, '2026-07-01');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.equal(s.length, 6);
  const apt3 = s.find(x => x.key === 'apt3|2026-07-06')!;
  assert.deepEqual([apt3.price, apt3.currency, apt3.priceUnit, apt3.priceBasis, apt3.occupancy, apt3.availability, apt3.endDate], [43, 'EUR', 'per_night', 'person', 3, 'on_request', '2026-09-06']);
  const notes: string[] = [];
  assert.deepEqual(await fetchKrmSlots({ note: t => notes.push(t), incomplete: () => {} }, '2026-10-19'), []);
  assert.match(notes[0], /all 2026 season bands are past/);
});

test('krm: content, courses, coordinates from the site', async () => {
  assert.deepEqual(krmCoords(html), { lat: 41.8797, lng: 19.322 });
  assert.ok(parseKrmCourses(html).some(c => c.name === 'Basic-beginner´s course' && c.from === 259));
  const c = parseKrmContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Montenegro', 'Velika Plaza, Ulcinj', 'Velika Plaza', 'self_catering']);
  assert.match(c.summary, /EUR 39-79 per person per night .* beginner courses from EUR 259/);
  assert.match(c.summary, /2027 rates are not published yet \(2026 season: 16 May - 6 September\)/);
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => !/-\d+x\d+\.jpg$/.test(u)));
  assert.equal((await kiteridersMontenegroCampUlcinj.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
