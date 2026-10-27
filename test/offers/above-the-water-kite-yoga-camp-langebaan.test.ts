// Above The Water Langebaan kite + yoga camp (Windtown Hotel): replays the camp page and /next-camps recorded
// 2026-10-27 (scripts, styles, SVG and tracking params trimmed). "Today" is pinned to 2026-10-27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atwCards, atwFormOptions, atwLines, atwVariants, buildAtwSlots, fetchAtwSlots, parseAtwCamp, readAtwCamps } from '../../src/offers/adapters/above-the-water-kite-camp-cape-town.js';
import {
  ATW_LB_SPEC, ATW_LB_URL, aboveTheWaterKiteYogaCampLangebaan, parseAtwLbContent,
} from '../../src/offers/adapters/above-the-water-kite-yoga-camp-langebaan.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/above-the-water-kite-yoga-camp-langebaan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const file = (part: string): string => readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes(part))!), 'utf8');
const html = file('langebaan-december-2026');
const next = file('next-camps');
const TODAY = '2026-10-27';
const ctx = { note: () => {}, incomplete: () => {} };

test('langebaan: price variants, layout B (label / "N EUR") + the "No hotel" form option', () => {
  const v = atwVariants(atwLines(html), atwFormOptions(html));
  assert.deepEqual(v.map(x => [x.label, x.amount, x.currency, x.nights]), [
    ['Group coaching', 1880, 'EUR', 7],
    ['Private coaching', 2330, 'EUR', 7],
    ['Group + equipment', 2580, 'EUR', 7],
    ['No hotel', 1280, 'EUR', null],
  ]);
  assert.ok(v[2].details.includes('All kite equipment included.'));
});

test('langebaan: one week x four variants, "4 SPOTS LEFT" -> limited, past week dropped', () => {
  const p = parseAtwCamp(ATW_LB_SPEC, ATW_LB_URL, html, atwCards(next), TODAY);
  assert.deepEqual(p.weeks.map(w => [w.start, w.end]), [['2026-12-13', '2026-12-20']]);
  const { ok, problems } = checkSlots(p.slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.packageNights, s.availability, s.spotsLeft]), [
    ['2026-12-13|group-coaching-double-room', 'Group coaching, double room', 1880, 7, 'limited', 4],
    ['2026-12-13|private-coaching-double-room', 'Private coaching, double room', 2330, 7, 'limited', 4],
    ['2026-12-13|group-equipment-double-room', 'Group + equipment, double room', 2580, 7, 'limited', 4],
    ['2026-12-13|no-hotel', 'No hotel', 1280, null, 'limited', 4],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.priceBasis === 'person'));
  assert.equal(ok[0].room, 'Double room');
  assert.equal(ok[3].room, null);
  assert.deepEqual(buildAtwSlots(ATW_LB_SPEC, p.weeks, p.variants, p.card, '2026-12-14'), []);
  // without the season grid card: on request, no spot count
  assert.ok(parseAtwCamp(ATW_LB_SPEC, ATW_LB_URL, html, [], TODAY).slots.every(s => s.availability === 'on_request' && s.spotsLeft === null));
});

test('langebaan: content from the fixture', async () => {
  const [p] = await readAtwCamps(ATW_LB_SPEC, TODAY, ctx);
  const c = parseAtwLbContent(p, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.region, 'Western Cape');
  assert.equal(c.spot, 'Langebaan');
  assert.equal(c.mealPlan, null, 'breakfast is described but not in "Always Included"');
  assert.equal(c.equipmentRental, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.deepEqual(c.includedServices.slice(0, 2), ['7 nights accommodation in a double room', 'Daily video coaching session with Fabio Ingrosso']);
  assert.ok(c.optionalServices.includes('Single room: +EUR 50 per night'));
  assert.ok(c.imageUrls.length >= 6 && c.imageUrls.length <= 12, `${c.imageUrls.length} photos`);
  assert.ok(!/[–—]/.test(c.summary + c.title + c.optionalServices.join() + c.includedServices.join()), 'no em/en dashes');
  assert.match(c.summary, /13 December 2026 to 20 December 2026/);
  assert.ok(html.includes(aboveTheWaterKiteYogaCampLangebaan.operator.contactEmail!));
});

test('langebaan: fetchAtwSlots against the fixtures', async () => {
  const notes: string[] = [];
  const slots = await fetchAtwSlots(ATW_LB_SPEC, TODAY, { note: n => notes.push(n), incomplete: n => notes.push(n) });
  assert.equal(slots.length, 4);
  assert.deepEqual(notes, []);
});
