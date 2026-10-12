// Pousada Vila Guará: replays Omnibees + vilaguara.com fixtures recorded 2026-10-09 (own-site page
// trimmed of style/script blocks the parser does not read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  vilaGuaraAtins, buildVgSlots, parseVgCalendar, parseVgResults, vgCalendarWindows, vgSampleStay, type VgRoomRate,
} from '../../src/offers/adapters/vila-guara-atins.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/vila-guara-atins');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const results = (ddmmyyyy: string) => parseVgResults(read(`book.omnibees.com_hotelresults_q_18675_c_9888_lang_en-US_currencyId_16_version_4_CheckIn_${ddmmyyyy}`));
const ctx = { note: () => {}, incomplete: () => {} };
const days = [
  ...parseVgCalendar(read('book.omnibees.com_availability_v4_q_18675_16_2026-10-09')),
  ...parseVgCalendar(read('book.omnibees.com_availability_v4_q_18675_16_2027-01-01')),
];

test('vila-guara: calendar windows and days', () => {
  assert.deepEqual(vgCalendarWindows('2026-10-09'), [
    { from: '2026-10-09', to: '2026-12-31' },
    { from: '2027-01-01', to: '2027-03-31' },
  ]);
  assert.equal(days.length, 84 + 90);
  assert.deepEqual(days[0], { date: '2026-10-09', status: 'Open', price: 1425.2, minStay: 2, closedArrival: false });
  assert.equal(days.filter(d => d.status === 'Close').length, 9); // 14-18 and 23-26 Nov 2026
});

test('vila-guara: sample stay = cheapest open arrival honoring min stay', () => {
  assert.deepEqual(vgSampleStay(days, '2026-11'), { checkIn: '2026-11-02', checkOut: '2026-11-03', nights: 1 });
  assert.deepEqual(vgSampleStay(days, '2026-12'), { checkIn: '2026-12-09', checkOut: '2026-12-11', nights: 2 });
});

test('vila-guara: results page -> room rates and rooms left', () => {
  const nov = results('02112026');
  assert.deepEqual(nov.map(r => [r.room, r.nightly, r.maxQuantity, r.roomsLeftText, r.board]), [
    ['Pond', [1044.1], 4, null, 'Breakfast'],
    ['Dune', [1096.58], 6, null, 'Breakfast'],
    ['Kite House', [1151.5], 1, 'There is 1 room left', 'Breakfast'],
  ]);
  assert.deepEqual(results('09122026').map(r => [r.room, r.nightly]), [['Pond', [859.84, 945.83]], ['Dune', [903.07, 993.38]]]);
});

test('vila-guara: slots = room x month', () => {
  const stays: Array<[string, string]> = [['2026-10', '13102026'], ['2026-11', '02112026'], ['2026-12', '09122026'], ['2027-01', '03012027'], ['2027-02', '01022027'], ['2027-03', '01032027']];
  const months = stays.map(([ym, d]) => ({ ym, stay: vgSampleStay(days, ym), results: results(d) as VgRoomRate[] }));
  const slots = buildVgSlots(['Pond', 'Dune', 'Kite House'], days, months);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 18);
  const kh = slots.find(s => s.key === 'kite-house|2026-11')!;
  assert.deepEqual([kh.startDate, kh.endDate, kh.unit, kh.price, kh.currency, kh.priceUnit, kh.priceBasis, kh.occupancy, kh.availability, kh.spotsLeft],
    ['2026-11-01', '2026-11-30', 'Kite House', 1151.5, 'BRL', 'per_night', 'room', 2, 'limited', 1]);
  assert.match(kh.availabilityText!, /There is 1 room left; sample stay 2026-11-02\.\.2026-11-03; 21 of 30 calendar days open/);
  const pondDec = slots.find(s => s.key === 'pond|2026-12')!;
  assert.equal(pondDec.price, 859.84);
  assert.equal(pondDec.availability, 'available');
  const khDec = slots.find(s => s.key === 'kite-house|2026-12')!;
  assert.equal(khDec.availability, 'unknown');
  assert.equal(khDec.price, null);
  assert.equal(slots.filter(s => s.availability === 'available').length, 12); // Pond + Dune every month
  assert.equal(slots.filter(s => s.availability === 'limited').length, 5); // Kite House: 1 room left
});

test('vila-guara: content', async () => {
  const c = await vilaGuaraAtins.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada Vila Guará');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Maranhão');
  assert.equal(c.spot, 'Atins');
  assert.equal(c.mealPlan, 'breakfast');
  assert.deepEqual(c.rooms.map(r => r.name), ['Pond', 'Dune', 'Kite House']);
  assert.ok(c.rooms[2].features.includes('Up to 8 guests'));
  assert.match(c.summary, /from July to December with 15 to 30 knots/);
  assert.equal(c.heroVideoUrl, 'https://vid.cdn-website.com/2ebbda22/videos/Ny3QrRA1TFCIj1hUHwEQ_video-banner-v.mp4');
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/(irp\.cdn-website\.com|media\.omnibees\.com)\//.test(u) && !/flags|[0-9a-f]{8}-[0-9a-f]{4}-/.test(u)));
  assert.ok(c.imageUrls.some(u => u === 'https://media.omnibees.com/Images/18675/Property/1192215.jpg'), 'Omnibees originals without size segment');
  assert.match(c.sourceText!, /Check-in from 2:00 PM/);
});
