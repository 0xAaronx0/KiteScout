// Le Papayer Ecolodge kitesurf camp: replays becapkite.com + lepapayer.com recorded 2026-10-21 (scripts/styles trimmed,
// the encrypted form-recipient value redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchPapSlots, lePapayerEcolodgeKitesurfCampCapSkirring, papPrintedPrice, parsePapHotel, parsePapKite,
} from '../../src/offers/adapters/le-papayer-ecolodge-kitesurf-camp-cap-skirring.js';
import { contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/le-papayer-ecolodge-kitesurf-camp-cap-skirring');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const kite = readFileSync(join(DIR, files.find(f => f.startsWith('www.becapkite.com'))!), 'utf8');
const hotel = readFileSync(join(DIR, files.find(f => f.startsWith('www.lepapayer.com'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('papayer: kite rules, season and spots from becapkite', () => {
  const k = parsePapKite(kite);
  assert.deepEqual([k.noLessons, k.noRental, k.confirmedOnly, k.bestPeriod, k.bestMonths, k.windKnots, k.gustKnots, k.capacityKite],
    [true, true, true, 'janvier à avril', 'février et mars', '10 à 20', '25', 18]);
  assert.deepEqual(k.excursionSpots, ['Carabane', 'Pointe Saint-Georges', 'Boudédiète', 'Nikine']);
});

test('papayer: hotel facts, own JSON-LD geo, no price -> no slots (priceRange ignored)', async () => {
  const h = parsePapHotel(hotel);
  assert.deepEqual([h.capacity, h.geo, h.email, h.openAllYear, h.freeBreakfastDirect], [16, { lat: 12.435368, lng: -16.7803266 }, 'opapayer@gmail.com', true, true]);
  assert.deepEqual(h.rooms.map(r => r.name), ['Double room', 'Upstairs room', 'Beachfront bungalow']);
  assert.equal(h.boards.length, 4);
  assert.match(hotel, /"priceRange":\s*"€25–€100"/); // present in the page code, deliberately unused
  assert.equal(papPrintedPrice(kite), null);
  assert.equal(papPrintedPrice('<body><p>Chambre double 45 € / nuit</p></body>'), '45 € / nuit');
  const notes: string[] = [];
  assert.deepEqual(await fetchPapSlots({ note: n => notes.push(n) }), []);
  assert.match(notes[0], /no price published/);
});

test('papayer: content', async () => {
  const c = await lePapayerEcolodgeKitesurfCampCapSkirring.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.country, c.region, c.spot, c.durationDays, c.kiteLessons, c.equipmentRental, c.beginnerFriendly],
    ['accommodation', 'Senegal', 'Cap Skirring, Casamance', 'Cap Skirring', null, false, false, false]);
  assert.deepEqual(c.spotCoords, { lat: 12.435368, lng: -16.7803266 });
  assert.match(c.summary, /no lessons and no gear rental/);
  assert.match(c.summary, /best from January to April \(best months February and March\)/);
  assert.doesNotMatch(c.summary, /[–—]|€/);
  assert.equal(c.imageUrls.length, 9);
  assert.ok(!c.imageUrls.some(u => u.includes("lepapayer.com")), "no rights-reserved lepapayer.com photos");
  assert.ok(!c.imageUrls.some(u => /\.png$|-800x44\d|-top\./.test(u)));
});
