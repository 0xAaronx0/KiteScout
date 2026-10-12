// Hotel Puclaro (Puclaro reservoir, Valle del Elqui): replays the one-page site recorded 2026-10-12 (content only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hotelPuclaroGualliguaica, parsePuclaroCards, puclaroPhotos } from '../../src/offers/adapters/hotel-puclaro-gualliguaica.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hotel-puclaro-gualliguaica');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const home = read('hotelpuclaro.cl_.');

test('puclaro: unit types and experiences', () => {
  const cards = parsePuclaroCards(home);
  assert.deepEqual(cards.map(c => c.heading), ['Cubos', 'Cabañas', 'Windsurf & kitesurf', 'Astroturismo', 'Valle del Elqui', 'Slow mornings']);
  assert.equal(cards[2].text, 'El embalse, tu cancha natural.');
});

test('puclaro: photos without the generated concept images', () => {
  const photos = puclaroPhotos(home);
  assert.equal(photos.length, 21);
  assert.ok(photos.every(u => u.startsWith('https://hotelpuclaro.cl/assets/') && !u.includes('/generated/')));
  assert.ok(/generated\/wingfoil\.jpg/.test(home), 'the page does show generated images');
});

test('puclaro: no slots (no rates on the site, Beds24 unavailable / robots-disallowed)', async () => {
  const notes: string[] = [];
  const slots = await hotelPuclaroGualliguaica.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /Beds24/);
});

test('puclaro: content', async () => {
  const c = await hotelPuclaroGualliguaica.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Hotel Puclaro');
  assert.equal(c.country, 'Chile');
  assert.equal(c.spot, 'Embalse Puclaro');
  assert.match(c.summary, /windsurfing, kitesurfing, wing foiling and SUP on the reservoir/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Cubo', 'Cabaña']);
  assert.match(c.sourceText ?? '', /tagline: Boutique wind & kite resort · Valle del Elqui/);
  assert.match(c.sourceText ?? '', /Marcelo Olivares 133, Vicuña/);
});
