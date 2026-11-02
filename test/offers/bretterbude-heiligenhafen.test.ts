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
import { planGallery } from '../../src/offers/gallery.js';

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

test('bretterbude: own photos per room and kite photos of the kitesurfing page', async () => {
  const c = await bretterbudeHeiligenhafen.fetchContent(ctx);
  const file = (u: string) => u.split('/').pop()!;
  const photos = (n: string) => c.rooms.find(r => r.name === n)!.imageUrls!;
  assert.equal(c.rooms.length, 17);
  assert.ok(c.rooms.every(r => r.imageUrls?.length && r.imageUrls.every(u => u.startsWith('https://www.bretterbude-hhf.de/media/w-1920/bb/xl/'))));
  // every room starts with its card teaser
  assert.deepEqual(c.rooms.map(r => r.imageUrls![0]), parseBbhRooms(read('www.bretterbude-hhf.de_butzen-zimmer.')).map(r => r.image));
  assert.deepEqual(photos('Kleine Butze Meerblick').map(file), ['17-zimmer-kl-butze-meerblick-at-andrea-flak.jpg', '14-zimmer-kl-butze-meerblick-at-andrea-flak.jpg']);
  assert.deepEqual(photos('Etagenbutze Meerblick').map(file), [
    '08-bretterbude-at-andrea-flak.jpg', '32-bretterbude-etagenbutze-at-andrea-flak.jpg', '160823-moodd-etagenbutze-c5a2414-at-andrea-flak.jpg', '29-bretterbude-etagenbutze-meer-at-andrea-flak.jpg',
  ]);
  assert.ok(!photos('Etagenbutze Landblick').some(u => /etagenbutze-meer/.test(u)));
  assert.match(photos('Etagenbutze Landblick')[0], /28-bretterbude-etagenbutze-land/);
  assert.equal(photos('Jägermeister Butze').length, 3);
  assert.match(photos('Jägermeister Butze')[1], /bb-hhf-jaegermeister-suite-0193/);
  assert.deepEqual(photos('XXL Butze').map(file), ['bb-xxl-butze-levis-carolin-wehmer-9.jpg', 'bb-xxl-butze-levis-carolin-wehmer-15.jpg']);
  assert.deepEqual(photos('XL Butze').map(file), ['161108-02-butze-83-bretterbde-at-andrea-flak.jpg']);
  assert.match(photos('Bauwagen Renate')[0], /bauwagen-renate50/);
  assert.match(photos('Große Butze Meerblick mit Balkon')[0], /10-zimmer-01/);
  assert.equal(c.rooms.filter(r => r.imageUrls!.length === 1).length, 12); // teaser only
  assert.deepEqual(c.spotImageUrls?.map(file), [
    'img-0526-at-jens-hogenkamp.jpg', 'f5j3637-at-jens-hogenkamp.jpg', 'img-3206-at-jens-hogenkamp.jpg', 'img-8494-at-jens-hogenkamp.jpg', 'f5j3867-at-jens-hogenkamp.jpg',
  ]);
  const plan = planGallery(c);
  assert.deepEqual(plan.dropped, []);
  const first24 = plan.candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
