// WattLodge (Norden / Norddeich): replays the site pages recorded 2026-10-14 (script / style / svg bodies dropped) and the
// 12 Easy-Booking category searches recorded 2026-10-14 (the one non-empty answer trimmed to the fields the parser reads:
// photos, descriptions and CDN paths dropped). Engine slots are built with today pinned to the recording day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  wattlodgeNorden, buildWlEngineSlots, buildWlSlots, fetchWlLiveSlots, fetchWlSample, fetchWlSlots, parseWlNotes, parseWlPackages, parseWlRates,
  parseWlSearch, wlSampleCheckIns, wlSearchBody,
} from '../../src/offers/adapters/wattlodge-norden.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wattlodge-norden');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('wattlodge.de_preise_.');

test('wattlodge: price cards (per person), the Bulli pitch flagged', () => {
  const rates = parseWlRates(prices);
  assert.deepEqual(rates.map(r => [r.name, r.price, r.occupancy, r.pitch]), [
    ['Surfer-Suite Basic', 62, 2, false], ['Surfer-Suite Classic', 65, 2, false], ["Surfer's Hostel", 51, 1, false],
    ['Hütten-Hostel', 39, 1, false], ['Hütten-Suite', 65, 2, false], ['Bulli-Stellplatz', 22, 1, true],
  ]);
  assert.equal(rates[4].meta, 'ab zwei Personen');
  assert.ok(rates[3].features.includes('Bettwäsche einmalig 15 Euro pro Person'));
  const notes = parseWlNotes(prices);
  assert.deepEqual(notes, { perPerson: true, kurtaxe: '3,50', checkIn: '15.00 Uhr und 19.00 Uhr', cancel: '14' });
});

test('wattlodge: kite packages on /sportangebot/', () => {
  assert.deepEqual(parseWlPackages(read('wattlodge.de_sportangebot_.')), { kiteWeekend: 307, kiteWeek: 755 });
});

test('wattlodge: table fallback = room types without dates, EUR per person per night', async () => {
  const slots = await fetchWlSlots();
  assert.deepEqual(slots, buildWlSlots(parseWlRates(prices)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [
    ['surfer-suite-basic', 62, 2], ['surfer-suite-classic', 65, 2], ['surfer-s-hostel', 51, 1], ['hutten-hostel', 39, 1], ['hutten-suite', 65, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('wattlodge: content', async () => {
  const c = await wattlodgeNorden.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'Norden, East Frisia');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /from EUR 39 per person per night/);
  assert.match(c.summary, /kite weekends \(2 nights, 2 days of kitesurfing\) start at EUR 307 per person/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Surfer-Suite Basic', 'Surfer-Suite Classic', "Surfer's Hostel", 'Hütten-Hostel', 'Hütten-Suite']);
  assert.ok(c.optionalServices.includes('Breakfast EUR 14.50 per person (hostel rooms)'));
  assert.ok(c.optionalServices.some(s => /Kite week Monday-Friday: .* from EUR 755 per person/.test(s)));
  assert.match(c.sourceText ?? '', /In unserem Wassersportzentrum, der Surfschule Norddeich/);
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => u.startsWith('https://wattlodge.de/wp-content/uploads/') && !/logo|favicon/i.test(u)));
});

const TODAY = '2026-10-14';

test('wattlodge engine: request shape and sample weeks', () => {
  assert.equal(wlSearchBody('2026-10-17'), 'customerId=10928&numAdults=2&numChildren=0&arrivalDate=2026-10-17&departureDate=2026-10-24&childrenDOB=&localeId=2');
  assert.deepEqual(wlSampleCheckIns(TODAY), [
    '2026-10-17', '2026-11-07', '2026-12-05', '2027-01-02', '2027-02-06', '2027-03-06',
    '2027-04-03', '2027-05-01', '2027-06-05', '2027-07-03', '2027-08-07', '2027-09-04',
  ]);
});

test('wattlodge engine: category answer (camper pitch dropped) and empty answers', async () => {
  const s = await fetchWlSample('2026-10-17');
  assert.equal(s.error, null);
  assert.deepEqual(s.cats.map(c => [c.name, c.free, c.total, c.tax]), [
    ['Zweibettzimmer Standard', 2, 917, 49], ['Doppelzimmer Einfach - Bad extern', 1, 917, 49], ['Doppelzimmer Standard +', 1, 959, 49],
    ['Doppelzimmer Zimmer +', 3, 1015, 49], ['Doppelzimmer Superior', 2, 1141, 49], ['Doppel-/ Familiensuite', 1, 1015, 49],
    ['Hütten-Suite Superior', 1, 1015, 49],
  ]);
  assert.deepEqual([(await fetchWlSample('2026-11-07')).cats, (await fetchWlSample('2026-11-07')).error], [[], 'FrontEndNoResult']);
  assert.equal((await fetchWlSample('2027-06-05')).error, 'FrontEndNoResultNoPrice');
  assert.deepEqual(parseWlSearch('{"catArr":[],"errorMsg":"FrontEndNoResultNoPrice"}', '2027-06-05').cats, []);
  assert.throws(() => parseWlSearch('{"error":"x"}', '2027-06-05'), /without catArr/);
});

test('wattlodge engine: replay 2026-10-14 -> 7 category slots for 17.-24.10.2026', async () => {
  const notes: string[] = [];
  const incomplete: string[] = [];
  const slots = await fetchWlLiveSlots(TODAY, { note: t => { notes.push(t); }, incomplete: t => { incomplete.push(t); } });
  assert.deepEqual(incomplete, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /2026-11-07 FrontEndNoResult, .*2027-09-04 FrontEndNoResultNoPrice/.test(n)));
  assert.deepEqual(slots.map(x => [x.key, x.price, x.availability, x.spotsLeft]), [
    ['zweibettzimmer-standard|2026-10-17', 868, 'available', 2], ['doppelzimmer-einfach-bad-extern|2026-10-17', 868, 'limited', 1],
    ['doppelzimmer-standard|2026-10-17', 910, 'limited', 1], ['doppelzimmer-zimmer|2026-10-17', 966, 'available', 3],
    ['doppelzimmer-superior|2026-10-17', 1092, 'available', 2], ['doppel-familiensuite|2026-10-17', 966, 'limited', 1],
    ['hutten-suite-superior|2026-10-17', 966, 'limited', 1],
  ]);
  const s = slots[0];
  assert.deepEqual([s.unit, s.startDate, s.endDate, s.currency, s.priceUnit, s.packageNights, s.priceBasis, s.occupancy],
    ['Zweibettzimmer Standard', '2026-10-17', '2026-10-23', 'EUR', 'package', 7, 'room', 2]);
  assert.match(s.availabilityText ?? '', /2 free for 7 nights from 2026-10-17 \(2 adults, Frühstück; Kurtaxe EUR 49 extra\)/);
});

test('wattlodge engine: a category missing from a non-empty answer is sold out', () => {
  const cat = (name: string, free: number) => ({ name, minPersons: 1, maxPersons: 2, free, total: 917, tax: 49, catering: null });
  const a = { checkIn: '2027-06-05', nights: 7, adults: 2, error: null, cats: [cat('Hütten-Suite', 2), cat('Doppelzimmer Superior', 1)] };
  const b = { checkIn: '2027-07-03', nights: 7, adults: 2, error: null, cats: [cat('Doppelzimmer Superior', 4)] };
  const closed = { checkIn: '2027-12-04', nights: 7, adults: 2, error: 'FrontEndNoResult', cats: [] };
  assert.deepEqual(buildWlEngineSlots([a, b, closed]).map(x => [x.key, x.price, x.availability]), [
    ['hutten-suite|2027-06-05', 868, 'available'], ['doppelzimmer-superior|2027-06-05', 868, 'limited'],
    ['hutten-suite|2027-07-03', null, 'sold_out'], ['doppelzimmer-superior|2027-07-03', 868, 'available'],
  ]);
});

test('wattlodge: adapter flags', () => {
  assert.equal(wattlodgeNorden.slotMethod, 'booking_engine');
  assert.equal(wattlodgeNorden.liveAvailability, true);
  assert.equal(wattlodgeNorden.instantBooking, true);
});
