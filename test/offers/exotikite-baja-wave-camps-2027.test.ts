// ExotiKite Baja Wave Camps, 2027 layout: replays the camp page recorded 2026-11-01 (Bricks rebuild). The week list is
// now "Camp Weeks 2026:" under the heading "2027 Baja Wave Camp Dates Are Here" (the label's year is a typo: the
// weeks start on Saturdays in 2027, April 3 2026 was a Friday), sold-out weeks are <del> with "Sold Out" on the next
// line, and the price sits in "Included in the $2,999 Price:". Separate file: page() memoises the camp URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchExoSlots, parseExoCamps, parseExoContent } from '../../src/offers/adapters/exotikite-baja-wave-camps.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/exotikite-baja-wave-camps-2027');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('exotikite.com_baja-wave-camps'))!), 'utf8');

test('exotikite 2027 layout: season year from the heading, Sold Out marks, price', () => {
  const c = parseExoCamps(html);
  assert.equal(c.year, 2027);
  assert.deepEqual(c.weeks.map(w => [w.start, w.end, w.full]), [
    ['2027-04-03', '2027-04-10', false], ['2027-04-10', '2027-04-17', false], ['2027-04-17', '2027-04-24', false],
    ['2027-04-24', '2027-05-01', true], ['2027-05-01', '2027-05-08', true], ['2027-05-08', '2027-05-15', false],
  ]);
  assert.ok(c.weeks.every(w => new Date(w.start + 'T00:00:00Z').getUTCDay() === 6)); // Saturday arrivals
  assert.equal(c.price, 2999);
  assert.match(c.yearNote ?? '', /2026.*2027/);
});

test('exotikite 2027 layout: slots via the fetch path', async () => {
  const notes: string[] = [];
  const slots = await fetchExoSlots('2026-11-01', { note: x => notes.push(x) });
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.endDate, s.availability, s.price, s.currency, s.priceBasis]), [
    ['2027-04-03', '2027-04-10', 'on_request', 2999, 'USD', 'person'],
    ['2027-04-10', '2027-04-17', 'on_request', 2999, 'USD', 'person'],
    ['2027-04-17', '2027-04-24', 'on_request', 2999, 'USD', 'person'],
    ['2027-04-24', '2027-05-01', 'sold_out', 2999, 'USD', 'person'],
    ['2027-05-01', '2027-05-08', 'sold_out', 2999, 'USD', 'person'],
    ['2027-05-08', '2027-05-15', 'on_request', 2999, 'USD', 'person'],
  ]);
  assert.ok(notes.some(n => /labelled 2026/.test(n)));
  assert.ok(!notes.some(n => /Pricing.*not found/.test(n)));
});

test('exotikite 2027 layout: content lists the 2027 weeks', () => {
  const c = parseExoContent(html, '2026-11-01');
  assert.equal(contentProblem(c), null);
  assert.equal(c.durationDays, 8);
  assert.match(c.summary, /Weeks 2027: April 3-10, .*April 24-May 1 \(full\), May 1-8 \(full\), May 8-15\./);
  assert.match(c.summary, /Price: \$2,999 per person/);
});
