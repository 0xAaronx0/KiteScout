import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, findPrices, parseDate, parseRange, availabilityFromText, spotsLeftFromText, daysInclusive } from '../../src/offers/parse.js';
import { parseRobots, robotsAllows } from '../../src/offers/http.js';
import { summarizePrice, isAhead } from '../../src/offers/ingest.js';
import type { Slot } from '../../src/offers/types.js';

test('parseAmount: thousands vs decimals', () => {
  assert.equal(parseAmount('1,899'), 1899);
  assert.equal(parseAmount('1.899'), 1899);
  assert.equal(parseAmount('€ 1.899,00'), 1899);
  assert.equal(parseAmount('2,195.50 USD'), 2195.5);
  assert.equal(parseAmount('R$570'), 570);
  assert.equal(parseAmount('no price'), null);
});

test('findPrices: currency on either side', () => {
  assert.deepEqual(findPrices('From €1,695 or 2.290 EUR').map(p => [p.amount, p.currency]), [[1695, 'EUR'], [2290, 'EUR']]);
  assert.deepEqual(findPrices('R$570-830').map(p => [p.amount, p.currency]), [[570, 'BRL']]);
  assert.deepEqual(findPrices('AUD 5,600').map(p => [p.amount, p.currency]), [[5600, 'AUD']]);
});

test('parseDate: common formats', () => {
  assert.equal(parseDate('26 Oct 2026'), '2026-10-26');
  assert.equal(parseDate('October 26, 2026'), '2026-10-26');
  assert.equal(parseDate('26.10.2026'), '2026-10-26');
  assert.equal(parseDate('Sept 3rd 2027'), '2027-09-03');
});

test('parseRange: ranges across months and years', () => {
  assert.deepEqual(parseRange('Oct 17-24', 2026), { start: '2026-10-17', end: '2026-10-24' });
  assert.deepEqual(parseRange('14-21 Nov 2026'), { start: '2026-11-14', end: '2026-11-21' });
  assert.deepEqual(parseRange('Oct 31-Nov 7', 2026), { start: '2026-10-31', end: '2026-11-07' });
  assert.deepEqual(parseRange('29 Dec 2026 - 20 Jan 2027'), { start: '2026-12-29', end: '2027-01-20' });
  assert.deepEqual(parseRange('28 Dec - 4 Jan', 2026), { start: '2026-12-28', end: '2027-01-04' });
  assert.deepEqual(parseRange('17.10.-24.10.2026'), { start: '2026-10-17', end: '2026-10-24' });
  assert.deepEqual(parseRange('Oct 31-07', 2026), { start: '2026-10-31', end: '2026-11-07' });
  assert.deepEqual(parseRange('Dec 28-04', 2026), { start: '2026-12-28', end: '2027-01-04' });
  assert.equal(daysInclusive('2026-11-14', '2026-11-21'), 8);
});

test('availabilityFromText', () => {
  assert.equal(availabilityFromText('Sold out'), 'sold_out');
  assert.equal(availabilityFromText('Waitlist only'), 'waitlist');
  assert.equal(availabilityFromText('1 place left'), 'limited');
  assert.equal(availabilityFromText('Spots available'), 'available');
  assert.equal(availabilityFromText('Price on request'), 'on_request');
  assert.equal(availabilityFromText('Kitesurf in Brazil'), null);
  assert.equal(availabilityFromText('Spots are limited, book early'), null);
  assert.equal(availabilityFromText('only 3 places'), 'limited');
  assert.equal(spotsLeftFromText('only 2 spots left!'), 2);
  assert.equal(spotsLeftFromText('one place left'), 1);
});

test('robots: longest match, Allow wins ties, own token beats *', () => {
  const g = parseRobots('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nDisallow: /private\n\nUser-agent: KiteScoutBot\nDisallow: /book\n');
  assert.equal(robotsAllows(g, '/camps/brazil'), true);
  assert.equal(robotsAllows(g, '/book/123'), false);
  assert.equal(robotsAllows(g, '/private/x'), true, 'own group replaces *');
  const star = parseRobots('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php');
  assert.equal(robotsAllows(star, '/wp-admin/admin-ajax.php'), true);
  assert.equal(robotsAllows(star, '/wp-admin/x'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), '/anything'), false);
});

const slot = (o: Partial<Slot>): Slot => ({
  key: 'k', startDate: null, endDate: null, unit: null, price: null, currency: null, priceUnit: null,
  priceBasis: null, occupancy: null, availability: 'available', availabilityText: null, spotsLeft: null, ...o,
});

test('summarizePrice: cheapest bookable future slot, like with like', () => {
  const s = summarizePrice('tour', [
    slot({ key: 'a', startDate: '2026-10-01', endDate: '2026-10-08', price: 900, currency: 'EUR', priceUnit: 'package', priceBasis: 'person', availability: 'sold_out' }),
    slot({ key: 'b', startDate: '2026-11-01', endDate: '2026-11-08', price: 1200, currency: 'EUR', priceUnit: 'package', priceBasis: 'person' }),
    slot({ key: 'c', startDate: '2026-12-01', endDate: '2026-12-08', price: 1100, currency: 'EUR', priceUnit: 'package', priceBasis: 'person' }),
    slot({ key: 'd', startDate: '2026-09-01', endDate: '2026-09-08', price: 500, currency: 'EUR', priceUnit: 'package', priceBasis: 'person' }),
  ], '2026-10-09');
  assert.equal(s.min?.key, 'c');
  assert.equal(s.raw, 'From EUR 1,100 p.p.');
  assert.equal(s.priceUnit, 'package');
  assert.equal(summarizePrice('camp', [], '2026-10-09').raw, 'Price on request');
});

test('summarizePrice: a stated price is never on request - full dates, then the last published price (Aaron 2026-10-29)', () => {
  const p = (o: Partial<Slot>) => slot({ currency: 'EUR', priceUnit: 'package', priceBasis: 'person', ...o });
  // only full upcoming dates (Kite Camp Brazil): the price shows, named as full
  const full = summarizePrice('tour', [
    p({ key: 'past', startDate: '2026-10-21', endDate: '2026-10-31', price: 1725, availability: 'available' }),
    p({ key: 'wait', startDate: '2026-11-06', endDate: '2026-11-16', price: 1950, availability: 'waitlist' }),
  ], '2026-10-29');
  assert.equal(full.min?.key, 'wait');
  assert.match(full.note!, /^From EUR 1,950 p\.p\. \(next dates full or waitlist only: .*2026-11-06; as of 2026-10-29\)$/);
  // all dates over: the latest year's cheapest price, from returned past slots and the adapter's lastPublished
  const past = summarizePrice('camp', [p({ key: 'r', startDate: '2026-05-01', endDate: '2026-05-31', price: 1200, datePrecision: 'month' })], '2026-10-29',
    [p({ key: 'old', startDate: '2025-06-11', price: 300 }), p({ key: 'jun', startDate: '2026-06-11', price: 540 }), p({ key: 'jul', startDate: '2026-07-08', price: 560 })]);
  assert.equal(past.min?.key, 'jun');
  assert.equal(past.raw, 'From EUR 540 p.p.');
  assert.match(past.note!, /last published price, 2026 dates are over, new dates not published yet/);
  // a bookable upcoming slot still wins, past prices never undercut it
  assert.equal(summarizePrice('camp', [p({ key: 'next', startDate: '2027-06-01', price: 900 })], '2026-10-29', [p({ key: 'cheap', startDate: '2026-06-01', price: 100 })]).min?.key, 'next');
  assert.equal(summarizePrice('camp', [], '2026-10-29', [p({ key: 'x', startDate: '2026-06-01', price: null })]).raw, 'Price on request');
});

test('summarizePrice: a running band names its end, not a start that is over (Aaron 2026-10-31)', () => {
  const p = (o: Partial<Slot>) => slot({ currency: 'EUR', priceUnit: 'per_night', priceBasis: 'room', ...o });
  const running = summarizePrice('accommodation', [p({ key: 'r', unit: 'Double Room', startDate: '2026-05-31', endDate: '2026-11-30', price: 39 })], '2026-10-30');
  assert.equal(running.note, 'From EUR 39 / night per room (cheapest bookable: Double Room, until 2026-11-30; as of 2026-10-30)');
  // a band that starts later keeps its start
  const later = summarizePrice('accommodation', [p({ key: 'l', unit: 'Cabin', startDate: '2027-03-20', endDate: '2027-03-27', price: 450 })], '2026-10-30');
  assert.match(later.note!, /cheapest bookable: Cabin, 2027-03-20; as of/);
  // a range floor without dates (Sun4Hel) names only the unit
  const range = summarizePrice('accommodation', [p({ key: 's', unit: 'Surf caravan', price: 100, currency: 'PLN', priceIsMinimum: true })], '2026-10-30');
  assert.equal(range.note, 'From PLN 100 / night per room (cheapest bookable: Surf caravan; as of 2026-10-30)');
});

test('isAhead: started departures are gone, bands last until their end', () => {
  const dep = slot({ startDate: '2026-10-03', endDate: '2026-10-10' });
  assert.equal(isAhead('tour', dep, '2026-10-09'), false);
  assert.equal(isAhead('accommodation', dep, '2026-10-09'), true);
  assert.equal(isAhead('tour', slot({ startDate: null, endDate: '2026-10-31', datePrecision: 'month' }), '2026-10-09'), true);
  assert.equal(isAhead('camp', slot({ startDate: '2026-10-09', endDate: '2026-10-16' }), '2026-10-09'), true);
  assert.equal(isAhead('tour', slot({ startDate: null, endDate: null }), '2026-10-09'), true);
});

test('runsOf: bands end where the state changes or a day is missing', async () => {
  const { runsOf } = await import('../../src/offers/parse.js');
  const days = [
    { date: '2026-12-22', p: 100 }, { date: '2026-12-23', p: 100 }, { date: '2026-12-24', p: 100 },
    { date: '2026-12-25', p: 180 }, { date: '2026-12-26', p: 180 },
    { date: '2026-12-28', p: 180 }, // gap on the 27th
  ];
  const runs = runsOf(days, d => String(d.p));
  assert.deepEqual(runs.map(r => [r.start, r.end, r.first.p]), [
    ['2026-12-22', '2026-12-24', 100], ['2026-12-25', '2026-12-26', 180], ['2026-12-28', '2026-12-28', 180],
  ]);
});
