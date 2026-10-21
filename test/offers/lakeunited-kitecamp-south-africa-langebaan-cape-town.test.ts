// LakeUnited Kitecamp South Africa (Langebaan + Cape Town): replays the camp page recorded 2026-10-21 (scripts/styles trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchLusaSlots, lakeunitedKitecampSouthAfricaLangebaanCapeTown, parseLusaContent, parseLusaNights, parseLusaPrice, parseLusaSlots,
} from '../../src/offers/adapters/lakeunited-kitecamp-south-africa-langebaan-cape-town.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/lakeunited-kitecamp-south-africa-langebaan-cape-town');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes('kitecamp-southafrica'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('lakeunited-sa: price box and nights parse (EUR 2,570, not "€ 2")', () => {
  assert.deepEqual(parseLusaPrice('Bestseller South Africa package in a double room € 2.570,- Including overnight stay in a double room, guiding, supervision. Excluding travel'),
    { amount: 2570, currency: 'EUR', room: 'Double room', label: 'South Africa package in a double room' });
  assert.equal(parseLusaPrice('no box here'), null);
  assert.equal(parseLusaNights('13 nights accommodation in a double or single room in a two-room apartment (2 rooms share kitchen). Including').nights, 13);
});

test('lakeunited-sa: one future slot 5-19 Dec 2026, past dates dropped', async () => {
  const { slots, weeks, hiddenWeeks } = parseLusaSlots(html, '2026-10-21');
  assert.deepEqual(hiddenWeeks, []);
  assert.deepEqual(weeks.map(w => [w.start, w.end]), [['2026-12-05', '2026-12-19']]);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability]),
    [['2026-12-05', 'Double room', 2570, 'EUR', 'package', 'person', 2, 13, 'on_request']]);
  assert.deepEqual(parseLusaSlots(html, '2026-12-06').slots, []);
  const notes: string[] = [];
  assert.equal((await fetchLusaSlots('2027-01-01', { note: n => notes.push(n) })).length, 0);
  assert.match(notes[0], /past; next edition not published/);
});

test('lakeunited-sa: content is a two-stop tour', async () => {
  const c = await lakeunitedKitecampSouthAfricaLangebaanCapeTown.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.kiteLessons, c.equipmentRental], ['tour', 15, 'South Africa', 'Western Cape', 'Langebaan', false, true]);
  assert.deepEqual(c.itinerarySpots.map(s => [s.name, s.order]), [['Langebaan', 1], ['Cape Town', 2]]);
  assert.ok(c.includedServices.includes('Guiding') && c.includedServices.includes('Supervision'));
  assert.match(c.summary, /EUR 2,570 in a double room for 13 nights/);
  assert.match(c.summary, /Next camp: 5 December to 19 December 2026/);
  assert.doesNotMatch(c.summary, /[–—]/);
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => /suedafrika|kapstadt|capetown|blouberg|langebaan|shark-bay|pinguine/i.test(u) && !/-\d+x\d+\./.test(u) && !/team/i.test(u)));
  assert.equal(c.bookingUrl, 'https://www.lakeunited.com/en/portfolio/kitecamps-request/?kitecamp=sa');
  const later = parseLusaContent(html, '2027-01-01');
  assert.match(later.summary, /published camp \(2026\) is over/);
});
