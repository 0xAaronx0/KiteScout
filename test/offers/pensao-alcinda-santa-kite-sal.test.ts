// Pensão Alcinda Bettencourt / Santa Kite (Santa Maria, Sal): replays the pages recorded 2026-10-12. The room prices
// are undated "From N Euros" on pages last edited 2024-10-04, so the adapter is content only (freshness gate tested).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pensaoAlcindaSantaKiteSal, buildPaskSlots, parsePaskRooms, parsePensaoContent, paskFresh, type PaskWpPage,
} from '../../src/offers/adapters/pensao-alcinda-santa-kite-sal.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pensao-alcinda-santa-kite-sal');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const roomsJson = JSON.parse(read('santakitecaboverde.com_pensaoalcindabettencourt_wp-json_')) as PaskWpPage[];
const ctx = { note: () => {}, incomplete: () => {} };

test('pask: 3 room types from the WP REST answer, in site order', () => {
  const rooms = parsePaskRooms(roomsJson);
  assert.deepEqual(rooms.map(r => [r.name, r.price, r.occupancyMin, r.occupancyMax, r.sizeM2, r.modified.slice(0, 10)]), [
    ['Double Room', 34, 2, 2, 12, '2024-10-04'],
    ['Standard Apartment', 43, 2, 2, 20, '2024-10-04'],
    ['Superior Apartment', 46, 3, 4, 45, '2024-10-04'],
  ]);
  assert.ok(rooms[2].features.includes('Kitchen'));
  assert.ok(rooms[1].features.includes('View: Balcony Sea view'));
});

test('pask: freshness gate (15 months)', () => {
  assert.equal(paskFresh('2024-10-04T12:13:59', '2026-10-12'), false);
  assert.equal(paskFresh('2025-07-12T00:00:00', '2026-10-12'), true);
  assert.equal(paskFresh('2025-07-11T23:59:59', '2026-10-12'), false);
});

test('pask: pages edited 2024 -> no slots, with a run note', async () => {
  assert.deepEqual(buildPaskSlots(parsePaskRooms(roomsJson), '2026-10-12'), []);
  const notes: string[] = [];
  const slots = await pensaoAlcindaSantaKiteSal.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.match(notes[0], /last edited 2024-10-04/);
});

test('pask: an edited room page (2026) turns its "From" price into an on-request slot', () => {
  const edited = roomsJson.map(p => ({ ...p, modified: '2026-09-01T10:00:00' }));
  const slots = buildPaskSlots(parsePaskRooms(edited), '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['double-room', 'Double Room', 34, 2], ['standard-apartment', 'Standard Apartment', 43, 2], ['superior-apartment', 'Superior Apartment', 46, 3],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.availability === 'on_request' && s.startDate === null));
  const c = parsePensaoContent({ kite: read('santakitecaboverde.com_.'), pensao: read('santakitecaboverde.com_pensaoalcindabettencourt_.'), rooms: edited }, '2026-10-12');
  assert.match(c.summary, /Rooms start from EUR 34 per night/);
});

test('pask: content', async () => {
  const c = await pensaoAlcindaSantaKiteSal.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pensão Alcinda Bettencourt (Santa Kite)');
  assert.equal(c.country, 'Cape Verde');
  assert.equal(c.spot, 'Santa Maria, Sal');
  assert.equal(pensaoAlcindaSantaKiteSal.confidence, 'low');
  assert.match(c.summary, /same building as the Santa Kite kitesurf and wingfoil school/);
  assert.match(c.summary, /IKO-certified instructors and Core equipment/);
  assert.match(c.summary, /wind season runs December to April/);
  assert.match(c.summary, /last edited in 2024, so stays are priced on request/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Double Room', 'Standard Apartment', 'Superior Apartment']);
  assert.equal(c.imageUrls.length, 30);
  assert.equal(c.imageUrls.filter(u => /\/kitesurf\/wp-content\//.test(u)).length, 6);
  assert.ok(!/IBAN|DE50/.test(c.sourceText ?? ''));
});
