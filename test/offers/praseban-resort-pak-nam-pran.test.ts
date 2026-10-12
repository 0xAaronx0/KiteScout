// Praseban Resort (Pak Nam Pran, Pranburi, Thailand): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  prasebanResortPakNamPran, parsePsbAddress, parsePsbCoords, parsePsbRoom, parsePsbRoomLinks, psbImages,
} from '../../src/offers/adapters/praseban-resort-pak-nam-pran.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/praseban-resort-pak-nam-pran');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('praseban: /rooms/ links the 7 room types', () => {
  const links = parsePsbRoomLinks(read('prasebanresort.com_rooms_.'));
  assert.deepEqual(links.map(l => l.slug), ['maarataar-deluxe', 'sawanya', 'seaview-suite', 'praseban-ocean', 'minntra-beach-front', 'narin-tara-family', 'two-bedroom-villa']);
});

test('praseban: room page (description, room information, amenities)', () => {
  const r = parsePsbRoom(read('prasebanresort.com_rooms_two-bedroom-villa_.'), 'two-bedroom-villa');
  assert.equal(r.name, 'Two Bedroom Villa');
  assert.match(r.description ?? '', /private two-storey villa/);
  assert.deepEqual(r.info, ['Room Size: 145 SQM.', 'Two Bedroom', '2 King Beds', 'Floor: Ground floor & Upper Floor']);
  assert.equal(r.amenities[0], 'Outdoor Spa Bath');
  assert.ok(r.amenities.includes('Complimentary WI-FI'));
});

test('praseban: map pin, address, image dedupe', () => {
  assert.deepEqual(parsePsbCoords(read('prasebanresort.com_.')), { lat: 12.3482028, lng: 99.9973775 });
  assert.equal(parsePsbAddress(read('prasebanresort.com_.')), '173 Moo 4 Paknampran, Pranburi, Prachuab-kiri khan 77220, Thailand');
  assert.deepEqual(psbImages([
    'https://x/a/DSC1-1024x683.jpg.webp', 'https://x/a/DSC1-2048x1365.jpg.webp', 'https://x/a/DSC1.jpg',
    'https://x/a/DSC2-scaled-e1692324308993.jpg', 'https://x/a/DSC2.jpg', 'https://x/a/pexels-1.jpg', 'https://x/a/praseban.png',
  ]), ['https://x/a/DSC1.jpg', 'https://x/a/DSC2-scaled-e1692324308993.jpg']);
});

test('praseban: no prices on the site -> no slots, no request', async () => {
  const slots = await prasebanResortPakNamPran.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('praseban: content', async () => {
  const c = await prasebanResortPakNamPran.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Praseban Resort');
  assert.equal(c.country, 'Thailand');
  assert.equal(c.spot, 'Pak Nam Pran, Pranburi');
  assert.equal(c.rooms.length, 7);
  assert.ok(c.rooms.find(r => r.name === 'Sawanya')!.features.includes('Room Size: 42 SQM.'));
  assert.match(c.summary, /14 Thai-Balinese style rooms/);
  assert.match(c.summary, /Kanang Sari restaurant/);
  assert.match(c.summary, /local schools near the resort/);
  assert.match(c.summary, /February to April, which the resort calls the best season/);
  assert.equal(c.kiteLessons, true);
  assert.ok(c.optionalServices.includes('Monthly stay offer (minimum 30 nights, daily breakfast, housekeeping 3 times a week)'));
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => !/pexels-|praseban\.png|FavLogo/i.test(u)));
});
