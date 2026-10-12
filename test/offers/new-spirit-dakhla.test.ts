// New Spirit Dakhla: replays the Wix home and /kitesurf pages recorded 2026-10-12 (fixtures trimmed: script /
// style bodies dropped, only the Wix business-location fragment of the site model script kept).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  newSpiritDakhla, parseNsBungalows, parseNsCounts, parseNsKitePrices,
} from '../../src/offers/adapters/new-spirit-dakhla.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/new-spirit-dakhla');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const home = read('www.newspiritdakhla.com_.');

test('new-spirit: bungalow cards and chalet counts', () => {
  const rooms = parseNsBungalows(home);
  assert.deepEqual(rooms.map(r => [r.name, r.features[0], r.features[r.features.length - 1]]), [
    ['Premium Seaview', 'available as a double or triple room', '13m²'],
    ['Deluxe', 'available as a double or triple room', '13m²'],
    ['Standard', 'available with one double or two single beds', '12m²'],
  ]);
  assert.deepEqual(parseNsCounts(home), { total: 31, byCategory: { Standard: 17, Deluxe: 5, Premium: 9 } });
});

test('new-spirit: kite course prices (EUR, "1.020 €" thousands dot)', () => {
  const prices = parseNsKitePrices(read('www.newspiritdakhla.com_kitesurf.'));
  assert.deepEqual(prices.slice(0, 5).map(x => [x.item, x.amount]), [
    ['Kitesurf Basic Course 8h', 450], ['Kitesurf Intensive Basic Course 12h', 625],
    ['Kitesurf Intensive Basic Course + 3 days rental', 800], ['Kitesurf Intensive Basic Course + 7 days rental', 890],
    ['Kitesurf Intensive Basic Course + 12 days rental', 1020],
  ]);
});

test('new-spirit: no slots (no room prices on the site, HotelRunner API not usable) -> price on request', async () => {
  const slots = await newSpiritDakhla.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /HotelRunner/.test(n)));
  assert.equal(newSpiritDakhla.confidence, 'low');
});

test('new-spirit: content', async () => {
  const c = await newSpiritDakhla.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'New Spirit Dakhla');
  assert.equal(c.country, 'Morocco');
  assert.deepEqual(c.spotCoords, { lat: 23.9040325, lng: -15.785266 });
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /31 chalets in three categories/);
  assert.match(c.summary, /powered by KBC World/);
  assert.match(c.summary, /basic course 8 h EUR 450/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Premium Seaview', 'Deluxe', 'Standard']);
  assert.match(c.rooms[2].description ?? '', /^17 chalets\./);
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/f417d2_[0-9a-f]{32}~mv2\.(jpe?g|webp)$/.test(u)));
  assert.match(c.sourceText ?? '', /14 to 20 August 2027/);
});
