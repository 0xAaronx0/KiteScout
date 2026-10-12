// Ventana Bay Resort (El Sargento / La Ventana): replays the pages recorded 2026-10-12 (content only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseVbCoords, parseVbKiteRates, parseVbRooms, ventanaBayResortElSargento,
} from '../../src/offers/adapters/ventana-bay-resort-el-sargento.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ventana-bay-resort-el-sargento');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');

test('ventana bay: 11 room types from /rooms.html', () => {
  const rooms = parseVbRooms(read('www.ventanabay.com_rooms.html.'));
  assert.equal(rooms.length, 11);
  assert.equal(rooms[0].name, 'Beach Front Suite');
  assert.equal(rooms[10].name, 'Palapa Sky Suite');
  assert.match(rooms[10].text, /palapa roof, a fully equipped kitchen/);
  assert.deepEqual(rooms.find(r => r.name === 'Ocean View Villa Casa Jazmin')!.notes[0], 'One bedroom');
});

test('ventana bay: map pin from the "Find us" link', () => {
  assert.deepEqual(parseVbCoords(read('www.ventanabay.com_.')), { lat: 24.09845496, lng: -109.9933577 });
});

test('ventana bay: kite school rates (content, USD)', () => {
  const r = parseVbKiteRates(read('www.ventanabay.com_kite-school.html.'));
  assert.deepEqual(r.lessons, ['$160 per hour', '$435 for 3 hour package', '$850 for 6 hour package', '$1200 for 9 hour package']);
  assert.equal(r.rental[0], 'Kite setup(Kite, Bar, Board, Harness) $150 per day');
  assert.equal(r.vat, 'Rates are in USD and do not include VAT(16%)');
});

test('ventana bay: no slots (no rates on the site, SiteMinder engine behind a bot challenge)', async () => {
  const notes: string[] = [];
  const slots = await ventanaBayResortElSargento.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /AWS WAF/);
});

test('ventana bay: content', async () => {
  const c = await ventanaBayResortElSargento.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Ventana Bay Resort');
  assert.equal(c.spot, 'La Ventana');
  assert.deepEqual(c.spotCoords, { lat: 24.09845496, lng: -109.9933577 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /Strong Kiteboarding Baja, .* \(USD 160 per hour/);
  assert.equal(c.rooms.length, 11);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/webbox\.imgix\.net\/images\/[^?]+$/.test(u)));
});
