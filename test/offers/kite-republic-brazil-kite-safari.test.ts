// Kite Republic Brazil Kite Safari 2027: replays the product page recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseKrTour } from '../../src/offers/adapters/kite-republic-aitutaki-winter-escape.js';
import {
  kiteRepublicBrazilKiteSafari, parseKrBrazilRoute, parseKrBrazilSlots,
} from '../../src/offers/adapters/kite-republic-brazil-kite-safari.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-republic-brazil-kite-safari');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.kiterepublic.com.au'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kite republic brazil: departure from the description, route line', () => {
  const t = parseKrTour(html);
  assert.deepEqual(t.dates.map(d => [d.start, d.end]), [['2027-08-22', '2027-09-04']]);
  assert.equal(t.soldPct.get(1), 40);
  assert.deepEqual(parseKrBrazilRoute(t), ['Ilha do Guajiru', 'Tatajuba', 'Arpoador', 'Macapá', 'Preá']);
});

test('kite republic brazil: twin share and private room at the early-bird variation prices', () => {
  const slots = parseKrBrazilSlots(html, '2026-10-19');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.unit, s.price, s.currency, s.availability, s.occupancy]), [
    ['Twin share', 4950, 'AUD', 'available', 2],
    ['Private room', 6150, 'AUD', 'available', 1],
  ]);
  // "Cost $5600" in the description = the twin-share regular price
  assert.match(ok[0].availabilityText!, /regular AUD 5,600/);
  assert.equal(parseKrBrazilSlots(html, '2027-08-23').length, 0);
});

test('kite republic brazil: content is a valid tour with the route as map stops', async () => {
  const c = await kiteRepublicBrazilKiteSafari.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.durationDays, 14);
  assert.deepEqual(c.itinerarySpots.map(s => [s.name, s.region]), [
    ['Fortaleza', 'Ceará'], ['Ilha do Guajiru', 'Ceará'], ['Tatajuba', 'Ceará'],
    ['Arpoador', 'Maranhão'], ['Praia de Macapá', 'Piauí'], ['Preá', 'Ceará'],
  ]);
  assert.ok(!/[–—]/.test(c.summary + c.title));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(!c.imageUrls.some(u => /Aitutaki|Mauritius|\.webp$/i.test(u)), c.imageUrls.join('\n'));
});
