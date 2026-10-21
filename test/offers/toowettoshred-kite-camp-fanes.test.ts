// Too Wet to Shred Kite Camp Greece (Fanes, Rhodes): replays the page recorded 2026-10-19 (trimmed).
// <title>/og/JSON-LD still say "22-30 August 2026"; only the visible "28 August to 5 September 2027" counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  toowettoshredKiteCampFanes, parseTwtsGrDates, parseTwtsGrRooms, buildTwtsGrSlots, parseTwtsGrLists, parseTwtsGrContent,
} from '../../src/offers/adapters/toowettoshred-kite-camp-fanes.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/toowettoshred-kite-camp-fanes');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');

test('twts greece: visible dates only, rooms with p.p. prices', () => {
  assert.deepEqual(parseTwtsGrDates(html).map(d => [d.start, d.end]), [['2027-08-28', '2027-09-05']]);
  const rooms = parseTwtsGrRooms(html);
  assert.deepEqual(rooms.map(r => [r.key, r.price, r.occupancy]), [['twin-room', 1150, 2], ['triple-room', 1075, 3]]);
  assert.match(rooms[0].note!, /private upgrade \+ EUR 150 \(the room's hover text says \+ EUR 250\)/);
});

test('twts greece: slots by pinned today', () => {
  const s = buildTwtsGrSlots(parseTwtsGrDates(html), parseTwtsGrRooms(html), '2026-10-19');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => [x.key, x.price, x.currency, x.priceUnit, x.priceBasis, x.availability]), [
    ['twin-room|2027-08-28', 1150, 'EUR', 'package', 'person', 'unknown'], ['triple-room|2027-08-28', 1075, 'EUR', 'package', 'person', 'unknown'],
  ]);
  assert.deepEqual(buildTwtsGrSlots(parseTwtsGrDates(html), parseTwtsGrRooms(html), '2027-08-29'), []);
});

test('twts greece: content', async () => {
  const l = parseTwtsGrLists(html);
  assert.ok(l.included.includes('Airport transfers'));
  assert.deepEqual(l.excluded, ['Your flight to Rhodes airport', 'Your visa (if applicable)', 'Lunch, drinks & extra’s', 'Travel/Sports insurance (obligatory)']);
  const c = parseTwtsGrContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 9, 'Greece', 'Dodecanese', 'Fanes, Rhodes', 'half_board']);
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /twin room EUR 1150, triple room EUR 1075/);
  assert.match(c.summary, /Next camp: 28 August 2027 - 5 September 2027/);
  // the brand is "Too Wet to Shred"; "Never ..." is only the WordPress site name (#267 verifier)
  assert.ok(!/Never Too Wet/i.test(`${c.title} ${c.summary} ${toowettoshredKiteCampFanes.operator.name}`));
  assert.ok(!c.includedServices.some(i => /kite kite/i.test(i)));
  assert.ok(c.imageUrls.length >= 5 && c.imageUrls.every(u => !/unsplash|logo/i.test(u)));
  assert.equal((await toowettoshredKiteCampFanes.fetchContent({ note: () => {}, incomplete: () => {} })).title, c.title);
});
