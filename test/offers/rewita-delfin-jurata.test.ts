// Rewita Jurata "Delfin": replays the resort home, rooms list and kite school article recorded 2026-10-12 (scripts
// except JSON-LD, styles, SVGs and style attributes trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rewitaDelfinJurata, buildRjSlots, parseRjRooms, rjName } from '../../src/offers/adapters/rewita-delfin-jurata.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/rewita-delfin-jurata');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const roomsPage = read('www.rewita.pl_obiekty_rewita-jurata_pokoje-do-wynajecia-jurata-rewita.');

test('rj: room cards (data-price / data-guests)', () => {
  const rooms = parseRjRooms(roomsPage);
  assert.deepEqual(rooms.map(r => [r.key, r.name, r.price, r.maxGuests, r.areaM2]), [
    ['delfin-pokoj-2-os-superior', 'Delfin Superior twin room', 360, 2, 15],
    ['delfin-pokoj-2-os-superior-l-w', 'Delfin Superior room with sofa bed', 360, 3, 15],
    ['delfin-duzy-apartament-2-os-superior', 'Delfin large Superior apartment', 420, 4, 30],
    ['delfin-maly-apartament-2-os-superior', 'Delfin small Superior apartment', 390, 4, 25],
  ]);
  assert.deepEqual(rooms.map(r => r.images.length), [5, 5, 7, 5]);
  assert.ok(rooms.every(r => r.images.every(u => /\/thumbs\/900x690\//.test(u))));
  assert.equal(rjName('WILLA STANDARD'), 'Willa Standard');
});

test('rj: slots = room type from-rate, undated, availability unknown', async () => {
  const slots = await rewitaDelfinJurata.fetchSlots(ctx);
  assert.deepEqual(slots, buildRjSlots(parseRjRooms(roomsPage)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [
    ['delfin-pokoj-2-os-superior', 360, 2], ['delfin-pokoj-2-os-superior-l-w', 360, 3],
    ['delfin-duzy-apartament-2-os-superior', 420, 4], ['delfin-maly-apartament-2-os-superior', 390, 4],
  ]);
  assert.ok(slots.every(s => s.currency === 'PLN' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('rj: content', async () => {
  const c = await rewitaDelfinJurata.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Rewita Jurata "Delfin"');
  assert.equal(c.region, 'Jurata, Hel Peninsula');
  assert.equal(c.spot, 'Jurata');
  assert.equal(c.spotCoords, undefined); // the JSON-LD geo points to Warsaw
  assert.equal(c.kiteLessons, true);
  assert.equal(c.beginnerFriendly, true);
  assert.match(c.summary, /more than 200 beds/);
  assert.match(c.summary, /kite and windsurf school runs on the Rewita grounds in Jurata/);
  assert.match(c.summary, /start at PLN 360 per room and night \(apartments for up to 4 guests from PLN 390\)/);
  assert.deepEqual(c.optionalServices.slice(0, 2), ['Breakfast buffet (8:00-11:00)', 'Dinner buffet (16:00-19:00)']);
  assert.ok(c.rooms[2].features.includes('Two rooms separated by a sliding door'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /profitroom\.(pl|com)\//.test(u) && !/\/(300x300|280x360)\/|konferencj|fokarium|shutterstock|Kawiarnia/i.test(u)));
  assert.ok(c.imageUrls.some(u => /Szko%C5%82a/.test(u)));
});
