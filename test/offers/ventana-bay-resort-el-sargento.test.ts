// Ventana Bay Resort (El Sargento / La Ventana): replays the pages recorded 2026-10-12 (content only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseVbCoords, parseVbKiteRates, parseVbRooms, ventanaBayResortElSargento,
} from '../../src/offers/adapters/ventana-bay-resort-el-sargento.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

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

test('ventana bay: own photos per room type from its card carousel, kite school photos as the spot', async () => {
  const c = await ventanaBayResortElSargento.fetchContent({ note: () => {}, incomplete: () => {} });
  const id = (u: string) => u.match(/norzbpnpqujtgmkx\/([0-9a-f]{8})-/)![1];
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, id(r.imageUrls![0])]), [
    ['Beach Front Suite', 4, '539b139c'],
    ['Casita', 5, '3222f763'],
    ['Classic Beach Front', 5, 'bad01ab8'],
    ['Estudio', 3, '3ef9eb6a'],
    ['Garden View Room', 5, 'eae31fa8'],
    ['Basic Ocean View Bungalow', 3, '933053ad'],
    ['Parcial Ocean and Garden View Room', 4, '0631d2d8'],
    ['Ocean View Villa Casa Jazmin', 7, '48b98227'],
    ['Superior Beach Front', 5, 'f162a046'],
    ['Superior Ocean View Bungalow', 9, 'f170f746'],
    ['Palapa Sky Suite', 7, '360cd04f'],
  ]);
  // c6f0dbd4 sits in the carousels of Beach Front Suite and Superior Beach Front: given to neither
  assert.ok(c.rooms.every(r => r.imageUrls!.every(u => id(u) !== 'c6f0dbd4')));
  const all = c.rooms.flatMap(r => r.imageUrls!);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(u => /^https:\/\/webbox\.imgix\.net\/images\/[^?]+$/.test(u)));
  assert.deepEqual(c.spotImageUrls, [
    'https://webbox.imgix.net/images/norzbpnpqujtgmkx/58140faf-4cfd-4fa3-84e6-135336689ab8.jpg',
    'https://webbox.imgix.net/images/norzbpnpqujtgmkx/647a9cbc-6083-4cbb-ab29-2a2705c28457.jpg',
  ]);
  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) if (r.imageUrls?.length) assert.ok(r.imageUrls.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
