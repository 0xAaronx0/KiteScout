// KiteAdventure Colombia course + stay packages (Mayapo): replays the home page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kiteadventureColombiaCourseStayMayapo, buildKacSlots, parseKac } from '../../src/offers/adapters/kiteadventure-colombia-course-stay-mayapo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteadventure-colombia-course-stay-mayapo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.kitesurfingcolombia.co_'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kac: three COP packages, promo, pin', () => {
  const p = parseKac(html);
  assert.deepEqual(p.packages.map(k => [k.hours, k.nights, k.days, k.price]), [[8, 3, 4, 2944000], [10, 3, 4, 3013000], [12, 4, 5, 3438500]]);
  assert.match(p.promo!, /10% off early bird for December 2026 & January 2027 \(Book by 31 October 2026\)/);
  assert.deepEqual(p.coords, { lat: 11.6798061, lng: -72.7661863 });
});

test('kac: undated slots, COP per person', async () => {
  const s = buildKacSlots(parseKac(html));
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => [x.key, x.price, x.currency, x.priceBasis, x.packageNights, x.startDate, x.availability]), [
    ['8h-3n', 2944000, 'COP', 'person', 3, null, 'on_request'],
    ['10h-3n', 3013000, 'COP', 'person', 3, null, 'on_request'],
    ['12h-4n', 3438500, 'COP', 'person', 4, null, 'on_request'],
  ]);
  assert.equal((await kiteadventureColombiaCourseStayMayapo.fetchSlots(ctx)).length, 3);
});

test('kac: content', async () => {
  const c = await kiteadventureColombiaCourseStayMayapo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 4, 'Colombia', 'La Guajira', 'Mayapo']);
  assert.deepEqual(c.spotCoords, { lat: 11.6798061, lng: -72.7661863 });
  assert.equal(c.heroVideoUrl, 'https://www.kitesurfingcolombia.co/videos/kiteadventure-kitesurfing-hero-v2.mp4');
  assert.ok(c.imageUrls.length >= 10 && !c.imageUrls.some(u => /reviews\//.test(u)));
});
