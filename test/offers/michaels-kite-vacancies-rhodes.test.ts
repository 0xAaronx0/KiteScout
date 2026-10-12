// Michael's Kite Vacancies (Rhodes): replays the English pages recorded 2026-10-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  michaelsKiteVacanciesRhodes, buildMkvSlots, parseMkvNotes, parseMkvRates,
} from '../../src/offers/adapters/michaels-kite-vacancies-rhodes.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/michaels-kite-vacancies-rhodes');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const pricing = read('www.kite-rhodos.com_pricing_.');

test('mkv: price table = occupancy x week of stay', () => {
  assert.deepEqual(parseMkvRates(pricing).map(r => [r.persons, r.week, r.nightly, r.weekly]), [
    [1, 1, 93, 650], [1, 2, 90, 630], [1, 3, 85, 600],
    [2, 1, 125, 870], [2, 2, 120, 840], [2, 3, 115, 800],
    [3, 1, 185, 1300], [3, 2, 178, 1250], [3, 3, 170, 1200],
  ]);
});

test('mkv: German table (same widget order, /de/preise/ strings of 2026-10-09)', () => {
  const ps = ['1 Woche', '7 Nights | Standard', '2. Woche', '3. Woche', '1 Person', 'pro Zimmer', '1 Woche', '93 Euro | pro Nacht', '650 Euro',
    '2. Woche', '90 Euro | pro Nacht', '630 Euro | 2. Woche', '2 Personen', 'pro Zimmer', '1 Woche', '125 Euro | pro Nacht', '870 Euro'];
  const html = ps.map(t => `<div><p>${t}</p></div>`).join('');
  assert.deepEqual(parseMkvRates(html).map(r => [r.persons, r.week, r.nightly, r.weekly]), [[1, 1, 93, 650], [1, 2, 90, 630], [2, 1, 125, 870]]);
});

test('mkv: slots = standard (first-week) rate per occupancy, on request, no dates', async () => {
  const slots = await michaelsKiteVacanciesRhodes.fetchSlots(ctx);
  assert.deepEqual(slots, buildMkvSlots(parseMkvRates(pricing)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['hotel-room-1p', 'Hotel room', 93, 1], ['hotel-room-2p', 'Hotel room', 125, 2], ['hotel-room-3p', 'Hotel room', 185, 3],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('mkv: surcharges under the table', () => {
  const notes = parseMkvNotes(pricing);
  assert.ok(notes.some(n => /Residence tax 2,00€ per person\/per night/.test(n)));
  assert.ok(notes.some(n => /8% discount/.test(n)));
  assert.ok(notes.some(n => /beach rooms cost plus 35€ per room per week/.test(n)));
});

test('mkv: content', async () => {
  const c = await michaelsKiteVacanciesRhodes.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, "Michael's Kite Vacancies");
  assert.equal(c.country, 'Greece');
  assert.equal(c.spot, 'Fanes, Rhodes');
  assert.equal(c.mealPlan, 'half_board');
  assert.match(c.summary, /20 rooms about 200 m from its own kite station .* 4 rooms in a Beach House/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Hotel room', 'Beach House room']);
  assert.ok(c.rooms[0].features.includes('2 persons, 2nd week of stay: EUR 120 per night / EUR 840 per week (half board)'));
  assert.ok(c.rooms[1].features.includes('The beach rooms cost plus 35€ per room per week'));
  assert.ok(c.optionalServices.includes('Airport shuttle (EUR 50.00 per room, return)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/leafs|logo|\.svg/i.test(u)));
});
