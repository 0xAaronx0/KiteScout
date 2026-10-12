// Puza Moya Guest House / Cape Sports Center (Langebaan, South Africa): replays /accommodation/, /kitesurfing/ and
// /puza-moya/ recorded 2026-10-12 (fixtures trimmed). Slots = dated 2026/27 season rates, ZAR, on request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  puzaMoyaCapeSportsLangebaan, buildPmSlots, parsePmSeasons, pmRange,
} from '../../src/offers/adapters/puza-moya-cape-sports-langebaan.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/puza-moya-cape-sports-langebaan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const accom = read('capesports.co.za_accommodation_.');

test('pm: range lines', () => {
  assert.deepEqual(pmRange('Christmas 11. Dec. 2026 - 14. Jan. 2027'), { label: 'Christmas', start: '2026-12-11', end: '2027-01-14' });
  assert.deepEqual(pmRange('A 1. Sept. - 10. Dec. 2026'), { label: 'A', start: '2026-09-01', end: '2026-12-10' });
  assert.deepEqual(pmRange('Easter 26. to 29. March 2027'), { label: 'Easter', start: '2027-03-26', end: '2027-03-29' });
  assert.deepEqual(pmRange('2830. March - 31. Aug. 2027'), { label: '', start: null, end: '2027-08-31' });
});

test('pm: season toggles', () => {
  const s = parsePmSeasons(accom);
  assert.deepEqual(s.map(x => [x.season, x.ranges.length, x.perRoom, x.perPersonShared, x.single]), [
    ['high', 2, 1450, null, null], ['mid', 3, null, 600, 950], ['low', 1, null, 525, 850],
  ]);
  assert.equal(s[0].breakfast, 180);
});

test('pm: slots from 2026-10-12', () => {
  const slots = buildPmSlots(parsePmSeasons(accom), '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.endDate, s.price, s.priceBasis, s.occupancy]), [
    ['room-shared-pp|2026-09-01', '2026-12-10', 600, 'person', 2],
    ['room-single|2026-09-01', '2026-12-10', 950, 'room', 1],
    ['room|2026-12-11', '2027-01-14', 1450, 'room', 2],
    ['room-shared-pp|2027-01-15', '2027-03-25', 600, 'person', 2],
    ['room-single|2027-01-15', '2027-03-25', 950, 'room', 1],
    ['room|2027-03-26', '2027-03-29', 1450, 'room', 2],
    ['room-shared-pp|2027-03-30', '2027-04-30', 600, 'person', 2],
    ['room-single|2027-03-30', '2027-04-30', 950, 'room', 1],
    ['room-shared-pp|2027-05-01', '2027-08-31', 525, 'person', 2],
    ['room-single|2027-05-01', '2027-08-31', 850, 'room', 1],
  ]);
  assert.ok(ok.every(s => s.currency === 'ZAR' && s.priceUnit === 'per_night' && s.availability === 'on_request'));
  assert.equal(buildPmSlots(parsePmSeasons(accom), '2027-05-02').length, 2);
});

test('pm: adapter slots note the inferred low-season start', async () => {
  const slots = await puzaMoyaCapeSportsLangebaan.fetchSlots(ctx);
  assert.equal(checkSlots(slots).problems.length, 0);
  assert.ok(notes.some(n => /inferred/.test(n)));
});

test('pm: content', async () => {
  const c = await puzaMoyaCapeSportsLangebaan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Puza Moya Guest House (Cape Sports Center)');
  assert.equal(c.spot, 'Langebaan');
  assert.match(c.summary, /about 90 m from the centre's kite, wing and windsurf school, with 4 en-suite twin rooms and 2 en-suite family rooms/);
  assert.match(c.summary, /R1,450 per room at Christmas and Easter, R600 per person sharing or R950 single/);
  assert.equal(c.includedServices.length, 9);
  assert.ok(c.optionalServices.includes('Breakfast at the Wunderbar: R180 per person'));
  assert.equal(c.imageUrls.length, 10);
  assert.ok(c.imageUrls.every(u => /puza-?moya/i.test(u) && !/Villa2/.test(u)));
});
