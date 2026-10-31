// Aqua Ventana (La Ventana, BCS): replays the ThinkReservations Markdown pages recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aquaVentanaLaVentana, aqSamples, aqSearchUrl, fetchAqSlots, parseAqUnits, unwrapNextImage,
} from '../../src/offers/adapters/aqua-ventana-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { roomsWithPrices } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/aqua-ventana-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: (r: string) => notes.push(`INCOMPLETE ${r}`) };
const TODAY = '2026-10-14';

test('aqua: undated room list = 17 units with "Starts at" prices', () => {
  const units = parseAqUnits(read('www.aquaventana.com_accommodations.md.'));
  assert.equal(units.length, 17);
  const pitaya = units.find(u => u.name === 'Pitaya')!;
  assert.equal(pitaya.price, 250);
  assert.equal(pitaya.fromPrice, true);
  assert.equal(pitaya.maxGuests, 5);
  assert.equal(pitaya.tagline, '2 bed/2 bath · Living Room · Rollaway bed available');
  assert.ok(pitaya.images.length > 3 && pitaya.images.every(u => !/Resort_Map/i.test(u)));
  assert.equal(units.find(u => u.name === 'Sabila')!.price, 120);
});

test('aqua: dated search = per-night price or the engine\'s "Unavailable" words', () => {
  const units = parseAqUnits(read('www.aquaventana.com_accommodations.md_startDate_2027-03-13'));
  assert.equal(units.length, 17);
  const cardon = units.find(u => u.name === 'Cardon')!;
  assert.deepEqual([cardon.price, cardon.fromPrice, cardon.unavailableText], [320, false, null]);
  const nov = parseAqUnits(read('www.aquaventana.com_accommodations.md_startDate_2026-11-14'));
  assert.ok(nov.every(u => u.price === null && /^Unavailable for selected dates/.test(u.unavailableText ?? '')));
});

test('aqua: one 7-night Saturday sample per month, 7 months', () => {
  const s = aqSamples(TODAY);
  assert.deepEqual(s.map(x => x.checkIn), ['2026-10-17', '2026-11-14', '2026-12-12', '2027-01-16', '2027-02-13', '2027-03-13', '2027-04-17']);
  assert.equal(s[0].checkOut, '2026-10-24');
  assert.equal(aqSearchUrl(s[3]), 'https://www.aquaventana.com/accommodations.md?startDate=2027-01-16&endDate=2027-01-23&numberOfAdults=2&numberOfChildren=0&numberOfPets=0');
});

test('aqua: slots = unit x month, USD per night, available / sold_out', async () => {
  const all = await fetchAqSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(all);
  assert.deepEqual(problems, []);
  const slots = ok.filter(s => !s.key.startsWith('printed|'));
  assert.equal(slots.length, 119);
  const cardon = slots.find(s => s.key === 'cardon|2027-03')!;
  assert.equal(cardon.price, 320);
  assert.equal(cardon.currency, 'USD');
  assert.equal(cardon.priceUnit, 'per_night');
  assert.equal(cardon.priceBasis, 'room');
  assert.equal(cardon.availability, 'available');
  assert.deepEqual([cardon.startDate, cardon.endDate, cardon.datePrecision], ['2027-03-01', '2027-03-31', 'month']);
  assert.match(cardon.availabilityText!, /2027-03-13 to 2027-03-20 .* \$320 \/ night \(VAT and hotel tax of 20% not included\)/);
  assert.equal(slots.find(s => s.key === 'papache-6|2027-01')!.price, 610);
  const pitaya = slots.find(s => s.key === 'pitaya|2026-10')!;
  assert.deepEqual([pitaya.availability, pitaya.price], ['sold_out', null]);
  assert.match(pitaya.availabilityText!, /Next availability for 7 nights: Oct 19/);
  assert.equal(slots.filter(s => s.key.endsWith('|2026-11') && s.availability === 'sold_out').length, 17);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 180);
});

test('aqua: every unit carries the room list from-price as an undated floor (Aaron 2026-10-31)', async () => {
  const slots = await fetchAqSlots(ctx, TODAY);
  const printed = slots.filter(s => s.key.startsWith('printed|'));
  assert.equal(printed.length, 17);
  assert.ok(printed.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.startDate === null && s.priceIsMinimum));
  assert.deepEqual(printed.filter(s => ['Damiana', 'Pitaya', 'Sabila'].includes(s.room!)).map(s => [s.room, s.price]), [
    ['Pitaya', 250], ['Damiana', 180], ['Sabila', 120],
  ]);
});

test('aqua: room price = min(engine, printed from-price) as "from"; dated month prices stay (Aaron 2026-10-31, "aqua min ja")', async () => {
  const content = await aquaVentanaLaVentana.fetchContent(ctx);
  const rows = roomsWithPrices(content, await fetchAqSlots(ctx, TODAY), TODAY);
  const row = (name: string) => rows.find(r => r.name === name)!;
  // engine only for expensive months (625 in March), the room list prints "Starts at $250"
  assert.deepEqual([row('Pitaya').price_from, row('Pitaya').price_from_is_minimum], [250, true]);
  // the printed floor is below every engine month
  assert.deepEqual([row('Sabila').price_from, row('Sabila').price_from_is_minimum], [120, true]);
  // booked in every sample month: the printed floor alone
  assert.deepEqual([row('Damiana').price_from, row('Damiana').price_from_is_minimum], [180, true]);
  // a dated engine price is still the price of its month
  assert.deepEqual(row('Pitaya').priced_months, [3, 12]);
  assert.ok(row('Pitaya').availability.some(a => a.start_date === '2027-03-01' && a.price === 625));
  assert.ok(row('Pitaya').availability.every(a => a.price !== 250));
});

test('aqua: content', async () => {
  const c = await aquaVentanaLaVentana.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Aqua Ventana');
  assert.equal(c.country, 'Mexico');
  assert.equal(c.continent, 'North America');
  assert.equal(c.region, 'La Ventana, Baja California Sur');
  assert.deepEqual(c.spotCoords, { lat: 24.0481319, lng: -109.9886093 });
  assert.equal(c.rooms.length, 17);
  assert.ok(c.rooms[0].features.includes('From USD 250 per night (VAT and hotel tax of 20% not included)'));
  assert.match(c.summary, /two IKO kite instructors/);
  assert.match(c.summary, /mid-October to mid-April/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.ok(c.optionalServices.includes('Private kite lesson: USD 200 per 2 hours, USD 270 with jet ski'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => !/_next\/image|Resort_Map|logo/i.test(u)));
});

test('aqua: Next.js image proxy unwrap', () => {
  assert.equal(unwrapNextImage('https://www.aquaventana.com/_next/image?url=https%3A%2F%2Fmedia-bridge.thinkreservations.com%2Fa%2Fb.jpg&w=3840&q=75'), 'https://media-bridge.thinkreservations.com/a/b.jpg');
});
