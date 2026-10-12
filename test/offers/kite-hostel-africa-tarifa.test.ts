// Kite Hostel Africa (Freeride Tarifa): replays the lodge page recorded 2026-10-12 (scripts and styles trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kiteHostelAfricaTarifa, parseKhaRooms } from '../../src/offers/adapters/kite-hostel-africa-tarifa.js';
import { parseFrLodge } from '../../src/offers/adapters/surfers-residence-tarifa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-hostel-africa-tarifa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('freeridetarifa.com_kite-hostel-tarifa_.');

test('kite-hostel-africa: lodge header (h2 on this page) and highlights', () => {
  const l = parseFrLodge(html);
  assert.equal(l.price?.amount, 45);
  assert.equal(l.heading, 'Kite Hostel In Tarifa');
  assert.ok(l.highlights.includes('Co-Working Space'));
  assert.ok(l.highlights.includes('Yoga Classes'));
  assert.deepEqual(parseKhaRooms(l.texts).map(r => r.name), ['Private room', 'Rooftop apartment']);
});

test('kite-hostel-africa: one "from" slot', async () => {
  const slots = await kiteHostelAfricaTarifa.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.availability, s.availabilityText]),
    [['private-room-from', 'Private room', 45, 'EUR', 'per_night', 'on_request', 'FROM 45€/Night']]);
});

test('kite-hostel-africa: content', async () => {
  const c = await kiteHostelAfricaTarifa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Hostel Africa (Freeride Tarifa)');
  assert.match(c.summary, /where the kite school Freeride Tarifa is based, 6 minutes' walk from the beach/);
  assert.match(c.summary, /Kite & Yoga Camp/);
  assert.ok(c.optionalServices.includes('Yoga Classes'));
  assert.ok(!c.includedServices.includes('Yoga Classes'));
  assert.equal(c.imageUrls.length, 12);
  assert.equal(kiteHostelAfricaTarifa.operator.rootDomain, 'freeridetarifa.com');
});
