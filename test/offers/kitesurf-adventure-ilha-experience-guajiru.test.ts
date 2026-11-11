// Kitesurf Adventure Ilha Experience (Ilha do Guajiru): replays /trips.js recorded 2026-11-11 (shared fixture of the
// Classic test). Status "27/09 a 02/10/2027 · vagas abertas", prices of the 2026 edition ("Valores 2027 sob consulta").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitesurfAdventureIlhaExperienceGuajiru, parseKsaIlhaContent } from '../../src/offers/adapters/kitesurf-adventure-ilha-experience-guajiru.js';
import { buildKsaSlots, fetchKsaSlots, ksaEditionSlots, parseKsaTripsJs } from '../../src/offers/adapters/kitesurf-adventure-cumbuco-classic.js';
import { summarizePrice } from '../../src/offers/ingest.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import type { Slot } from '../../src/offers/types.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-adventure-cumbuco-classic');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const js = readFileSync(join(DIR, files.find(f => f.startsWith('www.kitesurfadventure.com.br_trips.js'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksa ilha: the 2027 turma, BRL prices of the 2026 edition', () => {
  const t = parseKsaTripsJs(js, 'ilha')!;
  assert.deepEqual([t.year, t.priceYear], [2027, 2026]);
  assert.deepEqual(t.turmas.map(x => [x.start, x.end, x.label]), [['2027-09-27', '2027-10-02', '27/09 a 02/10/2027']]);
  assert.deepEqual(t.prices.map(p => [p.pkg, p.room, p.price]), [
    ['velejador', 'triplo', 6734], ['velejador', 'duplo', 7574], ['velejador', 'single', 9674], ['iniciante', 'triplo', 9234], ['iniciante', 'duplo', 9990],
  ]);
  assert.deepEqual([t.days, t.nights, t.noStay], [6, 5, null]);
});

test('ksa ilha: 2027 slots carry no price (on request), the 2026 prices are last published', async () => {
  const t = parseKsaTripsJs(js, 'ilha')!;
  const slots = buildKsaSlots(t, '2026-11-11');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.occupancy]), [
    ['velejador-triplo|2027-09-27', null, 3], ['velejador-duplo|2027-09-27', null, 2], ['velejador-single|2027-09-27', null, 1],
    ['iniciante-triplo|2027-09-27', null, 3], ['iniciante-duplo|2027-09-27', null, 2],
  ]);
  assert.equal(slots[0].availabilityText, '27/09 a 02/10/2027 · 2027 prices on request (2026 edition: BRL 6,734, lot 1)');
  const notes: string[] = [];
  const published: Slot[] = [];
  const got = await fetchKsaSlots('ilha', '2026-11-11', { note: x => notes.push(x), lastPublished: s => published.push(...s) });
  assert.deepEqual(got, slots);
  assert.match(notes[0], /2027 dates published, prices on request/);
  assert.deepEqual(published, ksaEditionSlots(t, 'ilha'));
  assert.deepEqual(published.map(s => s.startDate), [...Array(5).fill('2026-06-22'), ...Array(5).fill('2026-09-21')]);
  const p = summarizePrice('camp', got, '2026-11-11', published);
  assert.equal(p.note, 'From BRL 6,734 p.p. (last published price, 2026 dates are over, prices for the new dates not published yet: Rider package (Pacote Velejador), triple room, 2026-06-22; as of 2026-11-11)');
  // without a date ahead the label stays "new dates"
  assert.match(summarizePrice('camp', [], '2026-11-11', published).note, /2026 dates are over, new dates not published yet/);
});

test('ksa ilha: content', async () => {
  const c = parseKsaIlhaContent(js, '2026-11-11');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.spot, c.mealPlan], ['camp', 6, 'Ilha do Guajiru', 'breakfast']);
  assert.match(c.summary, /guided sessions at Almofala, Espraiado, Volta do Rio and Patos/);
  assert.match(c.summary, /Dates 2027: 27 September to 2 October\. Prices of the 2026 edition: BRL 6,734 to 9,990 per person .*; 2027 prices on request\./);
  assert.ok(c.optionalServices.includes('Non-riding companion: BRL 4,860'));
  assert.equal(c.imageUrls.length, 7);
  assert.equal(contentProblem(await kitesurfAdventureIlhaExperienceGuajiru.fetchContent(ctx)), null);
});
