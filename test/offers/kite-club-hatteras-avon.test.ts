// Kite Club Hatteras guest house (Avon): replays the pages + WooCommerce Store API product list recorded 2026-10-14
// (product list compacted to the fields the parser reads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kiteClubHatterasAvon, kchStayProducts, parseKchProducts } from '../../src/offers/adapters/kite-club-hatteras-avon.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-club-hatteras-avon');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kch: Store API -> rooms and houses without prices, camp with a USD range', () => {
  const all = parseKchProducts(read('kiteclubhatteras.com_wp-json_wc_store_v1_products'));
  const stays = kchStayProducts(all);
  assert.deepEqual(stays.map(s => s.name).sort(), ['Kite Club Hatteras House', 'Private Room', 'Shared Bunk Room', 'The Sea Star House', 'The Turtle Club House']);
  assert.ok(stays.every(s => s.price === null && !s.purchasable));
  const camp = all.find(p => p.slug === 'kite-camp')!;
  assert.deepEqual([camp.price, camp.priceMax, camp.currency], [1500, 1600, 'USD']);
  assert.equal(all.find(p => p.slug === 'private-room-accomodation')!.seasons.length, 5);
});

test('kch: slots = [] (rooms on request)', async () => {
  const notes: string[] = [];
  const slots = await kiteClubHatterasAvon.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('kch: content', async () => {
  const c = await kiteClubHatterasAvon.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Club Hatteras');
  assert.deepEqual([c.country, c.region, c.spot, c.kind], ['United States', 'Hatteras Island, North Carolina', 'Avon', 'accommodation']);
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.rooms.length, 5);
  const priv = c.rooms.find(r => r.name === 'Private Room')!;
  assert.ok(priv.features.includes('Queen bed'));
  assert.ok(priv.features.includes('Price on request (call for availability)'));
  assert.ok(!/PLEASE CALL/.test(priv.description ?? ''));
  assert.match(c.summary, /canal-front guest house/);
  assert.match(c.sourceText!, /Weekly, nightly and partial stay rates are available/);
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => /^https:\/\/kiteclubhatteras\.com\/wp-content\/uploads\/.+\.(webp|jpe?g)$/.test(u) && !/logo/i.test(u)));
});
