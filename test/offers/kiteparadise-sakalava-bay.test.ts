// KiteParadise Madagascar (Sakalava Bay, Diego Suarez): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteparadiseSakalavaBay, buildKpSlots, parseKpCoords, parseKpRoom,
} from '../../src/offers/adapters/kiteparadise-sakalava-bay.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteparadise-sakalava-bay');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kiteparadise: room page price block (price, guests, extra guest, min/max)', () => {
  const ch = parseKpRoom(read('www.kiteparadise-madagascar.com_chameleon-suite.'), 'chameleon-suite', 'Chameleon Suite');
  assert.deepEqual([ch.price, ch.guests, ch.extraGuest, ch.minGuests, ch.maxGuests], [120, 3, 15, 3, 5]);
  assert.equal(ch.features[0], 'Size : 45m2 ground floor + 15m2 mezzanine');
  const maki = parseKpRoom(read('www.kiteparadise-madagascar.com_maki-bungalow.'), 'maki-bungalow', 'Maki Bungalow');
  assert.deepEqual([maki.price, maki.guests, maki.extraGuest, maki.minGuests, maki.maxGuests], [45, 2, 15, null, 3]);
  assert.match(maki.description ?? '', /A-frame bungalows, standing 5\.5 metres high/);
  assert.match(maki.priceText ?? '', /^PRICE - 45€ \/ Prices for 2 guests sleeping in the same bed/);
});

test('kiteparadise: slots = 4 room types, EUR per room (unit assumed per night), on request, no dates', async () => {
  const slots = await kiteparadiseSakalavaBay.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 4);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [
    ['chameleon-suite|3p', 120, 3], ['baobab-suite|2p', 95, 2], ['zebu-bungalow|2p', 75, 2], ['maki-bungalow|2p', 45, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
  assert.deepEqual(buildKpSlots([{ ...parseKpRoom('<p>no price</p>', 'x', 'X') }]), []);
});

test('kiteparadise: map pin from the site\'s Squarespace location', () => {
  assert.deepEqual(parseKpCoords(read('www.kiteparadise-madagascar.com_home.')), { lat: -12.266748181505355, lng: 49.391496390429666 });
});

test('kiteparadise: content', async () => {
  const c = await kiteparadiseSakalavaBay.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'KiteParadise Madagascar');
  assert.equal(c.country, 'Madagascar');
  assert.equal(c.spot, 'Sakalava Bay');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.rooms.length, 4);
  assert.ok(c.rooms[2].features.includes('EUR 15 per additional guest'));
  assert.match(c.summary, /20 km from Diego Suarez/);
  assert.match(c.summary, /The 11 units/);
  assert.match(c.summary, /Reedin 2024 and Ozone 2025/);
  assert.match(c.summary, /mid-March to mid-December, strongest from June to September/);
  assert.ok(c.optionalServices.includes('Private kite lessons (beginner or advanced): EUR 55 per hour, gear included'));
  assert.ok(c.optionalServices.includes('Kite rental (full equipment): EUR 75 per day, EUR 400 per 7 days'));
  assert.deepEqual(c.languages, ['fr', 'en']);
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => !/logo|artboard|static1\.squarespace/i.test(u)));
});
