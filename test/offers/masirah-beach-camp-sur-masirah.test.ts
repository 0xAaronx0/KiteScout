// Masirah Beach Camp (GET Kitesurf Oman, Masirah Island): replays kitesurfoman.com pages recorded 2026-10-12
// (fixtures trimmed: script/style bodies dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  masirahBeachCampSurMasirah, parseMbcBase, parseMbcCamp, parseMbcCourses, parseMbcIko,
} from '../../src/offers/adapters/masirah-beach-camp-sur-masirah.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/masirah-beach-camp-sur-masirah');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('mbc: /locations/ names Masirah Beach Camp as the summer base with on-site accommodation', () => {
  const b = parseMbcBase(read('kitesurfoman.com_locations_.'));
  assert.equal(b.season, 'Summer Season (May - August)');
  assert.equal(b.location, 'Sur Masirah');
  assert.equal(b.base, 'Masirah Beach Camp');
  assert.ok(b.facts.includes('Accommodation available on-site'));
  assert.ok(b.facts.includes('Equipment rental available during summer'));
});

test('mbc: /masirah-island/ camp sentences', () => {
  const c = parseMbcCamp(read('kitesurfoman.com_masirah-island_.'));
  assert.match(c.operates ?? '', /operates out of the Masirah Beach Camp from May to September offering several accommodation options for every budget\. Bookings can be made through our contact page\./);
  assert.match(c.travel ?? '', /2 minute walk to the nearest beach/);
  assert.match(c.access ?? '', /4-5 hour drive to Shannah Port and a 1 hour ferry ride/);
});

test('mbc: /masirah-iko/ (2026) stats and services', () => {
  const i = parseMbcIko(read('kitesurfoman.com_masirah-iko_.'));
  assert.deepEqual(i.stats, ['May-Sep: Main wind season (Khareef)', '20-40kt: Steady southerly wind', '24-38°C: Cool while the mainland bakes', 'Flat + wave: Lagoon west, ocean east']);
  assert.equal(i.services.length, 5);
  assert.match(i.services[4], /^Full packages - GET can arrange accommodation, transfers and the whole Masirah trip\.$/);
  assert.equal(i.spot.length, 4);
});

test('mbc: IKO course prices in OMR', () => {
  assert.deepEqual(parseMbcCourses(read('kitesurfoman.com_iko-pro-centre_.')).map(c => [c.name, c.duration, c.level, c.privatePrice, c.groupPrice]), [
    ['Discovery course', '1 hour', 'IKO Level 1', 35, 45],
    ['Intermediate course', '4 hours', 'IKO Level 2', 100, 130],
    ['Independent course', '8-9 hours', 'IKO Level 3', 260, 290],
    ['Advanced course', '10 hours', 'IKO Level 4', 310, 360],
  ]);
});

test('mbc: no prices on the site -> no slots (price on request)', async () => {
  const slots = await masirahBeachCampSurMasirah.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('mbc: content', async () => {
  const c = await masirahBeachCampSurMasirah.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'Masirah Beach Camp');
  assert.equal(c.country, 'Oman');
  assert.equal(c.spot, 'Sur Masirah, Masirah Island');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /summer base of GET Kitesurf Oman/);
  assert.match(c.summary, /stays are on request/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.ok(c.optionalServices.includes('IKO Discovery course (approx. 1 hour, IKO Level 1): OMR 35 private / OMR 45 for 2 persons'));
  assert.deepEqual(c.rooms, []);
  assert.equal(c.imageUrls.length, 5);
  assert.ok(c.imageUrls.every(u => /kitesurfoman\.com\/wp-content\/uploads\/20(21|22)\//.test(u)));
  assert.match(c.sourceText ?? '', /Base: Masirah Beach Camp/);
});
