// Kite Republic Mauritius Waves Dream 2027: replays the product page recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteRepublicMauritiusWavesDreamWinterEscape, parseKrMauritius, parseKrMauritiusSlots,
} from '../../src/offers/adapters/kite-republic-mauritius-waves-dream-winter-escape.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-republic-mauritius-waves-dream-winter-escape');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.kiterepublic.com.au'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kr mauritius: date from the page TOUR DATES block, three variations, AUD, sold bar', () => {
  const t = parseKrMauritius(html);
  assert.deepEqual(t.dates.map(d => [d.start, d.end]), [['2027-08-01', '2027-08-14']]);
  assert.equal(t.variations.length, 3);
  assert.equal(t.currency, 'AUD');
  assert.equal(t.soldPct.get(1), 10);
});

test('kr mauritius: per-person slots, twin share normalised from the 2-person price, deposit skipped', () => {
  const { ok, problems } = checkSlots(parseKrMauritiusSlots(html, '2026-10-21'));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.price, s.priceTotal ?? null, s.occupancy, s.currency, s.availability]), [
    ['2027-08-01|private-room-1-person', 6950, null, 1, 'AUD', 'available'],
    ['2027-08-01|twin-share-room-2-people', 4950, 9900, 2, 'AUD', 'available'],
  ]);
  for (const s of ok) {
    assert.equal(s.priceUnit, 'package');
    assert.equal(s.priceBasis, 'person');
    assert.equal(s.endDate, '2027-08-14');
  }
  assert.ok(!ok.some(s => s.price === 1000));
});

test('kr mauritius: past tour date is dropped', () => {
  assert.equal(parseKrMauritiusSlots(html, '2027-08-02').length, 0);
});

test('kr mauritius: content is a valid 14-day camp with Mauritius photos only', async () => {
  const c = await kiteRepublicMauritiusWavesDreamWinterEscape.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Mauritius');
  assert.equal(c.region, 'Le Morne, Black River');
  assert.equal(c.durationDays, 14);
  assert.match(c.summary, /AUD 4,950 per person in a twin share or AUD 6,950 in a private room/);
  assert.match(c.summary, /2027-08-01 to 2027-08-14/);
  assert.ok(!/[–—]/.test(c.summary + c.title));
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(!c.imageUrls.some(u => /Brazil|Aitutaki|reel|150x150/i.test(u)), c.imageUrls.join('\n'));
});

test('kr mauritius: fetchSlots replays (flags as the Aitutaki shop adapter)', async (t) => {
  // pinned wall clock: the adapter reads the real date (todayIso / new Date) and the expectations are from 2026-10-21
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T12:00:00Z') });
  const slots = await kiteRepublicMauritiusWavesDreamWinterEscape.fetchSlots(ctx);
  assert.equal(checkSlots(slots).ok.length, 2);
  assert.equal(kiteRepublicMauritiusWavesDreamWinterEscape.instantBooking, true);
  assert.equal(kiteRepublicMauritiusWavesDreamWinterEscape.liveAvailability, true);
});
