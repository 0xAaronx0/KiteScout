// Escape Eco Adventures Fiji Kitesurfing Tour 2027: replays the Wix page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildEeSlots, eeImages, escapeEcoFijiKitesurfTourKorolevu, parseEeTour,
} from '../../src/offers/adapters/escape-eco-fiji-kitesurf-tour-korolevu.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/escape-eco-fiji-kitesurf-tour-korolevu');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('escape eco fiji: dated weeks and room prices (private = twin + surcharge)', () => {
  const t = parseEeTour(html);
  assert.equal(t.year, 2027);
  assert.deepEqual(t.weeks.map(w => [w.start, w.end]), [['2027-08-07', '2027-08-14'], ['2027-08-21', '2027-08-28']]);
  assert.deepEqual(t.rooms.map(r => [r.unit, r.price]), [['Twin share', 4250], ['Private room', 4964.5]]);
  assert.equal(t.currency, 'AUD');
  assert.equal(t.deposit, 1000);
});

test('escape eco fiji: 2 weeks x 2 rooms, on request; past weeks dropped', () => {
  const t = parseEeTour(html);
  const { ok, problems } = checkSlots(buildEeSlots(t, '2026-10-19'));
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 4);
  for (const s of ok) {
    assert.equal(s.availability, 'on_request');
    assert.equal(s.priceUnit, 'package');
    assert.equal(s.priceBasis, 'person');
  }
  assert.equal(buildEeSlots(t, '2027-08-10').length, 2);
});

test('escape eco fiji: content is a valid camp at the Beachouse pin', async () => {
  const c = await escapeEcoFijiKitesurfTourKorolevu.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 8);
  assert.deepEqual(c.spotCoords, { lat: -18.2268, lng: 177.7679 });
  assert.equal(escapeEcoFijiKitesurfTourKorolevu.instantBooking, false);
  const imgs = eeImages(html);
  assert.ok(imgs.length >= 20);
  assert.ok(imgs.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+\.jpe?g$/.test(u)), imgs.join('\n'));
});
