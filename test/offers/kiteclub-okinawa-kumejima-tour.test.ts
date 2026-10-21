// KITECLUB Okinawa Kumejima tour: replays the tours index (/category/info/tours/) recorded 2026-10-19, which prints the
// 2027 announcement (dates, placeholder prices) and the 2026 edition (prices) in full, and the WordPress REST search
// for "久米島" recorded 2026-10-21 (trimmed to id, title and the <img> tags of each post) for the photos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKcoSlots, fetchKumejimaSlots, kcoAnnouncements, kcoPriceText, kiteclubOkinawaKumejimaTour, parseKcoPosts,
  parseKcoReportImages, parseKcoTour,
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
  // photos from the older Kumejima reports and announcements (2021+ posts have none), newest first, max 14
  const U = 'https://kiteclub-okinawa.biz/wp-content/uploads/';
  assert.equal(c.imageUrls.length, 14);
  assert.equal(c.imageUrls[0], `${U}2020/02/IMG_8519.jpg`);
  for (const f of ['2019/04/P3300045.jpg', '2018/03/P3100327.jpg', '2018/01/P4080354.jpg', '2017/02/P3200265.jpg', '2016/01/１-73.jpg']) {
    assert.ok(c.imageUrls.includes(U + f), f);
  }
  // re-uploads of the same photo are dropped: IMG_8519 (2019/04 = 2020/02), P4080354 (2017/04 = 2018/01), the "コピー" copy
  assert.ok(!c.imageUrls.some(u => /2019\/04\/IMG_8519|2017\/04\/P4080354|コピー/.test(u)));
  // no event-plan post photos (2015/09 "2016年度イベント情報") and no thumbnails
  assert.ok(!c.imageUrls.some(u => /2015\/09\/|-\d+x\d+\./.test(u)));
});

test('kco: report photos, announcements optional, event plans skipped, re-uploads deduped', () => {
  const img = (f: string) => `<img src="https://kiteclub-okinawa.biz/wp-content/uploads/${f}">`;
  const posts = [
    { id: 5, title: { rendered: '2027年・カイトクラブイベント予定' }, content: { rendered: img('2027/01/plan.jpg') } },
    { id: 4, title: { rendered: '第20回・久米島ツアー2024開催のお知らせ' }, content: { rendered: img('2024/01/a-940x705.jpg') } },
    { id: 3, title: { rendered: '久米島ツアー2023' }, content: { rendered: [img('2023/03/b.jpg'), img('2023/03/a.jpg'), img('2023/03/c-コピー.jpg')].join('') } },
    { id: 2, title: { rendered: '小浜島ツアー2023' }, content: { rendered: img('2023/07/k.jpg') } },
  ];
  const U = 'https://kiteclub-okinawa.biz/wp-content/uploads/';
  assert.deepEqual(parseKcoReportImages(posts, /久米島/), [`${U}2023/03/b.jpg`, `${U}2023/03/a.jpg`, `${U}2023/03/c-コピー.jpg`]);
  assert.deepEqual(parseKcoReportImages(posts, /久米島/, { announcements: true, dedupe: true }), [`${U}2024/01/a.jpg`, `${U}2023/03/b.jpg`]);
  assert.deepEqual(parseKcoReportImages(posts, /久米島/, { perPost: 1 }), [`${U}2023/03/b.jpg`]);
});
