// Surfers Residence (Freeride Tarifa Kite House): replays the lodge page recorded 2026-10-12 (scripts and styles trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  surfersResidenceTarifa, buildFrSlots, parseFrLodge, parseSrRooms,
} from '../../src/offers/adapters/surfers-residence-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/surfers-residence-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('freeridetarifa.com_tarifa-kite-house_.');

test('surfers-residence: lodge header, highlights, boxes, footer', () => {
  const l = parseFrLodge(html);
  assert.deepEqual(l.price, { amount: 40, currency: 'EUR', raw: 'FROM 40€/Night' });
  assert.equal(l.heading, 'Kite house in Tarifa');
  assert.equal(l.highlights.length, 11);
  assert.ok(l.highlights.includes('Storage Space'));
  assert.deepEqual(l.boxes.map(b => b.title), ['Common areas', 'Nearby the residence']);
  assert.match(l.address!, /Hostal Africa Calle María Antonia Toledo, 12/);
  assert.equal(l.dateModified, '2026-02-19');
});

test('surfers-residence: three room types', () => {
  assert.deepEqual(parseSrRooms(parseFrLodge(html)).map(r => [r.name, r.features[0]]), [
    ['Apartment', 'Small kitchen and private bathroom'],
    ['Ensuite room', 'Own bathroom'],
    ['Double/twin room', 'Shared bathroom'],
  ]);
});

test('surfers-residence: one "from" slot, no dates, on request', async () => {
  const slots = await surfersResidenceTarifa.fetchSlots(ctx);
  assert.deepEqual(slots, buildFrSlots(parseFrLodge(html), 'Private room'));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.startDate]),
    [['private-room-from', 40, 'EUR', 'per_night', 'room', 'on_request', null]]);
});

test('surfers-residence: content', async () => {
  const c = await surfersResidenceTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Surfers Residence (Freeride Tarifa Kite House)');
  assert.equal(c.region, 'Tarifa town');
  assert.match(c.summary, /solo travellers get 10% off/);
  assert.match(c.summary, /rooms from EUR 40 per night/);
  assert.ok(c.includedServices.includes('Storage Space'));
  assert.equal(c.imageUrls.length, 13);
  assert.ok(c.imageUrls.every(u => !/-\d+x\d+\./.test(u))); // full-size photos, no 600x600 thumbnails
});

test('surfers-residence: the lodge-wide "from" price stays unlinked (it does not name one of the three room types)', async () => {
  const names = (await surfersResidenceTarifa.fetchContent(ctx)).rooms.map(r => r.name);
  const slots = await surfersResidenceTarifa.fetchSlots(ctx);
  assert.deepEqual(slots.map(s => [s.unit, s.room ?? null, slotRoom(names, s)]), [['Private room', null, null]]);
});
