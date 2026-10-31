// Feddet Strand Resort: replays the English site pages and the Compusoft answers recorded 2026-10-14 (pages without
// scripts / styles / navigation; profile lists and price answers trimmed to the fields the parser reads). Slots are built
// with today pinned to the recording day so the sample weeks (and their fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  feddetStrandResort, FSR_PORTAL, FSR_ROOMS, fetchFsrSlots, parseFsrGeo, parseFsrKite, parseFsrUnitPhotos, parseFsrUnits,
} from '../../src/offers/adapters/feddet-strand-resort.js';
import { planGallery } from '../../src/offers/gallery.js';
import { parseCsobList } from '../../src/offers/adapters/hvide-sande-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/feddet-strand-resort');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const incomplete: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: (r: string) => { incomplete.push(r); } };
const TODAY = '2026-10-14';

test('feddet: geo, kite page and unit cards', () => {
  assert.deepEqual(parseFsrGeo(read('feddet.dk_en_.')), { lat: 55.174466, lng: 12.101196 });
  const k = parseFsrKite(read('feddet.dk_en_activities_kitesurfing_.'));
  assert.equal(k.ownGear, true);
  assert.equal(k.annualPass, '995');
  assert.match(k.school ?? '', /collaborates with Kitekollektivet/);
  assert.deepEqual(k.courses, ['Private course 1:1: 5 hours 2750 DKK, 10 hours 5250 DKK', 'Course for 2 people: 5 hours 1474 DKK, 10 hours 2950 DKK']);
  const u = parseFsrUnits(read('feddet.dk_en_accomodation_.'));
  assert.equal(u.length, 15);
  assert.deepEqual(u.slice(0, 3).map(x => x.name), ['Spa Lodge', 'Spa Mobilehome', 'Comfort Lodge']);
  assert.ok(u[0].facts.includes('Includes 5 people in the price and 20 kWh per day'));
  assert.ok(u.every(x => !/pitch|camper|seasonal/i.test(x.name)));
});

test('feddet: unit filter keeps rental units, drops pitches, offers and add-ons', () => {
  const all = files.filter(f => f.startsWith('v3.onlinebooking.dk_profile_getCSProfileListViewModel')).flatMap(f => parseCsobList(readFileSync(join(DIR, f), 'utf8')));
  const units = [...new Set(all.filter(FSR_PORTAL.isUnit).map(p => p.title))];
  assert.ok(units.includes('Spa Lodge') && units.includes('Olivia Ocean Suite'));
  assert.ok(units.every(t => !/offer|tilbud|last minute|weekend|rental rooms|pitch|vælg/i.test(t)));
});

test('feddet: slots = rental unit type x sample week, sampling stops after 2 closed weeks', async () => {
  const slots = await fetchFsrSlots(TODAY, ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 30);
  assert.deepEqual(incomplete, []);
  assert.deepEqual([...new Set(slots.map(s => s.startDate))], ['2026-10-17', '2026-11-07', '2026-12-05']);
  assert.ok(notes.some(n => /stopped sampling after 2 closed weeks in a row \(last 2027-02-06\)/.test(n)));
  assert.ok(notes.some(n => /left out: .*Spa Glamping Tent/.test(n))); // out of season (April-October), not sold out
  const s = slots.find(x => x.key === 'comfort-lodge|2026-11-07')!;
  assert.deepEqual([s.endDate, s.price, s.currency, s.packageNights, s.availability, s.spotsLeft], ['2026-11-13', 4745, 'DKK', 7, 'available', 11]);
  assert.equal(slots.find(x => x.key === 'spa-villa|2026-10-17')!.availability, 'sold_out');
  assert.equal(Math.min(...slots.filter(x => x.price !== null).map(x => x.price!)), 4745);
});

test('feddet: content', async () => {
  const c = await feddetStrandResort.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Feddet, South Zealand');
  assert.deepEqual(c.spotCoords, { lat: 55.174466, lng: 12.101196 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /works with the kite school Kitekollektivet/);
  assert.ok(c.optionalServices.includes('Kite spot annual pass DKK 995'));
  assert.equal(c.rooms.length, 15);
  assert.ok(c.imageUrls[0].endsWith('/2021/12/kite-surfing-feddet-5.jpg'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => u.startsWith('https://feddet.dk/wp-content/uploads/') && !/\.png$|flags/.test(u)));
});

test('feddet: engine units link to their content rooms', async () => {
  const names = (await feddetStrandResort.fetchContent(ctx)).rooms.map(r => r.name);
  assert.ok(Object.values(FSR_ROOMS).every(r => names.includes(r)));
  const slots = await fetchFsrSlots(TODAY, { note: () => {}, incomplete: () => {} });
  const linked = new Map(slots.map(s => [s.unit, slotRoom(names, s)]));
  assert.equal(linked.get("Lark's cabin"), 'Larchcabin');
  assert.equal(linked.get('Comfort Lodge without pets'), 'Pet-free Comfort Lodge');
  assert.equal(linked.get('Olivia Ocean Suite'), 'The Olivia Ocean Suite');
  assert.equal(linked.get('Amalie Holiday House'), 'The Beach House Amalie');
  assert.equal(linked.get('Spa villa'), 'Spa Villa'); // by name
  assert.equal(linked.get('Vacation Home Elvira'), null); // no unit card on the site
  assert.deepEqual([...linked].filter(([u, r]) => !r).map(([u]) => u), ['Vacation Home Elvira']);
});

test('feddet: per-unit photos from the card sliders, kite photos from the kite page', async () => {
  const c = await feddetStrandResort.fetchContent(ctx);
  const room = (n: string) => c.rooms.find(r => r.name === n)!;
  const counts = Object.fromEntries(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0]));
  assert.deepEqual(counts, {
    'Spa Lodge': 10, 'Spa Mobilehome': 11, 'Comfort Lodge': 7, 'Pet-free Comfort Lodge': 5, Larchcabin: 8,
    'Spa Glamping tent': 10, 'Glamping tent': 7, 'Spa Rental Caravan': 8, 'Camp-Let tent rental trailer': 3, 'Spa Villa': 9,
    'The Beach House Paradiso': 0, // its slides are lazy (data-src) and the recording kept no URL; see the data-src case below
    'The Beach House Caroline': 8, 'The Beach House Amalie': 9, 'Holiday house Thalia': 9, 'The Olivia Ocean Suite': 8,
  });
  assert.match(room('Spa Lodge').imageUrls![0], /premium-strandhytte-2023-3-/);
  assert.match(room('Spa Mobilehome').imageUrls![0], /mobilehome-feddet-16-/);
  assert.match(room('Comfort Lodge').imageUrls![0], /strandhytter2022-2-/);
  assert.match(room('Pet-free Comfort Lodge').imageUrls![0], /strandhytte-2023-4-1-/);
  assert.match(room('Larchcabin').imageUrls![0], /laerkehytte-feddet-25-/);
  assert.match(room('Spa Glamping tent').imageUrls![0], /premium-glampingtelt-11-/);
  assert.match(room('Glamping tent').imageUrls![0], /glampingtelt-feddet-6-/);
  assert.match(room('Spa Rental Caravan').imageUrls![0], /spa-udlejningsvogn-13-/);
  assert.match(room('Camp-Let tent rental trailer').imageUrls![0], /camplet1-/);
  assert.match(room('Spa Villa').imageUrls![0], /premium-lejlighed-feddet-9-1-/);
  assert.match(room('The Beach House Caroline').imageUrls![0], /strandhuset-caroline-feddet-15-/);
  assert.match(room('The Beach House Amalie').imageUrls![0], /strandhuset-amalie-feddet-1-/);
  assert.match(room('Holiday house Thalia').imageUrls![0], /feriehuset-thalia-1-/);
  assert.match(room('The Olivia Ocean Suite').imageUrls![0], /olivia-1-/);
  // the pet-free lodge is the same lodge without pets and shares some photos; the others only show their own unit
  assert.ok(c.rooms.every(r => (r.imageUrls ?? []).every(u => u.startsWith('https://feddet.dk/wp-content/uploads/') && !/\.png$|flags|logo/i.test(u))));
  // lazy slides: the data-src photo is taken, grouped by the slide's link to the unit page
  const lazy = parseFsrUnitPhotos('<div class="swiper-slide"><a href="https://feddet.dk/en/accommodation/concept-holiday-houses/beach-house-paradiso/">'
    + '<figure class="swiper-slide-inner"><img class="swiper-slide-image swiper-lazy" data-src="https://feddet.dk/wp-content/uploads/elementor/thumbs/strandhuset-paradiso-feddet-50-abc.jpg" alt="x" /></figure></a></div>');
  assert.deepEqual([...lazy], [['https://feddet.dk/en/accommodation/concept-holiday-houses/beach-house-paradiso/',
    ['https://feddet.dk/wp-content/uploads/elementor/thumbs/strandhuset-paradiso-feddet-50-abc.jpg']]]);
  assert.equal(c.spotImageUrls!.length, 11);
  assert.ok(c.spotImageUrls!.every(u => /\/2021\/12\/kite-surfing-feddet-\d+\.jpg$/.test(u)));
  assert.match(c.spotImageUrls![0], /kite-surfing-feddet-5\.jpg$/);
  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms.filter(x => x.imageUrls?.length)) assert.ok(first24.includes(r.imageUrls![0]), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
