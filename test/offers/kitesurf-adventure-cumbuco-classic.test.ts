// Kitesurf Adventure Cumbuco Classic: replays /trips.js recorded 2026-11-11 (the relaunched static site; the Wix page
// text of 2026-10-19 is gone). Status "Edição 2027 · lista de prioridade" (no dates), prices of the 2026 edition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitesurfAdventureCumbucoClassic, buildKsaSlots, fetchKsaSlots, ksaEditionSlots, ksaTripBlock, parseKsaClassicContent, parseKsaTripsJs,
} from '../../src/offers/adapters/kitesurf-adventure-cumbuco-classic.js';
import { summarizePrice } from '../../src/offers/ingest.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import type { Slot } from '../../src/offers/types.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-adventure-cumbuco-classic');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const js = readFileSync(join(DIR, files.find(f => f.startsWith('www.kitesurfadventure.com.br_trips.js'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksa: trips.js is read as text, one block per trip', () => {
  assert.match(ksaTripBlock(js, 'classic') ?? '', /^\{page:"cumbuco-classic\.html"[\s\S]*\}$/);
  assert.match(ksaTripBlock(js, 'ilha') ?? '', /^\{page:"ilha-experience\.html"/);
  assert.equal(ksaTripBlock(js, 'nope'), null);
  assert.equal(parseKsaTripsJs('var TRIPS={};', 'classic'), null);
});

test('ksa classic: 2027 edition without dates, BRL prices of the 2026 edition per person', () => {
  const t = parseKsaTripsJs(js, 'classic')!;
  assert.deepEqual([t.year, t.priceYear, t.turmas], [2027, 2026, []]);
  assert.deepEqual(t.prices.map(p => [p.pkg, p.room, p.price, p.lot]), [
    ['velejador', 'duplo', 5544, 'lot 1'], ['velejador', 'single', 6544, 'lot 1'], ['iniciante', 'duplo', 8044, 'lot 1'], ['iniciante', 'single', 9044, 'lot 1'],
  ]);
  assert.deepEqual([t.days, t.nights, t.noStay], [7, 6, 3944]);
  assert.equal(t.status, '2027 edition · priority list');
  assert.match(t.priceNote, /^2026 edition prices \(1st batch\), per person\. 2027 prices on request\.$/);
  assert.equal(t.route.length, 4);
  assert.equal(t.route[3], 'Lagoas e dunas: Buggy and 4x4 trips around the area.'); // the name is PT only on the site
  assert.ok(t.included.includes('Sports insurance'));
  assert.equal(t.images.length, 8);
  assert.ok(t.images.every(u => /^https:\/\/static\.wixstatic\.com\/media\/a6f15c_[0-9a-f]{32}~mv2\.jpg$/.test(u)));
});

test('ksa classic: no slots; the 2026 prices go out as last published with the 2026 turmas', async () => {
  const t = parseKsaTripsJs(js, 'classic')!;
  assert.deepEqual(buildKsaSlots(t, '2026-11-11'), []);
  const past = ksaEditionSlots(t, 'classic');
  assert.deepEqual(checkSlots(past).problems, []);
  assert.deepEqual(past.map(s => s.key), [
    'velejador-duplo|2026-07-20', 'velejador-single|2026-07-20', 'iniciante-duplo|2026-07-20', 'iniciante-single|2026-07-20',
    'velejador-duplo|2026-08-10', 'velejador-single|2026-08-10', 'iniciante-duplo|2026-08-10', 'iniciante-single|2026-08-10',
  ]);
  const notes: string[] = [];
  const published: Slot[] = [];
  assert.deepEqual(await fetchKsaSlots('classic', '2026-11-11', { note: x => notes.push(x), lastPublished: s => published.push(...s) }), []);
  assert.match(notes[0], /^2027 dates not published yet/);
  assert.deepEqual(published, past);
  assert.equal(summarizePrice('camp', [], '2026-11-11', published).note,
    'From BRL 5,544 p.p. (last published price, 2026 dates are over, new dates not published yet: Rider package (Pacote Velejador), double room, 2026-07-20; as of 2026-11-11)');
});

test('ksa classic: a page that prints dates and prices of the same year gives priced slots', () => {
  const same = js.replace('status:T3("Edição 2027 · lista de prioridade"', 'status:T3("20/07 a 26/07/2026 · vagas abertas"');
  const t = parseKsaTripsJs(same, 'classic')!;
  const slots = buildKsaSlots(t, '2026-07-01');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.endDate]), [
    ['velejador-duplo|2026-07-20', 5544, '2026-07-26'], ['velejador-single|2026-07-20', 6544, '2026-07-26'],
    ['iniciante-duplo|2026-07-20', 8044, '2026-07-26'], ['iniciante-single|2026-07-20', 9044, '2026-07-26'],
  ]);
  assert.equal(slots[0].availabilityText, '20/07 a 26/07/2026 · price lot 1');
});

test('ksa classic: layout guards', async () => {
  await assert.rejects(fetchKsaSlots('nope', '2026-11-11'), /trip "nope" not found/);
});

test('ksa classic: content', async () => {
  const c = parseKsaClassicContent(js, '2026-11-11');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 7, 'Brazil', 'Ceará', 'Cumbuco']);
  assert.match(c.summary, /Runs every year; 2027 dates are not published yet \(2026: 20 July to 26 July and 10 August to 16 August\)/);
  assert.match(c.summary, /Prices of the 2026 edition: BRL 5,544 to 9,044 per person .*; 2027 prices on request\./);
  assert.match(c.summary, /run for 15 seasons/);
  assert.deepEqual(c.optionalServices, ['Flights', 'Gear rental', 'Advanced private lessons', 'Non-kiting companion (price on request)']);
  assert.equal(contentProblem(await kitesurfAdventureCumbucoClassic.fetchContent(ctx)), null);
});
