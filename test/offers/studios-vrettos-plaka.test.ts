// Studios Vrettos (Plaka, Naxos): replays the pages recorded 2026-10-12 (content only, no room prices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { studiosVrettosPlaka, parseVrettosLessons, parseVrettosUnits } from '../../src/offers/adapters/studios-vrettos-plaka.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/studios-vrettos-plaka');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');

test('vrettos: unit types', () => {
  const units = parseVrettosUnits(read('studiosvrettos.com_accommodation_.'));
  assert.deepEqual(units.map(u => [u.name, u.maxGuests, u.floor, u.sqm]), [
    ['Garden View Studio', 2, 'ground floor', 30],
    ['Sea View Studio', 2, '1st floor', 30],
    ['Triple Studio', 3, 'ground floor', 37],
    ['Garden View Apartment', 4, 'ground floor', 60],
    ['Sea View Apartment', 5, '1st floor', 60],
  ]);
  assert.deepEqual(units[0].features, ['Queen size bed or 2 single beds', 'Private Balcony', 'Air condition', 'Mosquito net on request', 'Fully equipment kitchen', 'Breakfast included']);
});

test('vrettos: hourly lesson prices', () => {
  assert.deepEqual(parseVrettosLessons(read('studiosvrettos.com_kitesurfing_.')).map(l => [l.name, l.pricePerHour]), [
    ['Private Course', 80], ['Semi-Private Course', 40], ['Advanced Lessons', 90],
  ]);
});

test('vrettos: no slots (engine unavailable to us, no room prices on the site)', async () => {
  const notes: string[] = [];
  const slots = await studiosVrettosPlaka.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /service unavailable/);
});

test('vrettos: content', async () => {
  const c = await studiosVrettosPlaka.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Studios Vrettos');
  assert.equal(c.spot, 'Plaka, Naxos');
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /over 25 years/);
  assert.match(c.summary, /5 types of studios and apartments \(30-60 m2, for 2 to 5 guests\)/);
  assert.match(c.summary, /IKO-certified courses/);
  assert.equal(c.rooms.length, 5);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://studiosvrettos.com/wp-content/uploads/') && !/\.png$/i.test(u)));
  assert.ok(!/uses cookies/.test(c.sourceText ?? ''));
});
