// Amanpulo (Pamalican Island, Philippines): replays the aman.com pages recorded 2026-10-12 (fixtures trimmed: script/style
// bodies dropped). Content only: rates exist only in Aman's reservation engine, so no slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { amanpuloPamalican, ampImages, ampNames, parseAmpIncludes, parseAmpUnits } from '../../src/offers/adapters/amanpulo-pamalican.js';
import { planGallery } from '../../src/offers/gallery.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/amanpulo-pamalican');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('amanpulo: casita and villa cards', () => {
  const casitas = parseAmpUnits(read('www.aman.com_resorts_amanpulo_accommodation_casitas.'));
  assert.deepEqual(casitas.map(u => u.name), [
    'Grand Beach Pool Casita', 'Beach Pool Casita', 'Beach Casita', 'Treetop Pool Casita', 'Treetop Casita', 'Deluxe Hillside Casita', 'Hillside Casita',
  ]);
  assert.ok(casitas.every(u => u.type === 'Casita' && !!u.intro));
  const villas = parseAmpUnits(read('www.aman.com_resorts_amanpulo_accommodation_villas.'));
  assert.deepEqual(villas.map(u => u.name), ['Four-Bedroom Lagoon Villa', 'Four-Bedroom Palawan Villa', 'Three-Bedroom Villa', 'Two-Bedroom Villa', 'One-Bedroom Villa']);
  assert.match(villas[3].intro ?? '', /215 square metres/);
});

test('amanpulo: "All stays include" list', () => {
  const inc = parseAmpIncludes(read('www.aman.com_resorts_amanpulo_accommodation_casitas.'));
  assert.equal(inc[0], 'Daily breakfast');
  assert.ok(inc.includes('Use of selected non-motorised watersports equipment'));
  assert.equal(inc.length, 7);
});

test('amanpulo: photos are Amanpulo images only, one (largest) style per file', () => {
  const imgs = ampImages(read('www.aman.com_resorts_amanpulo_kite-surf-centre.'));
  assert.equal(imgs[0], 'https://www.aman.com/sites/default/files/2021-02/Amanpulo_Experiences-Surf_4.jpg');
  assert.ok(imgs.some(u => /_2x\/public\/2021-02\/Amanpulo_Experiences-Surf_2\.webp\?itok=/.test(u)));
  assert.equal(imgs.filter(u => /Amanpulo_Experiences-Surf_2/.test(u)).length, 1);
  assert.ok(imgs.every(u => /amanpulo/i.test(decodeURIComponent(u))));
});

test('amanpulo: no slots (price on request), no network', async () => {
  const before = requestsSoFar();
  const slots = await amanpuloPamalican.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.ok(notes.some(n => /reservation engine/.test(n)));
});

test('amanpulo: content', async () => {
  const c = await amanpuloPamalican.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Amanpulo');
  assert.equal(c.country, 'Philippines');
  assert.equal(c.spot, 'Pamalican Island');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /Kite & Surf Centre teaches all levels on a shallow lagoon/);
  assert.match(c.summary, /kiting runs between December and March/);
  assert.match(c.summary, /7 types of casitas/);
  assert.equal(c.rooms.length, 12);
  assert.ok(c.optionalServices.includes('Kite centre: High quality Naish equipment'));
  assert.equal(c.imageUrls.length, 30);
  assert.match(c.sourceText ?? '', /International Kite Surfing Organization/);
});

test('amanpulo: each unit type gets the first photo of its card (another type\'s photo skipped), the kite page as spot', async () => {
  const c = await amanpuloPamalican.fetchContent(ctx);
  // file name as read (its en dash written as "-" here)
  const file = (u: string) => decodeURIComponent(u.replace(/\?.*$/, '').split('/').pop()!).replace(/\u2013/g, '-');
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, file(r.imageUrls![0])]), [
    ['Grand Beach Pool Casita', 1, 'Amanpulo - Accommodation, Premier Beach Pool Casita.webp'],
    ['Beach Pool Casita', 1, 'Amanpulo, Beach Pool Casita.webp'],
    ['Beach Casita', 1, 'Amanpulo,Philippines - Accommodation, Beach Casita, Bedroom and Deck.webp'],
    ['Treetop Pool Casita', 1, 'Amanpulo-Treetop-Pool-Casita-square.webp'],
    // the card's first image is a "Four-Bedroom (Villa 25)" interior: skipped
    ['Treetop Casita', 1, 'amanpulo-treetop-casita-walkway-square.webp'],
    ['Deluxe Hillside Casita', 1, 'Deluxe Hillside Casita, Amanpulo, Philippines_Square.webp'],
    ['Hillside Casita', 1, 'Amanpulo, Philippines - Accommodation, Hillside Casita, Bedroom1.webp'],
    ['Four-Bedroom Lagoon Villa', 1, 'amanpulo_philippines_-_villa_pool.webp'],
    ['Four-Bedroom Palawan Villa', 1, 'amanpulo_philippines_-_villa.webp'],
    ['Three-Bedroom Villa', 1, 'amanpulo-three-bed-villa-square.webp'],
    ['Two-Bedroom Villa', 1, 'amanpulo-two-bedroom-villa-pool-view.webp'],
    ['One-Bedroom Villa', 1, 'Amanpulo_B364-Villa32_Pool_Day_01 (1) (1).webp'],
  ]);
  const all = c.rooms.flatMap(r => r.imageUrls!);
  assert.equal(new Set(all).size, all.length);
  // the same (largest) style URL ampImages picks for that file
  const pageImgs = [...ampImages(read('www.aman.com_resorts_amanpulo_accommodation_casitas.')), ...ampImages(read('www.aman.com_resorts_amanpulo_accommodation_villas.'))];
  assert.ok(all.every(u => pageImgs.includes(u) && /\/styles\/listing_teaser_extra_large_2x\/public\//.test(u)));
  assert.ok(ampNames('2026-06/Amanpulo--Philippines---Accommodation--Grand-Beach-Pool-Casita--8-.webp', 'Grand Beach Pool Casita'));
  assert.ok(!ampNames('2026-06/Amanpulo--Philippines---Accommodation--Grand-Beach-Pool-Casita--8-.webp', 'Beach Pool Casita'));
  assert.ok(!ampNames('2021-02/Deluxe%20Hillside%20Casita%2C%20Amanpulo_Square.webp', 'Hillside Casita'));

  assert.deepEqual(c.spotImageUrls?.map(file), ['Amanpulo_Experiences-Surf_4.jpg', 'Amanpulo_Experiences-Surf_2.webp', 'Amanpulo_Experiences-Surf_3.webp']);

  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
