// ION CLUB Kitesurf & Wingfoil Camp with Mathieu Pastorino (Dakhla): replays the page recorded 2026-10-19 (trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIonCampSlots, fetchIonCampSlots, ionClubPastorinoCampDakhla, parseIonCampContent, parseIonCampPage } from '../../src/offers/adapters/ion-club-pastorino-camp-dakhla.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ion-club-pastorino-camp-dakhla');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ion camp: dates, price cards, supplements', () => {
  const c = parseIonCampPage(html);
  assert.deepEqual([c.start, c.end, c.participants, c.sharing, c.singleSupplement], ['2027-04-04', '2027-04-10', '6-12', 2, 460]);
  assert.deepEqual(c.prices.map(p => [p.title, p.price, p.currency]), [['With equipment rental', 1180, 'EUR'], ['With equipment storage', 950, 'EUR']]);
});

test('ion camp: two slots before the start, none after', async () => {
  const slots = await fetchIonCampSlots('2026-10-19', ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.priceBasis, s.occupancy, s.availability]), [
    ['rental|2027-04-04', '2027-04-04', '2027-04-10', 1180, 'person', 2, 'on_request'],
    ['storage|2027-04-04', '2027-04-04', '2027-04-10', 950, 'person', 2, 'on_request'],
  ]);
  assert.deepEqual(buildIonCampSlots(parseIonCampPage(html), '2027-04-05'), []);
});

test('ion camp: content, and the summary once the edition has passed', async () => {
  const c = await ionClubPastorinoCampDakhla.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.beginnerFriendly, c.spot], ['camp', 7, false, 'Dakhla Lagoon']);
  assert.match(c.summary, /Dates: 04\.04\.-10\.04\.2027/);
  assert.equal(c.imageUrls.length, 11);
  assert.match(parseIonCampContent(html, '2027-05-01').summary, /The 2027 edition \(04\.04\.-10\.04\.2027\) has passed; the next dates are not published yet/);
});
