// Kitesurf Adventure Cumbuco Classic: replays /cumbucoclassic recorded 2026-10-19 (both 2026 turmas past -> no slots).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitesurfAdventureCumbucoClassic, buildKsaSlots, fetchKsaSlots, parseKsaClassicContent, parseKsaTrip, KSA_CLASSIC_TITLE, KSA_CLASSIC_URL } from '../../src/offers/adapters/kitesurf-adventure-cumbuco-classic.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-adventure-cumbuco-classic');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.kitesurfadventure.com.br_cumbucoclassic'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksa classic: year, turmas, BRL prices', () => {
  const t = parseKsaTrip(html, KSA_CLASSIC_TITLE);
  assert.equal(t.year, 2026);
  assert.deepEqual(t.turmas.map(x => [x.start, x.end]), [['2026-07-20', '2026-07-26'], ['2026-08-10', '2026-08-16']]);
  assert.deepEqual(t.prices.map(p => [p.pkg, p.room, p.price]), [
    ['velejador', 'duplo', 5544], ['velejador', 'single', 6544], ['iniciante', 'duplo', 8044], ['iniciante', 'single', 9044],
  ]);
  assert.deepEqual([t.days, t.nights, t.noStay], [7, 6, 3944]);
});

test('ksa classic: past turmas give no slots; earlier "today" gives turma x package x room', async () => {
  const t = parseKsaTrip(html, KSA_CLASSIC_TITLE);
  const early = buildKsaSlots(t, '2026-07-01');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.equal(early.length, 8);
  assert.deepEqual([early[0].key, early[0].price, early[0].currency, early[0].occupancy, early[0].availability], ['velejador-duplo|2026-07-20', 5544, 'BRL', 2, 'on_request']);
  const notes: string[] = [];
  assert.deepEqual(await fetchKsaSlots(KSA_CLASSIC_URL, KSA_CLASSIC_TITLE, '2026-10-19', { note: x => notes.push(x) }), []);
  assert.match(notes[0], /all 2026 turmas are past/);
});

test('ksa classic: content', async () => {
  const c = parseKsaClassicContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 7, 'Brazil', 'Ceará', 'Cumbuco']);
  assert.match(c.summary, /Runs every year; 2027 dates are not published yet \(2026: 20 July to 26 July and 10 August to 16 August\)/);
  assert.match(c.summary, /15th season in 2026/);
  assert.equal(contentProblem(await kitesurfAdventureCumbucoClassic.fetchContent(ctx)), null);
});
