// Let's Go Kite Western Australia safari: replays the page fixture recorded 2026-10-14.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  letsgokiteWestaustralienKitesafari, parseLgkSafari, parseLgkSlots,
} from '../../src/offers/adapters/letsgokite-westaustralien-kitesafari.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/letsgokite-westaustralien-kitesafari');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.letsgokite.de'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('letsgokite: departure, price and gear rental', () => {
  const s = parseLgkSafari(html)!;
  assert.equal(s.start, '2026-12-29');
  assert.equal(s.end, '2027-01-20');
  assert.equal(s.priceOwnGear, 4900);
  assert.equal(s.rentalPerWeek, 490);
});

test('letsgokite: one on-request slot, valid', () => {
  const slots = parseLgkSlots(html);
  assert.equal(slots.length, 1);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok[0].price, 4900);
  assert.equal(ok[0].currency, 'EUR');
  assert.equal(ok[0].priceUnit, 'package');
  assert.equal(ok[0].priceBasis, 'person');
  assert.equal(ok[0].availability, 'on_request');
});

test('letsgokite: content is valid and images are Australia-only', async () => {
  const c = await letsgokiteWestaustralienKitesafari.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'tour');
  assert.equal(c.country, 'Australia');
  assert.equal(c.durationDays, 23);
  assert.ok(c.itinerarySpots.some(s => s.name === 'Geraldton'));
  // every photo once: the page ships each one in 2-4 zoom/crop variants with different hashes
  assert.equal(c.imageUrls.length, 12);
  const stems = c.imageUrls.map(u => decodeURIComponent(u.split('/').pop()!).replace(/-[0-9a-f]{8}(\.[a-z]+)$/i, '$1'));
  assert.equal(new Set(stems).size, stems.length, stems.join(', '));
  for (const u of c.imageUrls) assert.ok(u.startsWith('https://www.letsgokite.de/'), u);
  assert.ok(!c.imageUrls.some(u => /Danilo_profil|logo|favicon|Dabitz/i.test(u)));
});
