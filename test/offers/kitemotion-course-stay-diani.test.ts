// KiteMotion course + accommodation (Diani Beach): replays the Polish package page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitemotionCourseStayDiani, parseKmPackage, buildKmSlots, fetchKmSlots } from '../../src/offers/adapters/kitemotion-course-stay-diani.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitemotion-course-stay-diani');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('km: package block (price, hours, nights, validity)', () => {
  const p = parseKmPackage(html);
  assert.deepEqual([p.price, p.currency, p.hours, p.privateNights, p.dormNights, p.validFrom, p.validTo],
    [650, 'EUR', 6, 7, 10, '2026-06-01', '2028-03-05']);
});

test('km: two bands over the validity; none once it has ended', async () => {
  const slots = await fetchKmSlots('2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.priceBasis, s.packageNights, s.availability]), [
    ['private-room', '2026-06-01', '2028-03-05', 650, 'person', 7, 'on_request'],
    ['dorm', '2026-06-01', '2028-03-05', 650, 'person', 10, 'on_request'],
  ]);
  assert.deepEqual(buildKmSlots(parseKmPackage(html), '2028-03-06'), []);
});

test('km: content', async () => {
  const c = await kitemotionCourseStayDiani.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Kenya', 'Kwale County (South Coast)', 'Diani Beach']);
  assert.match(c.summary, /Price EUR 650 per person, lessons between 2026-06-01 and 2028-03-05/);
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => !/\.svg$|logo/i.test(u)));
});
