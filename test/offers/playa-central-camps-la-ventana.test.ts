// Playa Central Windsports camps (kiting camps only), La Ventana: replays the Squarespace pages recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  playaCentralCampsLaVentana, buildPcSlots, parsePcCampList, parsePcProduct, pcAvailability, pcCoords, pcRoomName,
} from '../../src/offers/adapters/playa-central-camps-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/playa-central-camps-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const campsPage = read('www.playacentralkiteboarding.com_windsport-camps.');
const beginner = read('www.playacentralkiteboarding.com_school_p_kiteboarding-camps-la-ventana.');

test('playa-central: camps page lists 5 camps, 3 of them with kiting', () => {
  const list = parsePcCampList(campsPage);
  assert.equal(list.length, 5);
  assert.deepEqual(list.filter(c => c.kiting).map(c => [c.name, c.url?.replace(/^.*\/p\//, '')]), [
    ['Beginner Kiteboarding Camp', 'kiteboarding-camps-la-ventana'],
    ["Women's Wellness and Windsports Camp", 'womens-windsports-wellness-camp-laventana'],
    ['Adventure Wing & Kite Foil Camp', 'adventure-foiling-camp-la-ventana'],
  ]);
  assert.ok(list.filter(c => !c.kiting).every(c => /wingfoil|downwinder/i.test(c.name)));
  assert.deepEqual(pcCoords(campsPage), { lat: 24.053442095773136, lng: -109.98931685057525 });
});

test('playa-central: product JSON = variants with price and stock', () => {
  const p = parsePcProduct(beginner, 'https://x/p/kiteboarding-camps-la-ventana')!;
  assert.match(p.title, /JAN\. 10 -16, 2027/);
  assert.deepEqual(p.variants.map(v => [v.dates, v.room, v.price, v.currency, v.qty, v.soldOut]), [
    ['January 10 - 16', 'Private Queen Bedroom', 2899, 'USD', 4, false],
    ['January 10 - 16', 'Double Room', 3099, 'USD', 1, false],
    ['January 10 - 16', 'Deluxe Suite', 3299, 'USD', 1, false],
  ]);
  assert.equal(p.images.length, 17);
  assert.equal(pcRoomName('Private Queen'), 'Private Queen Bedroom');
});

test('playa-central: stock -> availability', () => {
  const v = { dates: 'x', room: 'y', price: 1, currency: 'USD', unlimited: false, soldOut: false };
  assert.equal(pcAvailability({ ...v, qty: 4 }).availability, 'available');
  assert.deepEqual(pcAvailability({ ...v, qty: 1 }), { availability: 'limited', text: '1 left', spotsLeft: 1 });
  assert.equal(pcAvailability({ ...v, qty: 0 }).availability, 'sold_out');
  assert.equal(pcAvailability({ ...v, qty: 3, soldOut: true }).availability, 'sold_out');
});

test('playa-central: slots = kiting camp x room type', async () => {
  const slots = await playaCentralCampsLaVentana.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  if (new Date().toISOString().slice(0, 10) > '2027-01-16') return; // weeks drop off once past
  assert.equal(slots.length, 9);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.availability, s.spotsLeft]), [
    ['beginner-kiteboarding-camp|private-queen-bedroom|2027-01-10', 2899, 'available', 4],
    ['beginner-kiteboarding-camp|double-room|2027-01-10', 3099, 'limited', 1],
    ['beginner-kiteboarding-camp|deluxe-suite|2027-01-10', 3299, 'limited', 1],
    ['women-s-wellness-and-windsports-camp|deluxe-suite|2027-02-12', 3599, 'limited', 1],
    ['women-s-wellness-and-windsports-camp|double-room|2027-02-12', 3399, 'limited', 1],
    ['women-s-wellness-and-windsports-camp|private-queen-bedroom|2027-02-12', 3199, 'available', 4],
    ['adventure-wing-kite-foil-camp|private-queen-bedroom|2027-03-07', 2599, 'available', 4],
    ['adventure-wing-kite-foil-camp|double-room|2027-03-07', 2799, 'limited', 1],
    ['adventure-wing-kite-foil-camp|deluxe-suite|2027-03-07', 2999, 'limited', 1],
  ]);
  const s = slots[6];
  assert.deepEqual([s.startDate, s.endDate, s.unit, s.currency, s.priceUnit, s.priceBasis, s.occupancy],
    ['2027-03-07', '2027-03-13', 'Adventure Wing & Kite Foil Camp · Private Queen Bedroom', 'USD', 'package', 'person', 1]);
});

test('playa-central: past camps are dropped', () => {
  const p = parsePcProduct(beginner, 'u')!;
  const item = parsePcCampList(campsPage)[2];
  assert.equal(buildPcSlots([{ item, product: p }], '2026-10-14').length, 3);
  assert.equal(buildPcSlots([{ item, product: p }], '2027-01-17').length, 0);
});

test('playa-central: content', async () => {
  const c = await playaCentralCampsLaVentana.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  assert.equal(c.region, 'La Ventana, Baja California Sur');
  assert.match(c.summary, /Beginner Kiteboarding Camp \(Jan 10-16, 2027\)/);
  assert.match(c.summary, /USD 2,599 to 3,599 per person/);
  assert.ok(!/Wingfoil Camps|Downwinder Foiling Camp/.test(c.summary));
  assert.deepEqual(c.rooms.map(r => r.name), ['Private Queen Bedroom', 'Double Room', 'Deluxe Suite']);
  assert.ok(c.includedServices.includes('Daily yoga'));
  assert.ok(c.optionalServices.includes('Non-riding companion sharing a room: USD 1,899'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => !/WITH\+DATES/.test(u)));
});
