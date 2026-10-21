// Jaguaríndia Village (Fortim): replays own-site + Omnibees fixtures recorded 2026-10-12 (HTML trimmed of script/style
// bodies; Omnibees results pages compacted to the rate-plan elements and "rooms left" spans; calendar JSON verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jaguarindiaVillageFortim, JV_HOTEL, JV_ROOMS, parseJvUnits } from '../../src/offers/adapters/jaguarindia-village-fortim.js';
import { fixOmnibeesUnits, withOmnibeesRooms } from '../../src/offers/adapters/jaguaribe-lodge-fortim.js';
import { slotRoom } from '../../src/offers/ingest.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/jaguarindia-village-fortim');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_13994_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_13994_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(JV_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};

test('jaguarindia: calendar and sample stays', () => {
  assert.equal(days.length, 81 + 90);
  assert.equal(Math.min(...days.filter(d => d.status === 'Open').map(d => d.price!)), 2400); // calendar lowest; a results sample can be lower (Coconut Bungalow 2160 in Nov)
  assert.deepEqual(sampleStay(days, '2026-12'), { checkIn: '2026-12-01', checkOut: '2026-12-02', nights: 1 });
  const dec = results('2026-12-01', '2026-12-02');
  assert.equal(dec.length, 10);
  assert.ok(dec.every(r => r.board === 'Breakfast'));
  // Omnibees double-encodes "&" in two room names; the engine keeps "&amp;", the adapter decodes it
  assert.ok(dec.some(r => r.room === 'Ocean &amp; Pool Bungalow'));
});

test('jaguarindia: slots = calendar bands + room x month, names decoded (2026-10-12)', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  const names = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  const slots = fixOmnibeesUnits([...buildRunSlots(JV_HOTEL, days), ...buildRoomMonthSlots(JV_HOTEL, names, days, months)]);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 98);
  assert.ok(slots.every(s => !s.unit || !/&amp;/.test(s.unit)));
  const ocean = slots.find(s => s.key === 'ocean-pool-bungalow|2026-11')!;
  assert.deepEqual([ocean.unit, ocean.price, ocean.currency, ocean.priceUnit, ocean.availability, ocean.spotsLeft],
    ['Ocean & Pool Bungalow', 3780, 'BRL', 'per_night', 'limited', 2]);
  assert.equal(slots.find(s => s.key === 'coconut-bungalow|2026-11')!.price, 2160);
  assert.deepEqual(slots.find(s => s.key === 'lowest|2026-10-12')!.price, 3000);
});

test('jaguarindia: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await jaguarindiaVillageFortim.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 98);
});

test('jaguarindia: 10 accommodation cards on the own site', () => {
  const u = parseJvUnits(read('www.jaguarindiavillage.com_acomodacoes_lang_en.'));
  assert.equal(u.length, 10);
  assert.deepEqual([u[0].name, u[0].sizeM2, u[0].maxGuests, u[0].photo],
    ['Villa Jardim', 120, 4, 'https://www.jaguarindiavillage.com/assets/images/acomodacoes/villa-jardim/1.jpg']);
  assert.equal(u.filter(x => /private pool/i.test(x.text)).length, 3);
});

test('jaguarindia: content', async () => {
  const c = await jaguarindiaVillageFortim.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Jaguaríndia Village');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Fortim, Ceará', 'Fortim', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -4.4196938, lng: -37.780387 });
  assert.match(c.summary, /on a 50,000 m2 plot where the Jaguaribe River meets the sea/);
  assert.match(c.summary, /10 accommodation types, from bungalows to garden villas of 75 to 130 m2 for 2 to 6 guests, 3 of them with a private pool/);
  assert.match(c.summary, /Duotone Pro Center Fortim/);
  assert.match(c.summary, /five-day immersion programme with lessons and accommodation at the sister hotel Jaguaribe Lodge/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.rooms.length, 10);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.some(u => u.startsWith('https://media.omnibees.com/Images/13994/')));
  assert.ok(c.imageUrls.every(u => !/\.png|logo|\d+x\d+\//i.test(u)));
  assert.deepEqual(jaguarindiaVillageFortim.quote, { engine: 'omnibees', hotelId: 13994, chainId: 10325, currencyId: 16, currency: 'BRL' });
});

test('jaguarindia: engine rooms link to own-site accommodation cards (slot.room), the unnamed Double Room stays unlinked', async () => {
  const c = await jaguarindiaVillageFortim.fetchContent(ctx);
  const names = c.rooms.map(r => r.name);
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  const units = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  const slots = withOmnibeesRooms(fixOmnibeesUnits([...buildRunSlots(JV_HOTEL, days), ...buildRoomMonthSlots(JV_HOTEL, units, days, months)]), JV_ROOMS);
  assert.ok(Object.values(JV_ROOMS).every(r => names.includes(r)));
  const linked = new Map(slots.filter(s => s.unit).map(s => [s.unit!, slotRoom(names, s)]));
  assert.deepEqual(Object.fromEntries([...linked].sort()), {
    'Bungalow Familiar': 'Bangalô Família',
    'Coconut Bungalow': 'Bangalô Coqueiral',
    'Coqueiral Bungalow & Swimming Pool': 'Bangalô Coqueiral & Pool',
    'Double Room': null,
    'Family Bungalow & Swimming Pool': 'Bangalô Família & Pool',
    'Garden villa': 'Villa Jardim',
    'Grand Villa Garden Superior': 'Grand Villa Jardim Superior',
    'Grand Villa Jardim': 'Grand Villa Jardim',
    'Ocean & Pool Bungalow': 'Bangalô Oceano & Pool',
    'Superior Garden Villa': 'Villa Jardim Superior',
  });
  assert.ok(slots.filter(s => s.key.startsWith('lowest|')).every(s => slotRoom(names, s) === null));
});
