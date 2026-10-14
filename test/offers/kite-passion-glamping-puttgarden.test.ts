// Kite Passion Glamping (Puttgarden, Fehmarn): replays /unterkunft/ and /kite-kurse recorded 2026-10-14 (scripts except
// JSON-LD, styles and class attributes stripped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitePassionGlampingPuttgarden, buildKpgSlots, parseKpgPrices,
} from '../../src/offers/adapters/kite-passion-glamping-puttgarden.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-passion-glamping-puttgarden');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const stay = read('kite-passion.de_unterkunft_.');

test('kite-passion: price sentence of the glamping box', () => {
  const p = parseKpgPrices(stay)!;
  assert.deepEqual([p.high, p.low, p.secondPerson, p.minNights], [55, 49, 34, 3]);
  assert.equal(parseKpgPrices('<p>Preise auf Anfrage</p>'), null);
});

test('kite-passion: slots = season x persons, EUR per yurt per night, undated', async () => {
  const slots = await kitePassionGlampingPuttgarden.fetchSlots(ctx);
  assert.deepEqual(slots, buildKpgSlots(parseKpgPrices(stay)!));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.occupancy]), [
    ['glamping-1p|jun-sep', 55, 1], ['glamping-2p|jun-sep', 89, 2],
    ['glamping-1p|other-months', 49, 1], ['glamping-2p|other-months', 83, 2],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.minNights === 3));
});

test('kite-passion: content', async () => {
  const c = await kitePassionGlampingPuttgarden.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'Kite Passion Glamping');
  assert.equal(c.region, 'Puttgarden, Fehmarn');
  assert.deepEqual(c.spotCoords, { lat: 54.5034587, lng: 11.2165698 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /VDWS surf school on the Camping Puttgarden site/);
  assert.match(c.summary, /EUR 55 per night for one person and EUR 49 in the other months, plus EUR 34/);
  assert.match(c.sourceText ?? '', /Wir schulen von April bis Oktober auf Fehmarn/);
  assert.equal(c.rooms.length, 1);
  assert.ok(c.imageUrls[0].endsWith('/images/unterkunft/kitecamp_hero_fehmarn_kitesurfen_surfschulekitepassion_jurte.webp'));
  assert.ok(c.imageUrls.every(u => !/logo|brands|mascot|trainer/i.test(u)));
});
