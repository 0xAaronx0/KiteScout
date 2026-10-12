// Camping Tarifa (Los Lances): replays the home, bungalows, apartments and school pages recorded 2026-10-12 (scripts
// except JSON-LD, styles, SVGs, style attributes and data URIs trimmed). The year-less price table is anchored on the
// page's dateModified (2026-07-21); today is pinned to the recording day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingTarifaLosLances, buildCtSlots, ctBands, ctModified, ctSeasonEn, fetchCtSlots, parseCtTable,
} from '../../src/offers/adapters/camping-tarifa-los-lances.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/camping-tarifa-los-lances');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const TODAY = '2026-10-12';
const bungalows = read('campingtarifa.es_bungalows_.');

test('ct: price table of /bungalows/', () => {
  const rows = parseCtTable(bungalows);
  assert.deepEqual(rows.map(r => [r.season, r.months, r.special, r.weekday?.price ?? null, r.weekend?.price ?? null]), [
    ['Marzo', [3], false, 80, 100],
    ['Marzo (Semana Santa)', [], true, 100, 150],
    ['Marzo (primer fin de semana de Semana Santa)', [], true, null, 130],
    ['Abril y mayo', [4, 5], false, 80, 100],
    ['Junio', [6], false, 90, 150],
    ['Julio, agosto y septiembre', [7, 8, 9], false, 130, 190],
  ]);
  assert.deepEqual(rows[0].weekday, { days: 'Monday to Thursday', price: 80 });
  assert.equal(rows[1].weekday?.days, 'Monday to Wednesday');
  assert.deepEqual(parseCtTable(read('campingtarifa.es_apartamentos_.')).map(r => r.weekend?.price), rows.map(r => r.weekend?.price));
  assert.equal(ctSeasonEn([7, 8, 9]), 'July, August and September');
});

test('ct: year anchor and the 12-month cycle', () => {
  assert.equal(ctModified(bungalows), '2026-07-21');
  const bands = ctBands(parseCtTable(bungalows), '2026-07-21');
  assert.deepEqual(bands.map(b => [b.start, b.end]), [
    ['2026-07-01', '2026-09-30'], ['2027-03-01', '2027-03-31'], ['2027-04-01', '2027-05-31'], ['2027-06-01', '2027-06-30'],
  ]);
  assert.deepEqual(buildCtSlots('Bungalow', parseCtTable(bungalows), '2026-07-21', '2027-07-01'), []); // cycle over
});

test('ct: slots = unit x season band x weekday class, future bands only', async () => {
  const slots = await fetchCtSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 12);
  assert.deepEqual(slots.filter(s => s.key.startsWith('bungalow|')).map(s => [s.key, s.startDate, s.endDate, s.price]), [
    ['bungalow|2027-03|mon-thu', '2027-03-01', '2027-03-31', 80],
    ['bungalow|2027-03|fri-sun', '2027-03-01', '2027-03-31', 100],
    ['bungalow|2027-04|mon-thu', '2027-04-01', '2027-05-31', 80],
    ['bungalow|2027-04|fri-sun', '2027-04-01', '2027-05-31', 100],
    ['bungalow|2027-06|mon-thu', '2027-06-01', '2027-06-30', 90],
    ['bungalow|2027-06|fri-sun', '2027-06-01', '2027-06-30', 150],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_day' && s.priceBasis === 'room' && s.availability === 'unknown'));
  const mar = slots.find(s => s.key === 'apartment|2027-03|fri-sun')!;
  assert.equal(mar.unit, 'Apartment (Friday to Sunday)');
  assert.equal(mar.availabilityText,
    'March: Friday to Sunday EUR 100 per day; Holy Week: Monday to Wednesday EUR 100, Thursday to Sunday EUR 150; first Holy Week weekend: Friday to Sunday EUR 130 per day');
  assert.deepEqual(notes, []);
});

test('ct: content', async () => {
  const c = await campingTarifaLosLances.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Camping Tarifa');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Los Lances, Tarifa');
  assert.equal(c.spot, 'Los Lances');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /only these and Kampaoh tents can be booked in advance/);
  assert.match(c.summary, /The 32 m² bungalows/);
  assert.match(c.summary, /EUR 80 to 190 per day from March to September/);
  assert.match(c.summary, /Laduna Tarifa Center school/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Bungalow', 'Apartment']);
  assert.ok(c.rooms[0].features.includes('July, August and September: Monday to Thursday EUR 130, Friday to Sunday EUR 190 per day'));
  assert.equal(c.imageUrls.length, 13);
  assert.ok(c.imageUrls.every(u => /^https:\/\/campingtarifa\.es\/wp-content\/uploads\/.+\.jpg$/.test(u)));
  assert.equal(campingTarifaLosLances.confidence, 'medium');
});
