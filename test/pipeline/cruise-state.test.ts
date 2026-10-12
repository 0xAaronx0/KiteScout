import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDepartures, factsKey, fingerprint, normStatus, proposeUpdate, siteLossSignal, titleMatches,
  type ObservedState, type OfferRow,
} from '../../src/pipeline/cruise-state.js';

const TODAY = '2026-10-12';

function offer(over: Partial<OfferRow> = {}): OfferRow {
  return {
    id: 'o1', slug: 'red-sea-week', title: 'Red Sea Kite Week', source_url: 'https://example.com/red-sea',
    dates: [
      { start_date: '2026-06-06', end_date: '2026-06-13', price: 2000, currency: 'EUR', status: 'available' },
      { start_date: '2026-11-07', end_date: '2026-11-14', price: 2000, currency: 'EUR', status: 'available' },
    ],
    price_pp_cabin: 2000, price_pp_cabin_currency: 'EUR', price_charter_week: null, price_charter_week_currency: null,
    price_from_eur: 2000, currency: 'EUR', duration_days: 8, season_start_month: 6, season_end_month: 11, season_text: 'June-November',
    ...over,
  };
}
function obs(over: Partial<ObservedState> = {}): ObservedState {
  return {
    listed: true, departures: null, pricePP: null, priceCharter: null,
    durationDays: null, seasonStartMonth: null, seasonEndMonth: null, seasonText: null, ...over,
  };
}
const AUTH = { authoritative: true, today: TODAY };

test('nothing stated → no proposal (never blanks)', () => {
  assert.equal(proposeUpdate(offer(), obs(), AUTH), null);
});

test('same upcoming departures, past one dropped by the page → no proposal', () => {
  const o = obs({ departures: [{ start_date: '2026-11-07', end_date: '2026-11-14', price: 2000, currency: 'EUR', status: 'available' }] });
  assert.equal(proposeUpdate(offer(), o, AUTH), null);
});

test('new departure + sold out → dates proposal, auto-appliable', () => {
  const o = obs({
    departures: [
      { start_date: '2026-11-07', end_date: '2026-11-14', price: null, currency: null, status: 'sold_out' },
      { start_date: '2027-04-17', end_date: '2027-04-24', price: null, currency: null, status: 'available' },
    ],
  });
  const p = proposeUpdate(offer(), o, AUTH)!;
  assert.ok(p);
  assert.deepEqual(p.violations, []);
  assert.equal(p.changeType, 'dates_change');
  const deps = p.set.dates as Array<{ start_date: string; price: number | null; status: string }>;
  assert.equal(deps.length, 2);
  // a price the page leaves out is carried over, never blanked
  assert.equal(deps[0].price, 2000);
  assert.equal(deps[0].status, 'sold_out');
  assert.match(p.summary, /\+1/);
});

test('removing ALL upcoming departures needs review', () => {
  const o = obs({ departures: [{ start_date: '2026-06-06', end_date: '2026-06-13', price: null, currency: null, status: 'available' }] });
  const p = proposeUpdate(offer(), o, AUTH)!;
  assert.ok(p.violations.some(v => /alle kommenden/.test(v)));
});

test('non-authoritative page only adds, never removes', () => {
  const o = obs({ departures: [{ start_date: '2027-04-17', end_date: null, price: null, currency: null, status: 'available' }] });
  const p = proposeUpdate(offer(), o, { authoritative: false, today: TODAY })!;
  const deps = p.set.dates as Array<{ start_date: string }>;
  assert.deepEqual(deps.map(d => d.start_date), ['2026-06-06', '2026-11-07', '2027-04-17']);
  // and never touches prices
  const p2 = proposeUpdate(offer(), obs({ pricePP: { amount: 2500, currency: 'EUR' } }), { authoritative: false, today: TODAY });
  assert.equal(p2, null);
});

test('price within 40 % → auto; above → review; currency change → review', () => {
  const ok = proposeUpdate(offer(), obs({ pricePP: { amount: 2200, currency: 'EUR' } }), AUTH)!;
  assert.deepEqual(ok.violations, []);
  assert.equal(ok.set.price_pp_cabin, 2200);
  assert.equal(ok.set.price_from_eur, 2200);
  assert.equal(ok.changeType, 'price_change');

  const jump = proposeUpdate(offer(), obs({ pricePP: { amount: 3500, currency: 'EUR' } }), AUTH)!;
  assert.ok(jump.violations.some(v => /≥ 40 %/.test(v)));
  // exactly 40 % (egyptkitesurfingcruise 1000 → 1400, two prices on one page) → review
  const edge = proposeUpdate(offer({ price_pp_cabin: 1000 }), obs({ pricePP: { amount: 1400, currency: 'EUR' } }), AUTH)!;
  assert.ok(edge.violations.length > 0);

  const fx = proposeUpdate(offer(), obs({ pricePP: { amount: 2300, currency: 'USD' } }), AUTH)!;
  assert.ok(fx.violations.some(v => /Währung/.test(v)));
  assert.equal(fx.set.price_from_eur, undefined, 'no conversion into price_from_eur');
});

test('implausible price is dropped (no write, no review); unknown currency → review', () => {
  // kitesurfnmate: €140 per night read as a trip price
  const low = proposeUpdate(offer({ price_pp_cabin: null, price_pp_cabin_currency: null }), obs({ pricePP: { amount: 140, currency: 'EUR' } }), AUTH);
  assert.equal(low, null);
  const withDates = proposeUpdate(offer({ price_pp_cabin: null, price_pp_cabin_currency: null }), obs({
    pricePP: { amount: 140, currency: 'EUR' },
    departures: [{ start_date: '2027-04-17', end_date: null, price: null, currency: null, status: 'available' }],
  }), AUTH)!;
  assert.deepEqual(Object.keys(withDates.set), ['dates']);
  assert.ok(withDates.ignored.some(v => /unplausibel/.test(v)));
  const xyz = proposeUpdate(offer({ price_pp_cabin: null, price_pp_cabin_currency: null }), obs({ pricePP: { amount: 900, currency: 'XYZ' } }), AUTH)!;
  assert.ok(xyz.violations.some(v => /unbekannt/.test(v)));
});

test('charter normalized to 7 days and cross-gated against p.p.', () => {
  const p = proposeUpdate(offer(), obs({ priceCharter: { amount: 14000, currency: 'EUR', days: 14 } }), AUTH)!;
  assert.equal(p.set.price_charter_week, 7000);
  assert.deepEqual(p.violations, []);
  // a freshly read charter that contradicts p.p. is dropped, like the price backfill does
  const cheap = proposeUpdate(offer(), obs({ priceCharter: { amount: 2800, currency: 'EUR', days: 7 } }), AUTH);
  assert.equal(cheap, null);
  // egyptkitesurfingcruise: charter 875 → implausible, dropped
  assert.equal(proposeUpdate(offer(), obs({ priceCharter: { amount: 875, currency: 'EUR', days: 7 } }), AUTH), null);
});

test('season months only fill a gap (re-reads of "Spring and Autumn" flip them)', () => {
  assert.equal(proposeUpdate(offer(), obs({ seasonStartMonth: 6, seasonEndMonth: 11, seasonText: 'Jun to Nov' }), AUTH), null);
  assert.equal(proposeUpdate(offer(), obs({ seasonStartMonth: 3, seasonEndMonth: 11, seasonText: 'Every Spring and Fall' }), AUTH), null);
  const p = proposeUpdate(offer({ season_start_month: null, season_end_month: null }), obs({ seasonStartMonth: 4, seasonEndMonth: 11, seasonText: 'April-November' }), AUTH)!;
  assert.equal(p.set.season_start_month, 4);
  assert.equal(p.set.season_text, 'April-November');
});

test('duration: ±1 day is nights-vs-days noise; a gap is filled; a big jump needs review', () => {
  assert.equal(proposeUpdate(offer(), obs({ durationDays: 7 }), AUTH), null);
  assert.equal(proposeUpdate(offer({ duration_days: 7 }), obs({ durationDays: 8 }), AUTH), null);
  assert.equal(proposeUpdate(offer({ duration_days: null }), obs({ durationDays: 6 }), AUTH)!.set.duration_days, 6);
  assert.deepEqual(proposeUpdate(offer({ duration_days: 8 }), obs({ durationDays: 6 }), AUTH)!.violations, []);
  assert.ok(proposeUpdate(offer(), obs({ durationDays: 15 }), AUTH)!.violations.length > 0);
});

test('merge mode (every LLM read): never removes an upcoming departure, even on the own page', () => {
  // windseekers: dates load via JS, the read sees none of the two upcoming departures
  const o = obs({ departures: [{ start_date: '2027-03-01', end_date: null, price: null, currency: null, status: 'available' }] });
  const p = proposeUpdate(offer(), o, { authoritative: true, today: TODAY, datesMode: 'merge' })!;
  assert.deepEqual((p.set.dates as Array<{ start_date: string }>).map(d => d.start_date), ['2026-06-06', '2026-11-07', '2027-03-01']);
  assert.deepEqual(p.violations, []);
});

test('fingerprint is key-order independent', () => {
  assert.equal(fingerprint({ a: 1, b: [{ x: 1, y: 2 }] }), fingerprint({ b: [{ y: 2, x: 1 }], a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test('cleanDepartures drops invalid / far rows and dedupes', () => {
  const d = cleanDepartures([
    { start_date: '2026-11-07', end_date: '2026-11-01', status: 'Sold Out' },
    { start_date: '2026-11-07', end_date: '2026-11-01', status: 'Sold Out' },
    { start_date: '2031-01-01' },
    { start_date: 'next spring' },
  ], TODAY);
  assert.equal(d.length, 1);
  assert.equal(d[0].end_date, null);
  assert.equal(d[0].status, 'sold_out');
  assert.equal(normStatus('Warteliste'), 'waitlist');
  assert.equal(normStatus('waitlist only'), 'waitlist');
  assert.equal(normStatus('ausgebucht'), 'sold_out');
});

test('factsKey ignores testimonials/CTAs/countdowns, catches prices and dates', () => {
  const base = 'Kite cruise Greece. From €2,500 per person. Dates: 04.07.2026, 11 July 2026. Book now!';
  const noise = 'Kite cruise Greece. From €2,500 per person. Dates: 04.07.2026, 11 July 2026. Request a quote! "Best trip ever" - Anna. Noch 48 Tage.';
  assert.equal(factsKey(base), factsKey(noise));
  assert.notEqual(factsKey(base), factsKey(base.replace('€2,500', '€2,700')));
  assert.notEqual(factsKey(base), factsKey(base + ' 18 July 2026'));
  assert.notEqual(factsKey(base), factsKey(base + ' SOLD OUT'));
});

test('siteLossSignal: gambling takeover and missing trade vocabulary', () => {
  assert.match(siteLossSignal('KTPJITU: Situs Slot Online Paling Populer')!, /Übernahme/);
  assert.match(siteLossSignal('Welcome to our bakery. Fresh bread daily.')!, /kein Kite/);
  assert.equal(siteLossSignal('Kite safari on the Red Sea aboard our yacht'), null);
});

test('titleMatches tells re-titles from new products', () => {
  assert.ok(titleMatches('Kite & Family Red Sea Safari on HERMES', 'Kite & Family on HERMES - Red Sea'));
  assert.ok(!titleMatches('Los Roques 2027', 'Panama Kite Cruise San Blas'));
});
