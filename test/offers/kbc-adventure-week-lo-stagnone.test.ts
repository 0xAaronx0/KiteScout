// KBC Kitesurf Adventure Week Sicily (Lo Stagnone): replays the page and the Leão event API answer recorded
// 2026-10-21 (page trimmed: scripts/styles dropped). The engine had no events -> one undated slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kbcAdventureWeekLoStagnone, parseKbcPage, kbcPrice, buildKbcSlots, fetchKbcSlots, parseKbcContent, kbcImages, kbcEventsUrl,
} from '../../src/offers/adapters/kbc-adventure-week-lo-stagnone.js';
import type { LeaoEvent } from '../../src/offers/adapters/oasis-kite-kitecamp-djerba.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kbc-adventure-week-lo-stagnone');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.kiteboarding-club.com'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kbc: page facts', () => {
  assert.deepEqual(parseKbcPage(html), {
    productId: 45438, bookingUrl: 'https://myleao.com/calendar/product/45438/en', price: 1700,
    discount: { pct: 15, untilMonth: 'February', price: 1445 }, coupleDiscount: 200, days: 6,
  });
  assert.equal(kbcEventsUrl(45438), 'https://www.myleao.com/api/event/product/45438/lang/en');
  const p = parseKbcPage(html);
  assert.deepEqual(kbcPrice(p, '2026-10-21').price, 1700);
  assert.deepEqual(kbcPrice(p, '2027-02-10'), { price: 1445, validUntil: '2027-02-28', note: '15% early discount until the end of February (instead of EUR 1700)' });
});

test('kbc: no engine events -> one undated slot; events -> dated slots with engine availability', async () => {
  const s = await fetchKbcSlots(ctx, '2026-10-21');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].key, s[0].startDate, s[0].price, s[0].currency, s[0].priceUnit, s[0].priceBasis, s[0].occupancy, s[0].packageNights, s[0].availability],
    ['single-room', null, 1700, 'EUR', 'package', 'person', 1, 5, 'on_request']);
  assert.match(s[0].availabilityText ?? '', /No event dates in the KBC booking engine/);
  const ev = (start: string, end: string, taken: number): LeaoEvent => ({
    event_id: '1', product_id: '45438', startdate: start, enddate: end, maxParticipants: 8, participants: taken,
    availMsg: '', price: '1.700,00', currency: 'EUR', bookable: 1, name: 'Kitesurf Adventure Week KBC Sicily',
  });
  const d = buildKbcSlots(parseKbcPage(html), [ev('2026-05-01', '2026-05-07', 0), ev('2027-05-02', '2027-05-08', 7), ev('2027-06-06', '2027-06-12', 8)], '2026-10-21');
  assert.deepEqual(checkSlots(d).problems, []);
  assert.deepEqual(d.map(x => [x.key, x.endDate, x.price, x.availability, x.spotsLeft, x.packageNights]), [
    ['2027-05-02', '2027-05-08', 1700, 'limited', 1, 6], ['2027-06-06', '2027-06-12', 1700, 'sold_out', 0, 6],
  ]);
});

test('kbc: content', async () => {
  const c = parseKbcContent(html, '2026-10-21');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 6, 'Italy', 'Lo Stagnone, Sicily', 'Lo Stagnone', 'full_board']);
  assert.match(c.summary, /from VDWS level 5/);
  assert.match(c.summary, /EUR 1,700 per person \(couples sharing a double room get EUR 200 off the total\)/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.ok(c.includedServices.includes('Accommodation in a single room at Villa Vajarassa'));
  const imgs = kbcImages(html);
  assert.ok(imgs.length >= 8 && imgs.every(u => u.startsWith('https://www.kiteboarding-club.com/fileadmin/')));
  assert.equal((await kbcAdventureWeekLoStagnone.fetchContent(ctx)).title, c.title);
  assert.deepEqual([kbcAdventureWeekLoStagnone.liveAvailability, kbcAdventureWeekLoStagnone.instantBooking], [true, true]);
});
