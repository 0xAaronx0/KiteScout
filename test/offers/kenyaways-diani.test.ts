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
import { planGallery } from '../../src/offers/gallery.js';
import { slotRoom } from '../../src/offers/ingest.js';

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
  // per band and room: super sea view 4 x 2 rooms, aircon 4 x 3, small sea view 2 x 2, budget 2 x 1, apartment 4
  // (peak: no single rate for the apartment)
  assert.equal(ok.length, 30 * 5 + 29);
  const k = (key: string) => ok.find(s => s.key === key)!;
  assert.equal(k('super-sea-view-2p|2026-12-18|Rebel').price, 101);
  assert.equal(k('super-sea-view-2p|2026-12-18|Tribal').price, 101);
  assert.equal(k('super-sea-view-2p|2026-12-18|Rebel').minNights, 7);
  assert.equal(k('aircon-1p|2027-01-18|Crossbow').price, 135);
  assert.equal(k('pool-garden-budget-2p|2026-11-01|Cult').price, 43);
  assert.equal(k('pool-apartment-4p|2027-03-01|Bandit').price, 62);
  assert.match(k('pool-apartment-4p|2027-03-01|Bandit').availabilityText!, /usually closed after Easter/);
  assert.equal(ok.find(s => s.key === 'pool-apartment-1p|2026-12-18|Bandit'), undefined);
  assert.ok(ok.every(s => s.currency === 'USD' && s.priceUnit === 'per_night' && s.priceBasis === 'person'
    && s.availability === 'unknown' && (s.minNights === 3 || s.minNights === 7)));
});

test('kenyaways: liveness - unlinked sheets and vanished rooms are not released', () => {
  const noPeak = buildKwSlots(ALL.filter(h => !h.includes('Peak')), NAMES, TODAY);
  assert.ok(noPeak.every(s => s.startDate !== '2026-12-18'));
  const noCult = buildKwSlots(ALL, NAMES.filter(n => n !== 'Cult'), TODAY);
  assert.ok(noCult.every(s => !s.key.startsWith('pool-garden-budget')));
  const noPark = buildKwSlots(ALL, NAMES.filter(n => n !== 'Park'), TODAY);
  assert.ok(noPark.every(s => s.room !== 'Park') && noPark.some(s => s.room === 'Bolt'));
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

test('kenyaways: each category rate is released once per named room of the category', () => {
  const c = parseKenyawaysContent({ rooms, facilities, terms }, TODAY);
  const slots = buildKwSlots(ALL, NAMES, TODAY);
  const names = c.rooms.map(r => r.name);
  const roomsOf = (unit: string) => [...new Set(slots.filter(s => s.unit === unit).map(s => slotRoom(names, s)))].sort();
  assert.deepEqual(roomsOf('Super Sea View room (Rebel, Tribal)'), ['Rebel', 'Tribal']);
  assert.deepEqual(roomsOf('Aircon room (Bolt, Park, Crossbow)'), ['Bolt', 'Crossbow', 'Park']);
  assert.deepEqual(roomsOf('Small Sea View room (Raven, Fuel)'), ['Fuel', 'Raven']);
  assert.deepEqual(roomsOf('Pool Garden Budget room (Cult)'), ['Cult']);
  assert.deepEqual(roomsOf('Pool Apartment (Bandit)'), ['Bandit']);
  assert.equal(new Set(slots.map(s => s.key)).size, slots.length);
  // each room carries its category's full rate set
  const rate = (room: string) => slots.filter(s => s.room === room).map(s => `${s.key.split('|')[0]}|${s.startDate}=${s.price}`);
  assert.deepEqual(rate('Rebel'), rate('Tribal'));
});

test('kenyaways: own photos per room from the gallery before each <h3>, the kite spot photo from /facilities', () => {
  const c = parseKenyawaysContent({ rooms, facilities, terms }, TODAY);
  const photos = (name: string) => c.rooms.find(r => r.name === name)!.imageUrls ?? [];
  assert.deepEqual(c.rooms.map(r => [r.name, photos(r.name).length]), [
    ['Crossbow', 7], ['Rebel', 13], ['Tribal', 10], ['Raven', 14], ['Fuel', 5], ['Bolt', 7], ['Park', 13], ['Bandit', 22], ['Cult', 11],
  ]);
  assert.match(photos('Crossbow')[0], /kenyaways\+rooms\+patio\+view\.jpg$/);
  assert.match(photos('Rebel')[0], /_H6A9650\+Kenyaways/);
  assert.ok(photos('Rebel').slice(1).every(u => /rebel\+kenyaways|_H6A9669/.test(u)));
  assert.match(photos('Tribal')[0], /Tribal\+kenyaways\+rooms/);
  assert.match(photos('Raven')[0], /kenyaways\+sea\+view\+balcony2\.jpg$/);
  assert.match(photos('Fuel')[0], /02\+-\+fuel\+-\+kenyaways/);
  assert.match(photos('Bolt')[0], /01-Bolt_terrace\.jpg$/);
  assert.ok(photos('Park').some(u => /04-Park_garden\.jpg$/.test(u)));
  assert.match(photos('Bandit')[0], /IMG_1916\+ph\+Rosalia/);
  assert.ok(photos('Cult').some(u => /05-Cult_ensuite\.jpg$/.test(u)));
  assert.ok(photos('Cult').every(u => !/Park/.test(u)), "Cult's gallery also shows 04-Park_terrace.jpg: another room's photo, left out");
  assert.ok(c.rooms.every(r => photos(r.name).every(u => u.startsWith('https://images.squarespace-cdn.com/'))));
  assert.deepEqual(c.spotImageUrls, [
    'https://images.squarespace-cdn.com/content/v1/620b5b0c6185131a2b398636/6f3540b3-be0a-47c9-baef-2e3bf84a8853/Diani+Kitesurf+spot',
  ]);
  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) if (r.imageUrls?.length) assert.ok(r.imageUrls.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
