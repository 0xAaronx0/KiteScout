// Djerbakite villa (Sedouikech, Djerba): replays the villa, price-list and location pages of www.djerbakite.com
// recorded 2026-10-14 (scripts except JSON-LD, styles and SVGs trimmed). Content only: no villa price on the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  djerbakiteVillaSedouikech as adapter, djkDates, djkImages, djkLines, djkMapCoords, djkOptionalServices,
  djkVillaFeatures, parseDjkPrices,
} from '../../src/offers/adapters/djerbakite-villa-sedouikech.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/djerbakite-villa-sedouikech');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const villa = read('www.djerbakite.com_hebergement_.');
const prices = read('www.djerbakite.com_prix_.');

test('djerbakite: map pin + page dates (villa 2024, price list 2026)', () => {
  assert.deepEqual(djkMapCoords(villa), { lat: 33.746528, lng: 10.935556 });
  assert.equal(djkMapCoords('<html></html>'), null);
  assert.deepEqual(djkDates(villa), { published: '2024-06-20', modified: '2024-07-15' });
  assert.equal(djkDates(prices).modified, '2026-03-24');
});

test('djerbakite: villa feature boxes', () => {
  const f = djkVillaFeatures(djkLines(villa));
  assert.equal(Object.keys(f).length, 9);
  assert.equal(f.Chambres, '3 grandes chambres, dont 1 suite parentale');
  assert.equal(f.Piscine, 'Piscine 10m x 4m');
  assert.equal(f.Stationnement, 'Aire de stationnement intérieure pour 3 à 4 véhicules');
});

test('djerbakite: school price list -> optional services with printed EUR prices', () => {
  const rows = parseDjkPrices(prices);
  assert.equal(rows.length, 34);
  assert.deepEqual(rows[0], { section: 'Stages (conditionnés par un moniteur en un binôme / un matériel)', label: 'Stage Kitesurf objectif « Découverte »', quantity: '2h', price: '80' });
  const opt = djkOptionalServices(rows);
  assert.equal(opt.length, 14);
  for (const s of [
    'Kitesurf course "Autonomie" (10h): EUR 350',
    'Kite rental, all sizes (1 week): EUR 490',
    'Shuttle hotel / villa - water-sports base (return): EUR 10',
    'Equipment storage (1 week): EUR 50',
    'Equipment storage + shuttle (1 week): EUR 110',
  ]) assert.ok(opt.includes(s), s);
});

test('djerbakite: carousel photos', () => {
  const imgs = djkImages(villa);
  assert.equal(imgs.length, 29);
  assert.equal(imgs[0], 'https://www.djerbakite.com/wp-content/uploads/2024/06/8-1536x1152.png');
  assert.ok(imgs.every(u => /\/wp-content\/uploads\/2024\/06\//.test(u) && !/150x150|chambre|piscine-1/.test(u)), 'no feature icons');
});

test('djerbakite: no villa price -> [] (price on request)', async () => {
  const slots = await adapter.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.equal(adapter.confidence, 'low');
});

test('djerbakite: content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'Djerbakite Villa with Pool');
  assert.deepEqual([c.country, c.region, c.spot, c.durationDays], ['Tunisia', 'Djerba, Medenine', 'Sedouikech, Djerba', null]);
  assert.deepEqual(c.spotCoords, { lat: 33.746528, lng: 10.935556 });
  assert.match(c.summary, /up to 8 guests, rented out by Djerbakite, the kite and wingfoil school at Sedouikech on the Djerba lagoon, 5 minutes from Club Med/);
  assert.match(c.summary, /return shuttle between the villa and its water-sports base/);
  assert.equal(c.rooms.length, 1);
  assert.ok(c.rooms[0].features.includes('Pool: Pool 10 x 4 m'));
  assert.ok(c.rooms[0].features.includes('Price on request (booking by phone +21697402893)'));
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.sourceText ?? '', /villa page \(published 2024-06-20, modified 2024-07-15\)/);
  assert.match(c.sourceText ?? '', /price list \(modified 2026-03-24/);
  assert.ok(!/[–—]/.test(c.summary + c.rooms[0].features.join(' ') + c.optionalServices.join(' ')), 'no en/em dashes');
});
