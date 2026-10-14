// Drivethru Kite & Surf Camp (Hvide Sande): replays the German and English camp pages recorded 2026-10-14
// (scripts / styles / srcsets dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  drivethruKiteSurfCampHvideSande, buildDtcSlots, parseDtcPackages, DTC_KITE_UNIT,
} from '../../src/offers/adapters/drivethru-kite-surf-camp-hvide-sande.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/drivethru-kite-surf-camp-hvide-sande');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('dtc: package price boxes of the German offer page', () => {
  const p = parseDtcPackages(read('www.drivethru.de_daenemark_hvide-sande_angebot_.'));
  assert.deepEqual(p.map(x => [x.name, x.price, x.currency, x.nights]), [
    ['Kite Camp', 1190, 'EUR', 7], ['Surf Camp', 990, 'EUR', 7], ['Movement Camp', 990, 'EUR', 7], ['Comfort Camp', 690, 'EUR', 7], ['Silvester Special', 399, 'EUR', 3],
  ]);
  assert.ok(p[0].features.includes('Privater Kite Spot'));
  assert.equal(p[0].priceText, 'Ab 1190,- € / 7 Tage im 4-Bett-Zimmer');
});

test('dtc: one undated slot for the Kite Camp, EUR per person for 7 nights', async () => {
  const slots = await drivethruKiteSurfCampHvideSande.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.startDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability]), [
    ['kite-camp|4-bed-room', DTC_KITE_UNIT, null, 1190, 'EUR', 'package', 'person', 1, 7, 'unknown'],
  ]);
  assert.deepEqual(buildDtcSlots([]), []);
});

test('dtc: content', async () => {
  const c = await drivethruKiteSurfCampHvideSande.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Hvide Sande, West Jutland');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /private access to the fjord that serves as the camp's own kite spot/);
  assert.match(c.summary, /sleeps 20 guests/);
  assert.match(c.summary, /from EUR 1,190 per person for 7 nights in a 4-bed room/);
  assert.ok(c.includedServices.includes('Camp: Kitesurfing Lessons + Equipment'));
  assert.ok(c.optionalServices.includes('Comfort Camp: from 690 EUR / 7 days in a 4-bed room'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => /^https:\/\/www\.drivethru\.de\/content\/uploads\/.*-1856x1230\.jpg$/.test(u)));
  assert.match(c.sourceText ?? '', /Anreisetage am Samstag/);
});
