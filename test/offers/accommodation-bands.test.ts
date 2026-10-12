// Price/availability bands for per-day booking engines (Aaron 2026-10-12: season limits sit
// mid-month; Omnibees prices change almost daily), built from the 2026-10-09 fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkSlots } from '../../src/offers/validate.js';
import { parseVgCalendar, buildVgRunSlots } from '../../src/offers/adapters/vila-guara-atins.js';
import { parseKvRoomProducts, parseKvNights, buildKvRunSlots, type KvCategory, type KvNightState } from '../../src/offers/adapters/kite-village-hamata.js';

const fx = (key: string) => join(import.meta.dirname, '../fixtures/offers', key);

test('vila-guara: daily calendar -> bands with exact limits, min stay and status', () => {
  const dir = fx('vila-guara-atins');
  const days = readdirSync(dir).filter(f => f.includes('availability_v4')).flatMap(f => parseVgCalendar(readFileSync(join(dir, f), 'utf8')));
  const slots = buildVgRunSlots(days);
  assert.equal(days.length, 174);
  assert.equal(slots.length, 52);
  assert.deepEqual(checkSlots(slots).problems, []);
  // every day is covered exactly once
  const covered = slots.reduce((n, s) => n + (Date.parse(s.endDate!) - Date.parse(s.startDate!)) / 86400000 + 1, 0);
  assert.equal(covered, 174);
  const first = slots[0];
  assert.deepEqual([first.key, first.startDate, first.endDate, first.price, first.currency, first.minNights, first.availability],
    ['lowest|2026-10-09', '2026-10-09', '2026-10-10', 1425.2, 'BRL', 2, 'available']);
  // a price change mid-month starts a new band: 13-14 Oct at 1044.10 between 1425.20 days
  const oct13 = slots.find(s => s.startDate === '2026-10-13')!;
  assert.deepEqual([oct13.endDate, oct13.price], ['2026-10-14', 1044.1]);
  // "Close" days are not bookable
  assert.ok(slots.some(s => s.availability === 'sold_out' && s.availabilityText?.includes('Close')));
});

test('kite-village: night states -> bands per room product, nights before today dropped', () => {
  const dir = fx('kite-village-hamata');
  const rooms = parseKvRoomProducts(readFileSync(join(dir, readdirSync(dir).find(f => f.includes('station_101'))!), 'utf8'));
  const nights: Partial<Record<KvCategory, Array<{ date: string; state: KvNightState }>>> = {};
  for (const f of readdirSync(dir).filter(f => f.includes('_available_'))) {
    const [, , , , , res, start] = f.split('_');
    const d = new Date(Number(start) * 1000);
    const cat: KvCategory = res === '500' ? 'bungalow' : 'tiny-house';
    (nights[cat] ??= []).push(...parseKvNights(readFileSync(join(dir, f), 'utf8'), d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  const slots = buildKvRunSlots(rooms, nights, '2026-10-09');
  assert.deepEqual(checkSlots(slots).problems, []);
  const bd = slots.filter(s => s.key.startsWith('bungalow-double|'));
  assert.deepEqual(bd.map(s => [s.startDate, s.endDate, s.availability]), [
    ['2026-10-09', '2026-10-31', 'available'],
    ['2026-11-01', '2026-11-16', 'limited'],
    ['2026-11-17', '2027-03-31', 'available'],
  ]);
  assert.ok(bd.every(s => s.price === 110 && s.currency === 'EUR' && s.priceUnit === 'per_night' && s.occupancy === 2));
  assert.ok(slots.every(s => s.startDate! >= '2026-10-09'));
});

test('kite-village: live-quote recipe product ids still exist in the station feed', async () => {
  const { kiteVillageHamata } = await import('../../src/offers/adapters/kite-village-hamata.js');
  const dir = fx('kite-village-hamata');
  const rooms = parseKvRoomProducts(readFileSync(join(dir, readdirSync(dir).find(f => f.includes('station_101'))!), 'utf8'));
  const recipe = kiteVillageHamata.quote;
  assert.ok(recipe && recipe.engine === 'leao');
  for (const r of recipe.rooms) {
    for (const [persons, id] of Object.entries(r.products)) {
      assert.ok(rooms.some(p => p.unit === r.unit && p.persons === Number(persons) && p.parentId === id), `${r.unit} ${persons}p -> ${id}`);
    }
  }
});
