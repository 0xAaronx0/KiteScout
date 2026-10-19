// KITECLUB Okinawa Kumejima tour: replays the tours index (/category/info/tours/) recorded 2026-10-19, which prints the
// 2027 announcement (dates, placeholder prices) and the 2026 edition (prices) in full.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKcoSlots, fetchKumejimaSlots, kcoAnnouncements, kcoPriceText, kiteclubOkinawaKumejimaTour, parseKcoPosts, parseKcoTour,
} from '../../src/offers/adapters/kiteclub-okinawa-kumejima-tour.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteclub-okinawa-kumejima-tour');
process.env.OFFERS_FIXTURE_DIR = DIR;
const index = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('kiteclub-okinawa.biz_category_info_tours_'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kco: index posts and Kumejima announcements (reports excluded)', () => {
  const posts = parseKcoPosts(index);
  assert.equal(posts.length, 17);
  assert.deepEqual(posts[0], { ...posts[0], id: 13988, title: '久米島ツアー2027/4/2(金)-4(日)開催！', posted: '2026-10-15' });
  const ann = kcoAnnouncements(posts, /久米島/);
  assert.deepEqual(ann.map(p => p.id), [13988, 12687]); // 13285 is the 2026 trip report
});

test('kco: 2027 tour = 2-4 Apr (start + 2 nights), placeholder prices; 2026 edition priced', () => {
  const [cur, prev] = kcoAnnouncements(parseKcoPosts(index), /久米島/);
  const t = parseKcoTour(cur);
  assert.equal(t.year, 2027);
  assert.deepEqual(t.departures.map(d => [d.start, d.end, d.nights]), [['2027-04-02', '2027-04-04', 2]]);
  assert.deepEqual(t.rooms.map(r => [r.key, r.persons, r.price]), [['standard', '3-4', null], ['twin', '2', null], ['single', '1', null]]);
  assert.equal(kcoPriceText(t), null);
  const p = parseKcoTour(prev);
  assert.deepEqual(p.departures.map(d => [d.start, d.end]), [['2026-03-13', '2026-03-15']]);
  assert.deepEqual(p.rooms.map(r => r.price), [58000, 68000, 78000]);
  assert.equal(kcoPriceText(p), 'JPY 58,000 standard room (3-4 per room) / 68,000 twin room (2 per room) / 78,000 single use (1 per room) per person');
});

test('kco: slots per room type, price null with last-edition text; priced rooms when published; past dropped', async () => {
  const slots = await fetchKumejimaSlots('2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy, s.availability]), [
    ['2027-04-02|standard', null, null, 'on_request'], ['2027-04-02|twin', null, 2, 'on_request'], ['2027-04-02|single', null, 1, 'on_request'],
  ]);
  assert.match(slots[0].availabilityText!, /last edition \(2026\): JPY 58,000 standard room/);
  // once the site fills in the prices
  const [cur] = kcoAnnouncements(parseKcoPosts(index), /久米島/);
  const t = parseKcoTour(cur);
  const priced = buildKcoSlots({ ...t, rooms: t.rooms.map((r, i) => ({ ...r, price: 60000 + i * 10000 })) }, '2026-10-19', null, 'Kumejima tour');
  assert.deepEqual(checkSlots(priced).problems, []);
  assert.deepEqual(priced.map(s => [s.price, s.currency, s.priceUnit, s.priceBasis]), [
    [60000, 'JPY', 'package', 'person'], [70000, 'JPY', 'package', 'person'], [80000, 'JPY', 'package', 'person'],
  ]);
  assert.deepEqual(await fetchKumejimaSlots('2027-04-03'), []);
});

test('kco kumejima: content', async () => {
  const c = await kiteclubOkinawaKumejimaTour.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.sourceUrl], ['tour', 3, 'Japan', 'Kumejima, Okinawa', 'Kumejima', 'https://kiteclub-okinawa.biz/info/blog/13988/']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Naha', 'Kumejima', 'Hatenohama']);
  assert.deepEqual(c.includedServices, ['Return flights Naha - Kumejima', 'Hotel nights at Eef Beach Hotel, breakfast included', 'Transfers and rental car', 'Boat charter (3 days)']);
  assert.match(c.summary, /Next trip: 2 Apr - 4 Apr 2027 \(2 nights\); prices not yet published \(2026 edition: JPY 58,000/);
  assert.ok(!/[–—]/.test(c.summary));
});
