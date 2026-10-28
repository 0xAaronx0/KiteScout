// Kiteskolen.no snowkite courses at Haukeliseter: replays the destination page recorded 2026-10-28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { buildKsSlots, kiteskolenSnowkiteCourseHaukeliseter, parseKsContent, parseKsPrices } from '../../src/offers/adapters/kiteskolen-snowkite-course-haukeliseter.js';
import { wpLines } from '../../src/offers/adapters/kite-republic-aitutaki-winter-escape.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteskolen-snowkite-course-haukeliseter');
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('kiteskolen.no_destinasjoner_kitekurs-haukeliseter_.'))!), 'utf8');

test('kiteskolen: three price cards', () => {
  assert.deepEqual(parseKsPrices(wpLines(html)), { '2-day': 4099, '1-day': 2599, 'intro-3h': 1499 });
});

test('kiteskolen: undated on-request slots while the 2027 calendar is announced', () => {
  const notes: string[] = [];
  const slots = buildKsSlots(wpLines(html), { note: t => notes.push(t) });
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.currency, s.startDate, s.availability]), [
    ['2-day|2027', 4099, 'NOK', null, 'on_request'],
    ['1-day|2027', 2599, 'NOK', null, 'on_request'],
    ['intro-3h|2027', 1499, 'NOK', null, 'on_request'],
  ]);
  assert.deepEqual(notes, []);
  const without = wpLines(html).filter(l => !/kalender kommer/i.test(l));
  buildKsSlots(without, { note: t => notes.push(t) });
  assert.match(notes[0], /course dates published/);
});

test('kiteskolen: content', () => {
  const c = parseKsContent(html);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'course');
  assert.match(c.summary, /2-day course \(NOK 4,099\)/);
  assert.ok(!/wetsuit|water/i.test(c.summary));
  assert.equal(c.imageUrls.length, 2);
  assert.equal(kiteskolenSnowkiteCourseHaukeliseter.operator.contactEmail, 'info@kiteskolen.no');
});
