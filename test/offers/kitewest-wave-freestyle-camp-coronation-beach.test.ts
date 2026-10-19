// KiteWest Wave & Freestyle Kite Camp, Coronation Beach: replays /wave-freestyle/ recorded 2026-10-19
// ("2027 Calendar dates TBA" -> no slots). The date parser is checked with a synthetic dated line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKwSlots, kitewestWaveFreestyleCampCoronationBeach, parseKwCamp,
} from '../../src/offers/adapters/kitewest-wave-freestyle-camp-coronation-beach.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitewest-wave-freestyle-camp-coronation-beach');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes('wave-freestyle'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kitewest: room prices AUD per person, 7 days / 6 nights, 2027 dates TBA', () => {
  const c = parseKwCamp(html);
  assert.deepEqual(c.rooms.map(r => [r.unit, r.price, r.occupancy]), [
    ['Shared tent 2 beds', 3295, 2], ['Private single 1 bed', 3395, 1], ['Private double bed', 3595, null],
  ]);
  assert.equal(c.currency, 'AUD');
  assert.deepEqual([c.days, c.nights], [7, 6]);
  assert.equal(c.weeks.length, 0);
  assert.match(c.datesNote!, /2027/);
});

test('kitewest: no slots today; dated lines become slots once printed', async () => {
  assert.deepEqual(await kitewestWaveFreestyleCampCoronationBeach.fetchSlots(ctx), []);
  const dated = html.replace('2027 Calendar dates TBA', '2027 Calendar dates TBA</p><p>07-13 February 2027</p><p>01-07 October 2026');
  const c = parseKwCamp(dated);
  assert.deepEqual(c.weeks.map(w => [w.start, w.end]), [['2027-02-07', '2027-02-13'], ['2026-10-01', '2026-10-07']]);
  const slots = buildKwSlots(c, '2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 3);
  assert.ok(slots.every(s => s.startDate === '2027-02-07' && s.currency === 'AUD' && s.priceBasis === 'person'));
});

test('kitewest: valid camp content, no images (robots disallows /wp-content/)', async () => {
  const c = await kitewestWaveFreestyleCampCoronationBeach.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  assert.deepEqual(c.imageUrls, []);
  assert.match(c.summary, /2027 dates are not published yet/);
  assert.match(c.summary, /AUD 3,295 in a shared tent to AUD 3,595/);
  assert.doesNotMatch(c.summary, /[–—]/);
});
