// Feddet Strand Resort: replays the English site pages and the Compusoft answers recorded 2026-10-14 (pages without
// scripts / styles / navigation; profile lists and price answers trimmed to the fields the parser reads). Slots are built
// with today pinned to the recording day so the sample weeks (and their fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  feddetStrandResort, FSR_PORTAL, fetchFsrSlots, parseFsrGeo, parseFsrKite, parseFsrUnits,
} from '../../src/offers/adapters/feddet-strand-resort.js';
import { parseCsobList } from '../../src/offers/adapters/hvide-sande-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

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
