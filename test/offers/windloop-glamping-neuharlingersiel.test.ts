// Windloop Kite Week & Sleep (Neuharlingersiel): replays the pages recorded 2026-10-14 (script / style / svg bodies
// dropped except the contact page's map script, whose Google Maps API key is REDACTED).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  windloopGlampingNeuharlingersiel, buildWlpSlots, fetchWlpSlots, inferWeekYear, parseWlpCamp, parseWlpContact,
} from '../../src/offers/adapters/windloop-glamping-neuharlingersiel.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/windloop-glamping-neuharlingersiel');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const campHtml = read('www.windloop.de_kurse_kite-week');

test('windloop: camp weeks (year from the Wednesday start), prices', () => {
  const camp = parseWlpCamp(campHtml, '2026-10-14');
  assert.deepEqual(camp.weeks, [
    { start: '2026-06-03', end: '2026-06-07', label: null },
    { start: '2026-06-17', end: '2026-06-21', label: 'Girls only mit Jantje' },
    { start: '2026-07-01', end: '2026-07-05', label: null },
    { start: '2026-07-15', end: '2026-07-19', label: null },
  ]);
  assert.deepEqual([camp.campPrice, camp.tentPrice, camp.breakfast, camp.kurbeitrag, camp.parking, camp.durationDays], [599, 35, 10, 3, 10, 5]);
  // same list read in spring 2027 still resolves to 2026 (no Wednesday in 2027/2028); 2027 dates resolve to 2027
  assert.equal(inferWeekYear(3, 6, '2027-03-01'), 2026);
  assert.equal(inferWeekYear(2, 6, '2026-10-14'), 2027);
});

test('windloop: slots = future camp weeks, EUR per person (tent extra)', async () => {
  assert.deepEqual(await fetchWlpSlots(ctx, '2026-10-14'), []);
  const spring = buildWlpSlots(parseWlpCamp(campHtml, '2026-05-01'), '2026-05-01');
  assert.deepEqual(checkSlots(spring).problems, []);
  assert.deepEqual(spring.map(s => [s.key, s.startDate, s.endDate, s.price, s.priceUnit, s.priceBasis, s.availability]), [
    ['kite-week-sleep|2026-06-03', '2026-06-03', '2026-06-07', 599, 'package', 'person', 'unknown'],
    ['kite-week-sleep|2026-06-17', '2026-06-17', '2026-06-21', 599, 'package', 'person', 'unknown'],
    ['kite-week-sleep|2026-07-01', '2026-07-01', '2026-07-05', 599, 'package', 'person', 'unknown'],
    ['kite-week-sleep|2026-07-15', '2026-07-15', '2026-07-19', 599, 'package', 'person', 'unknown'],
  ]);
  assert.equal(spring[1].unit, 'Kite Week & Sleep camp (5 days; glamping tent extra) - Girls only mit Jantje');
  assert.deepEqual(buildWlpSlots(parseWlpCamp(campHtml, '2026-06-10'), '2026-06-10').map(s => s.startDate), ['2026-06-17', '2026-07-01', '2026-07-15']);
});

test('windloop: contact page map marker and season notice', () => {
  assert.deepEqual(parseWlpContact(read('www.windloop.de_kontakt.')), {
    coords: { lat: 53.700978, lng: 7.694482 }, closed: '1.10.2026', reopens: '01.05.2027', address: 'Edo-Edzards-Str. 1 26427 Neuharlingersiel',
  });
});

test('windloop: content (kind camp, 5 days)', async () => {
  const c = await windloopGlampingNeuharlingersiel.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 5);
  assert.equal(c.region, 'Neuharlingersiel, East Frisia');
  assert.deepEqual(c.spotCoords, { lat: 53.700978, lng: 7.694482 });
  assert.match(c.summary, /EUR 35 per tent per night, booked with the camp/);
  assert.match(c.summary, /closed for the winter from 1 October 2026 and reopens on 1 May 2027/);
  assert.ok(c.optionalServices.includes('Glamping tent (double) on the Nordsee Campingplatz: EUR 35 per night'));
  assert.match(c.sourceText ?? '', /Glamping- Zelten, welche während der Camp- Woche genutzt werden/);
  assert.equal(c.imageUrls.length, 6);
  assert.ok(c.imageUrls[0].endsWith('IMG_4503.jpeg?1772438127'));
});
