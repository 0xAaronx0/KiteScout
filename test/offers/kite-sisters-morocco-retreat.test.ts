// Kite Sisters Boutique Morocco Kitesurf Retreat: replays the retreat page recorded 2026-10-19 (2027 editions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kiteSistersMoroccoRetreat, fetchKsmSlots, parseKsmEditions, editionStatus, parseKsmContent } from '../../src/offers/adapters/kite-sisters-morocco-retreat.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/kite-sisters-morocco-retreat');
const ctx = { note: () => {}, incomplete: () => {} };

test('ksm: two 2027 editions, women-only limited (2 last spots), co-ed open', async () => {
  const slots = await fetchKsmSlots('2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.endDate, s.availability, s.spotsLeft, s.availabilityText, s.price]), [
    ['women|2027-05-13', '2027-05-23', 'limited', 2, '2 last spots', null],
    ['co-ed|2027-05-27', '2027-06-06', 'on_request', null, 'Reservations open', null],
  ]);
  // after the women's edition has started only the co-ed one is left; after both: none
  assert.deepEqual((await fetchKsmSlots('2027-05-20')).map(s => s.key), ['co-ed|2027-05-27']);
  const notes: string[] = [];
  assert.deepEqual(await fetchKsmSlots('2027-06-01', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /all listed editions are past/);
});

test('ksm: edition line parser and status words', () => {
  const html = '<div data-elementor-type="wp-post"><h4>2028 Dates: Reservations open</h4><ul><li>Women Only Retreat: May 11th to 21st 2028. SOLD OUT</li><li>Pre-sale: book before October 1st</li></ul></div>';
  const e = parseKsmEditions(html);
  assert.deepEqual(e.map(x => [x.unit, x.start, x.end, x.availability]), [['women', '2028-05-11', '2028-05-21', 'sold_out']]);
  assert.deepEqual(editionStatus('Last 3 spots!', null), { availability: 'limited', text: 'Last 3 spots', spotsLeft: 3 });
});

test('ksm: content (tour with three stops)', async () => {
  const c = await kiteSistersMoroccoRetreat.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.spot], ['tour', 11, 'Morocco', 'Marrakech']);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Marrakech', 'Essaouira', 'Dakhla']);
  assert.ok(c.includedServices.includes('6 Nights at an Exclusive Ecolodge in Dakhla'));
  assert.ok(c.imageUrls.length >= 10);
  const dir = process.env.OFFERS_FIXTURE_DIR!;
  const html = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
  assert.match(parseKsmContent(html, '2026-10-19').summary,
    /Editions: women only 13 May 2027 to 23 May 2027 \(2 spots left\); couples \/ co-ed 27 May 2027 to 6 June 2027\. Prices on request; early bird EUR 250 off when booked before December 15 2026/);
  assert.match(parseKsmContent(html, '2027-07-01').summary, /the next dates are not published yet/);
});
