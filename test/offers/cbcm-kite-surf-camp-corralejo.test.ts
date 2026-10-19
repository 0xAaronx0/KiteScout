// CBCM Kitesurf & Surf Training Camp (Corralejo): replays the camp post recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cbcmKiteSurfCampCorralejo, buildCbcmSlots, cbcmRowIsRoomTotal, parseCbcmBlocks,
} from '../../src/offers/adapters/cbcm-kite-surf-camp-corralejo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/cbcm-kite-surf-camp-corralejo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('cbcmfuerteventura.com_2026_02_19_kitesurf-surf-camps_');

test('cbcm: three houses with their price lines', () => {
  const b = parseCbcmBlocks(html);
  assert.deepEqual(b.map(x => [x.house, x.rows.length]), [['Surf Hostal', 4], ['Apartment', 1], ['CBCM Rider Palace (sea view)', 6]]);
  assert.deepEqual(b[0].rows[0], { room: 'Double room shared Bathroom', prices: [{ persons: 1, amount: 890 }, { persons: 2, amount: 1430 }] });
  assert.equal(b[2].rows[0].room, 'Villa');
  assert.deepEqual(b[2].rows[5].prices.map(p => [p.persons, p.amount]), [[2, 1080], [3, 894], [4, 975], [5, 884]]);
  assert.equal(cbcmRowIsRoomTotal(b[0].rows[0]), true);
  assert.equal(cbcmRowIsRoomTotal(b[1].rows[0]), false);
});

test('cbcm: undated package slots, room total vs per person', async () => {
  const slots = await cbcmKiteSurfCampCorralejo.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 22);
  const s890 = slots.find(s => s.key === 'surf-hostal|double-room-shared-bathroom|1p')!;
  assert.deepEqual([s890.price, s890.currency, s890.priceUnit, s890.priceBasis, s890.occupancy, s890.packageNights, s890.availability, s890.startDate],
    [890, 'EUR', 'package', 'person', 1, 7, 'on_request', null]);
  const s1430 = slots.find(s => s.key === 'surf-hostal|double-room-shared-bathroom|2p')!;
  assert.deepEqual([s1430.price, s1430.priceBasis, s1430.occupancy], [1430, 'room', 2]);
  const apt = slots.find(s => s.key === 'apartment|unit|2p')!;
  assert.deepEqual([apt.price, apt.priceBasis], [770, 'person']);
  assert.deepEqual(buildCbcmSlots([]), []);
});

test('cbcm: content', async () => {
  const c = await cbcmKiteSurfCampCorralejo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Spain', 'Canary Islands', 'Corralejo, Fuerteventura']);
  assert.match(c.summary, /Prices start at EUR 770 per person for the week; the camp can be bought online as a voucher valid for one year/);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(!c.imageUrls.some(u => /logo|book-now|mapa/.test(u)));
});
