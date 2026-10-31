// Camping Strukkamphuk (Fehmarnsund): replays the site pages and the Compusoft answers recorded 2026-10-14 (pages without
// scripts / styles / srcsets; profile list and price answer trimmed to the fields the parser reads). Slots are built with
// today pinned to the recording day so the sample week (and its fixtures) stays the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingStrukkamphukFehmarnsund, CSK_PORTAL, cskNumbers, cskSeasons, cskUnitName, fetchCskSlots, parseCskBands, parseCskCaravans, parseCskPrices,
} from '../../src/offers/adapters/camping-strukkamphuk-fehmarnsund.js';
import { csobSaturdaySamples, parseCsobList } from '../../src/offers/adapters/hvide-sande-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { roomsWithPrices } from '../../src/offers/ingest.js';
import type { Slot } from '../../src/offers/types.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/camping-strukkamphuk-fehmarnsund');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const incomplete: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: (r: string) => { incomplete.push(r); } };
const TODAY = '2026-10-14';
const prices = read('strukkamphuk.de_angebote-preise_.');

test('strukkamphuk: 2026 season bands, merged season and the one sample week left', () => {
  const bands = parseCskBands(prices);
  assert.equal(bands.length, 5);
  assert.deepEqual(bands[0], { season: 'high', start: '2026-05-13', end: '2026-05-26' });
  assert.deepEqual(cskSeasons(bands), [{ start: '2026-03-27', end: '2026-10-25' }]);
  assert.deepEqual(csobSaturdaySamples(TODAY, cskSeasons(bands), { max: 9 }), ['2026-10-17']);
});

test('strukkamphuk: printed caravan prices and caravan blocks', () => {
  const p = parseCskPrices(prices);
  assert.equal(p.year, 2026);
  assert.deepEqual(p.rows.map(r => [r.model, r.high, r.low]), [
    ['Knaus Sport 550 FSK', 123, 85], ['Knaus Südwind 550 FU', 123, 85], ['Knaus Südwind 500 EU', 123, 85],
    ["Dethleffs c'trend 515 ER", 128, 90], ["Dethleffs c'trend 515FR", 128, 90], ['Knaus Sport 580 QS', 133, 95], ['Deluxe-Wohnwagen', 163, 115],
  ]);
  const c = parseCskCaravans(read('strukkamphuk.de_mietwohnwagen_.'));
  assert.equal(c.length, 8);
  assert.equal(c.reduce((n, x) => n + x.numbers.length, 0), 22);
  assert.deepEqual(cskNumbers('6+7, 12-14'), [6, 7, 12, 13, 14]);
});

test('strukkamphuk: unit filter keeps caravans and caravan offers, drops pitches', () => {
  const list = parseCsobList(read('v3.onlinebooking.dk_profile_getCSProfileListViewModel'));
  const units = list.filter(CSK_PORTAL.isUnit).map(p => p.title);
  assert.ok(units.includes('Mietwohnwagen Knaus Sport 580 QS') && units.includes('Miewohnwagen Knaus Südwind 500 EU'));
  assert.ok(units.every(t => !/Stellplatz/.test(t)));
  assert.equal(cskUnitName('Angebot Herbstliebe Mietwohnwagen 1-4, 17-20 7 Nächte'), 'Rental caravan no. 1-4, 17-20 (Herbstliebe offer, 7 nights)');
});

test('strukkamphuk: slots = caravan profile x sample week, EUR per caravan for 7 nights', async () => {
  const slots = await fetchCskSlots(TODAY, ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(incomplete, []);
  assert.equal(ok.length, 1); // regular caravans all taken in the last 2026 week -> left out, not "sold out"
  const s = ok[0];
  assert.deepEqual([s.key, s.unit, s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.packageNights, s.availability, s.spotsLeft], [
    'angebot-herbstliebe-mietwohnwagen-1-4-17-20-7-nachte|2026-10-17', 'Rental caravan no. 1-4, 17-20 (Herbstliebe offer, 7 nights)',
    '2026-10-17', '2026-10-23', 586, 'EUR', 'package', 7, 'limited', 1,
  ]);
  assert.ok(notes.some(n => /not bookable in any sampled week/.test(n)));
});

test('strukkamphuk: content', async () => {
  const c = await campingStrukkamphukFehmarnsund.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Camping Strukkamphuk');
  assert.equal(c.region, 'Fehmarnsund, Fehmarn');
  assert.deepEqual(c.spotCoords, { lat: 54.411847, lng: 11.098098 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /rents 22 fully equipped caravans/);
  assert.match(c.summary, /from EUR 85 \(low season\) to EUR 163 \(high season\)/);
  assert.match(c.sourceText ?? '', /Kitesurf-Schule – beide mit SUP-Verleih/);
  assert.equal(c.rooms.length, 8);
  assert.equal(c.rooms[0].description, 'Caravans no. 1-4 with a fixed awning (kitchen unit and seating) and terrace; sleeps 5 (2 adults and 3 children).');
  assert.ok(c.imageUrls.length >= 12 && c.imageUrls.every(u => /^https:\/\/strukkamphuk\.de\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
});

test('strukkamphuk: after the season the printed per-night table prices every caravan (Aaron 2026-10-31)', async () => {
  const past: Slot[] = [];
  const after = '2026-10-31';
  const slots = await fetchCskSlots(after, { ...ctx, lastPublished: p => { past.push(...p); } });
  assert.deepEqual(slots, []); // no sample week left, every 2026 band is over
  assert.deepEqual(checkSlots(past).problems, []);
  const knaus = past.filter(s => s.room === 'Rental caravan Knaus Sport 580 QS');
  assert.ok(knaus.length >= 2 && knaus.every(s => s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.currency === 'EUR'));
  assert.deepEqual([...new Set(knaus.map(s => s.price))].sort(), [133, 95]);
  const rows = roomsWithPrices(await campingStrukkamphukFehmarnsund.fetchContent(ctx), slots, after, past);
  assert.deepEqual(rows.map(r => [r.name, r.price_from, r.price_from_is_minimum]), [
    ['Rental caravan Knaus Sport 580 QS', 95, true],
    ['Rental caravan Knaus Sport 550 FSK', 85, true],
    ['Rental caravan Knaus Südwind 550 UF', 85, true],
    ['Rental caravan Knaus Südwind 500 EU', 85, true],
    ['Rental caravan Dethleffs c’trend 515 ER', 90, true],
    ['Rental caravan Dethleffs c’trend 515 FR', 90, true],
    ['Rental caravan Deluxe for 4', 115, true],
    ['Rental caravan Deluxe for 5', 115, true],
  ]);
});
