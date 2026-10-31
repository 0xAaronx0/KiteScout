// Villa Rasa (Praia Rasa, Búzios): replays villarasa.com.br (/home-en/, /experiencias/, /acomodacoes/) + Omnibees
// fixtures recorded 2026-10-12 (HTML trimmed of script/style/svg bodies; calendar JSON verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { villaRasaBuzios, parseVrRoomPhotos, parseVrRooms, vrCardNames, vrKitePhotos, VR_HOTEL } from '../../src/offers/adapters/villa-rasa-buzios.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/villa-rasa-buzios');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_21103_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_21103_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(VR_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('villa rasa: slots = calendar bands + room x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  assert.deepEqual(months.map(m => m.stay?.checkIn), ['2026-10-18', '2026-11-03', '2026-12-01', '2027-01-24', '2027-02-01', '2027-03-01']);
  const roomNames = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  assert.equal(roomNames.length, 8);
  const slots = [...buildRunSlots(VR_HOTEL, days), ...buildRoomMonthSlots(VR_HOTEL, roomNames, days, months)];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 132);
  const std = slots.find(s => s.key === 'standard-apartment-need-to-cross-the-street|2026-10')!;
  assert.deepEqual([std.price, std.currency, std.priceUnit, std.priceBasis, std.occupancy, std.availability, std.spotsLeft],
    [686.94, 'BRL', 'per_night', 'room', 2, 'limited', 2]);
  assert.equal(slots.find(s => s.key === 'villa-suite|2027-01')!.price, 4295.78);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 686.94);
});

test('villa rasa: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await villaRasaBuzios.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 132);
});

test('villa rasa: own-site room facts and full Omnibees card names', () => {
  const rooms = parseVrRooms(read('villarasa.com.br_acomodacoes_.'));
  assert.deepEqual(rooms.map(r => r.name), ['Suíte da Villa', 'Suíte Master', 'Suíte Master com Banheira', 'Suíte Luxo',
    'Apartamento Superior', 'Apartamento Superior com Varanda', 'Suíte Jardim', 'Apartamento Standard']);
  assert.deepEqual([rooms[0].units, rooms[0].size, rooms[0].maxGuests], [1, '90', 3]);
  assert.ok(rooms[0].amenities.includes('Hidro Ofurô'));
  assert.deepEqual([rooms[5].units, rooms[5].size], [10, '25-35']);
  assert.ok(rooms[7].amenities.some(a => /atravessar a rua/.test(a)));
  const names = vrCardNames(read('book.omnibees.com_chain_11108_hotel_21103_lang_en-US'));
  assert.ok(names.includes('Garden Suite - (Need to Cross the Street)'));
  assert.ok(names.every(n => !n.endsWith('...')));
});

test('villa rasa: content', async () => {
  const c = await villaRasaBuzios.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Villa Rasa');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Búzios, Rio de Janeiro', 'Praia Rasa', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -22.7607688, lng: -41.9412575 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /with 35 apartments and suites/);
  assert.match(c.summary, /Surf, kitesurf and wing foil lessons are booked directly at the reception/);
  assert.match(c.sourceText!, /KITESURF E WING FOIL|Kitesurf e Wing Foil/);
  assert.equal(c.rooms.length, 8);
  assert.equal(c.rooms.find(r => r.name === 'Villa Suite')!.description, '1 unit, 90 m2, up to 3 guests');
  assert.ok(c.rooms.find(r => r.name === 'Villa Suite')!.features.includes('Hot tub'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/selos|popup|logo|-\d+x\d+\./i.test(u)));
  assert.deepEqual(villaRasaBuzios.quote, { engine: 'omnibees', hotelId: 21103, chainId: 11108, currencyId: 16, currency: 'BRL' });
});

test('villa rasa: own photos per room type from its /acomodacoes/ tab panel, kite photos from #kitesurf on /experiencias/', async () => {
  const panels = parseVrRoomPhotos(read('villarasa.com.br_acomodacoes_.'));
  assert.deepEqual([...panels].map(([name, urls]) => [name, urls.length]), [
    ['Suíte da Villa', 12], ['Suíte Master', 7], ['Suíte Master com Banheira', 5], ['Suíte Luxo', 13],
    ['Apartamento Superior', 15], ['Apartamento Superior com Varanda', 7], ['Suíte Jardim', 13], ['Apartamento Standard', 12],
  ]);
  const c = await villaRasaBuzios.fetchContent(ctx);
  const photos = (name: string) => c.rooms.find(r => r.name === name)!.imageUrls ?? [];
  assert.deepEqual(c.rooms.map(r => [r.name, photos(r.name).length]), [
    ['Superior Apartment', 15], ['Superior Apartment with Balcony', 7], ['Villa Suite', 12],
    ['Standard Apartment - (Need to Cross the Street)', 12], ['Luxury Suite with bathtub', 13], ['Master Suite', 7],
    ['Master Suite with Bathtub', 5], ['Garden Suite - (Need to Cross the Street)', 13],
  ]);
  assert.match(photos('Villa Suite')[0], /\/2024\/06\/1-capa-suite-da-villa-4\.jpg$/);
  assert.match(photos('Master Suite')[0], /\/2024\/06\/master-1\.jpg$/);
  // the panel of the suite with bathtub: four master-1-* photos plus master-com-banheira-4 (none of the plain Master Suite)
  assert.match(photos('Master Suite with Bathtub')[0], /\/2024\/06\/master-1-2\.jpg$/);
  assert.ok(photos('Master Suite with Bathtub').some(u => /master-com-banheira-4\.jpg$/.test(u)));
  assert.ok(photos('Master Suite with Bathtub').every(u => !photos('Master Suite').includes(u)));
  assert.match(photos('Luxury Suite with bathtub')[0], /\/2024\/06\/1-capa-luxo-1-7\.jpg$/);
  assert.match(photos('Superior Apartment')[0], /\/2024\/06\/1-capa-superior-1-9-sem-luz\.jpg$/);
  assert.match(photos('Superior Apartment with Balcony')[0], /\/2024\/06\/1-capa-superior-com-varanda-1-3\.jpg$/);
  assert.match(photos('Garden Suite - (Need to Cross the Street)')[0], /\/2025\/10\/1-1\.jpg$/);
  assert.match(photos('Standard Apartment - (Need to Cross the Street)')[0], /\/2024\/06\/1-capa-standard-2\.jpg$/);
  const all = c.rooms.flatMap(r => r.imageUrls ?? []);
  assert.equal(new Set(all).size, all.length); // no photo is given to two room types
  assert.ok(all.every(u => /^https:\/\/villarasa\.com\.br\/wp-content\/uploads\/.+\.jpe?g$/.test(u) && !/-\d+x\d+\./.test(u)));
  // #kitesurf slider: the JPEG kite teaser first, then the 7 PNG slides in slider order
  assert.deepEqual(c.spotImageUrls, vrKitePhotos(read('villarasa.com.br_experiencias_.')));
  assert.equal(c.spotImageUrls!.length, 1); // the JPEG; the 7 PNG slides of the slider are left out
  assert.equal(c.spotImageUrls![0], 'https://villarasa.com.br/wp-content/uploads/2022/07/c2ee2da1-f2d8-4c4b-88f3-631d4476b253-2-1.jpg');
  const plan = planGallery(c);
  assert.deepEqual(plan.dropped, []);
  const first24 = plan.candidates.slice(0, 24);
  for (const r of c.rooms) if (r.imageUrls?.length) assert.ok(r.imageUrls.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
