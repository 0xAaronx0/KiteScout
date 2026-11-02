// Dakhla Attitude (Dakhla lagoon): replays the French price pages recorded 2026-10-12 (script/style trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dakhlaAttitudeDakhla, DA_PAGES, daRoomPhotos, daTablesByUnit, dhgBands, dhgDate, dhgLevel, dhgSlots, fetchDaSlots, parseDaTables,
} from '../../src/offers/adapters/dakhla-attitude-dakhla.js';
import { planGallery } from '../../src/offers/gallery.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/dakhla-attitude-dakhla');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-12';
const pages = DA_PAGES.map(d => ({ path: d.path, html: read(`dakhla-attitude.ma${d.path.replace(/\//g, '_')}.`) }));

test('dhg: season words and dates', () => {
  assert.deepEqual(['Basse Saison', 'Saison Standard', 'Intermidaire Saison', 'Haute Saison', 'Middle Season', 'MAD'].map(dhgLevel),
    ['low', 'mid', 'mid', 'high', 'mid', null]);
  assert.equal(dhgDate('05', '09', '26'), '2026-09-05');
  assert.equal(dhgDate('23', '12', '2027'), '2027-12-23');
});

test('dakhla-attitude: Windhunter page = 2026 grid + 2027 grid, columns read by season word', () => {
  const [g26, g27] = parseDaTables(pages.find(p => p.path === '/windhunter-2/')!.html, DA_PAGES[3].units);
  assert.equal(g26.unit, 'Windhunter Camp');
  assert.deepEqual(g26.prices.high, { 1: 1210, 2: 1760, 3: 2420, 4: 2970, 5: 3410 });
  assert.deepEqual(g27.prices.low, { 1: 850, 2: 1190, 3: 1586, 4: 1869, 5: 2039 }); // 2027 grid: Haute | Intermédiaire | Basse
  assert.deepEqual(g27.prices.high![2], 1813);
  assert.ok(g26.seasons.some(b => b.level === 'high' && b.start === '2026-09-05' && b.end === '2026-11-08'));
  assert.equal(g27.seasons.length, 13);
  assert.ok(g27.seasons.some(b => b.level === 'mid' && b.start === '2026-11-09' && b.end === '2026-11-23'));
  assert.ok(g27.offer76);
});

test('dakhla-attitude: every category of the six pages (VIP A-C, Speed Spot + Premium by marker)', () => {
  const byUnit = daTablesByUnit(pages);
  assert.deepEqual([...byUnit.keys()], ['VIP A', 'VIP B', 'VIP C', 'Dragon Camp', 'Dragon Camp Premium', 'Windhunter Camp', 'Windhunter Premium', 'Speed Spot', 'Speed Spot Premium']);
  assert.ok([...byUnit.values()].every(ts => ts.length === 2));
  assert.deepEqual(byUnit.get('VIP C')![1].prices.low, { 1: 2475, 2: 2475, 3: 3520, 4: 4565, 5: 5610 });
  assert.deepEqual(byUnit.get('Speed Spot Premium')![1].prices.high, { 1: 1869, 2: 2379, 3: 3229, 4: 3626 });
  // the Windhunter Premium grid is captioned "WINDHUNTER CAMP" but has its own prices
  assert.equal(byUnit.get('Windhunter Premium')![1].prices.low![2], 1416);
});

test('dakhla-attitude: bands - 2026 grid until 2026-11-08, then the 2027 grid', () => {
  const tables = daTablesByUnit(pages).get('Windhunter Camp')!;
  const bands = dhgBands(tables, TODAY);
  assert.deepEqual(bands.slice(0, 3).map(b => [b.level, b.start, b.end]), [
    ['high', '2026-09-05', '2026-11-08'], ['mid', '2026-11-09', '2026-11-23'], ['low', '2026-11-24', '2026-12-22'],
  ]);
  assert.equal(bands.length, 14);
  assert.deepEqual(bands[bands.length - 1].start, '2027-12-23');
});

test('dakhla-attitude: slots = category x band, MAD per bungalow per night for 2 guests', async () => {
  const slots = dhgSlots(daTablesByUnit(pages), TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 126);
  const w = slots.find(s => s.key === 'windhunter-camp-2p|2027-01-05')!;
  assert.deepEqual([w.startDate, w.endDate, w.unit, w.price, w.currency, w.priceUnit, w.priceBasis, w.occupancy, w.availability, w.availabilityText],
    ['2027-01-05', '2027-01-31', 'Windhunter Camp', 1190, 'MAD', 'per_night', 'room', 2, 'unknown', 'low season']);
  assert.equal(slots.find(s => s.key === 'windhunter-camp-2p|2026-09-05')!.price, 1760);
  assert.equal(slots.find(s => s.key === 'vip-b-2p|2026-12-23')!.price, 2420);
  assert.equal(Math.min(...slots.map(s => s.price!)), 1190);
  assert.deepEqual(await fetchDaSlots(TODAY), slots);
});

test('dakhla-attitude: content', async () => {
  const c = await dakhlaAttitudeDakhla.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Dakhla Attitude');
  assert.equal(c.country, 'Morocco');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /9 bungalow categories in two camps/);
  assert.match(c.summary, /from MAD 1,190 per bungalow per night/);
  assert.equal(c.rooms.length, 9);
  assert.ok(c.rooms.find(r => r.name === 'Windhunter Camp')!.features.some(f => /seasons from 2026-11-09: 1 pax 850 \/ 1,133 \/ 1,246; 2 pax 1,190/.test(f)));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /\.(jpe?g|webp)$/i.test(u) && !/logo|wall|Plan-DA/i.test(u)));
});

test('dakhla-attitude: each category gets the gallery of its BUNGALOW row, the kitesurf page as spot', async () => {
  const c = await dakhlaAttitudeDakhla.fetchContent(ctx);
  const file = (u: string) => u.split('/').pop();
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, file(r.imageUrls![0])]), [
    ['VIP A', 4, 'DSC09637.jpg'],
    ['VIP B', 4, 'VIP-B-51605932-1.jpg'],
    ['VIP C', 7, 'VIP-C-51006007-2.jpg'],
    ['Dragon Camp', 9, 'DSCF1757-Recupere.jpg'],
    // DSCF1741-copie opens the gallery but is also the Windhunter location slider's photo: left out
    ['Dragon Camp Premium', 14, 'DSC01181dragon-premium-dakhla-attitude.jpg'],
    ['Windhunter Camp', 4, 'DSC00710-1.jpg'],
    ['Windhunter Premium', 7, 'DSC00772-2.jpg'],
    // the Speed Spot gallery stands before its heading inside the row
    ['Speed Spot', 8, 'DSC_6264-2.jpg'],
    ['Speed Spot Premium', 4, 'IMGL1939-Enhanced-SR.jpeg'],
  ]);
  const room = (n: string) => c.rooms.find(r => r.name === n)!.imageUrls!;
  assert.ok(room('VIP A').some(u => /DSC05738-1-1\.jpg$/.test(u)));
  assert.ok(room('VIP C').every(u => /VIP-C-|DSC058/.test(u)) && room('VIP B').every(u => /VIP-B-/.test(u)));
  // DSC05781-2 sits in both the VIP B and the VIP C gallery: given to neither
  assert.ok(!c.rooms.some(r => r.imageUrls!.some(u => /DSC05781-2/.test(u))));
  // location sliders (EMPLACEMENT: DC1-3, WH-location, DSCF2335, drone shots) are not room photos
  const all = c.rooms.flatMap(r => r.imageUrls!);
  assert.ok(!all.some(u => /DC\d-dragon-camp|WH-location|DSCF2335|DSCF1741|Unknown-16|dragon-camp-vista/.test(u)));
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(u => /^https:\/\/dakhla-attitude\.ma\/wp-content\/uploads\/.+\.(?:jpe?g|webp)$/.test(u) && !/-\d+x\d+\./.test(u)));
  assert.deepEqual(daRoomPhotos(pages).get('Speed Spot Premium')!.map(file), ['IMGL1939-Enhanced-SR.jpeg', 'IMGL1947.jpeg', 'IMGL1935-Enhanced-SR.jpeg', 'IMGL1909.jpeg']);

  assert.equal(c.spotImageUrls?.length, 9);
  assert.deepEqual(c.spotImageUrls!.slice(0, 2).map(file), ['DSC00125.jpg', 'IMG_0778.jpg']);
  assert.ok(c.spotImageUrls!.some(u => /kite-dakhla\.jpg$/.test(u)) && !c.spotImageUrls!.some(u => /wall-/.test(u)));

  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
