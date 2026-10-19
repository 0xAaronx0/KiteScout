// Freeride Kitesurf Wild North downwind: replays the English route page + the downwind dates page recorded 2026-10-19
// (scripts / styles trimmed, contact-form nonce redacted). Three of the four 2026 departures were past on that day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREERIDE_WILD_NORTH_URL, buildFreerideSlots, fetchFreerideSlots, freerideDatesSentence, freerideKitesurfDownwindWildNorth,
  parseFreerideDates, parseFreerideRoute,
} from '../../src/offers/adapters/freeride-kitesurf-downwind-wild-north.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/freeride-kitesurf-downwind-wild-north');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const datesHtml = readFileSync(join(DIR, files.find(f => f.includes('downwind-brazil_.'))!), 'utf8');
const routeHtml = readFileSync(join(DIR, files.find(f => f.includes('wild-north'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('freeride: dates list (grid layout skipped), every route of 2026', () => {
  const d = parseFreerideDates(datesHtml);
  assert.equal(d.length, 12);
  assert.deepEqual(d.filter(x => /wild north/i.test(x.route)).map(x => [x.start, x.end]), [
    ['2026-08-01', '2026-08-13'], ['2026-09-02', '2026-09-14'], ['2026-10-01', '2026-10-13'], ['2026-11-05', '2026-11-17'],
  ]);
  assert.deepEqual(d.filter(x => /rio grande do norte/i.test(x.route)).map(x => [x.start, x.end, x.stretch]),
    [['2026-11-11', '2026-11-21', 'S. M. do Gostoso to Icapuí - 260km']]);
});

test('freeride: route page price, nights, program, lists', () => {
  const r = parseFreerideRoute(routeHtml, FREERIDE_WILD_NORTH_URL);
  assert.deepEqual([r.nights, r.days, r.price, r.singleSurchargePct, r.minPeople, r.maxPeople], [12, 13, 2295, 20, 3, 12]);
  assert.equal(r.program.length, 13);
  assert.ok(r.included.includes('Buffet breakfast'));
  assert.deepEqual(r.excluded[0], 'Flights');
  assert.ok(r.images.length >= 10 && !r.images.some(u => /150x150|logo|wordmark/i.test(u)));
});

test('freeride wild north: only future departures become slots', async () => {
  const notes: string[] = [];
  const slots = await fetchFreerideSlots(FREERIDE_WILD_NORTH_URL, /wild north/i, '2026-10-19', { note: n => notes.push(n) });
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability]),
    [['2026-11-05', '2026-11-17', 2295, 'EUR', 'package', 'person', 'on_request']]);
  assert.match(notes[0], /3 past departure/);
  const deps = parseFreerideDates(datesHtml).filter(d => /wild north/i.test(d.route));
  const r = parseFreerideRoute(routeHtml, FREERIDE_WILD_NORTH_URL);
  assert.deepEqual(buildFreerideSlots(deps, r, '2026-12-01'), []);
  assert.equal(freerideDatesSentence(deps, '2026-12-01'), 'Runs every year; 2027 dates not yet published (2026: August, September, October, November).');
});

test('freeride wild north: content', async () => {
  const c = await freerideKitesurfDownwindWildNorth.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['tour', 13, 'Brazil', 'Ceará', 'Cumbuco']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), [
    'Cumbuco', 'Tatajuba', 'Praia de Maceió', 'Barra Grande', 'Macapá', 'Pedra do Sal', 'Ilha do Caju', 'Arpoador', 'Atins', 'Canto do Atins',
  ]);
  assert.match(c.summary, /Estimated price EUR 2,295 per person/);
});
