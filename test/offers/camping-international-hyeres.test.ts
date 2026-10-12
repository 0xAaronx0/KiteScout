// Camping International & Spa (Giens / Hyères): replays the English welcome, accommodation and sport pages
// recorded 2026-10-12 (script / style bodies, SVGs and comments trimmed). The SecureHoliday widget is not called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingInternationalHyeres, parseCiCoords, parseCiDocuments, parseCiFacts, parseCiFaq, parseCiKite,
} from '../../src/offers/adapters/camping-international-hyeres.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/camping-international-hyeres');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const home = read('acampa-vacances.com_en_international_welcome_.');
const accommodation = read('acampa-vacances.com_en_international_accomodation_.');
const sport = read('acampa-vacances.com_en_international_sport-and-well-being-activities_.');

test('camping-international: facts, rate sheet link, map pin', () => {
  const f = parseCiFacts(home);
  assert.deepEqual([f.pitches, f.hectares, f.openAllYear, f.spotMeters], [162, 3, true, 50]);
  assert.match(f.villa ?? '', /130m² rental with sea view/);
  assert.match(f.apartments ?? '', /33 to 58m2 .* 2 to 5 people/);
  assert.match(f.mobileHomes ?? '', /up to 6 people/);
  const rates = parseCiDocuments(home).find(d => /tarif/i.test(d.url));
  assert.equal(rates?.url, 'https://acampa-vacances.com/wp-content/uploads/2024/11/Tarifs-Locations-Emplacements-CI-2026-prix-mini-maxi-A4.pdf');
  assert.deepEqual(parseCiCoords(home), { lat: 43.0413947, lng: 6.1279316 });
});

test('camping-international: FAQ and the Almanarre kite block', () => {
  assert.equal(parseCiFaq(accommodation).find(x => /minimum number of nights/.test(x.q))?.a, '3 nights.');
  const kite = parseCiKite(sport);
  assert.equal(kite[0], 'Almanarre Bay: the ideal place for kitesurfing');
  assert.ok(kite.some(l => /The KGG and MF Kite schools offer courses for everyone, from beginners to advanced kiteboarders/.test(l)));
  assert.ok(kite.some(l => /possibility of buying or renting equipment/.test(l)));
});

test('camping-international: no slots (widget needs an embedded API key) -> price on request', async () => {
  const slots = await campingInternationalHyeres.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /SecureHoliday/.test(n)));
});

test('camping-international: content', async () => {
  const c = await campingInternationalHyeres.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Camping International & Spa');
  assert.equal(c.country, 'France');
  assert.deepEqual(c.spotCoords, { lat: 43.0413947, lng: 6.1279316 });
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /open all year, just 50 m from the Almanarre kite spot, with 162 pitches on 3 hectares/);
  assert.match(c.summary, /minimum stay of 3 nights/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Mobile home', 'Apartment', 'Villa']);
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => u.includes('/wp-content/uploads/') && !/AdobeStock|unsplash|-\d+x\d+\./.test(u)));
  assert.ok(!notes.some(n => /rate sheet link does not name/.test(n)));
});
