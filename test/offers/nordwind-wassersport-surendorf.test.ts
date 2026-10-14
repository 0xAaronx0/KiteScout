// Nordwind Wassersport kite weekend (Surendorf): replays the Contao pages recorded 2026-10-14 (scripts, styles and
// srcsets stripped). Slots are built with a pinned "today": the printed 2026 weekends are almost all past.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nordwindWassersportSurendorf, buildNwsSlots, fetchNwsSlots, parseNwsPage,
} from '../../src/offers/adapters/nordwind-wassersport-surendorf.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/nordwind-wassersport-surendorf');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const weekend = read('reisen.nordwind-wassersport.de_kompaktwochenenden_kitesurfen.');

test('nordwind: 2026 weekends and the three price variants', () => {
  const p = parseNwsPage(weekend);
  assert.equal(p.year, 2026);
  assert.equal(p.weekends.length, 15);
  assert.deepEqual([p.weekends[0], p.weekends[14]], [{ start: '2026-05-29', end: '2026-05-31' }, { start: '2026-10-16', end: '2026-10-18' }]);
  assert.deepEqual(p.variants.map(v => [v.id, v.persons, v.price]), [['cat-a-2p', 2, 369], ['cat-b-3p', 3, 339], ['cat-b-5p', 5, 319]]);
});

test('nordwind: slots = variant x weekend, EUR per person for the package', async () => {
  const all = buildNwsSlots(parseNwsPage(weekend), '2026-01-01');
  assert.deepEqual(checkSlots(all).problems, []);
  assert.equal(all.length, 45);
  const slots = await fetchNwsSlots('2026-10-14');
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.occupancy]), [
    ['cat-a-2p|2026-10-16', '2026-10-16', '2026-10-18', 369, 2],
    ['cat-b-3p|2026-10-16', '2026-10-16', '2026-10-18', 339, 3],
    ['cat-b-5p|2026-10-16', '2026-10-16', '2026-10-18', 319, 5],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.priceBasis === 'person' && s.availability === 'on_request'));
  assert.deepEqual(await fetchNwsSlots('2026-10-19'), []);
});

test('nordwind: content (camp, 2 nights)', async () => {
  const c = await nordwindWassersportSurendorf.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 3);
  assert.equal(c.region, 'Surendorf, Baltic Coast');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /EUR 369 per person in a 2-person apartment, or EUR 319-339 per person/);
  assert.match(c.sourceText ?? '', /Nordwind Wassersportstation in Surendorf/);
  assert.match(c.sourceText ?? '', /direkt oberhalb vom Strand und der Wassersportstation/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Category A apartment', 'Category B holiday flat']);
  assert.ok(c.rooms[0].features.includes('Single-occupancy surcharge (whole weekend): EUR 69'));
  assert.equal(c.imageUrls[0], 'https://reisen.nordwind-wassersport.de/files/CONTENT/2026/Wocheneden.jpg');
  assert.equal(new Set(c.imageUrls.map(u => new URL(u).pathname)).size, c.imageUrls.length);
});
