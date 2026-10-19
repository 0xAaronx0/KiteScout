// Zephyr WA Signature Adventure Off-Road tour (Exmouth): replays the tour + book-now pages recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildZephyrSlots, parseZephyrContent, parseZephyrDates, zephyrImages, zephyrWaOffroadAdventureExmouth,
} from '../../src/offers/adapters/zephyr-wa-offroad-adventure-exmouth.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/zephyr-wa-offroad-adventure-exmouth');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const tour = read('western-australia-kiteboarding-tour');
const book = read('book-now');
const ctx = { note: () => {}, incomplete: () => {} };

test('zephyr: the tour dates (headline + "2026 TOUR DATES" block) parse to one range', () => {
  assert.deepEqual(parseZephyrDates(tour).map(d => [d.start, d.end]), [['2026-10-31', '2026-11-07']]);
});

test('zephyr: one future slot without price, none once it has started', () => {
  const slots = buildZephyrSlots(parseZephyrDates(tour), '2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].price, null);
  assert.equal(slots[0].availability, 'unknown');
  assert.equal(buildZephyrSlots(parseZephyrDates(tour), '2026-11-01').length, 0);
});

test('zephyr: content is a valid 8-day camp, experienced riders, own WA photos only', async () => {
  const c = await zephyrWaOffroadAdventureExmouth.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.equal(c.beginnerFriendly, false);
  assert.ok(c.includedServices.length >= 8);
  assert.ok(zephyrImages(tour).length >= 5);
  assert.ok(!c.imageUrls.some(u => /Cocos|Twin-Tip|Small-Groups|Thumbnail/i.test(u)), c.imageUrls.join('\n'));
  assert.match(parseZephyrContent({ tour, book }, '2026-10-19').summary, /Tour dates: 2026-10-31 to 2026-11-07/);
  assert.match(parseZephyrContent({ tour, book }, '2026-12-01').summary, /next dates are not published yet/);
  assert.doesNotMatch(c.summary, /[–—]/);
});
