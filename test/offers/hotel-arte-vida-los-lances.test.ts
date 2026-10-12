// Hotel Arte Vida (Los Lances): replays the home, rooms and Surf Center pages recorded 2026-10-12 (scripts except
// JSON-LD, styles without background images, SVGs and comments trimmed; srcsets kept for the photo picker). Rooms are
// on request, so there are no slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hotelArteVidaLosLances, avCoords, avImages } from '../../src/offers/adapters/hotel-arte-vida-los-lances.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hotel-arte-vida-los-lances');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('av: map embed and photos', () => {
  const home = read('hotelartevidatarifa.com_.');
  assert.deepEqual(avCoords(home), { lat: 36.051983809519356, lng: -5.6505956245930955 });
  assert.equal(avCoords('<p>no map</p>'), null);
  const rooms = avImages(read('hotelartevidatarifa.com_habitaciones_.'));
  assert.deepEqual(rooms, ['DSCF5726-2', 'DSCF5743-2', 'GOPR0005-2', 'GOPR0013-2'].map(n => `https://hotelartevidatarifa.com/wp-content/uploads/2026/01/${n}.jpg`));
  assert.ok(avImages(home).every(u => /\/2026\/01\/.+\.jpe?g$/.test(u)));
});

test('av: rooms on request -> no slots', async () => {
  const slots = await hotelArteVidaLosLances.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes.join(' '), /price on request/);
});

test('av: content', async () => {
  const c = await hotelArteVidaLosLances.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Hotel Arte Vida');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Los Lances, Tarifa');
  assert.equal(c.spot, 'Los Lances');
  assert.deepEqual(c.spotCoords, { lat: 36.051983809519356, lng: -5.6505956245930955 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.match(c.summary, /direct access to Los Lances beach/);
  assert.match(c.summary, /Surf Center Tarifa school in the hotel garden runs kitesurf and windsurf courses/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Double room']);
  assert.match(c.sourceText ?? '', /en el jardín del hotel se encuentra el Surf Center Tarifa/);
  assert.equal(c.imageUrls.length, 18);
  assert.equal(c.bookingUrl, 'https://hotelartevidatarifa.com/contacto-2/');
});
