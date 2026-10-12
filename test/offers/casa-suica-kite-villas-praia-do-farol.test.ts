// CSKV Casa Suiça Kite Villas (Praia do Farol): replays home, villa 1 and kite point pages recorded 2026-10-12
// (script/style bodies trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  casaSuicaKiteVillasPraiaDoFarol, buildCskvSlots, parseCskvContent, parseCskvRates, seasonBand,
} from '../../src/offers/adapters/casa-suica-kite-villas-praia-do-farol.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/casa-suica-kite-villas-praia-do-farol');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const villa = read('cskv.com.br_kite-villas-casa-1_.');

test('cskv: rate table = villa / suite x high / low season, minimum stay', () => {
  assert.deepEqual(parseCskvRates(villa), {
    villaPersons: 4, suitePersons: 2, minNights: 3,
    seasons: [
      { season: 'high', startMonth: 7, endMonth: 1, villa: 2500, suite: 1250 },
      { season: 'low', startMonth: 2, endMonth: 6, villa: 2000, suite: 1000 },
    ],
  });
});

test('cskv: season band = next occurrence that has not ended', () => {
  assert.deepEqual(seasonBand(7, 1, '2026-10-12'), { start: '2026-07-01', end: '2027-01-31', label: '2026-27' });
  assert.deepEqual(seasonBand(2, 6, '2026-10-12'), { start: '2027-02-01', end: '2027-06-30', label: '2027' });
  assert.deepEqual(seasonBand(7, 1, '2027-02-01'), { start: '2027-07-01', end: '2028-01-31', label: '2027-28' });
});

test('cskv: slots (2026-10-12)', () => {
  const slots = buildCskvSlots(parseCskvRates(villa), '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.unit, s.price, s.occupancy]), [
    ['villa-4p|high|2026-27', '2026-07-01', '2027-01-31', 'Entire villa (up to 4 persons)', 2500, 4],
    ['suite-2p|high|2026-27', '2026-07-01', '2027-01-31', 'Suite (up to 2 persons)', 1250, 2],
    ['villa-4p|low|2027', '2027-02-01', '2027-06-30', 'Entire villa (up to 4 persons)', 2000, 4],
    ['suite-2p|low|2027', '2027-02-01', '2027-06-30', 'Suite (up to 2 persons)', 1000, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'BRL' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'on_request'
    && s.minNights === 3 && s.datePrecision === 'month'));
});

test('cskv: live slot run over the fixtures', async () => {
  const slots = await casaSuicaKiteVillasPraiaDoFarol.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 4);
});

test('cskv: content', async () => {
  const c = await casaSuicaKiteVillasPraiaDoFarol.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'CSKV Casa Suiça Kite Villas');
  assert.deepEqual([c.country, c.region, c.spot, c.spotCoords], ['Brazil', 'Praia do Farol, Ceará', 'Praia do Farol', null]);
  assert.match(c.summary, /rents 3 beachfront villas at Praia do Farol in Itarema/);
  assert.match(c.summary, /runs 7 km along the coast/);
  assert.match(c.summary, /BRL 2500 per villa or 1250 per suite and night in the high season \(July - January\) and BRL 2000 \/ 1000 in the low season, minimum 3 nights/);
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.rooms.map(r => r.name), ['Entire villa (up to 4 persons)', 'Suite (up to 2 persons)']);
  assert.match(c.rooms[0].description!, /178 m2 with 2 master suites/);
  assert.ok(c.includedServices.includes('Access to common areas (main pool, tennis court, kite point, restaurant, bar)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.some(u => /Gallery_tkp_/.test(u)) && c.imageUrls.some(u => /casa_suica_kite_villas_0\d\d/.test(u)));
  assert.ok(c.imageUrls.every(u => u.startsWith('https://cskv.com.br/wp-content/uploads/') && !/logo|bg_map|download\.jpg/.test(u)));
  // season bands in the source text follow the run date
  const at = parseCskvContent({ home: read('cskv.com.br_.'), villa, kitePoint: read('cskv.com.br_the-kite-point_.') }, '2026-10-12');
  assert.match(at.sourceText!, /season bands \(inferred year, 2026-10-12\): 2026-07-01\.\.2027-01-31, 2027-02-01\.\.2027-06-30/);
});
