// The Rider Experience Los Roques 2027: replays the trip page recorded 2026-10-12 (prices are PDF constants).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  theriderexperienceLosRoques, parseTreSlots, parseTreTrip,
} from '../../src/offers/adapters/theriderexperience-los-roques.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/theriderexperience-los-roques');
process.env.OFFERS_FIXTURE_DIR = DIR;
const page = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = () => { const notes: string[] = []; return { notes, note: (t: string) => notes.push(t), incomplete: (r: string) => notes.push(r) }; };

test('los roques: dates, booking deadline, PDF link from the page', () => {
  assert.deepEqual(parseTreTrip(page), { start: '2027-04-02', end: '2027-04-10', deadline: '2026-10-30', limited: true, pdf: true });
});

test('los roques: two rooms, limited until the deadline, closed after it', async () => {
  const c = ctx();
  const slots = await theriderexperienceLosRoques.fetchSlots(c);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.unit, s.price, s.currency, s.startDate, s.endDate, s.occupancy]), [
    ['Shared room', 3240, 'USD', '2027-04-02', '2027-04-10', 2],
    ['Private room', 4090, 'USD', '2027-04-02', '2027-04-10', 1],
  ]);
  assert.ok(c.notes.some(n => /info PDF/.test(n)));
  assert.ok(parseTreSlots(page, '2026-10-12').every(s => s.availability === 'limited'));
  assert.ok(parseTreSlots(page, '2026-10-31').every(s => s.availability === 'closed'));
  // without the PDF link the hand-read prices are not released
  assert.deepEqual(parseTreSlots(page.replaceAll('/s/Los-Roques-2-10-April-Info.pdf', '/s/other.pdf')), []);
});

test('los roques: content', async () => {
  const c = await theriderexperienceLosRoques.fetchContent(ctx());
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.country, 'Venezuela');
  assert.equal(c.durationDays, 9);
  assert.equal(c.mealPlan, 'full_board');
  assert.ok(c.imageUrls.length >= 1);
  assert.match(c.summary, /2 April 2027 to 10 April 2027/);
  assert.ok(!/[—–]/.test(c.summary + c.title), 'no em/en dashes');
});
