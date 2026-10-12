// Windsurf Village (Porto Pollo): replays the home page with its embedded HBook data, the content pages and one
// HBook search (2026-10-31..2026-11-07, 2 adults), recorded 2026-10-12 (script bodies trimmed except var hb_*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  windsurfVillagePortoPollo, buildWvSlots, fetchWvSlots, parseWvEngine, parseWvSearch, parseWvTypes, wvSampleStays, wvSearchBody,
} from '../../src/offers/adapters/windsurf-village-porto-pollo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/windsurf-village-porto-pollo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const TODAY = '2026-10-12';
const engine = parseWvEngine(read('www.windsurfvillage.it_.'));
const search = parseWvSearch(read('www.windsurfvillage.it_source__wp-admin_admin-ajax.php.'));

test('windsurf-village: HBook data in the home page', () => {
  assert.equal(engine.seasons.length, 12);
  assert.deepEqual(engine.seasons[0], { seasonId: '1', start: '2026-03-28', end: '2026-05-09' });
  assert.deepEqual(engine.checkInDays, [6]); // HBook "5" (Monday = 0) = Saturday
  assert.equal(engine.minStay, 7);
  assert.equal(engine.pageId, '33');
  assert.equal(engine.status['2026-10-25'], 'hb-day-fully-taken');
});

test('windsurf-village: one sample week per month (last free Saturday arrival)', () => {
  assert.deepEqual(wvSampleStays(engine, TODAY), [{ seasonId: '1', checkIn: '2026-10-31', checkOut: '2026-11-07' }]);
  assert.match(wvSearchBody(engine, '2026-10-31', '2026-11-07'), /^action=hb_get_available_accom&check_in=2026-10-31&check_out=2026-11-07&adults=2&children=0&.*current_page_id=33/);
});

test('windsurf-village: HBook search answer', () => {
  assert.deepEqual(search.map(a => [a.id, a.unit, a.variant, a.total, a.base, a.quantity]), [
    ['214', 'Type A', 'Superior 1', 695, 600, 3], ['244', 'Type A', 'Superior 2', 725, 630, 4],
    ['248', 'Type B', 'Superior 1', 870, 755, 18], ['252', 'Type B', 'Superior 2', 910, 795, 15],
    ['258', 'Type C', 'Superior 1', 1040, 905, 4],
  ]);
  assert.deepEqual(search[0].fees, ['Pulizia finale: 95 €']);
  assert.deepEqual(parseWvSearch('{"success":false,"msg":"no"}'), []);
});

test('windsurf-village: bands per variant - sample week exact, full week sold out, rest unknown', async () => {
  const slots = buildWvSlots(engine, [{ stay: wvSampleStays(engine, TODAY)[0], accoms: search }], TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 15);
  const s = (k: string) => slots.find(x => x.key === k)!;
  assert.deepEqual([s('type-a-superior-1|2026-10-31').endDate, s('type-a-superior-1|2026-10-31').price, s('type-a-superior-1|2026-10-31').availability],
    ['2026-11-06', 695, 'available']);
  const a = s('type-a-superior-1|2026-10-31');
  assert.deepEqual([a.unit, a.currency, a.priceUnit, a.priceBasis, a.occupancy, a.packageNights, a.minNights], ['Type A', 'EUR', 'package', 'room', 2, 7, 7]);
  assert.deepEqual([s('type-b-superior-2|2026-10-24').endDate, s('type-b-superior-2|2026-10-24').availability], ['2026-10-30', 'sold_out']);
  assert.deepEqual([s('type-c-superior-1|2026-10-17').endDate, s('type-c-superior-1|2026-10-17').price, s('type-c-superior-1|2026-10-17').availability],
    ['2026-10-23', 1040, 'unknown']);
  assert.deepEqual(await fetchWvSlots(ctx, TODAY), slots);
  // after the last loaded season: no request, price on request
  assert.deepEqual(await fetchWvSlots(ctx, '2026-11-10'), []);
  assert.ok(notes.some(n => /no HBook season after 2026-11-10/.test(n)));
});

test('windsurf-village: content', async () => {
  assert.deepEqual(parseWvTypes(read('www.windsurfvillage.it_home-holidays-sardinia_.')).map(r => r.name), ['Type A', 'Type B', 'Type C']);
  const c = await windsurfVillagePortoPollo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Windsurf Village - Baia dei Delfini');
  assert.equal(c.country, 'Italy');
  assert.equal(c.spot, 'Porto Pollo');
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /kite area is 900 m away/);
  assert.match(c.summary, /season 2026-03-28 to 2026-11-07/);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /\.jpe?g$/.test(u) && !/logo|cropped|-\d+x\d+\./i.test(u)));
});
