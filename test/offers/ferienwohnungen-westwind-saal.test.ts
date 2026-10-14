// Ferienwohnungen Westwind & Gästehaus Darßblick (Saal): replays the pages recorded 2026-10-14 (scripts / styles dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ferienwohnungenWestwindSaal, FWS_GUEST_URL, buildFwsGuestSlots, fetchFwsSlots, fwsGuestBand, fwsLastmod, fwsRanges,
  parseFwsFlatBands, parseFwsGuestTables,
} from '../../src/offers/adapters/ferienwohnungen-westwind-saal.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ferienwohnungen-westwind-saal');
process.env.OFFERS_FIXTURE_DIR = DIR; // also skips the 10 s crawl delay
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('fws: date ranges (year-less start, New Year)', () => {
  assert.deepEqual(fwsRanges('06.01. - 23.03.2026\n27.10. - 20.12.2026 21.12. - 03.01.2027'), [
    { start: '2026-01-06', end: '2026-03-23' }, { start: '2026-10-27', end: '2026-12-20' }, { start: '2026-12-21', end: '2027-01-03' },
  ]);
});

test('fws: flat season bands (Emma and Ben identical)', () => {
  const emma = parseFwsFlatBands(read('ferienwohnungen-saal.de_Ferienwohnungen-Saal_.'));
  assert.deepEqual(emma.map(b => [b.season, b.start, b.end, b.price]), [
    ['NS', '2026-01-06', '2026-03-23', 50], ['VS', '2026-03-24', '2026-05-31', 60], ['HS', '2026-06-01', '2026-09-14', 70],
    ['VS', '2026-09-15', '2026-10-26', 60], ['NS', '2026-10-27', '2026-12-20', 50], ['HS', '2026-12-21', '2027-01-03', 70],
  ]);
  assert.deepEqual(parseFwsFlatBands(read('ferienwohnungen-saal.de_Ferienunterkuenfte-Saal_.')), emma);
});

test('fws: guesthouse tables anchored on the sitemap year', () => {
  const t = parseFwsGuestTables(read('ferienwohnungen-saal.de_Gaestehaus-Darssblick-Saal_.'));
  assert.deepEqual(t.map(x => [x.season, x.rows.find(r => /^1 Nacht/.test(r.label))?.p1, x.rows.find(r => /^1 Nacht/.test(r.label))?.p2]), [['high', 35, 55], ['low', 30, 50]]);
  assert.equal(fwsLastmod(read('ferienwohnungen-saal.de_sitemap.xml.'), FWS_GUEST_URL), '2026-08-16');
  assert.deepEqual(fwsGuestBand(t[1], 2026), { start: '2026-10-01', end: '2027-04-30' });
  assert.equal(buildFwsGuestSlots(t, 2026, '2026-07-01').filter(s => s.startDate === '2026-05-01').length, 4);
});

test('fws: slots', async () => {
  const slots = await fetchFwsSlots('2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.priceUnit, s.packageNights ?? null, s.occupancy]), [
    ['ferienwohnung-emma|2026-09-15', '2026-09-15', '2026-10-26', 60, 'per_night', null, 2],
    ['ferienwohnung-emma|2026-10-27', '2026-10-27', '2026-12-20', 50, 'per_night', null, 2],
    ['ferienwohnung-emma|2026-12-21', '2026-12-21', '2027-01-03', 70, 'per_night', null, 2],
    ['ferienwohnung-ben|2026-09-15', '2026-09-15', '2026-10-26', 60, 'per_night', null, 2],
    ['ferienwohnung-ben|2026-10-27', '2026-10-27', '2026-12-20', 50, 'per_night', null, 2],
    ['ferienwohnung-ben|2026-12-21', '2026-12-21', '2027-01-03', 70, 'per_night', null, 2],
    ['guesthouse-room-1p|2026-10-01', '2026-10-01', '2027-04-30', 30, 'per_night', null, 1],
    ['guesthouse-room-1p-6n|2026-10-01', '2026-10-01', '2027-04-30', 165, 'package', 6, 1],
    ['guesthouse-room-2p|2026-10-01', '2026-10-01', '2027-04-30', 50, 'per_night', null, 2],
    ['guesthouse-room-2p-6n|2026-10-01', '2026-10-01', '2027-04-30', 260, 'package', 6, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceBasis === 'room' && s.availability === 'on_request'));
});

test('fws: content', async () => {
  const c = await ferienwohnungenWestwindSaal.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Saal, Fischland-Darß');
  assert.match(c.summary, /Wassersportcenter Saal with its kite school/);
  assert.match(c.summary, /flats cost EUR 50-70 per night for 1-2 persons, guesthouse rooms from EUR 30 per night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Ferienwohnung Emma', 'Ferienwohnung Ben', 'Gästehaus Darßblick room']);
  assert.ok(c.rooms[2].features.includes('Low season (1.10.-30.4.), 1 Woche = 6 Nächte: EUR 165 (1 person) / EUR 260 (2 persons) per room'));
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => /\/\.cm4all\/uproc\.php\/0\/.+\/picture-1600/.test(u)));
});
