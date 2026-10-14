// Bretterbude Heiligenhafen: replays the German pages recorded 2026-10-14 (scripts except JSON-LD, styles, SVGs and all but
// one <source> per <picture> stripped). Slots are built with today pinned so the Schnapper period stays current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bretterbudeHeiligenhafen, bbhLarge, buildBbhSlots, fetchBbhSlots, parseBbhOffer, parseBbhRooms,
} from '../../src/offers/adapters/bretterbude-heiligenhafen.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/bretterbude-heiligenhafen');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('bretterbude: Schnapper winter rate with its travel period', () => {
  const o = parseBbhOffer(read('www.bretterbude-hhf.de_hotel-und-wir_knueller-angebote_winterschnapper.'))!;
  assert.deepEqual([o.price, o.start, o.end], [55, '2026-11-01', '2027-03-18']);
  assert.equal(parseBbhOffer('<p>Kein Angebot</p>'), null);
});

test('bretterbude: one dated slot, dropped after the period', async () => {
  const slots = await fetchBbhSlots('2026-10-14');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 1);
  assert.deepEqual([ok[0].key, ok[0].startDate, ok[0].endDate, ok[0].price, ok[0].currency, ok[0].priceUnit, ok[0].priceBasis, ok[0].availability],
    ['schnapper|2026-11-01', '2026-11-01', '2027-03-18', 55, 'EUR', 'per_night', 'room', 'unknown']);
  assert.deepEqual(buildBbhSlots({ price: 55, start: '2026-11-01', end: '2027-03-18', text: '', terms: null }, '2027-03-19'), []);
});

test('bretterbude: room cards without the van pitches', () => {
  const rooms = parseBbhRooms(read('www.bretterbude-hhf.de_butzen-zimmer.'));
  assert.equal(rooms.length, 17);
  assert.ok(rooms.every(r => !/bulliparkplatz/i.test(r.name)));
  assert.deepEqual(rooms.find(r => r.name === 'Bauwagen Renate')!.facts, ['8 Quadratmeter', '2 Personen', 'Bettwäsche & Handtücher']);
  assert.equal(rooms[0].image, 'https://www.bretterbude-hhf.de/media/w-1920/bb/xl/17-zimmer-kl-butze-meerblick-at-andrea-flak.jpg');
  assert.equal(bbhLarge('https://www.bretterbude-hhf.de/media/w-{width}/bb/5_6/x-y.jpg'), 'https://www.bretterbude-hhf.de/media/w-1920/bb/xl/x-y.jpg');
});

test('bretterbude: content', async () => {
  const c = await bretterbudeHeiligenhafen.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Bretterbude Heiligenhafen');
  assert.equal(c.region, 'Heiligenhafen, Baltic Coast');
  assert.deepEqual(c.spotCoords, { lat: 54.3798742, lng: 10.9795991 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /official kite beach of the town is right in front of the house/);
  assert.match(c.summary, /from EUR 55 per night for stays from 1\.11\.2026 to 18\.3\.2027/);
  assert.match(c.sourceText ?? '', /Der offizielle Kitestrand liegt direkt vor der Bretterbude/);
  assert.match(c.sourceText ?? '', /Einstiegskurse sowie Privatstunden/);
  assert.ok(c.optionalServices.includes('Breakfast for hotel guests: EUR 21.90 per person and day'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.bretterbude-hhf.de/media/w-1920/bb/xl/')));
});
