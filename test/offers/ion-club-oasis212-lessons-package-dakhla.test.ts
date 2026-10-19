// ION CLUB Dakhla Oasis212 packages (+ the shared ION parser): replays the page recorded 2026-10-19 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildIonPackageSlots, fetchIonPackageSlots, ionClubOasis212LessonsPackageDakhla, parseIonPackagePage, parseIonWindow,
} from '../../src/offers/adapters/ion-club-oasis212-lessons-package-dakhla.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ion-club-oasis212-lessons-package-dakhla');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ion: window and pricing tables', () => {
  assert.deepEqual(parseIonWindow('October 5th to December 21th 2026'), { start: '2026-10-05', end: '2026-12-21' });
  assert.deepEqual(parseIonWindow('December 1st to February 28th 2027'), { start: '2026-12-01', end: '2027-02-28' });
  const p = parseIonPackagePage(html);
  assert.deepEqual(p.window, { start: '2026-10-05', end: '2026-12-21' });
  assert.deepEqual([p.lessons?.price, p.lessons?.currency, p.lessons?.nights, p.lessons?.days], [830, 'EUR', 7, 8]);
  assert.equal(p.rental?.price, 780);
  assert.match(p.lessons!.basis, /price per person, double occupancy, minimum 4 night/);
});

test('ion: season-band slots until the window ends', async () => {
  const slots = await fetchIonPackageSlots('2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy, s.minNights, s.packageNights, s.availability, s.datePrecision]), [
    ['lessons|2026-10-05', 830, 2, 4, 7, 'on_request', 'season'],
    ['rental|2026-10-05', 780, 2, 4, 7, 'on_request', 'season'],
  ]);
  assert.equal(buildIonPackageSlots(parseIonPackagePage(html), '2026-12-22').length, 0);
});

test('ion: content', async () => {
  const c = await ionClubOasis212LessonsPackageDakhla.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Morocco', 'Dakhla-Oued Ed-Dahab', 'Dakhla Lagoon']);
  assert.match(c.summary, /EUR 830 per person, double occupancy/);
  assert.equal(c.imageUrls.length, 13);
  assert.ok(c.imageUrls.every(u => /\/wp-content\/uploads\/2026\//.test(u)));
});
