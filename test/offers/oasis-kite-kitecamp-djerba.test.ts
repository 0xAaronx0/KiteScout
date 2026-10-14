// Oasis Kite - Kitecamp Djerba: replays the camp page, Impressum, Leão category page and the six kite products'
// event lists recorded 2026-10-14 (HTML scripts/styles trimmed, reCAPTCHA site key redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  oasisKiteKitecampDjerba as adapter, buildOkSlots, decodeShortPlusCode, eventAvailability, okImages, okLines,
  okSeasonWord, parseLeaoEvents, parseOkCategory, parseOkImpressum, parseOkPackages, parseOkPageWeeks,
  parseOkRiderPlusRooms, type LeaoEvent,
} from '../../src/offers/adapters/oasis-kite-kitecamp-djerba.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { todayIso } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/oasis-kite-kitecamp-djerba');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const camp = read('oasiskite.com_kitecamp_.');
const category = read('www.myleao.com_selfservice_category_2132.');
const events = (id: number) => parseLeaoEvents(read(`www.myleao.com_api_event_product_${id}_lang_de.`));

test('oasis: short plus code of the Impressum, recovered on Djerba', () => {
  const imp = parseOkImpressum(read('oasiskite.com_impressum_.'));
  assert.equal(imp.plusCode, 'Q3J2+XC');
  assert.equal(imp.email, 'info@oasiskite.com');
  assert.match(imp.tunisia ?? '', /^Midoun, Djerba Midun, Tunesien, Q3J2\+XC El Haddad$/);
  assert.deepEqual(decodeShortPlusCode('Q3J2+XC', { lat: 33.8, lng: 10.9 }), { lat: 33.782438, lng: 11.051063 });
  assert.deepEqual(decodeShortPlusCode('Q3J2+XC', { lat: 33.6, lng: 11.3 }), { lat: 33.782438, lng: 11.051063 }, 'same cell from another point on Djerba');
  assert.equal(decodeShortPlusCode('Q3J2XC', { lat: 33.8, lng: 10.9 }), null);
});

test('oasis: Leão category = 6 kite products + 2 yoga products (skipped)', () => {
  const products = parseOkCategory(category);
  assert.deepEqual(products.map(p => [p.id, p.pkg, p.room, p.price]), [
    [32193, 'beginner-advanced', 'double', 1090], [32296, 'beginner-advanced', 'single', 1290],
    [32194, 'rider', 'double', 790], [32297, 'rider', 'single', 990],
    [43791, null, null, 60], [43792, null, 'double', 790],
    [46371, 'rider-plus', 'double', 990], [46372, 'rider-plus', 'single', 1190],
  ]);
});

test('oasis: event availability from places left', () => {
  const ev = (max: number, taken: number, msg: string, bookable = '1') =>
    ({ maxParticipants: String(max), participants: String(taken), availMsg: msg, bookable } as unknown as LeaoEvent);
  assert.deepEqual(eventAvailability(ev(1, 1, 'Leider ausgebucht.')), { availability: 'sold_out', spotsLeft: 0, text: 'Leider ausgebucht.' });
  assert.deepEqual(eventAvailability(ev(4, 2, 'Nur noch 2 Plätze frei.')), { availability: 'limited', spotsLeft: 2, text: 'Nur noch 2 Plätze frei.' });
  assert.deepEqual(eventAvailability(ev(4, 0, 'Nur noch 4 Plätze frei.')), { availability: 'available', spotsLeft: 4, text: 'Nur noch 4 Plätze frei.' });
  assert.equal(eventAvailability(ev(4, 0, 'x', '0')).availability, 'closed');
});

test('oasis: slots = package x room x camp week from the engine (as of 2026-10-14)', () => {
  const products = parseOkCategory(category);
  const map = new Map(products.filter(p => p.pkg).map(p => [p.id, events(p.id)]));
  const slots = buildOkSlots(products, map, '2026-10-14');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 38);
  const by = (k: string) => slots.find(s => s.key === k)!;
  assert.deepEqual(
    [by('beginner-advanced-double|2027-04-17').availability, by('beginner-advanced-double|2027-04-17').spotsLeft, by('beginner-advanced-double|2027-04-17').availabilityText],
    ['sold_out', 0, 'Leider ausgebucht.'],
  );
  const w = by('beginner-advanced-double|2027-04-24');
  assert.deepEqual([w.startDate, w.endDate, w.unit, w.price, w.currency, w.priceUnit, w.priceBasis, w.occupancy, w.packageNights, w.availability, w.spotsLeft],
    ['2027-04-24', '2027-05-01', 'Beginner/Advanced package, double room', 1090, 'EUR', 'package', 'person', 2, 7, 'limited', 2]);
  assert.equal(by('beginner-advanced-double|2027-05-01').availability, 'available');
  assert.deepEqual([by('rider-single|2027-05-29').price, by('rider-single|2027-05-29').occupancy, by('rider-single|2027-05-29').endDate], [990, 1, '2027-06-05']);
  assert.equal(by('rider-plus-single|2027-05-01').price, 1190);
  assert.equal(Math.min(...slots.map(s => s.price!)), 790);
  assert.ok(!slots.some(s => /yoga/i.test(s.unit ?? '')), 'yoga products skipped');
  assert.equal(buildOkSlots(products, map, '2027-05-02').length, 24, 'weeks that started are dropped');
});

test('oasis: fetchSlots replays the engine', async () => {
  const slots = await adapter.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  const products = parseOkCategory(category);
  const map = new Map(products.filter(p => p.pkg).map(p => [p.id, events(p.id)]));
  assert.deepEqual(slots, buildOkSlots(products, map, todayIso()));
});

test('oasis: camp page packages, weeks, Rider PLUS note, photos', () => {
  const lines = okLines(camp);
  assert.deepEqual(parseOkPackages(lines).map(p => [p.name, p.price, p.items.length]), [['Beginner/Advanced', 1090, 8], ['Rider', 790, 8], ['Rider PLUS', 990, 10]]);
  assert.deepEqual(parseOkPageWeeks(lines).map(w => [w.start, w.end, w.note]), [
    ['2027-04-17', '2027-04-24', 'Ausgebucht'], ['2027-04-24', '2027-05-01', 'Nur noch wenige Plätze'],
    ['2027-05-01', '2027-05-08', null], ['2027-05-08', '2027-05-15', null], ['2027-05-15', '2027-05-22', null], ['2027-05-22', '2027-05-29', null],
  ]);
  assert.deepEqual(parseOkRiderPlusRooms(['7 Nächte im Doppelzimmer – 1090 Euro', '7 Nächte im Einzelzimmer – 1290 Euro']), { double: 1090, single: 1290 });
  assert.equal(okSeasonWord('Mitte Juli'), 'mid-July');
  const imgs = okImages(camp);
  assert.equal(imgs.length, 42);
  assert.ok(imgs.includes('https://oasiskite.com/wp-content/uploads/2023/02/OasisKite_Villa9.jpg'));
  assert.ok(!imgs.some(u => /Helen|2024\/02\/4|2026\/01\//.test(u)), 'no testimonial avatars, logo or Sicily event images');
});

test('oasis: content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.title, 'Oasis Kite - Kitecamp Djerba');
  assert.deepEqual([c.country, c.region, c.spot, c.durationDays], ['Tunisia', 'Djerba, Medenine', 'Midoun / El Haddad, Djerba', 8]);
  assert.deepEqual(c.spotCoords, { lat: 33.782438, lng: 11.051063 });
  assert.match(c.summary, /roughly 40 km² lagoon/);
  assert.match(c.summary, /April to mid-July/);
  assert.match(c.summary, /packages start at EUR 790 per person/);
  assert.ok(!/[–—]/.test(c.summary + c.rooms.flatMap(r => r.features).join(' ')), 'no en/em dashes');
  assert.deepEqual(c.rooms.map(r => r.name), ['Double room', 'Single room', 'Triple room']);
  assert.ok(c.rooms[0].features.includes('Air conditioning'));
  assert.match(c.rooms[2].features[0], /triple room \(double room EUR 1,090, single room EUR 1,290\); the booking engine sells Rider PLUS double at EUR 990 and single at EUR 1,190/);
  assert.ok(c.optionalServices.includes('Yoga add-on (4 sessions, the 5th free): EUR 60'));
  assert.equal(c.bookingUrl, 'https://www.myleao.com/selfservice/category/2132');
  assert.equal(c.imageUrls.length, 40);
});
