// Casa Nomade (Nomade do Kite, Ilha do Guajiru, Brazil): replays the pages recorded 2026-10-12. No prices on the
// site and the booking engine is robots-disallowed -> no slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  casaNomadeIlhaDoGuajiru, parseNomadeIncludes, parseNomadeRooms,
} from '../../src/offers/adapters/casa-nomade-ilha-do-guajiru.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/casa-nomade-ilha-do-guajiru');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const casa = () => read('nomadedokite.com_casa-nomade-ilha-do-guajiru_.');

test('nomade: 4 room types, family room up to 6', () => {
  const rooms = parseNomadeRooms(casa());
  assert.deepEqual(rooms.map(r => r.name), ['Mirante', 'Jardim', 'Por do sol', 'Familiar']);
  assert.ok(rooms[3].features.includes('Up to 6 guests'));
});

test('nomade: stay inclusions', () => {
  assert.deepEqual(parseNomadeIncludes(casa()), [
    'Daily breakfast', 'Air conditioning and hot water', 'Storage space for your kite equipment',
    'Stable Wi-Fi in common areas', 'Accommodation options for couples, families, or groups', 'Organized transfers to the best kite spots',
  ]);
});

test('nomade: no slots (price on request), no request', async () => {
  const before = requestsSoFar();
  const slots = await casaNomadeIlhaDoGuajiru.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.ok(notes.some(n => /robots-disallowed/.test(n)));
});

test('nomade: content', async () => {
  const c = await casaNomadeIlhaDoGuajiru.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.country, 'Brazil');
  assert.equal(c.spot, 'Ilha do Guajiru');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /own kite and wing school/);
  assert.match(c.sourceText ?? '', /dateModified 2026-09-01/);
  assert.match(c.sourceText ?? '', /dateModified 2026-04-23/);
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => !/favicon|logo|cropped-/i.test(u)));
});
