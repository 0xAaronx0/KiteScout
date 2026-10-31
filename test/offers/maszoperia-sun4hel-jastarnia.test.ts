// Maszoperia Sun4Hel (Jastarnia): replays the home, price list 2026, four unit pages and the adult kitesurfing page
// recorded 2026-10-12 (scripts except JSON-LD, styles, SVGs and style attributes trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  maszoperiaSun4helJastarnia, buildS4hSlots, parseS4hPrices, s4hPriceListUrl,
} from '../../src/offers/adapters/maszoperia-sun4hel-jastarnia.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { roomsWithPrices } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/maszoperia-sun4hel-jastarnia');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('s4h: price list link and unit ranges (pitches and camper plots left out)', () => {
  assert.deepEqual(s4hPriceListUrl(read('sun4hel.pl_.')), { url: 'https://sun4hel.pl/cennik-2026', year: 2026 });
  assert.deepEqual(s4hPriceListUrl('<a href="/cennik-2026">x</a><a href="/cennik-2027">y</a>'), { url: 'https://sun4hel.pl/cennik-2027', year: 2027 });
  const prices = parseS4hPrices(read('sun4hel.pl_cennik-2026.'));
  assert.deepEqual(prices.map(p => [p.key, p.from, p.to]), [['caravan', 100, 750], ['wiatr', 100, 500], ['sky', 100, 500], ['woda', 100, 300]]);
  assert.equal(prices[0].raw, 'Przyczepy od 100 zł do 750 zł – w zależności od terminu');
});

test('s4h: slots = unit for the price-list year, the from-price without dates, availability unknown', async () => {
  const slots = await maszoperiaSun4helJastarnia.fetchSlots(ctx);
  assert.deepEqual(slots, buildS4hSlots(parseS4hPrices(read('sun4hel.pl_cennik-2026.')), 2026));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  // Aaron 2026-10-31: "od 100 zł do 750 zł" is a range, not the price of every 2026 date -> no dates, a floor price.
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.startDate, s.endDate, s.price, s.priceIsMinimum]), [
    ['caravan|2026', 'Surf caravan', null, null, 100, true],
    ['wiatr|2026', 'Wiatr family room', null, null, 100, true],
    ['sky|2026', 'Sky room', null, null, 100, true],
    ['woda|2026', 'Woda room', null, null, 100, true],
  ]);
  assert.ok(slots.every(s => s.currency === 'PLN' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
});

test('s4h: rooms show the range floor as a from-price and no priced month (Aaron 2026-10-31)', async () => {
  const content = await maszoperiaSun4helJastarnia.fetchContent(ctx);
  const rows = roomsWithPrices(content, await maszoperiaSun4helJastarnia.fetchSlots(ctx), '2026-10-31');
  assert.deepEqual(rows.map(r => [r.name, r.price_from, r.price_currency, r.price_from_is_minimum, r.priced_months, r.availability]), [
    ['Surf caravan', 100, 'PLN', true, [], []],
    ['Wiatr family room', 100, 'PLN', true, [], []],
    ['Sky room', 100, 'PLN', true, [], []],
    ['Woda room', 100, 'PLN', true, [], []],
  ]);
});

test('s4h: content', async () => {
  const c = await maszoperiaSun4helJastarnia.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Maszoperia Sun4Hel');
  assert.equal(c.region, 'Jastarnia, Hel Peninsula');
  assert.equal(c.spot, 'Jastarnia');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.beginnerFriendly, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate']);
  assert.match(c.summary, /own water sports school, Surf4Hel/);
  assert.match(c.summary, /12 surf caravans for 4 to 8 guests, 12 Wiatr family rooms .* 12 Sky container rooms \(6 with a bay view\)/);
  assert.match(c.summary, /PLN 100-750 per caravan and PLN 100-500 per room and night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Surf caravan', 'Wiatr family room', 'Sky room', 'Woda room']);
  assert.ok(c.rooms[0].features.includes('PLN 100-750 per night depending on the dates (price list 2026)'));
  assert.ok(c.optionalServices.some(s => /low season 27\.04 - 23\.06 and 02\.09 - 13\.10, high season 23\.06 - 01\.09/.test(s)));
  assert.ok(c.optionalServices.includes('Pets PLN 50 per night'));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => /\/images\/s4h\/(przyczepy-kem|pokoje-(wiatr|sky|woda)|Surf4Hel)\//.test(u)));
});
