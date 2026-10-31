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
import { planGallery } from '../../src/offers/gallery.js';

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

test('kailua: each unit type gets the gallery of its own article (gallery before the heading), surf photos as spot', async () => {
  const c = await kailuaLodgePelzerhaken.fetchContent(ctx);
  const file = (u: string) => u.split('/').pop();
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, file(r.imageUrls![0])]), [
    ['Holiday house type A', 6, 'architektur_kailualodge_9086_web-galerie.jpg'],
    ['Holiday house type B1', 14, 'kailua_lodge_pelzerhaken_ferienhaus_b1.jpg'],
    ['Holiday house type B2', 12, 'kailua_lodge_pelzerhaken_b2.jpg'],
    ['Holiday flat type D1', 8, '01-kelii_wohnraum-01.jpg'],
    ['Holiday flat type D2', 11, 'waikiki_north-shore_aussenansicht-haus_03.jpg'],
    ['Loft Waterfront', 10, 'img_5978.jpg'],
    ['Lodge type C1', 11, 'kailua-lodge_aussenanlage_10.jpg'],
    ['Lodge type C2', 8, 'architektur_kailualodge_9072_web-galerie-1.jpg'],
    ['Mini lodge type C1', 6, 'kailua_lodge_pelzerhaken_lodge_c1.jpg'],
    ['Mini lodge type C2', 5, '02_kalama-2_wohnraum-01.jpg'],
  ]);
  // unit names in the file names land in their own type (the old heuristic gave C1 photos to the loft)
  const room = (n: string) => c.rooms.find(r => r.name === n)!.imageUrls!;
  assert.ok(room('Holiday house type B1').some(u => /molokai/.test(u)) && room('Holiday house type B2').some(u => /kihei/.test(u)));
  assert.ok(room('Lodge type C1').some(u => /barking-sands/.test(u)) && room('Lodge type C2').some(u => /hookipa/.test(u)));
  assert.ok(room('Mini lodge type C1').some(u => /mana-point/.test(u)) && !room('Loft Waterfront').some(u => /barking|hanapepe|kee-beach/.test(u)));
  const all = c.rooms.flatMap(r => r.imageUrls!);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(u => /^https:\/\/www\.kailualodge\.de\/wp-content\/uploads\/.+\.jpg$/.test(u) && !/-\d+x\d+\./.test(u) && !/lageplan|legende/.test(u)));

  assert.deepEqual(c.spotImageUrls?.map(file), ['kailua_lodge_surfen_2.jpg', 'kailua_lodge_surf_opti.jpg', 'kailua_lodge_wing_sup.jpg', 'kailua_lodge_naish_procenter_1.jpg']);

  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
