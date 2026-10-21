// Kiteboarding Colombia "Kite Trip Wild North", replayed from the fixture recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import {
  buildKbcSlots, kbcLines, parseKbcContent, parseKbcDepartures, parseKbcLengths,
} from '../../src/offers/adapters/kiteboarding-colombia-wild-north-kite-trip.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteboarding-colombia-wild-north-kite-trip');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, 'www.kiteboardingcolombia.com_kite-trip-cabo-de-la-vela-punta-gallinas_.fa0088c3.txt'), 'utf8');
const TODAY = '2026-10-21';

test('parseKbcDepartures: page style and tolerant variants', () => {
  assert.deepEqual(parseKbcDepartures(kbcLines(html).join(' ')).map(d => [d.start, d.end]), [['2026-07-16', '2026-07-20']]);
  assert.deepEqual(parseKbcDepartures('JULY 16 – 20 / 2026 · July 30 - August 3, 2027 · 12 - 16 marzo 2027').map(d => [d.start, d.end]), [
    ['2026-07-16', '2026-07-20'], ['2027-07-30', '2027-08-03'], ['2027-03-12', '2027-03-16'],
  ]);
});

test('parseKbcLengths: the lengths sold', () => {
  assert.deepEqual(parseKbcLengths(kbcLines(html).join(' ')), [{ days: 7, nights: 6 }, { days: 5, nights: 4 }, { days: 4, nights: 3 }]);
});

test('colombia slots: past-only page -> no slots; a future date -> price-on-request slot', () => {
  const deps = parseKbcDepartures(kbcLines(html).join(' '));
  assert.deepEqual(buildKbcSlots(deps, TODAY), []);
  const future = buildKbcSlots([{ start: '2027-03-12', end: '2027-03-16', raw: '' }], TODAY);
  const { ok, problems } = checkSlots(future);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.availability]), [['2027-03-12', '5 days / 4 nights', null, 'on_request']]);
});

test('colombia content (pinned today)', () => {
  const c = parseKbcContent(html, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.durationDays, 7);
  assert.equal(c.region, 'La Guajira');
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Mayapo', 'Cabo de la Vela', 'Punta Gallinas', 'Dunas de Taroa', 'La Boquita']);
  assert.ok(c.itinerarySpots.every((s, i) => s.order === i + 1 && s.country === 'Colombia' && s.region === 'La Guajira'));
  assert.match(c.summary, /next dates are not published yet \(last printed: 16-20 July 2026\)/);
  assert.match(c.summary, /No price is printed/);
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.equal(c.includedServices.length, 7);
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => u.startsWith('https://www.kiteboardingcolombia.com/')));
});
