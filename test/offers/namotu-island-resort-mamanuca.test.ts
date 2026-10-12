// Namotu Island Resort (Mamanuca, Fiji): replays the WordPress pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped). Content only: no prices on the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { namotuIslandResortMamanuca, parseNiRooms, parseNiWeeks } from '../../src/offers/adapters/namotu-island-resort-mamanuca.js';
import { contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/namotu-island-resort-mamanuca');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('namotu: room names from the accommodation overview', () => {
  assert.deepEqual(parseNiRooms(read('www.namotuislandfiji.com_the-resort_accommodations_.')), [
    'Hideaway Room', 'Shallows 7 & 8', 'Mana Suite', 'Cobalt Suite', 'Cloudbreak Suite', 'Pool Suite', 'Love Shack',
    'Pacific Bures & Sunset Bures', 'Villa Suite', 'Beach Bures',
  ]);
});

test('namotu: Unlimited Weeks dates as printed (heading 2027, dates 2026) -> no slots, a note', async () => {
  const w = parseNiWeeks(read('www.namotuislandfiji.com_signature-week_ben-wilson-kite-weeks_.'));
  assert.equal(w.heading, '2027 DATES');
  assert.deepEqual([w.dates.length, w.dates[0], w.dates[8]], [9, '06-13 June 2026', '22-29 Aug 2026']);
  assert.deepEqual(await namotuIslandResortMamanuca.fetchSlots(ctx), []);
  assert.ok(notes.some(n => /heading "2027 DATES" lists 9 dates/.test(n)));
});

test('namotu: content', async () => {
  const c = await namotuIslandResortMamanuca.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Namotu Island Resort');
  assert.equal(c.country, 'Fiji');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /with 12 air-conditioned rooms/);
  assert.match(c.summary, /minimum 7 nights, check-in on Sunday/);
  assert.match(c.summary, /opened in 1994/);
  assert.ok(c.includedServices.includes('Round trip Airport transfers via car and boat'));
  assert.ok(c.optionalServices.includes('Unlimited Week booking deposit: USD$2,500 per person deposit'));
  assert.equal(c.rooms.length, 10);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => /namotuislandfiji\.com\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
});
