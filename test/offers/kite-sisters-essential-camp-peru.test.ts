// Kite Sisters Essential Kiteboarding Camp Peru, replayed from the fixture recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import {
  buildKsPeruSlots, ksDiscounts, ksPeruAvailability, parseKsPeruContent, parseKsPeruWeeks,
} from '../../src/offers/adapters/kite-sisters-essential-camp-peru.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-sisters-essential-camp-peru');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, 'kite-sisters.com_kite-camps_mancora-northshore-peru-october_.ba1fbfe4.txt'), 'utf8');
const TODAY = '2026-10-21';

test('parseKsPeruWeeks: the visible year headings (hidden 2025 duplicate dropped)', () => {
  const w = parseKsPeruWeeks(html);
  assert.deepEqual(w.map(x => [x.start, x.end, x.status]), [
    ['2026-10-03', '2026-10-10', 'New spots have opened!'],
    ['2027-10-02', '2027-10-09', ''],
  ]);
  assert.deepEqual(ksDiscounts(w[1].notes), ['Pre-sale: book before 2027-03-02, $400 off', 'Early bird: book before 2027-06-01, $200 off']);
});

test('ksPeruAvailability: heading words first', () => {
  assert.equal(ksPeruAvailability({ start: 'x', end: 'x', status: 'SOLD OUT', notes: [] }).availability, 'sold_out');
  assert.equal(ksPeruAvailability({ start: 'x', end: 'x', status: '', notes: ['Waitlist only.'] }).availability, 'waitlist');
  assert.equal(ksPeruAvailability({ start: 'x', end: 'x', status: 'New spots have opened!', notes: ['Sign up for the waitlist ... sold-out dates.'] }).availability, 'on_request');
});

test('peru slots on 2026-10-21: the past 2026 week is dropped', () => {
  const slots = buildKsPeruSlots(parseKsPeruWeeks(html), TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.endDate, s.price, s.availability, s.availabilityText]), [
    ['women|2027-10-02', '2027-10-09', null, 'on_request', 'Pre-sale: book before 2027-03-02, $400 off; Early bird: book before 2027-06-01, $200 off'],
  ]);
  assert.equal(buildKsPeruSlots(parseKsPeruWeeks(html), '2026-09-01').length, 2);
});

test('peru content (pinned today)', () => {
  const c = parseKsPeruContent(html, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Peru');
  assert.equal(c.region, 'Piura');
  assert.equal(c.durationDays, 8);
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /women-only/);
  assert.match(c.summary, /Dates: 2027-10-02 to 2027-10-09\./);
  assert.match(parseKsPeruContent(html, '2027-11-01').summary, /next dates are not published yet/);
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.equal(c.includedServices.length, 12);
  assert.ok(c.imageUrls.length >= 20, `images: ${c.imageUrls.length}`);
  assert.ok(!(c.sourceText ?? '').includes('2025 Date'), 'hidden widget dropped');
});
