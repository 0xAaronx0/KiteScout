// Kailua Lodge (Pelzerhaken): replays the WordPress pages recorded 2026-10-14 (scripts, styles, srcsets and class
// attributes stripped). Prices are constants read from the linked PDF price lists; the test checks the link guard,
// the season continuity and a few values against the PDFs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kailuaLodgePelzerhaken, buildKlpSlots, fetchKlpSlots, klpPdfLinks, klpReleasedSheets, KLP_SHEETS, parseKlpUnits,
} from '../../src/offers/adapters/kailua-lodge-pelzerhaken.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kailua-lodge-pelzerhaken');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const home = read('www.kailualodge.de_.');

test('kailua: both price-list PDFs are linked under the hand-read paths', () => {
  assert.deepEqual([...klpPdfLinks(home)], [[2026, '/wp-content/uploads/2026/08/preisliste-2026.pdf'], [2027, '/wp-content/uploads/2026/08/preisliste-2027.pdf']]);
  assert.deepEqual(klpReleasedSheets(home).map(s => s.year), [2026, 2027]);
  const moved = home.replace(/2026\/08\/preisliste-2027\.pdf/g, '2027/01/preisliste-2027-neu.pdf');
  const n: string[] = [];
  assert.deepEqual(klpReleasedSheets(moved, { note: t => { n.push(t); } }).map(s => s.year), [2026]);
  assert.match(n[0], /price list 2027 no longer linked/);
});

test('kailua: slots = unit type x season range from today, EUR per unit per following night', async () => {
  const slots = await fetchKlpSlots('2026-10-14', ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 144); // 9 types x (4 remaining 2026 ranges + 12 ranges 2027)
  const peak = slots.find(s => s.key === 'house-a|2027-07-10')!;
  assert.deepEqual([peak.endDate, peak.price, peak.minNights, peak.occupancy, peak.availability], ['2027-08-14', 359, 7, 6, 'unknown']);
  const now = slots.find(s => s.key === 'lodge-c2|2026-09-06')!;
  assert.deepEqual([now.endDate, now.price, now.minNights], ['2026-10-30', 179, 3]);
  const nye = slots.find(s => s.key === 'flat-d2|2026-12-27')!;
  assert.deepEqual([nye.endDate, nye.price, nye.minNights], ['2027-01-02', 269, 5]);
  assert.equal(Math.min(...slots.map(s => s.price!)), 45); // mini lodge C1, low season
  assert.ok(notes.some(t => /constants read from the PDF/.test(t)));
  assert.deepEqual(buildKlpSlots(KLP_SHEETS, '2028-01-04'), []);
});

test('kailua: unit-type cards', () => {
  const u = parseKlpUnits(read('www.kailualodge.de_uebernachten_.'));
  assert.equal(u.length, 10);
  assert.deepEqual(u[0], { site: 'Ferienhaus Typ A', facts: { 'Größe': '100 m²', Schlafzimmer: '3', 'Badezimmer / WC': '2 / 2', Personen: '6', 'Strand in': '80 m', 'Hunde erlaubt': 'Ja' }, extras: ['Parkplatz', 'WLAN', 'Sauna', 'Kamin'] });
});

test('kailua: content', async () => {
  const c = await kailuaLodgePelzerhaken.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kailua Lodge');
  assert.equal(c.region, 'Pelzerhaken, Baltic Coast');
  assert.deepEqual(c.spotCoords, { lat: 54.0881448, lng: 10.8728051 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /Sail & Surf Pelzerhaken, a VDWS school and Naish pro centre, is right next door/);
  assert.match(c.summary, /The 2027 price list starts at EUR 99 per night/);
  assert.match(c.sourceText ?? '', /Direkt neben der Kailua Lodge/);
  assert.equal(c.rooms.length, 10);
  assert.ok(c.rooms[0].features.includes('2027: EUR 189-369 per following night (low season to high season B); first night incl. final cleaning EUR 179 more'));
  assert.ok(c.imageUrls[0].includes('naish_procenter'));
  assert.ok(c.imageUrls.every(u => /^https:\/\/www\.kailualodge\.de\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
});
