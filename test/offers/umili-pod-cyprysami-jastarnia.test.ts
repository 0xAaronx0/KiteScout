// Umili Pod Cyprysami (Jastarnia): replays /en, /cottages and /holidays-surf-inclusive recorded 2026-10-12
// (script / style bodies, SVGs and comments trimmed) and /gallery (photos) recorded 2026-10-21. Bookassist is not
// called (robots.txt disallows it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  umiliPodCyprysamiJastarnia, parsePcCoords, parsePcEquipment, parsePcGalleryAttractions, parsePcPackages, parsePcSurfInclusive,
  parsePcUnits, pcPhotoCandidates, PC_KITE_PHOTOS,
} from '../../src/offers/adapters/umili-pod-cyprysami-jastarnia.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/umili-pod-cyprysami-jastarnia');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const home = read('podcyprysami.pl_en.');
const cottages = read('podcyprysami.pl_cottages.');
const surf = read('podcyprysami.pl_holidays-surf-inclusive.');
const gallery = read('podcyprysami.pl_gallery.');

test('pod-cyprysami: unit cards (m², max persons, group, gallery)', () => {
  const units = parsePcUnits(cottages);
  assert.equal(units.length, 12);
  assert.deepEqual(units.map(u => [u.name, u.group, u.areaM2, u.maxPersons]).slice(0, 3), [
    ['Cottages 2+1 Active', 'lodges', 14, 3],
    ['Air-conditioned Active Cool 4+2 Cottages', 'lodges', 24, 6],
    ['Cottages 4+2 Active', 'lodges', 24, 6],
  ]);
  assert.deepEqual(units.slice(-3).map(u => [u.name, u.group, u.areaM2, u.maxPersons]), [
    ['Double Room', 'rooms-and-apartments', null, 2],
    ['6 bedded apartment', 'rooms-and-apartments', 35, 6],
    ['Hostel 6 bedded', 'hostel', null, 6],
  ]);
  assert.ok(units.every(u => u.photos.length > 0 && u.photos.every(p => p.startsWith('https://podcyprysami.pl/thumb?file=') && p.endsWith('&w=1440'))));
  assert.deepEqual(parsePcEquipment(cottages), [
    'Cottages: Free internet, TV, fan, bedding.', 'Bathroom: Shower, Towels, Hairdryer',
    'Kitchenette: Heating plate, set of plates and glasses', 'Terrace: Perfect for summer evenings and sunny days',
  ]);
});

test('pod-cyprysami: map pin, 2027 packages, Surf Inclusive season', () => {
  assert.deepEqual(parsePcCoords(home), { lat: 54.708848, lng: 18.652231 });
  const packages = parsePcPackages(home);
  assert.ok(packages.includes('May Weekend 2027 - HB & BBQ party! 30.04 - 03.05'));
  assert.ok(packages.includes('June long weekend 2027 26.05 - 30.05'));
  const s = parsePcSurfInclusive(surf);
  assert.equal(s.season, '25 Jun - 31 Aug');
  assert.ok(s.items.some(i => /^daily 2h water sports training/.test(i)));
});

test('pod-cyprysami: no slots (no prices, Bookassist robots-blocked) -> price on request', async () => {
  const slots = await umiliPodCyprysamiJastarnia.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /Bookassist/.test(n)));
  assert.equal(umiliPodCyprysamiJastarnia.confidence, 'low');
});

test('pod-cyprysami: content', async () => {
  const c = await umiliPodCyprysamiJastarnia.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Umili Pod Cyprysami');
  assert.equal(c.country, 'Poland');
  assert.equal(c.spot, 'Jastarnia');
  assert.deepEqual(c.spotCoords, { lat: 54.708848, lng: 18.652231 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /9 types of heated, air-conditioned cottages \(13-30 m², up to 10 persons\)/);
  assert.match(c.summary, /SurfPoint school has its base at the resort/);
  assert.match(c.summary, /"Holidays 2027 Surf Inclusive" package \(25 Jun - 31 Aug\)/);
  assert.equal(c.rooms.length, 12);
  assert.equal(c.rooms[0].description, '14 m², up to 3 persons');
  assert.equal(c.imageUrls.length, 24);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://podcyprysami.pl/thumb?') && !/Ustronie|Ruciane|logo/i.test(u)));
  assert.match(c.sourceText ?? '', /May Weekend 2027/);
});

test('umili-pod-cyprysami: photo pool (gallery kite photos interleaved with the cottages, distinct dedup keys)', async () => {
  const c = await umiliPodCyprysamiJastarnia.fetchContent(ctx);
  // the shared dedup (src/lib/images.ts canonicalKey) keys a URL on its "url" query param's path, else on its own
  // path - which is "/thumb" for every candidate here; mirror it and require one key per photo
  const key = (u: string) => { const x = new URL(u); const inner = x.searchParams.get('url'); return inner ? new URL(inner, x.origin).pathname : x.pathname; };
  assert.equal(new Set(c.imageUrls.map(key)).size, c.imageUrls.length);
  // one crop size for all: equal area, so the vision QC's 10 largest = the first 10
  assert.ok(c.imageUrls.every(u => u.includes('&w=1440&h=960&url=%2Fdomki-pod-cyprysami%2Fuser%2F')));
  const first10 = c.imageUrls.slice(0, 10).map(u => decodeURIComponent(new URL(u).searchParams.get('file')!));
  assert.match(first10[0], /Atuty\/20220512MP16/); // og: cottages with surfboards
  assert.equal(first10.filter(f => /Galeria/.test(f)).length, 5); // kite / beach photos
  assert.equal(first10.filter(f => /Domki/.test(f)).length, 4);   // cottages
  assert.match(first10[1], /54-DSC02354\.jpg$/);
  const attractions = parsePcGalleryAttractions(gallery);
  assert.ok(attractions.length >= 40);
  for (const n of PC_KITE_PHOTOS) assert.ok(attractions.some(f => f.endsWith(`%2F${n}`)), `gallery lacks ${n}`);
  // without the gallery the pool is cottages + home photos only
  const noGallery = pcPhotoCandidates(null, parsePcUnits(cottages), null, []);
  assert.ok(noGallery.length > 10 && noGallery.every(u => !/Galeria/.test(u)));
});
