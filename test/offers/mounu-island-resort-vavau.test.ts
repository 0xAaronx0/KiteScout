// Mounu Island (Vava'u, Tonga): replays the Bucket List Collection pages + sitemap recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mounuIslandResortVavau, MOU_BOOK_URL, buildMouSlots, mouBands, parseMouFaq, parseMouPricingNote, parseMouRanges,
  parseMouSeasons, sitemapLastmod,
} from '../../src/offers/adapters/mounu-island-resort-vavau.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/mounu-island-resort-vavau');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const book = read('www.thebucketlistcollection.com_mounu-book-now.');

test('mounu: year-less day ranges', () => {
  assert.deepEqual(parseMouRanges('June 1 - 30, Oct 15-31'), [{ m1: 6, d1: 1, m2: 6, d2: 30 }, { m1: 10, d1: 15, m2: 10, d2: 31 }]);
  assert.deepEqual(parseMouRanges('Nov 1 - Jan 11'), [{ m1: 11, d1: 1, m2: 1, d2: 11 }]);
});

test('mounu: four seasons with nightly and 7-night prices, per room for two', () => {
  const s = parseMouSeasons(book);
  assert.deepEqual(s.map(x => [x.name, x.perNight, x.week, x.currency, x.ranges.length]), [
    ['Shoulder Season', 1700, 11900, 'USD', 2],
    ['Whale Season', 2000, 14000, 'USD', 1],
    ['Island Season', 1700, 11900, 'USD', 1],
    ['Holiday Season', 2000, 14000, 'USD', 1],
  ]);
  assert.equal(parseMouPricingNote(book), 'Pricing is per room per night assuming double occupancy.');
  assert.ok(parseMouFaq(book).some(f => /5 days of whale swimming/.test(f.a)));
});

test('mounu: bands anchored on the page lastmod (2026-03-09), one 12-month cycle', () => {
  const anchor = sitemapLastmod(read('www.thebucketlistcollection.com_sitemap.xml.'), MOU_BOOK_URL);
  assert.equal(anchor, '2026-03-09');
  const bands = mouBands(parseMouSeasons(book), anchor!);
  assert.deepEqual(bands.map(b => [b.season, b.start, b.end, b.perNight]), [
    ['Island Season', '2026-01-12', '2026-05-31', 1700],
    ['Shoulder Season', '2026-06-01', '2026-06-30', 1700],
    ['Whale Season', '2026-07-01', '2026-10-14', 2000],
    ['Shoulder Season', '2026-10-15', '2026-10-31', 1700],
    ['Holiday Season', '2026-11-01', '2027-01-11', 2000],
  ]);
  const slots = buildMouSlots(bands, '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.price]), [
    ['fale|2026-07-01', '2026-07-01', '2026-10-14', 2000],
    ['fale|2026-10-15', '2026-10-15', '2026-10-31', 1700],
    ['fale|2026-11-01', '2026-11-01', '2027-01-11', 2000],
  ]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.occupancy === 2 && s.availability === 'unknown'));
  assert.deepEqual(buildMouSlots(bands, '2027-01-12'), []); // cycle over: price on request until the page is edited
});

test('mounu: fetchSlots replays book-now + sitemap', async () => {
  const slots = await mounuIslandResortVavau.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.every(s => s.currency === 'USD' && s.endDate! <= '2027-01-11'));
});

test('mounu: content', async () => {
  const c = await mounuIslandResortVavau.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Mounu Island');
  assert.equal(c.country, 'Tonga');
  assert.equal(c.continent, 'Oceania');
  assert.equal(c.region, "Vava'u");
  assert.equal(c.mealPlan, 'full_board');
  assert.equal(c.kiteLessons, null);
  assert.match(c.summary, /four traditional thatched Tongan fales/);
  assert.ok(c.optionalServices.includes('Kite surfing and winging in the lagoon')); // no research note (audit 2026-10-27)
  assert.match(c.summary, /SE to E trade winds from April to November/);
  assert.match(c.summary, /USD 1,700 to 2,000 per fale per night for two/);
  assert.equal(c.rooms.length, 1);
  assert.ok(c.rooms[0].features.includes('Whale Season (July 1 - Oct 14): USD 2,000 per night, 7 nights USD 14,000'));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => !/unsplash-image|logo|Screenshot/i.test(decodeURIComponent(u))));
  assert.ok(!/[–—]/.test(c.summary + c.rooms[0].description));
});
