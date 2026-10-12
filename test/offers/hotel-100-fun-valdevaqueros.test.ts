// Hotel 100% Fun (Valdevaqueros): replays the English home, kitesurf, FAQ and contact pages and the 7 room pages
// recorded 2026-10-12 (scripts except JSON-LD, styles without background images, SVGs and srcsets trimmed). The site
// prints no prices; neither the WP Hotel Booking REST endpoint (prices 0) nor SiteMinder is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hotel100FunValdevaqueros, FUN_ROOM_URLS, parseFunCoords, parseFunFaq, parseFunRoom,
} from '../../src/offers/adapters/hotel-100-fun-valdevaqueros.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hotel-100-fun-valdevaqueros');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('fun: room page -> name, first paragraph, features, gallery originals', () => {
  const r = parseFunRoom(read('100x100fun.com_en_room_balinese-suite_.'), FUN_ROOM_URLS[1])!;
  assert.equal(r.name, 'Balinese Suite');
  assert.match(r.description ?? '', /^Let yourself be carried away by the magic of our Balinese Suite/);
  assert.deepEqual(r.features, [
    ['Approximate area', '30 m²'], ['Bed size', 'Two 180 cm beds'], ['Capacity', 'Maximum 2 adults'], ['Views', 'Garden'],
    ['Extras', 'Outdoor bathtub + Shower'],
  ]);
  assert.deepEqual(r.images, [7072, 7081, 7135, 7136, 7163].map(n => `https://100x100fun.com/wp-content/uploads/2025/03/DSC${n}.jpg`));
  assert.equal(parseFunRoom('<html><body><h1>x</h1></body></html>', FUN_ROOM_URLS[0]), null);
});

test('fun: FAQ toggles and the map embed', () => {
  const faq = parseFunFaq(read('100x100fun.com_en_faqs_.'));
  assert.equal(faq.length, 15);
  assert.match(faq.find(f => /own kitesurf school/.test(f.q))!.a, /^No\. Hotel 100% Fun does not have its own kitesurf school, but we can recommend the best school near the hotel/);
  assert.match(faq.find(f => /breakfast included/.test(f.q))!.a, /^Yes\. Breakfast is included/);
  assert.deepEqual(parseFunCoords(read('100x100fun.com_en_contact_.')), { lat: 36.06681800869579, lng: -5.679978923728665 });
});

test('fun: no prices on the site -> no slots', async () => {
  const slots = await hotel100FunValdevaqueros.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes.join(' '), /price on request/);
});

test('fun: content', async () => {
  const c = await hotel100FunValdevaqueros.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Hotel 100% Fun');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Valdevaqueros, Tarifa');
  assert.equal(c.spot, 'Valdevaqueros');
  assert.deepEqual(c.spotCoords, { lat: 36.06681800869579, lng: -5.679978923728665 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /a few metres from Valdevaqueros beach/);
  assert.match(c.summary, /7 room types .* breakfast is included and pets are not allowed/);
  assert.match(c.summary, /runs no kite school of its own but recommends a school near the hotel/);
  assert.deepEqual(c.rooms.map(r => r.name), [
    'Garden View Suite', 'Balinese Suite', 'Quadruple Room', 'Suite with Sea View', 'Junior Suite with Sea View',
    'Superior Double Room', 'Standard Double Room',
  ]);
  assert.ok(c.rooms[6].features.includes('Approximate area: 16.5 m²'));
  assert.deepEqual(c.includedServices, ['Breakfast', 'Swimming pool', 'Free Wi-Fi', 'Parking', 'Electric vehicle charger']);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/100x100fun\.com\/wp-content\/uploads\/.+\.jpe?g$/.test(u) && !/-\d+x\d+\.jpe?g$/.test(u)));
  assert.equal(hotel100FunValdevaqueros.confidence, 'medium');
});
