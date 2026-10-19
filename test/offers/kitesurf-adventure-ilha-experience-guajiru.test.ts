// Kitesurf Adventure Ilha Experience (Ilha do Guajiru): replays /ilhaexperience recorded 2026-10-19 (2026 turmas past).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitesurfAdventureIlhaExperienceGuajiru, parseKsaIlhaContent, KSA_ILHA_TITLE } from '../../src/offers/adapters/kitesurf-adventure-ilha-experience-guajiru.js';
import { buildKsaSlots, parseKsaTrip } from '../../src/offers/adapters/kitesurf-adventure-cumbuco-classic.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitesurf-adventure-ilha-experience-guajiru');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('www.kitesurfadventure.com.br_ilhaexperience'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksa ilha: own DATAS block only, triple/double/single prices', () => {
  const t = parseKsaTrip(html, KSA_ILHA_TITLE);
  assert.equal(t.year, 2026);
  assert.deepEqual(t.turmas.map(x => [x.start, x.end]), [['2026-06-22', '2026-06-28'], ['2026-09-21', '2026-09-27']]);
  assert.deepEqual(t.prices.map(p => [p.pkg, p.room, p.price]), [
    ['velejador', 'triplo', 6734], ['velejador', 'duplo', 7574], ['velejador', 'single', 9684], ['iniciante', 'triplo', 9234], ['iniciante', 'duplo', 9990],
  ]);
});

test('ksa ilha: slots', async () => {
  const t = parseKsaTrip(html, KSA_ILHA_TITLE);
  const s = buildKsaSlots(t, '2026-07-01');
  assert.deepEqual(checkSlots(s).problems, []);
  assert.deepEqual(s.map(x => x.key), ['velejador-triplo|2026-09-21', 'velejador-duplo|2026-09-21', 'velejador-single|2026-09-21', 'iniciante-triplo|2026-09-21', 'iniciante-duplo|2026-09-21']);
  assert.equal(s[0].occupancy, 3);
  assert.deepEqual(await kitesurfAdventureIlhaExperienceGuajiru.fetchSlots(ctx), []);
});

test('ksa ilha: content', async () => {
  const c = parseKsaIlhaContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 7, 'Brazil', 'Ceará', 'Ilha do Guajiru']);
  assert.match(c.summary, /The 2027 dates are not published yet \(2026: 22 June to 28 June and 21 September to 27 September\)/);
  assert.match(c.summary, /Almofala, Espraiado, Volta do Rio and Patos/);
  assert.equal(contentProblem(await kitesurfAdventureIlhaExperienceGuajiru.fetchContent(ctx)), null);
});
