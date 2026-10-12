// Kenyaways (Galu Beach, Diani): replays the rooms, facilities and terms pages recorded 2026-10-12.
// Prices are hand-read constants (KW_SHEETS); the tests pin them and the liveness rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kenyawaysDiani, buildKwSlots, mapPin, parseKenyawaysContent, parseKwRooms, rateLinks,
} from '../../src/offers/adapters/kenyaways-diani.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kenyaways-diani');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const rooms = read('www.thekenyaway.com_bedandbreakfast-rooms-rates.');
const facilities = read('www.thekenyaway.com_facilities.');
const terms = read('www.thekenyaway.com_rates-and-booking-terms.');
const TODAY = '2026-10-12';
const ALL = ['/s/2027-Kaskazi-rates.pdf', '/s/2026-Kusi-rates.jpg', '/s/2027-Peak-rates.pdf'];
const NAMES = ['Crossbow', 'Rebel', 'Tribal', 'Raven', 'Fuel', 'Bolt', 'Park', 'Bandit', 'Cult'];

test('kenyaways: 9 room blocks and the three rate-sheet links', () => {
  const rs = parseKwRooms(rooms);
  assert.deepEqual(rs.map(r => r.name), NAMES);
  assert.equal(rs[0].type, 'Sea view with Aircon');
  assert.equal(rs[0].sleeps, 'Sleeps maximum of 4 in twin double beds.');
  assert.deepEqual(rateLinks(rooms), ALL);
  assert.deepEqual(mapPin(rooms), { lat: -4.3508756, lng: 39.5635778 });
});

test('kenyaways: season bands with real limits, USD per person per night, min nights', () => {
  const slots = buildKwSlots(ALL, NAMES, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  // Oct 2026 (Kusi regular), Nov (Kusi low), 1-17 Dec (low), peak, 18 Jan-28 Feb (regular), Mar-May 2027 (low)
  assert.deepEqual([...new Set(ok.map(s => `${s.startDate}..${s.endDate}`))], [
    '2026-10-01..2026-10-31', '2026-11-01..2026-11-30', '2026-12-01..2026-12-17',
    '2026-12-18..2027-01-17', '2027-01-18..2027-02-28', '2027-03-01..2027-05-31',
  ]);
  assert.equal(ok.length, 16 * 5 + 15); // peak: no single rate for the apartment
  const k = (key: string) => ok.find(s => s.key === key)!;
  assert.equal(k('super-sea-view-2p|2026-12-18').price, 101);
  assert.equal(k('super-sea-view-2p|2026-12-18').minNights, 7);
  assert.equal(k('aircon-1p|2027-01-18').price, 135);
  assert.equal(k('pool-garden-budget-2p|2026-11-01').price, 43);
  assert.equal(k('pool-apartment-4p|2027-03-01').price, 62);
  assert.match(k('pool-apartment-4p|2027-03-01').availabilityText!, /usually closed after Easter/);
  assert.equal(ok.find(s => s.key === 'pool-apartment-1p|2026-12-18'), undefined);
  assert.ok(ok.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'unknown' && (s.minNights === 3 || s.minNights === 7)));
});

test('kenyaways: liveness - unlinked sheets and vanished rooms are not released', () => {
  const noPeak = buildKwSlots(ALL.filter(h => !h.includes('Peak')), NAMES, TODAY);
  assert.ok(noPeak.every(s => s.startDate !== '2026-12-18'));
  const noCult = buildKwSlots(ALL, NAMES.filter(n => n !== 'Cult'), TODAY);
  assert.ok(noCult.every(s => !s.key.startsWith('pool-garden-budget')));
  assert.equal(buildKwSlots(ALL, NAMES, '2027-06-01').length, 0);
});

test('kenyaways: fetchSlots on the fixture releases all three sheets', async () => {
  const notes: string[] = [];
  const slots = await kenyawaysDiani.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, buildKwSlots(ALL, NAMES)); // today's date: not pinned, so compare with the builder
  assert.ok(notes.every(n => !/no longer linked|new rate sheet/.test(n)));
});

test('kenyaways: content', () => {
  const c = parseKenyawaysContent({ rooms, facilities, terms }, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kenyaways Beach B&B');
  assert.equal(c.country, 'Kenya');
  assert.equal(c.mealPlan, 'breakfast');
  assert.deepEqual(c.spotCoords, { lat: -4.3508756, lng: 39.5635778 });
  assert.match(c.summary, /Linzi Kennaway, who started teaching kitesurfing in 2004/);
  assert.match(c.summary, /9 B&B rooms, 5 with sea view/);
  assert.match(c.summary, /H2O Extreme kite school/);
  assert.match(c.summary, /from USD 43 to 194 per person per night/);
  assert.equal(c.rooms.length, 9);
  assert.ok(c.rooms.find(r => r.name === 'Rebel')!.features.includes('Rate category: Super Sea View room'));
  assert.ok(c.includedServices.some(s => /Kite storage/.test(s)));
  assert.equal(c.kiteLessons, true);
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => u.startsWith('https://images.squarespace-cdn.com/')));
  assert.match(c.bookingUrl!, /freetobook\.com\/reservations\?w_id=11210/);
});
