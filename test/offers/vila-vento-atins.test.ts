// Vila Vento (Atins): replays vilavento.com + BedBooking widget API fixtures recorded 2026-10-12
// (site pages trimmed of script/style bodies; the widget key in the settings body is redacted, the URL keeps it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  vilaVentoAtins, buildVvSlots, parseVvBusy, parseVvOffers, parseVvSettings, parseVvSuite, vvClosedDays, vvMinStay,
  vvOffersUrl, vvSampleStays, vvWindow, type VvSampleResult,
} from '../../src/offers/adapters/vila-vento-atins.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/vila-vento-atins');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const readUrl = (url: string) => read(new URL(url).hostname + new URL(url).pathname.replace(/[^A-Za-z0-9._-]+/g, '_'));
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-12';
const settings = parseVvSettings(read('api-widget.bed-booking.com_settings_key_'));
const busy = parseVvBusy(read('api-widget.bed-booking.com_offers_busy_vilavento_'));

test('vila-vento: BedBooking settings and busy calendar', () => {
  assert.deepEqual(settings.rooms.map(r => [r.id, r.name, r.capacity]), [
    [586911, 'Meltemi', 4], [587755, 'Vila Alize', 10], [588100, 'Mistral', 4], [1661417, 'Monsoon', 4], [1661418, 'Casa Pescador', 6],
  ]);
  assert.equal(settings.minDays, 2);
  assert.equal(vvMinStay(settings, 587755, '2026-11-20'), 2);
  assert.deepEqual(vvWindow(TODAY), { from: '2026-10-12', to: '2027-03-31' });
  assert.equal(busy.size, 5);
  assert.ok(busy.get(588100)!.has('2026-11-13') && !busy.get(588100)!.has('2026-11-20'));
  const closed = vvClosedDays(settings.rooms, busy, ['2026-12-21', '2026-12-22', '2027-03-31']);
  assert.deepEqual([...closed], []); // a 3-day list is too short to call a closure
});

test('vila-vento: sample stays cover the free units per month', () => {
  const stays = vvSampleStays(settings, busy, TODAY);
  assert.deepEqual(stays.map(s => [s.checkIn, s.checkOut, s.rooms.length]), [
    ['2026-10-18', '2026-10-20', 4], ['2026-10-24', '2026-10-26', 1], ['2026-11-09', '2026-11-11', 5], ['2026-12-03', '2026-12-05', 5],
  ]);
  assert.equal(vvOffersUrl('2026-11-09', '2026-11-11'), 'https://api-widget.bed-booking.com/offers/vilavento/start/1794182400/end/1794355200/persons/2/kids/0/age/0');
  const nov = parseVvOffers(readUrl(vvOffersUrl('2026-11-09', '2026-11-11')));
  assert.deepEqual([...nov], [[586911, 1400], [587755, 2640], [588100, 1400], [1661417, 1400], [1661418, 1650]]);
});

test('vila-vento: bands per unit (free with price / booked / closed)', () => {
  const results: VvSampleResult[] = vvSampleStays(settings, busy, TODAY)
    .map(stay => ({ stay, prices: parseVvOffers(readUrl(vvOffersUrl(stay.checkIn, stay.checkOut))) }));
  const slots = buildVvSlots(settings, busy, results, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 58);
  const m = slots.find(s => s.key === 'mistral|2026-11-20')!;
  assert.deepEqual([m.startDate, m.endDate, m.unit, m.price, m.currency, m.priceUnit, m.priceBasis, m.occupancy, m.availability, m.minNights],
    ['2026-11-20', '2026-11-29', 'Mistral', 1400, 'BRL', 'per_night', 'room', 2, 'available', 2]);
  assert.match(m.availabilityText!, /sample stay 2026-11-09\.\.2026-11-11/);
  const booked = slots.find(s => s.key === 'mistral|2026-11-13')!;
  assert.deepEqual([booked.endDate, booked.price, booked.availability], ['2026-11-19', null, 'sold_out']);
  const closed = slots.filter(s => s.availability === 'closed');
  assert.deepEqual(closed.map(s => [s.unit, s.startDate, s.endDate]), settings.rooms.map(r => [r.name, '2026-12-22', '2027-03-31']));
  assert.equal(slots.find(s => s.key === 'vila-alize|2026-10-12')!.price, 2860);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 1400);
});

test('vila-vento: unit page parser', () => {
  const s = parseVvSuite(read('www.vilavento.com_SPAges_suite.aspx_s_bungalow-mistral_'));
  assert.equal(s.name, 'Bungalow Mistral');
  assert.equal(s.guests, 4);
  assert.match(s.description, /queen size bed and 2 single beds/);
  assert.ok(s.amenities.includes('A/C') && s.amenities.includes('large varanda with sea view') && s.amenities.includes('kettle & glass ware'));
  assert.ok(!/Feugiat|lorem/i.test(s.description)); // template filler sits in an HTML comment
});

test('vila-vento: content', async () => {
  const c = await vilaVentoAtins.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Vila Vento');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Maranhão');
  assert.equal(c.spot, 'Atins');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /own Lençóis Kiteboarding School/);
  assert.match(c.summary, /launch and land their kites in the hotel yard/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Bungalow Mistral', 'Bungalow Meltemi', 'Bungalow Monsoon', 'Vila Alize Beach House', 'Casa do Pescador']);
  assert.ok(c.rooms[2].features.includes('Marked "coming soon" on the website'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/www\.vilavento\.com\/(data\/sites\/1\/GalleryImages|SPages\/home_files\/images)\//.test(u) && !/captura|logo/i.test(u)));
});

test('vila-vento: every BedBooking unit prices its site unit (content room)', async () => {
  const c = await vilaVentoAtins.fetchContent(ctx);
  const results: VvSampleResult[] = vvSampleStays(settings, busy, TODAY)
    .map(stay => ({ stay, prices: parseVvOffers(readUrl(vvOffersUrl(stay.checkIn, stay.checkOut))) }));
  const slots = buildVvSlots(settings, busy, results, TODAY);
  const names = c.rooms.map(r => r.name);
  assert.deepEqual(Object.fromEntries(slots.map(s => [s.unit, slotRoom(names, s)])), {
    Meltemi: 'Bungalow Meltemi',
    'Vila Alize': 'Vila Alize Beach House',
    Mistral: 'Bungalow Mistral',
    Monsoon: 'Bungalow Monsoon',
    'Casa Pescador': 'Casa do Pescador',
  });
});
