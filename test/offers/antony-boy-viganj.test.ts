// Antony Boy Camping (Viganj): replays the English pages recorded 2026-10-12 (script/style trimmed); the
// prices are hand-read constants from the linked 2026 PDF price lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  antonyBoyViganj, AB_SHEETS, abBands, abInquiryFrom, abSheetLinks, buildAbSlots, fetchAbSlots,
} from '../../src/offers/adapters/antony-boy-viganj.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/antony-boy-viganj');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-12';
const home = read('antony-boy.com_.');

test('antony-boy: the two 2026 price-list PDFs are linked, reception note', () => {
  const links = abSheetLinks(home);
  assert.ok(links.includes(AB_SHEETS.mobile) && links.includes(AB_SHEETS.apartments));
  assert.deepEqual(abInquiryFrom(home), { from: '11-01', text: '01.11 – 01.04: Inquiries only' });
  assert.deepEqual(abBands(2026, abInquiryFrom(home)).map(b => [b.start, b.end, b.peak, b.availability]), [
    ['2026-01-01', '2026-06-30', false, 'unknown'], ['2026-07-01', '2026-08-31', true, 'unknown'],
    ['2026-09-01', '2026-10-31', false, 'unknown'], ['2026-11-01', '2026-12-31', false, 'on_request'],
  ]);
});

test('antony-boy: slots = unit x band ahead of today, EUR per unit per night', async () => {
  const slots = buildAbSlots(abSheetLinks(home), abInquiryFrom(home), TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 18); // 9 units x (Sep-Oct, Nov-Dec)
  const mh = slots.find(s => s.key === 'veezia-mobile-home|2026-09-01')!;
  assert.deepEqual([mh.endDate, mh.unit, mh.price, mh.currency, mh.priceUnit, mh.priceBasis, mh.occupancy, mh.availability],
    ['2026-10-31', 'Veezia mobile home', 109, 'EUR', 'per_night', 'room', 4, 'unknown']);
  const a7 = slots.find(s => s.key === 'apartment-a7|2026-11-01')!;
  assert.deepEqual([a7.price, a7.occupancy, a7.availability, a7.availabilityText], [79, 2, 'on_request', 'reception: 01.11 – 01.04: Inquiries only']);
  // peak prices appear once the band is ahead (e.g. on 2026-06-01)
  assert.equal(buildAbSlots(abSheetLinks(home), null, '2026-06-01').find(s => s.key === 'apartment-a3|2026-07-01')!.price, 170);
  assert.deepEqual(await fetchAbSlots(ctx, TODAY), slots);
});

test('antony-boy: liveness - prices only while the PDF is linked', async () => {
  assert.equal(buildAbSlots([AB_SHEETS.apartments], null, TODAY).filter(s => /veezia/.test(s.key)).length, 0);
  assert.equal(buildAbSlots([], null, TODAY).length, 0);
});

test('antony-boy: content', async () => {
  const c = await antonyBoyViganj.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Antony Boy Camping');
  assert.equal(c.country, 'Croatia');
  assert.equal(c.spot, 'Viganj');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /LIBERAN Surf & Kite school/);
  assert.equal(c.rooms.length, 9);
  assert.ok(c.rooms[0].features.includes('Indoor area: 38.3 m²'));
  assert.ok(c.optionalServices.some(s => /10 % off any LIBERAN lesson/.test(s)));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => !/logo|CARAVANS|pitches|tlocrt/i.test(u)));
});
