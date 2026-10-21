// My Salty Sisters women's kite retreat Egypt (El Gouna): replays the trip page, the previous-retreats page and the
// El Gouna 2026 photo page recorded 2026-10-21 (trimmed: scripts/styles dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mySaltySistersRetreatElGouna, parseMssgWeeks, parseMssgPrices, buildMssgSlots, fetchMssgSlots, parseMssgContent, mssgGalleryUrl,
  mssgPhotoCandidates,
} from '../../src/offers/adapters/my-salty-sisters-retreat-el-gouna.js';
import { mssLines, mssCurrentPrice } from '../../src/offers/adapters/my-salty-sisters-retreat-kremasti.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/my-salty-sisters-retreat-el-gouna');
process.env.OFFERS_FIXTURE_DIR = DIR;
const read = (prefix: string) => readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith(prefix))!), 'utf8');
const html = read('www.mysaltysisters.info_retreats_en_kitetrip-to-el-gouna_.');
const previous = read('www.mysaltysisters.info_retreats_en_previous-retreats_.');
const gallery = read('www.mysaltysisters.info_hidden_pictures-of-el-gouna-2026_.');
const lines = mssLines(html);
const ctx = { note: () => {}, incomplete: () => {} };

test('mssg: week (also the spaced "24. 04.2027" form) and price tiers', () => {
  assert.deepEqual(parseMssgWeeks(lines), [{ start: '2027-04-17', end: '2027-04-24' }]);
  assert.deepEqual(parseMssgWeeks(['Kite holidays in Egypt: 17. - 24. 04.2027']), [{ start: '2027-04-17', end: '2027-04-24' }]);
  const p = parseMssgPrices(lines);
  assert.deepEqual(p, { regular: 1480, early: 1390, earlyUntil: '2026-09-15', lastMinute: null, lastMinuteAfter: null });
  assert.deepEqual(mssCurrentPrice(p, '2026-09-15'), { price: 1390, tier: 'Early Bird', validUntil: '2026-09-15' });
  assert.deepEqual(mssCurrentPrice(p, '2026-10-21'), { price: 1480, tier: 'Regular', validUntil: null });
  assert.deepEqual(parseMssgPrices(['Regular Price:', '€ 1.390,-', 'Last Minute:', '€ 1.450,- (after 15.05.2027)']).lastMinuteAfter, '2027-05-15');
});

test('mssg: one slot at the standard price (pinned today), past week dropped', async () => {
  const s = buildMssgSlots(parseMssgWeeks(lines), parseMssgPrices(lines), '2026-10-21');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].key, s[0].endDate, s[0].price, s[0].currency, s[0].priceUnit, s[0].priceBasis, s[0].packageNights, s[0].availability, s[0].priceValidUntil],
    ['2027-04-17', '2027-04-24', 1480, 'EUR', 'package', 'person', 7, 'on_request', null]);
  assert.match(s[0].availabilityText ?? '', /^Standard price \(Early Bird EUR 1390 until 2026-09-15, Standard EUR 1480\)/);
  assert.deepEqual(buildMssgSlots(parseMssgWeeks(lines), parseMssgPrices(lines), '2027-04-18'), []);
  assert.equal((await fetchMssgSlots(ctx, '2026-10-21')).length, 1);
});

test('mssg: content and El Gouna photos', async () => {
  assert.equal(mssgGalleryUrl(previous), 'https://www.mysaltysisters.info/hidden/pictures-of-el-gouna-2026/');
  assert.equal(mssgGalleryUrl('<a href="/hidden/pictures-of-egypt-april-2023/">x</a>'), 'https://www.mysaltysisters.info/hidden/pictures-of-egypt-april-2023/');
  const photos = mssgPhotoCandidates(html, gallery);
  assert.ok(photos.length >= 12 && photos.length <= 20);
  assert.ok(photos.every(u => /^https:\/\/image\.jimcdn\.com\//.test(u) && !/colombia|\/image\.png$/i.test(u)));
  const c = parseMssgContent(html, '2026-10-21', gallery);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.continent], ['camp', 8, 'Egypt', 'Red Sea Governorate', 'El Gouna', 'Africa']);
  assert.match(c.summary, /17 April 2027 - 24 April 2027, EUR 1,480 per person in a shared room/);
  assert.match(c.summary, /limited to 8 places/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.ok(c.includedServices.some(x => /Transfer Airport Hurghada/.test(x)));
  assert.equal(c.bookingUrl, 'https://www.mysaltysisters.info/hidden/booking-el-gouna-egypt/');
  const live = await mySaltySistersRetreatElGouna.fetchContent(ctx);
  assert.equal(live.title, c.title);
  assert.equal(live.imageUrls.length, photos.length);
  assert.equal(mySaltySistersRetreatElGouna.operator.rootDomain, 'mysaltysisters.info');
});
