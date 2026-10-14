// Kite Marina Sarbsk: replays the Polish pages recorded 2026-10-12 (2026 price tables, season over).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteMarinaSarbsk, buildKmSlots, kmCoords, kmNightBands, kmRoomNameEn, miroArtImages, parseKmRoomCards, parseKmTables,
} from '../../src/offers/adapters/kite-marina-sarbsk.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-marina-sarbsk');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kite marina: room cards on /pokoje/', () => {
  const cards = parseKmRoomCards(read('www.kitemarina.pl_pokoje_.'));
  assert.equal(cards.length, 8);
  assert.deepEqual(cards.map(c => [c.slug, c.nameEn, c.maxPersons, c.sizeM2]), [
    ['pokoj-2-os-z-balkonem-z-widokiem-na-jezioro', 'Double room with balcony and lake view', 2, 20],
    ['pokoj-2-os-z-balkonem', 'Double room with balcony', 2, 20],
    ['pokoj-3-os-z-tarasem-i-widokiem-na-jezioro', 'Triple room with terrace and lake view', 3, 25],
    ['pokoj-3-os-z-tarasem-3', 'Triple room with terrace', 3, 25],
    ['pokoj-rodzinny-z-widokiem-na-jezioro', 'Family room with terrace and lake view', 4, 25],
    ['pokoj-rodzinny-z-tarasem', 'Family room with terrace', 4, 25],
    ['apartament-2-os-z-tarasem-i-widokiem-na-jezioro', 'Premium room with terrace and lake view', 4, 30],
    ['apartament-2-os-z-tarasem', 'Premium room with terrace', 4, 30],
  ]);
  assert.equal(kmRoomNameEn('Pokój 3 osobowy z tarasem'), 'Triple room with terrace');
});

test('kite marina: price table, departure-day ends, holiday overlay', () => {
  const [t] = parseKmTables(read('www.kitemarina.pl_pokoje_pokoj-2-os-z-balkonem-z-widokiem-na-jezioro_.'));
  assert.equal(t.occupancy, null);
  assert.deepEqual(t.bands.map(b => [b.start, b.endExclusive, b.label, b.price, b.dinner]), [
    ['2026-04-30', '2026-05-04', 'May Day holidays', 480, false],
    ['2026-05-04', '2026-07-04', null, 440, false],
    ['2026-06-04', '2026-06-07', 'Corpus Christi', 480, false],
    ['2026-07-04', '2026-08-22', null, 760, true],
    ['2026-08-22', '2026-09-27', null, 430, false],
  ]);
  // Corpus Christi splits the May-July band; a band's last night is the day before the printed end
  assert.deepEqual(kmNightBands(t.bands).map(n => [n.start, n.end, n.band.price]), [
    ['2026-04-30', '2026-05-03', 480], ['2026-05-04', '2026-06-03', 440], ['2026-06-04', '2026-06-06', 480],
    ['2026-06-07', '2026-07-03', 440], ['2026-07-04', '2026-08-21', 760], ['2026-08-22', '2026-09-26', 430],
  ]);
});

test('kite marina: Premium rooms have one table per occupancy', () => {
  const tables = parseKmTables(read('www.kitemarina.pl_pokoje_apartament-2-os-z-tarasem_.'));
  assert.deepEqual(tables.map(t => [t.occupancy, t.bands.map(b => b.price)]), [
    [2, [580, 460, 580, 840, 480]], [3, [750, 610, 750, 1120, 660]], [4, [860, 710, 860, 1270, 720]],
  ]);
});

test('kite marina: slots = room x occupancy x band, PLN per room per night, on request', async () => {
  const slots = await kiteMarinaSarbsk.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 72); // 6 rooms x 6 bands + 2 Premium rooms x 3 occupancies x 6 bands
  assert.ok(slots.every(s => s.currency === 'PLN' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'));
  const cheapest = [...slots].sort((a, b) => a.price! - b.price!)[0];
  assert.deepEqual([cheapest.key, cheapest.unit, cheapest.price, cheapest.startDate, cheapest.endDate], [
    'pokoj-2-os-z-balkonem-2p|2026-05-04', 'Double room with balcony', 390, '2026-05-04', '2026-06-03',
  ]);
  const top = slots.find(s => s.key === 'apartament-2-os-z-tarasem-i-widokiem-na-jezioro-4p|2026-07-04')!;
  assert.deepEqual([top.price, top.occupancy, top.endDate], [1320, 4, '2026-08-21']);
  assert.deepEqual(buildKmSlots([]), []);
});

test('kite marina: content', async () => {
  const c = await kiteMarinaSarbsk.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Marina Sarbsk');
  assert.equal(c.country, 'Poland');
  assert.equal(c.region, 'Sarbsk, Pomerania');
  assert.deepEqual(c.spotCoords, { lat: 54.762278, lng: 17.642113 });
  assert.deepEqual(kmCoords(read('www.kitemarina.pl_kontakt_.')), c.spotCoords);
  assert.match(c.summary, /37 rooms and 6 Premium rooms/);
  assert.match(c.summary, /kitesurfing, windsurfing, surfing and SUP/);
  assert.match(c.summary, /PLN 390 to 1320 per night \(season 30\.04\.2026 to 27\.09\.2026/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.rooms.length, 8);
  assert.ok(c.rooms[0].features.includes('No extra bed possible'));
  assert.ok(c.rooms[6].features.some(f => /^2026 rates for 4 persons .*1320 incl\. dinner/.test(f)));
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.kitemarina.pl/img2/w1140-h900/files/gallery/') && !/rzut|logo|\.svg/i.test(u)));
});

test('kite marina: MiroArt image helper (data-source + photoswipe, dedup by file name)', () => {
  const html = '<div data-source="-q80-p1/files/gallery/1/a.jpg"></div><a href="/img2/w1140-h900/files/gallery/2/a.jpg"></a>'
    + '<a href="/img2/w1140-h900/files/gallery/3/1-rzut_pitro.jpg"></a><img src="/img2/w170-h170/files/gallery/4/b.webp">';
  assert.deepEqual(miroArtImages(html, 'https://x.pl', 'w1140-h900'), [
    'https://x.pl/img2/w1140-h900/files/gallery/1/a.jpg', 'https://x.pl/img2/w1140-h900/files/gallery/4/b.webp',
  ]);
});
