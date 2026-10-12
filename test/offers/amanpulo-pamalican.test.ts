// Amanpulo (Pamalican Island, Philippines): replays the aman.com pages recorded 2026-10-12 (fixtures trimmed: script/style
// bodies dropped). Content only: rates exist only in Aman's reservation engine, so no slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { amanpuloPamalican, ampImages, parseAmpIncludes, parseAmpUnits } from '../../src/offers/adapters/amanpulo-pamalican.js';
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
