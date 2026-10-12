// Sorrento Beach Club & Kite Village (My Hoa, Vietnam): replays the pages recorded 2026-10-12. The rate table on /stay/
// is the 2023/24 season, so the adapter is content only until the owner publishes a new season (gate tested below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sorrentoBeachClubMyHoa, buildSbcSlots, parseSbcPeak, parseSbcStay, parseSorrentoContent, sbcRatesCurrent,
} from '../../src/offers/adapters/sorrento-beach-club-my-hoa.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/sorrento-beach-club-my-hoa');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const stayHtml = read('sorrentobeachclub.com_stay_.');
const ctx = { note: () => {}, incomplete: () => {} };

test('sbc: peak ranges (a year-less start takes the end year)', () => {
  assert.deepEqual(parseSbcPeak('Peak rate applicable: Dec 22, 2023 to Jan 03, 2024 and Feb 08 to Feb 15 2024'), [
    { start: '2023-12-22', end: '2024-01-03' }, { start: '2024-02-08', end: '2024-02-15' },
  ]);
});

test('sbc: /stay/ = 5 room types with VND standard + peak rates', () => {
  const stay = parseSbcStay(stayHtml);
  assert.deepEqual(stay.rooms.map(r => [r.name, r.guests, r.standard.length, r.peak.length]), [
    ['Executive Deluxe', 2, 2, 2], ['Premium Deluxe', 2, 1, 1], ['Deluxe Double', 2, 1, 1], ['Superior Twin', 2, 1, 1], ['2 Bedroom Suite', 4, 1, 1],
  ]);
  assert.deepEqual(stay.rooms[0].standard, [{ view: 'Ocean View', amount: 2550000 }, { view: 'Pool/Garden view', amount: 2300000 }]);
  assert.deepEqual(stay.rooms[4].peak, [{ view: null, amount: 3800000 }]);
});

test('sbc: the 2023/24 table is stale on 2026-10-12 -> no slots, with a run note', async () => {
  const stay = parseSbcStay(stayHtml);
  assert.equal(sbcRatesCurrent(stay, '2026-10-12'), false);
  assert.deepEqual(buildSbcSlots(stay, '2026-10-12'), []);
  const notes: string[] = [];
  const slots = await sorrentoBeachClubMyHoa.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.match(notes[0], /past season .*Feb 15 2024/);
});

test('sbc: a published next season (same layout, years 2026/27) yields standard + dated peak slots', () => {
  const next = parseSbcStay(stayHtml.replace(/2024/g, '2027').replace(/2023/g, '2026'));
  const slots = buildSbcSlots(next, '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 6 * 3); // 6 room x view units: 1 standard + 2 peak ranges each
  const exec = ok.filter(s => s.unit === 'Executive Deluxe (Ocean View)');
  assert.deepEqual(exec.map(s => [s.key, s.startDate, s.endDate, s.price]), [
    ['executive-deluxe-ocean-view|standard', null, null, 2550000],
    ['executive-deluxe-ocean-view|peak|2026-12-22', '2026-12-22', '2027-01-03', 2950000],
    ['executive-deluxe-ocean-view|peak|2027-02-08', '2027-02-08', '2027-02-15', 2950000],
  ]);
  assert.ok(ok.every(s => s.currency === 'VND' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
});

test('sbc: content', async () => {
  const c = await sorrentoBeachClubMyHoa.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Sorrento Beach Club & Kite Village');
  assert.equal(c.country, 'Vietnam');
  assert.equal(c.spot, 'My Hoa Lagoon');
  assert.equal(sorrentoBeachClubMyHoa.confidence, 'low');
  assert.match(c.summary, /IKO affiliated/);
  assert.match(c.summary, /free for hotel guests; the kite season runs November to April/);
  assert.equal(c.rooms.length, 5);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /sorrentobeachclub\.com\/wp-content\/uploads\/20(23|24)\/\d\d\/IMG_/.test(u)));
  // the stale-rate sentence names the table's own season, a current table drops it
  const pages = { home: read('sorrentobeachclub.com_.'), stay: stayHtml, play: read('sorrentobeachclub.com_play_.'), about: read('sorrentobeachclub.com_about_.') };
  assert.match(parseSorrentoContent(pages, '2026-10-12').summary, /rates on the site are for the 2023\/24 season/);
  assert.match(parseSorrentoContent({ ...pages, stay: stayHtml.replace(/2024/g, '2027').replace(/2023/g, '2026') }, '2026-10-12').summary, /Room rates are published per room and view/);
});
