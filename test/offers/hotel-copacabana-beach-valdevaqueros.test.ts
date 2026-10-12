// Hotel Copacabana Beach (Valdevaqueros): replays the English home, rooms, services and gallery pages recorded
// 2026-10-12 (scripts except JSON-LD, styles without background images, SVGs and srcsets trimmed). The year-less
// from-price window is anchored on the rooms page's dateModified (2026-03-05); today is pinned to the recording day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hotelCopacabanaBeachValdevaqueros, buildCopaSlots, copaBand, copaModified, fetchCopaSlots, parseCopaCommon, parseCopaRooms,
  parseCopaWindow,
} from '../../src/offers/adapters/hotel-copacabana-beach-valdevaqueros.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hotel-copacabana-beach-valdevaqueros');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const TODAY = '2026-10-12';
const roomsPage = read('hotel.copacabanatarifa.com_en_rooms_.');

test('copa: room cards with from-prices', () => {
  const rooms = parseCopaRooms(roomsPage);
  assert.equal(rooms.length, 10);
  assert.deepEqual(rooms.map(r => [r.name, r.maxPersons, r.fromPrice]), [
    ['Single Room with Terrace', 1, 38], ['Standard Double Room', 2, 42], ['Family Room for 4 people', 4, 73],
    ['Double Room with Terrace', 2, 39], ['Top Floor Double Room with Sea View', 2, 54], ['Large Double Bedroom with Patio and Sofa', 2, 50],
    ['Large Double Room', 2, 48], ['Triple Room (1 double bed + 1 single bed )', 3, 61], ['Double Room with Private Patio', 2, 45],
    ['Double Room (2 Beds) with Terrace', 2, 39],
  ]);
  assert.deepEqual(rooms[0].window, { d1: 31, m1: 5, d2: 30, m2: 11 });
  assert.equal(rooms[0].priceText, 'From 38€ per night (from 31 May to 30 November)');
  assert.match(rooms[0].image ?? '', /^https:\/\/images\.mirai\.com\/INFOROOMS\/100378668\/.+_large\.jpg$/);
  assert.deepEqual(parseCopaCommon(roomsPage), {
    rooms: 34, types: 10,
    features: ['Refrigerator', 'Terrace', 'Television', 'Air conditioning', 'Free safe', 'Free Wi-Fi Internet', 'Tiled floor',
      '24h luggage storage', 'Sound-proof windows', 'Toiletries', 'Shower', 'Hairdryer'],
  });
});

test('copa: year-less window anchored on the page edit', () => {
  assert.equal(copaModified(roomsPage), '2026-03-05');
  const w = parseCopaWindow('0 people from 31 May to 30 November')!;
  assert.deepEqual(copaBand(w, '2026-03-05'), { start: '2026-05-31', end: '2026-11-30' });
  assert.deepEqual(copaBand(w, '2026-12-01'), { start: '2027-05-31', end: '2027-11-30' });
  assert.deepEqual(buildCopaSlots(parseCopaRooms(roomsPage), '2026-03-05', '2026-12-01'), []); // window passed
});

test('copa: slots = room type x window, from-price per night', async () => {
  const slots = await fetchCopaSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 10);
  assert.ok(slots.every(s => s.startDate === '2026-05-31' && s.endDate === '2026-11-30' && s.currency === 'EUR'
    && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
  assert.deepEqual(slots.find(s => s.key === 'top-floor-double-room-with-sea-view|2026-05-31')!.price, 54);
  assert.equal(Math.min(...slots.map(s => s.price!)), 38);
  assert.deepEqual(notes, []);
});

test('copa: content', async () => {
  const c = await hotelCopacabanaBeachValdevaqueros.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Hotel Copacabana Beach');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Valdevaqueros, Tarifa');
  assert.equal(c.spot, 'Valdevaqueros');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /34 rooms of 10 types for 1 to 4 guests/);
  assert.match(c.summary, /Pata Negra kitesurf school of Live to Fly Tarifa has its base at the hotel/);
  assert.match(c.sourceText ?? '', /School Base: Hotel Copacabana, N-340 km 76, Valdevaqueros Beach/);
  assert.equal(c.rooms.length, 10);
  assert.deepEqual(c.rooms[2].features, ['Max. 4 people', 'From 73€ per night (from 31 May to 30 November)']);
  assert.equal(c.imageUrls.length, 30);
  assert.equal(c.imageUrls[0], 'https://static-resources-elementor.mirai.com/wp-content/uploads/sites/2055/copacabana-gallery4.webp');
  assert.equal(hotelCopacabanaBeachValdevaqueros.confidence, 'medium');
});
