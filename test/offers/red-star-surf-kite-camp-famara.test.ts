// Red Star Surf Kite Camp (Famara): replays /kite-camp/ + /accommodation/ recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redStarSurfKiteCampFamara, buildRssSlots, parseRssPackages } from '../../src/offers/adapters/red-star-surf-kite-camp-famara.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/red-star-surf-kite-camp-famara');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('rss: three packages with from-prices and nights', () => {
  const p = parseRssPackages(read('www.redstarsurf.com_kite-camp_'));
  assert.deepEqual(p.map(x => [x.name, x.price, x.nights]), [['Try-Out Week', 665, 7], ['Level-Up Week', 865, 7], ['Short Trip', 375, 3]]);
  assert.equal(p[0].details[1], '3-day kite course, 3 hours a day');
});

test('rss: undated package slots', async () => {
  const slots = await redStarSurfKiteCampFamara.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => s.key), ['try-out-week', 'level-up-week', 'short-trip']);
  const s = slots[0];
  assert.deepEqual([s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability, s.startDate],
    [665, 'EUR', 'package', 'person', 1, 7, 'unknown', null]);
  assert.deepEqual(buildRssSlots([]), []);
});

test('rss: content', async () => {
  const c = await redStarSurfKiteCampFamara.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Spain', 'Canary Islands', 'Famara, Lanzarote']);
  assert.match(c.summary, /Try-Out Week \(7 nights, from EUR 665\) and Level-Up Week \(7 nights, from EUR 865\)/);
  assert.ok(c.imageUrls.length >= 8);
  assert.ok(!c.imageUrls.some(u => /logo|bungalow/.test(u)));
});
