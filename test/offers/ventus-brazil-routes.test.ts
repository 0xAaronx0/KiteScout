// Ventus Brazil group trips: replays the Wix page fixture recorded 2026-10-09 (scripts/styles/svg stripped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ventusBrazilRoutes, parseVentusDates, parseVentusRoutes, parseVentusSlots, isVentusDateLine,
} from '../../src/offers/adapters/ventus-brazil-routes.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ventus-brazil-routes');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.ventuskitesurf.com'))!), 'utf8');
const ctx = () => { const notes: string[] = []; return { notes, note: (t: string) => notes.push(t), incomplete: (r: string) => notes.push(r) }; };

test('ventus: date lines (end day before start day rolls into the next month)', () => {
  assert.equal(isVentusDateLine('Oct 17-24 | Oct 31-07 | Nov 16-23 | Nov 28-05'), true);
  assert.equal(isVentusDateLine('August | Sept 2026'), true);
  assert.equal(isVentusDateLine('Discover pristine coastline of Brazil'), false);
  assert.deepEqual(parseVentusDates('Oct 31-07 | Nov 28-05', 2026).map(d => [d.start, d.end]), [
    ['2026-10-31', '2026-11-07'], ['2026-11-28', '2026-12-05'],
  ]);
  assert.deepEqual(parseVentusDates('Dec 28-04 2026', null).map(d => [d.start, d.end]), [['2026-12-28', '2027-01-04']]);
  assert.deepEqual(parseVentusDates('August | Sept 2026', null).map(d => [d.start, d.end, d.month]), [
    [null, '2026-08-31', '2026-08'], [null, '2026-09-30', '2026-09'],
  ]);
  assert.deepEqual(parseVentusDates('Oct 3-10', null), [], 'no year anywhere = no dates');
});

test('ventus: three route blocks with price, length and spots', () => {
  const routes = parseVentusRoutes(html);
  assert.deepEqual(routes.map(r => [r.name, r.price, r.currency, r.nights, r.days, r.departures.length]), [
    ['Brazil Essentials Route', 1550, 'USD', 7, 8, 2],
    ['Classic Route', 2195, 'USD', 7, 8, 4],
    ['Wild Wind Route', 2295, 'USD', 7, 8, 2],
  ]);
  assert.deepEqual(routes[0].spots, ['Cumbuco', 'Ilha do Guajiru']);
  assert.deepEqual(routes[1].spots, ['Paracuru', 'Taíba', 'Icaraí', 'Ilha do Guajiru', 'Guriú']);
  assert.equal(routes[2].spots[0], 'Tatajuba');
  assert.equal(routes[0].singleRoomSurchargePct, 15);
  assert.deepEqual(routes[0].notIncluded, ['Flights', 'Accommodation before or after the Kitesurf & Wing foil experience', 'Lunch or dinner', 'Personal expenses']);
});

test('ventus: slots per route departure, inquiry only', async () => {
  const c = ctx();
  const slots = await ventusBrazilRoutes.fetchSlots(c);
  assert.deepEqual(slots, parseVentusSlots(html));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 8);
  assert.deepEqual(slots.map(s => s.key), [
    'essentials|2026-10-03', 'essentials|2026-12-05',
    'classic|2026-10-17', 'classic|2026-10-31', 'classic|2026-11-16', 'classic|2026-11-28',
    'wild-wind|2026-08', 'wild-wind|2026-09',
  ]);
  const c31 = slots.find(s => s.key === 'classic|2026-10-31')!;
  assert.equal(c31.endDate, '2026-11-07');
  assert.equal(c31.price, 2195);
  assert.equal(c31.currency, 'USD');
  assert.equal(c31.unit, 'Classic Route');
  assert.ok(slots.every(s => s.availability === 'on_request'));
  assert.equal(slots.find(s => s.key === 'wild-wind|2026-08')!.startDate, null);
  assert.deepEqual(c.notes, [], 'every dated departure is 8 days long');
});

test('ventus: content', async () => {
  const c = await ventusBrazilRoutes.fetchContent(ctx());
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Brazil Kitesurf & Wing Foil Group Trips');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.durationDays, 8);
  assert.equal(c.itinerarySpots.length, 12);
  assert.equal(c.itinerarySpots.at(-1)!.region, 'Maranhão');
  assert.ok(c.includedServices.includes('Daily Breakfast'));
  assert.ok(c.optionalServices.includes('Single room: +15% on the trip price'));
  assert.equal(c.beginnerFriendly, true);
  assert.ok(c.imageUrls.length >= 12, `images ${c.imageUrls.length}`);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://static.wixstatic.com/media/')));
  assert.ok(!/Colombia trip|\$2200/.test(c.summary), 'JSON-LD (Colombia) must not leak in');
  assert.ok(!/[—–]/.test(c.summary), 'summary has no em/en dashes');
});
