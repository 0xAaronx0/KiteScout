// Baja Joe's (La Ventana): replays bajajoe.com + the SabeeApp booking page recorded 2026-10-12 (trimmed;
// the SabeeApp page keeps its <script id="ng-state"> transfer state).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bajaJoesLaVentana, bjSeason, parseBjEvents, parseBjIbe, parseBjRooms,
} from '../../src/offers/adapters/baja-joes-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/baja-joes-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('baja-joes: six room types from the Elementor headings', () => {
  const rooms = parseBjRooms(read('bajajoe.com_room-types_.'));
  assert.deepEqual(rooms.map(r => r.name), [
    "Baja Joe's Beach House", "Baja Joe's House", 'Premium Courtyard', 'Courtyard Room', 'Standard Room', 'Basic Room',
  ]);
  assert.deepEqual(rooms[0].features, ['2 bedrooms', 'On the beach']);
  assert.ok(rooms[4].features.includes('Sleeps two to six'));
  assert.ok(rooms[5].features.includes('Shared bathrooms'));
});

test('baja-joes: event calendar -> 2026/2027 season and school opening', () => {
  const events = parseBjEvents(read('bajajoe.com_events_.'));
  assert.deepEqual(events.map(e => [e.start, e.title]), [
    ['2026-10-01', 'Elevation Kite & Wing Center OPENS!'],
    ['2026-10-31', 'Halloween Extravaganza'],
  ]);
  assert.equal(bjSeason(events), '2026/2027');
  assert.equal(bjSeason([]), null);
});

test('baja-joes: SabeeApp booking page settings (own engine: coordinates, currency, booking on)', () => {
  assert.deepEqual(parseBjIbe(read('ibe.sabeeapp.com_properties_')), {
    name: 'Baja Joe´s Vacation Paradise', lat: 24.0472107, lng: -109.9882736, currency: 'MXN', allowBooking: true,
  });
  assert.deepEqual(parseBjIbe('<html></html>'), { name: null, lat: null, lng: null, currency: null, allowBooking: null });
});

test('baja-joes: no readable rates -> empty slot list (price on request), no request made', async () => {
  const slots = await bajaJoesLaVentana.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /SabeeApp/.test(n)));
  assert.equal(bajaJoesLaVentana.confidence, 'low');
});

test('baja-joes: content', async () => {
  const c = await bajaJoesLaVentana.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, "Baja Joe's");
  assert.equal(c.country, 'Mexico');
  assert.equal(c.spot, 'La Ventana');
  assert.deepEqual(c.spotCoords, { lat: 24.0472107, lng: -109.9882736 });
  assert.equal(c.rooms.length, 6);
  assert.match(c.summary, /Elevation Kiteboarding, an IKO center/);
  assert.match(c.summary, /announces the 2026\/2027 winter season, with the kite center opening on October 1, 2026/);
  assert.match(c.summary, /best wind is from November to March/);
  assert.ok(!/[—–]/.test(c.summary));
  assert.ok(c.includedServices.includes('Beachfront gear shed'));
  assert.equal(c.optionalServices[0], 'Kite lessons and rentals with Elevation Kiteboarding (IKO; English, French and Spanish)');
  assert.equal(c.bookingUrl, 'https://ibe.sabeeapp.com/properties/Baja-Joes-Vacation-Paradise-booking/?p=bSp539ecc4910b37d36');
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://bajajoe.com/wp-content/uploads/') && !/logo|booklet/i.test(u)));
});
