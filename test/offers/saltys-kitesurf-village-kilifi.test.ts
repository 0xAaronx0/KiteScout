// Salty's Kitesurf Village (Kilifi, Kenya): replays the Squarespace pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped) and twelve Sirvoy sample stays recorded 2026-10-14 (results pages cut down to the
// room-type data, room cards, currency and the engine notice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  saltysKitesurfVillageKilifi, buildSkvEngineSlots, buildSkvSlots, fetchSkvSample, fetchSkvSlots, parseSkvPin, parseSkvRooms,
  skvResultsUrl, skvSampleStays, skvWidgetBody,
} from '../../src/offers/adapters/saltys-kitesurf-village-kilifi.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/saltys-kitesurf-village-kilifi');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-14';
const roomsHtml = read('saltyskitesurf.com_saltys-accommodation.');

test('saltys: room cards with single / double nightly prices', () => {
  assert.deepEqual(parseSkvRooms(roomsHtml).map(r => [r.name, r.single, r.double, r.currency, r.from]), [
    ['Cottage Superior Suite Top Floor', 110, 143, 'USD', true],
    ['Cottage Superior Suite', 110, 143, 'USD', true],
    ['Cottage Double Ensuite', 72, 94, 'USD', false],
    ['Cottage King Ensuite', 88, 116, 'USD', true],
    ['King Ensuite', 91, 121, 'USD', true],
    ['Superior Suite', 103, 140, 'USD', true],
    ['King Room', 53, 70, 'USD', true],
    ['Surfers Economy Room', 39, 50, 'USD', false],
  ]);
});

test('saltys: fallback slots = printed room x 1/2 guests, USD per room per night, no dates, unknown availability', async () => {
  // no Sirvoy fixture exists for 2028 samples: every sample fails, so the printed room cards are the slots
  const notes: string[] = []; const missing: string[] = [];
  const slots = await fetchSkvSlots({ note: n => notes.push(n), incomplete: r => missing.push(r) }, '2028-01-01');
  assert.equal(missing.length, 12);
  assert.match(notes[0], /no priced room type in 0 sample/);
  assert.deepEqual(slots, buildSkvSlots(parseSkvRooms(roomsHtml)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 16);
  assert.deepEqual(slots.slice(4, 6).map(s => [s.key, s.price, s.occupancy]), [['cottage-double-ensuite-1p', 72, 1], ['cottage-double-ensuite-2p', 94, 2]]);
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('saltys: one 7-night Sirvoy sample per month from the 2nd Saturday, widget body as the site sends it', () => {
  const stays = skvSampleStays(TODAY);
  assert.equal(stays.length, 12);
  assert.deepEqual(stays.map(s => s.checkIn), ['2026-10-17', '2026-11-14', '2026-12-12', '2027-01-09', '2027-02-13', '2027-03-13',
    '2027-04-10', '2027-05-08', '2027-06-12', '2027-07-10', '2027-08-14', '2027-09-11']);
  assert.equal(stays[0].checkOut, '2026-10-24');
  assert.equal(skvSampleStays('2026-10-31')[0].checkIn, '2026-11-14'); // no Saturday left in October
  const body = JSON.parse(skvWidgetBody('2026-11-14', '2026-11-21'));
  assert.deepEqual([body.form_id, body.widget, body.adults, body.check_in, body.check_out, body.target, body.host_page_url],
    ['5d95f3e47432e', 'normal', '2', '2026-11-14', '2026-11-21', 'results', 'https://saltyskitesurfvillage.stay.at/']);
  assert.equal(skvResultsUrl('{"status":"ok","t":"abc","html":"<iframe src=\\"https://secured.sirvoy.com/engine/book_results?t=abc&amp;id=5d95f3e47432e&amp;container_id=sbw_widget_1\\">"}'),
    'https://secured.sirvoy.com/engine/book_results?t=abc&id=5d95f3e47432e&container_id=sbw_widget_1');
  assert.equal(skvResultsUrl('{"status":"error"}'), null);
});

test('saltys: Sirvoy results -> room types with rates and free units, or the engine notice', async () => {
  const nov = await fetchSkvSample('2026-11-14', '2026-11-21');
  assert.equal(nov.notice, null);
  assert.equal(nov.currency, 'USD');
  assert.deepEqual(nov.types.map(t => [t.name, t.rates[2], t.freeUnits]), [
    ['Cottage King Ensuite', 78.82, 1], ['Economy Double Room', 42.38, 4], ['King Ensuite', 82.21, 1], ['King Room', 59.33, 1], ['Superior Suite', 94.92, 1],
  ]);
  assert.ok(nov.cards.some(c => c.name === 'Economy Double Room' && /private courtyard/.test(c.description ?? '')));
  const dec = await fetchSkvSample('2026-12-12', '2026-12-19');
  assert.deepEqual(dec.notice, { key: 'not_enough_beds1', text: 'No selection available for chosen dates/length of stay/number of guests. Please make another choice, or contact us via email/phone.' });
  assert.deepEqual(dec.types, []);
});

test('saltys: engine slots = month bands per room type; a refused sample only marks its own nights', async () => {
  const slots = await fetchSkvSlots(ctx, TODAY);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 81);
  const count = (a: string) => slots.filter(s => s.availability === a).length;
  assert.deepEqual([count('available'), count('limited'), count('sold_out'), count('unknown')], [4, 25, 16, 36]);
  const king = slots.filter(s => s.unit === 'King Room').map(s => [s.startDate, s.endDate, s.price, s.availability, s.spotsLeft]);
  assert.deepEqual(king, [
    ['2026-10-14', '2026-10-16', null, 'unknown', null],
    ['2026-10-17', '2026-10-23', null, 'sold_out', null],
    ['2026-10-24', '2026-10-31', null, 'unknown', null],
    ['2026-11-01', '2026-11-30', 59.33, 'limited', 1],
    ['2026-12-01', '2026-12-11', null, 'unknown', null],
    ['2026-12-12', '2026-12-18', null, 'sold_out', null],
    ['2026-12-19', '2026-12-31', null, 'unknown', null],
    ['2027-01-01', '2027-02-28', 82.21, 'limited', 2],
    ['2027-03-01', '2027-03-31', 76.03, 'limited', 2],
    ['2027-04-01', '2027-09-30', 75, 'limited', 2],
  ]);
  const eco = slots.find(s => s.key === 'economy-double-room|2027-04-01')!;
  assert.deepEqual([eco.price, eco.currency, eco.priceUnit, eco.priceBasis, eco.occupancy, eco.availability, eco.endDate],
    [42, 'USD', 'per_night', 'room', 2, 'available', '2027-09-30']);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 42);
  // a type missing from an open sample is 'unknown' without a price
  const top = slots.find(s => s.key === 'cottage-superior-suite-top-floor|2026-11-01')!;
  assert.deepEqual([top.availability, top.price], ['unknown', null]);
  assert.deepEqual(slots, buildSkvEngineSlots(await Promise.all(skvSampleStays(TODAY).map(s => fetchSkvSample(s.checkIn, s.checkOut))), TODAY));
  assert.equal(saltysKitesurfVillageKilifi.liveAvailability, true);
  assert.equal(saltysKitesurfVillageKilifi.slotMethod, 'booking_engine');
});

test('saltys: map pin from the contact page', () => {
  assert.deepEqual(parseSkvPin(read('saltyskitesurf.com_contactus.')), { lat: -3.6052648, lng: 39.8817229 });
});

test('saltys: content', async () => {
  const c = await saltysKitesurfVillageKilifi.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, "Salty's Kitesurf Village");
  assert.equal(c.country, 'Kenya');
  assert.deepEqual(c.spotCoords, { lat: -3.6052648, lng: 39.8817229 });
  assert.match(c.summary, /from USD 50 per night for two \(Surfers Economy Room\)/);
  assert.match(c.summary, /Kaskazi \(December to March, 13-18 knots\) and Kuzi \(May to October, 17-31 knots\)/);
  assert.equal(c.rooms.length, 8);
  assert.ok(c.optionalServices.includes('Private kite 7h course: USD 460'));
  assert.ok(c.optionalServices.some(s => /^Classic Kite Getaway .*: 6 Days \/ 5 Nights, from USD 865 per person/.test(s)));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://images.squarespace-cdn.com/content/') && !u.includes('?')));
});

test('saltys: every room type has the slideshow under its heading, /kitecenter gives the kite photos, all inside the first 24', async () => {
  const c = await saltysKitesurfVillageKilifi.fetchContent(ctx);
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0]), [
    ['Cottage Superior Suite Top Floor', 5], ['Cottage Superior Suite', 9], ['Cottage Double Ensuite', 7],
    ['Cottage King Ensuite', 31], ['King Ensuite', 5], ['Superior Suite', 13], ['King Room', 5], ['Surfers Economy Room', 16],
  ]);
  // first slide of each slideshow (upload ids tell same-named files apart: "Copy of 1 1.jpg" is in two rooms)
  assert.deepEqual(c.rooms.map(r => r.imageUrls![0].split('/').slice(-2).join('/')), [
    '1742559957467-O1UKTKYK4P0SDTT2959M/1+48.jpg',
    '1742560937791-MO75JL08M8BEMGZ2ZB9S/Copy+of+1+23.jpg',
    '1742561554460-FXL0FW0CQLH09TH6LGPD/Copy+of+1+1.jpg',
    '1742562280028-SR38AOY9IT8C5ZYILHT9/Copy+of+1+70.jpg',
    '1759225224583-GRV1DC0A5CRJ7U2IG3BX/IMG_2567.JPG',
    '1755073818560-SHI9QQQ6WXI9FCK9ZCPJ/IMG_2058.JPG',
    '1742563499086-GL1BIL1E1WCRV8LFYVJJ/Copy+of+1+1.jpg',
    '1742564822492-NP67XDORFOVC27Q9A89Y/Copy+of+1+74.jpg',
  ]);
  const all = c.rooms.flatMap(r => r.imageUrls!);
  assert.equal(new Set(all).size, all.length); // no photo in two rooms
  assert.ok(all.every(u => u.startsWith('https://images.squarespace-cdn.com/content/v1/5cda706c7a1fbd52c62a5572/') && !u.includes('?')));

  assert.equal(c.spotImageUrls?.length, 19);
  assert.match(c.spotImageUrls![0], /\/social\+media-0041\.jpg$/);
  assert.ok(c.spotImageUrls!.some(u => /\/G77A7460-2\.jpg$/.test(u))); // IKO course gallery
  assert.ok(c.spotImageUrls!.every(u => u.startsWith('https://images.squarespace-cdn.com/content/') && !/\.png$|\?/.test(u)));

  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
