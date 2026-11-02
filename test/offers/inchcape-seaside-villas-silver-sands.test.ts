// Inchcape Seaside Villas (Silver Sands, Barbados): replays the Lodgify site pages recorded 2026-10-12
// (embedded lodgify-model-json / lodgify-swr-fallback-json pruned to the fields the adapter reads).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  inchcapeSeasideVillasSilverSands, buildIcSlots, parseIcNotes, parseIcProperty, parseIcRates, parseIcRooms,
  parseInchcapeContent,
} from '../../src/offers/adapters/inchcape-seaside-villas-silver-sands.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/inchcape-seaside-villas-silver-sands');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const rates = read('inchcape.net_en_1725230_rates.');
const TODAY = '2026-10-12';

test('ic: embedded rate data = 17 room types, USD, real season periods', () => {
  const { rooms, summaryCurrency } = parseIcRates(rates);
  assert.equal(rooms.length, 17);
  assert.equal(summaryCurrency, 'USD');
  const seaside = rooms.find(r => r.name === 'House Seaside')!;
  assert.deepEqual([seaside.defaultPrice, seaside.defaultCurrency], [395, 'USD']);
  assert.deepEqual(seaside.periods.slice(0, 4).map(p => [p.name, p.start, p.end, p.price, p.currency]), [
    ['Autumn 2025 - 2027', '2026-09-01', '2026-10-31', 240, 'USD'],
    ['Low Season 2025 - 2027', '2026-11-01', '2026-12-14', 310, 'USD'],
    ['High Season 2025 - 2027', '2026-12-15', '2026-12-19', 410, 'USD'],
    ['Christmas 2025 - 2028', '2026-12-20', '2027-01-05', 475, 'USD'],
  ]);
  assert.ok(rooms.every(r => r.periods.every(p => p.currency === 'USD')));
});

test('ic: room types from the page model (guests, area, beds, images)', () => {
  const rooms = parseIcRooms(rates);
  assert.equal(rooms.length, 17);
  const courtyard = rooms.find(r => r.name === 'Courtyard by the Sea')!;
  assert.deepEqual([courtyard.maxGuests, courtyard.areaM2], [5, 200]);
  assert.ok(courtyard.features.includes('1 King-size bed'));
  assert.ok(courtyard.images.length > 10 && courtyard.images.every(u => u.startsWith('https://l.icdbcdn.com/oh/')));
  assert.deepEqual(parseIcProperty(read('inchcape.net_en_1725232_map.')).lat, 13.046714);
});

test('ic: slots = room x season period from today, USD per unit per night', () => {
  const { rooms } = parseIcRates(rates);
  const guests = new Map(parseIcRooms(rates).map(r => [r.id, r.maxGuests] as const));
  const slots = buildIcSlots(rooms, guests, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 170); // 17 units x 10 periods (2026-09-01 .. 2028-01-05), no default-rate gaps
  const by = (k: string) => slots.find(s => s.key === k)!;
  assert.deepEqual([by('house-seaside|2026-12-20').price, by('house-seaside|2026-12-20').endDate], [475, '2027-01-05']);
  assert.deepEqual([by('courtyard-by-the-sea|2027-01-06').price, by('courtyard-by-the-sea|2027-01-06').occupancy], [410, 5]);
  assert.equal(Math.min(...slots.map(s => s.price!)), 130); // Seaview / Coconut Studio, autumn
  assert.ok(slots.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
  // a period that ended before "today" is dropped
  assert.equal(buildIcSlots(rooms, guests, '2026-11-01').filter(s => s.startDate === '2026-09-01').length, 0);
});

test('ic: a gap between seasons gets the default rate; a rate without currency is skipped', () => {
  const notes: string[] = [];
  const slots = buildIcSlots([{
    id: '1', name: 'Test Unit', defaultPrice: 99, defaultCurrency: 'USD', periods: [
      { name: 'A', start: '2027-01-01', end: '2027-01-10', price: 100, currency: 'USD', isDefault: false },
      { name: 'B', start: '2027-01-20', end: '2027-01-31', price: 120, currency: null, isDefault: false },
    ],
  }], new Map(), TODAY, { note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots.map(s => [s.startDate, s.endDate, s.price]), [['2027-01-01', '2027-01-10', 100], ['2027-01-11', '2027-01-19', 99]]);
  assert.equal(notes.length, 1);
});

test('ic: fees and rules', () => {
  const notes = parseIcNotes(read('inchcape.net_en_1714085_how-to-book.'), rates);
  assert.ok(notes.includes('All rates are per apartment per night in $ US, 10% Gov. tax is to be added'));
  assert.ok(notes.some(n => /designated storage areas where equipment can be stored/.test(n)));
});

test('ic: fetchSlots replays the rates page', async () => {
  const slots = await inchcapeSeasideVillasSilverSands.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(slots.every(s => s.currency === 'USD'));
});

test('ic: content', async () => {
  const c = await inchcapeSeasideVillasSilverSands.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  const pages = {
    home: read('inchcape.net_.'), kite: read('inchcape.net_en_1714087_kitesurfing.'), rates,
    map: read('inchcape.net_en_1725232_map.'), book: read('inchcape.net_en_1714085_how-to-book.'),
  };
  const d = parseInchcapeContent(pages, TODAY);
  assert.equal(d.title, 'Inchcape Seaside Villas');
  assert.equal(d.country, 'Barbados');
  assert.equal(d.spot, 'Silver Sands');
  assert.deepEqual(d.spotCoords, { lat: 13.046714, lng: -59.517865 });
  assert.equal(d.mealPlan, 'self_catering');
  assert.equal(d.kiteLessons, null);
  assert.match(d.summary, /17 self-catering studios/);
  assert.match(d.summary, /Brian Talma's Action Shop at Silver Rock/);
  assert.match(d.summary, /USD 130 to 530 per unit per night/);
  assert.equal(d.rooms.length, 17);
  assert.ok(d.rooms[0].features.includes('Christmas 2025 - 2028: USD 475 per night'));
  assert.equal(d.imageUrls.length, 40);
  assert.match(d.sourceText ?? '', /Super Summer 2026 Offers/);
  assert.ok(!/[–—]/.test(d.summary));
});

test('ic: each unit has its own Lodgify gallery, its beach shots are spot photos', async () => {
  const c = await inchcapeSeasideVillasSilverSands.fetchContent(ctx);
  // Sunset Upstairs, Sunrise Beach House and the Deluxe 1Bed Villa lose their 5 / 6 / 4 beach-captioned shots
  assert.deepEqual(c.rooms.map(r => r.imageUrls?.length ?? 0), [25, 26, 18, 21, 21, 24, 21, 18, 24, 25, 26, 23, 23, 23, 26, 19, 25]);
  const house = c.rooms.find(r => r.name === 'House Seaside')!;
  assert.equal(house.imageUrls![0], 'https://l.icdbcdn.com/oh/0938366e-4b85-44af-81fe-1947893df45e.jpg'); // its mainImage
  assert.match(c.rooms.find(r => r.name === 'Deluxe 1Bed Apartment D')!.imageUrls![0], /0176dd16-c9d1-4166-ad99-96f48fda46c0\.jpg$/);
  const parsed = parseIcRooms(rates);
  assert.deepEqual(c.rooms.map(r => r.imageUrls![0]), parsed.map(r => r.images[0]));
  const all = c.rooms.flatMap(r => r.imageUrls!);
  assert.equal(new Set(all).size, all.length); // no photo shared between two units
  assert.ok(all.every(u => /^https:\/\/l\.icdbcdn\.com\/oh\/[0-9a-f-]+\.(jpe?g|png)$/.test(u)));
  assert.ok(c.rooms.every(r => c.imageUrls.includes(r.imageUrls![0]))); // same URLs as the general list
  // spot: captions "Silver Sands Beach at our Villas", "Inchcape's Beach" (11), "Aerial view of SSB" (3), nothing else
  assert.equal(c.spotImageUrls?.length, 15);
  const sunset = parsed.find(r => r.name === 'Sunset Upstairs by the Sea')!;
  assert.equal(sunset.imageText[c.spotImageUrls![0]], 'Silver Sands Beach at our Villas');
  const caption = (u: string) => parsed.map(r => r.imageText[u]).find(Boolean);
  assert.deepEqual([...new Set(c.spotImageUrls!.map(caption))], ['Silver Sands Beach at our Villas', "Inchcape's Beach", 'Aerial view of SSB']);
  assert.ok(!c.spotImageUrls!.some(u => all.includes(u)));
  const plan = planGallery(c);
  assert.deepEqual(plan.dropped, []);
  const first24 = plan.candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(first24.includes(r.imageUrls![0]), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
