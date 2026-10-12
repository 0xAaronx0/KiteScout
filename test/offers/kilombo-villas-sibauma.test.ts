// Kilombo Villas (Sibaúma, RN): replays www.kilombovillas.com/en/ + Omnibees fixtures recorded 2026-10-12 (HTML
// trimmed of script/style/svg bodies and inline base64 blur placeholders; calendar JSON verbatim).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kilomboVillasSibauma, parseKvKite, parseKvVillas, KV_HOTEL } from '../../src/offers/adapters/kilombo-villas-sibauma.js';
import { buildRoomMonthSlots, buildRunSlots, parseCalendar, parseResults, resultsUrl, sampleStay } from '../../src/offers/engines/omnibees.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kilombo-villas-sibauma');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_1088_16_2026-10-12')),
  ...parseCalendar(read('book.omnibees.com_availability_v4_q_1088_16_2027-01-01')),
];
const results = (checkIn: string, checkOut: string) => {
  const u = new URL(resultsUrl(KV_HOTEL, checkIn, checkOut));
  return parseResults(read(`book.omnibees.com${(u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}`));
};
const home = read('www.kilombovillas.com_en_.');

test('kilombo: slots = calendar bands + villa x month', () => {
  const yms = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
  const months = yms.map(ym => {
    const stay = sampleStay(days, ym);
    return { ym, stay, results: stay ? results(stay.checkIn, stay.checkOut) : null };
  });
  assert.deepEqual(months.map(m => m.stay?.checkIn), ['2026-10-12', '2026-11-01', '2026-12-26', '2027-01-06', '2027-02-10', '2027-03-01']);
  const roomNames = [...new Set(months.flatMap(m => (m.results ?? []).map(r => r.room)))];
  assert.equal(roomNames.length, 10);
  const slots = [...buildRunSlots(KV_HOTEL, days), ...buildRoomMonthSlots(KV_HOTEL, roomNames, days, months)];
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 144);
  const jacu = slots.find(s => s.key === 'villa-jacu-garden-suite|2026-10')!;
  assert.deepEqual([jacu.unit, jacu.price, jacu.currency, jacu.priceUnit, jacu.priceBasis, jacu.occupancy, jacu.availability, jacu.spotsLeft],
    ['Villa Jacú Garden Suite', 933.94, 'BRL', 'per_night', 'room', 2, 'limited', 1]);
  assert.equal(slots.find(s => s.key === 'villa-jacu-ocean|2027-01')!.price, 2162.82);
  assert.equal(slots.find(s => s.key === 'villa-jacu-ocean|2026-12')!.availability, 'unknown'); // the Christmas sample stay returned no villa
  const first = slots.find(s => s.key === 'lowest|2026-10-12')!;
  assert.deepEqual([first.endDate, first.price, first.availability], ['2026-10-15', 1073.5, 'available']);
  assert.equal(slots.find(s => s.key === 'lowest|2026-11-12')!.availability, 'closed');
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 933.94);
});

test('kilombo: live run over the fixtures (2026-10-12 only: the calendar window starts today)', { skip: new Date().toISOString().slice(0, 10) !== '2026-10-12' }, async () => {
  const slots = await kilomboVillasSibauma.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 144);
});

test('kilombo: villa cards and the kite block of the home page', () => {
  const villas = parseKvVillas(home);
  assert.equal(villas.length, 10);
  assert.deepEqual(villas[0], { name: 'Sibraáma Ocean', slug: 'sibraama-ocean', text: 'The Mediterranean essence provides comfort and coziness. Duplex with jacuzzi and sea view.' });
  const kite = parseKvKite(home)!;
  assert.equal(kite.title, 'An exclusive spot for Kite');
  assert.match(kite.text, /powerful winds/);
  assert.match(kite.seo!, /^Experiences include kitesurfing/);
});

test('kilombo: content', async () => {
  const c = await kilomboVillasSibauma.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kilombo Villas');
  assert.deepEqual([c.country, c.region, c.spot, c.mealPlan], ['Brazil', 'Sibaúma, Rio Grande do Norte', 'Praia de Sibaúma', 'breakfast']);
  assert.deepEqual(c.spotCoords, { lat: -6.27333, lng: -35.03667 });
  assert.match(c.summary, /10 villas on Sibaúma beach/);
  assert.match(c.summary, /names no own kite school/);
  assert.equal(c.rooms.length, 10);
  assert.equal(c.rooms.find(r => r.name === 'Villa Sibraáma Ocean')!.description, 'The Mediterranean essence provides comfort and coziness. Duplex with jacuzzi and sea view.');
  assert.ok(c.rooms.every(r => r.description));
  assert.equal(c.imageUrls.length, 30);
  assert.equal(c.imageUrls[0], 'https://www.kilombovillas.com/_next/static/immutable/media/intro-1.1upqm3sr8zdbw.jpg');
  assert.ok(c.imageUrls.every(u => !/_next\/image|\.svg|logo/i.test(u)));
  assert.deepEqual(kilomboVillasSibauma.quote, { engine: 'omnibees', hotelId: 1088, chainId: 1009, currencyId: 16, currency: 'BRL' });
});
