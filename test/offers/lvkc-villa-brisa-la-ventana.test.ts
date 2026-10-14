// La Ventana Kite Camp (LVKC) at Villa Brisa: replays the pages + camps API recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lvkcVillaBrisaLaVentana, buildLvkcSlots, lvkcStatus, parseLvkcCamps, parseLvkcRooms,
} from '../../src/offers/adapters/lvkc-villa-brisa-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lvkc-villa-brisa-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const campsPage = read('www.laventanacamps.com_kite-camps.');
const api = JSON.parse(read('www.laventanacamps.com_api_camps_public_1.'));

test('lvkc: room tabs = suite type, USD per guest, room count', () => {
  assert.deepEqual(parseLvkcRooms(campsPage).map(r => [r.name, r.price, r.currency, r.count]), [
    ['Standard Suite', 3250, 'USD', '7 suites available'],
    ['Premium Suite', 3450, 'USD', '2 suites available'],
    ['Primary Suite', 3700, 'USD', '1 suite available'],
  ]);
});

test('lvkc: camps API = five published 2026/27 weeks with spots left', () => {
  const camps = parseLvkcCamps(api);
  assert.deepEqual(camps.map(c => [c.startDate, c.endDate, c.spotsRemaining, lvkcStatus(c)]), [
    ['2026-11-30', '2026-12-06', 3, 'open'],
    ['2027-01-16', '2027-01-22', 3, 'open'],
    ['2027-01-23', '2027-01-29', 5, 'open'],
    ['2027-02-21', '2027-02-27', 4, 'open'],
    ['2027-02-28', '2027-03-06', 3, 'open'],
  ]);
});

test('lvkc: status mirrors the site (override first, else spots)', () => {
  const base = { id: 'x', titleEn: 'X', startDate: '2027-01-01', endDate: '2027-01-07', spotsTotal: 12, published: true, order: 0 };
  assert.equal(lvkcStatus({ ...base, spotsRemaining: 0, statusOverride: 'auto' }), 'full');
  assert.equal(lvkcStatus({ ...base, spotsRemaining: 2, statusOverride: null }), 'few');
  assert.equal(lvkcStatus({ ...base, spotsRemaining: 5, statusOverride: 'auto' }), 'filling');
  assert.equal(lvkcStatus({ ...base, spotsRemaining: 9, statusOverride: 'soon' }), 'soon');
  const rooms = parseLvkcRooms(campsPage).slice(0, 1);
  const s = (spotsRemaining: number, statusOverride: string) => buildLvkcSlots([{ ...base, spotsRemaining, statusOverride }], rooms, '2026-10-14')[0];
  assert.equal(s(2, 'auto').availability, 'limited');
  assert.equal(s(0, 'auto').availability, 'sold_out');
  assert.equal(s(6, 'soon').availability, 'closed');
  assert.equal(s(6, 'auto').availability, 'available');
});

test('lvkc: slots = week x suite, valid, past weeks dropped', async () => {
  const slots = buildLvkcSlots(parseLvkcCamps(api), parseLvkcRooms(campsPage), '2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 15);
  assert.deepEqual(slots[0], {
    key: 'standard-suite|2026-11-30', startDate: '2026-11-30', endDate: '2026-12-06', unit: 'Standard Suite',
    price: 3250, currency: 'USD', priceUnit: 'package', priceBasis: 'person', occupancy: 1,
    availability: 'available', availabilityText: 'December Camp: Available · 3 spots left', spotsLeft: 3,
  });
  assert.equal(slots.find(x => x.key === 'primary-suite|2027-01-23')?.spotsLeft, 5);
  assert.equal(buildLvkcSlots(parseLvkcCamps(api), parseLvkcRooms(campsPage), '2027-01-20').length, 12);
  const live = await lvkcVillaBrisaLaVentana.fetchSlots(ctx);
  assert.deepEqual(checkSlots(live).problems, []);
  assert.ok(live.every(x => slots.some(y => y.key === x.key)));
});

test('lvkc: content', async () => {
  const c = await lvkcVillaBrisaLaVentana.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  assert.equal(c.region, 'La Ventana, Baja California Sur');
  assert.deepEqual(c.spotCoords, { lat: 24.0522, lng: -109.993 });
  assert.match(c.summary, /five kite camp weeks/);
  assert.match(c.summary, /up to 15 hours/);
  assert.match(c.summary, /USD 3,250 to 3,700 per guest/);
  assert.equal(c.includedServices.length, 10);
  assert.ok(c.includedServices[0].startsWith('Beachfront Accommodation: 6 nights'));
  assert.deepEqual(c.rooms.map(r => r.name), ['Standard Suite', 'Premium Suite', 'Primary Suite']);
  assert.ok(c.rooms[0].features.includes('Shared bath'));
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => !/logo|floorplan|og\.png/i.test(u)));
});
