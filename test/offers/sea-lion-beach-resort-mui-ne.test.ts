// Sea Lion Beach Resort (Mui Ne, Vietnam): replays the pages recorded 2026-10-12 (fixtures trimmed: script/style bodies
// dropped). Slots = the undated from-prices of the 8 room pages (VND per room and night, breakfast included).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  seaLionBeachResortMuiNe, buildSlSlots, parseSlRoom, SL_ROOM_URLS,
} from '../../src/offers/adapters/sea-lion-beach-resort-mui-ne.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sea-lion-beach-resort-mui-ne');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('sea-lion: room page (from-price, Vietnamese attributes -> English)', () => {
  const r = parseSlRoom(read('sealionresort.com_hamtien_deluxe-ocean-view.'), SL_ROOM_URLS[3]);
  assert.equal(r.name, 'Deluxe Ocean View');
  assert.equal(r.price, 3900000);
  assert.equal(r.priceText, 'Từ 3.900.000 vnđ/đêm');
  assert.equal(r.areaM2, 45);
  assert.equal(r.view, 'ocean');
  assert.equal(r.balcony, true);
  assert.equal(r.beds, 'Double / Twin');
  assert.equal(r.breakfast, 'breakfast for two included');
  assert.equal(r.images.length, 7);
  const fam = parseSlRoom(read('sealionresort.com_hamtien_family-garden-view.'), SL_ROOM_URLS[5]);
  assert.deepEqual([fam.view, fam.beds, fam.breakfast], ['sea or garden', 'Double and Twin', 'buffet breakfast included']);
});

test('sea-lion: slots = 8 undated from-prices, VND per room and night', async () => {
  const slots = await seaLionBeachResortMuiNe.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price]), [
    ['standard', 2300000], ['superior', 2700000], ['deluxe-garden-view', 3100000], ['deluxe-ocean-view', 3900000],
    ['deluxe-beach-front', 4700000], ['family-garden-view', 5600000], ['family-ocean-view', 6300000], ['bungalow-garden-view', 5300000],
  ]);
  assert.ok(ok.every(s => s.currency === 'VND' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.occupancy === 2
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
  assert.deepEqual(notes, []);
});

test('sea-lion: a room page without a price gives no slot', () => {
  const html = read('sealionresort.com_hamtien_superior.').replace(/Từ 2\.700\.000 vnđ\/đêm/, 'Liên hệ');
  assert.deepEqual(buildSlSlots([parseSlRoom(html, SL_ROOM_URLS[1])]), []);
});

test('sea-lion: content (kite link from the on-site C2SKY centre)', async () => {
  const c = await seaLionBeachResortMuiNe.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Sea Lion Beach Resort');
  assert.equal(c.country, 'Vietnam');
  assert.equal(c.spot, 'Mui Ne');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /285 rooms and bungalows in a 6\.5-hectare coconut garden/);
  assert.match(c.summary, /C2SKY Kite & Wing Center, an IKO and IWO certified school in Mui Ne since 2007, is based at the resort/);
  assert.match(c.summary, /gear storage from EUR 5 a day/);
  assert.match(c.summary, /from VND 2,300,000 per room and night/);
  assert.equal(c.rooms.length, 8);
  assert.equal(c.rooms[3].description, '45 m² room with ocean view and balcony; breakfast for two included.');
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/sealionresort\.com\/hamtien\/thumbs\/1550x1050x1\/upload\/product\//.test(u)));
  assert.match(c.sourceText ?? '', /Năm 2026/);
  assert.match(c.sourceText ?? '', /Sea Lion 12 Nguyen Dinh Chieu/);
});
