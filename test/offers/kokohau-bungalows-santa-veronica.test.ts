// Kokohau Bungalows (KiteSurf Experience Colombia): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kokohauBungalowsSantaVeronica, kseStayPackages, parseKseBungalows, parseKsePackages,
} from '../../src/offers/adapters/kokohau-bungalows-santa-veronica.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kokohau-bungalows-santa-veronica');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const home = read('kitesurfexperience.co_.');

test('kokohau: package cards incl. amounts with typographic apostrophes', () => {
  const cards = parseKsePackages(home);
  assert.equal(cards.length, 12);
  assert.deepEqual(cards.slice(0, 4).map(c => [c.price, c.currency]), [[2850000, 'COP'], [3250000, 'COP'], [2500000, 'COP'], [5800000, 'COP']]);
  assert.ok(cards.some(c => c.price === 880 && c.currency === 'USD'));
});

test('kokohau: bungalow rates per night', () => {
  assert.deepEqual(parseKseBungalows(home).map(r => [r.name, r.guests, r.guestsText, r.price, r.currency]), [
    ['Private bungalow', 2, '2 people', 450000, 'COP'],
    ['Group bungalow', 5, '4-5 people', 700000, 'COP'],
    ['Private bungalow', 1, '1 person', 250000, 'COP'],
  ]);
});

test('kokohau: lesson + stay packages (incl. the 2027 pre-season promo) go to the content', () => {
  const p = kseStayPackages(home);
  assert.equal(p.length, 5);
  // Spanish cards rebuilt in English (audit 2026-10-27)
  assert.equal(p[0], 'Pre-season promo January to April 2027: 10 h private IKO kite lessons with insurance + 4 nights / 5 days in a private bungalow (book by 30 October) - COP 2,850,000');
  assert.equal(p[1], 'Promo: 12 h private IKO kite lessons with insurance + 5 nights / 6 days in a private bungalow, breakfast included - COP 3,250,000 per person');
  assert.ok(p.every(x => !/\b(?:clases?|noches|dias|persona|privado)\b/i.test(x)), p.join(' | '));
});

test('kokohau: slots = bungalow x guests, COP per night, no dates', async () => {
  const slots = await kokohauBungalowsSantaVeronica.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.occupancy]), [
    ['private-bungalow-2p', 'Private bungalow (2 people)', 450000, 2],
    ['group-bungalow-5p', 'Group bungalow (4-5 people)', 700000, 5],
    ['private-bungalow-1p', 'Private bungalow (1 person)', 250000, 1],
  ]);
  assert.ok(slots.every(s => s.currency === 'COP' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('kokohau: content', async () => {
  const c = await kokohauBungalowsSantaVeronica.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kokohau Bungalows');
  assert.equal(c.country, 'Colombia');
  assert.equal(c.spot, 'Santa Verónica');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /IKO-certified kite school at Salinas del Rey/);
  assert.match(c.summary, /December to May with mostly 15-25 knot NE wind/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Private bungalow', 'Group bungalow']);
  assert.ok(c.rooms[0].features.includes('2 people: COP 450,000 per night'));
  assert.match(c.sourceText ?? '', /season: 2027 December to May/);
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://kitesurfexperience.co/wp-content/uploads/') && !/instagram|\.png$/i.test(u)));
});
