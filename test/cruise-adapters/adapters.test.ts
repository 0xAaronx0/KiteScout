import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { kiteAndIslands, statusFromText } from '../../src/cruise-adapters/adapters/kite-and-islands.js';
import { kiteSafariSeason } from '../../src/cruise-adapters/adapters/kite-safari-season.js';
import { kite2sail } from '../../src/cruise-adapters/adapters/kite2sail.js';
import { CRUISE_ADAPTERS, isAdapterUrl } from '../../src/cruise-adapters/registry.js';
import { proposeUpdate, type OfferRow } from '../../src/pipeline/cruise-state.js';

// Recorded 2026-10-12 (trimmed: no JS/CSS), replayed by src/offers/http.ts.
process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/cruise');
const TODAY = '2026-10-12';

const deps = (items: Awaited<ReturnType<typeof kiteAndIslands.fetchStates>>, url: string) =>
  items.find(i => i.sourceUrl.endsWith(url))?.state.departures?.map(d => [d.start_date, d.end_date, d.status]) ?? null;

test('kite-and-islands: departure cards with booking status, event pages, no prices', async () => {
  const items = await kiteAndIslands.fetchStates();
  assert.equal(items.length, 10);
  assert.deepEqual(deps(items, '/kite-body'), [
    ['2026-10-24', '2026-10-31', 'sold_out'], ['2027-05-15', '2027-05-22', 'sold_out'], ['2027-06-12', '2027-06-19', 'few_spots'],
  ]);
  assert.deepEqual(deps(items, '/kite-family'), [['2027-07-17', '2027-07-24', 'few_spots'], ['2028-07-15', '2028-07-22', 'available']]);
  assert.deepEqual(deps(items, '/kite-dive'), [['2028-09-30', '2028-10-07', 'available']]);
  assert.equal(deps(items, '/kite-vibe'), null);
  assert.deepEqual(deps(items, '/kite-sail-karibik-hauptsaison'), [['2026-01-03', '2026-03-28', 'closed']]);
  assert.equal(deps(items, '/kite-sail-griechenland-2027'), null, 'individual trip: no dates');
  assert.ok(items.every(i => i.state.pricePP === null), 'per-night prices are not per-trip prices');
});

test('kite-and-islands status words', () => {
  assert.equal(statusFromText('AUSGEBUCHT! 12 Tage').status, 'sold_out');
  assert.equal(statusFromText('Nur noch 4 Zimmer frei! 278 Tage').status, 'few_spots');
  assert.equal(statusFromText('50% bereits vorreserviert! 719 Tage').status, 'available');
  assert.equal(statusFromText('Anmeldung geschlossen Jetzt andere').status, 'closed');
  assert.equal(statusFromText('Woche auswählen & buchen:').status, null);
});

test('kite-safari-season: Event JSON-LD departures (merge mode) + cheapest €/person', async () => {
  const [item] = await kiteSafariSeason.fetchStates();
  assert.equal(kiteSafariSeason.datesMode, 'merge');
  assert.equal(item.state.departures?.length, 9);
  assert.equal(item.state.departures?.[0].start_date, '2027-04-17');
  assert.deepEqual(item.state.pricePP, { amount: 1400, currency: 'EUR' });
});

test('kite2sail: site-wide schedule split per destination + headline price', async () => {
  const items = await kite2sail.fetchStates();
  assert.equal(items.length, 5);
  assert.deepEqual(deps(items, '/sardinien-korsika')?.map(d => d[0]), ['2026-09-05', '2026-09-12', '2026-10-03', '2026-10-10']);
  assert.deepEqual(deps(items, '/antigua-barbuda'), [['2027-01-16', '2027-01-26', null]]);
  assert.equal(deps(items, '/bahamas'), null);
  assert.deepEqual(items.find(i => i.sourceUrl.endsWith('/griechenland'))?.state.pricePP, { amount: 2500, currency: 'EUR' });
  assert.deepEqual(items.find(i => i.sourceUrl.endsWith('/sardinien-korsika'))?.state.pricePP, { amount: 1900, currency: 'EUR' });
});

test('registry: unique keys, covered URLs are recognised', () => {
  assert.equal(new Set(CRUISE_ADAPTERS.map(a => a.key)).size, CRUISE_ADAPTERS.length);
  assert.ok(isAdapterUrl('https://kite-and-islands.ch/kite-body/'));
  assert.ok(!isAdapterUrl('https://www.kite-and-islands.ch/'));
});

test('end to end: adapter state vs the DB row of 2026-10-12 → the expected proposal', async () => {
  // DB values of kite-body-red-sea-safari-on-hermes as read on 2026-10-12.
  const row: OfferRow = {
    id: 'x', slug: 'kite-body-red-sea-safari-on-hermes', title: 'Kite & Body Red Sea Safari on HERMES',
    source_url: 'https://www.kite-and-islands.ch/kite-body',
    dates: [
      { start_date: '2026-10-24', end_date: '2026-10-31', price: null, status: 'few_spots' },
      { start_date: '2027-06-12', end_date: '2027-06-19', price: null, status: 'available' },
    ],
    price_pp_cabin: null, price_pp_cabin_currency: null, price_charter_week: null, price_charter_week_currency: null,
    price_from_eur: null, currency: 'EUR', duration_days: 7, season_start_month: null, season_end_month: null, season_text: null,
  };
  const items = await kiteAndIslands.fetchStates();
  const p = proposeUpdate(row, items.find(i => i.sourceUrl.endsWith('/kite-body'))!.state, { authoritative: true, today: TODAY })!;
  assert.ok(p);
  assert.deepEqual(p.violations, []);
  assert.deepEqual(Object.keys(p.set), ['dates']);
  assert.match(p.summary, /\+1/);
  // dive: page and DB agree → nothing to do, no queue entry
  const dive: OfferRow = { ...row, source_url: 'https://www.kite-and-islands.ch/kite-dive', dates: [
    { start_date: '2026-09-12', end_date: '2026-09-19', price: null, status: 'available' },
    { start_date: '2028-09-30', end_date: '2028-10-07', price: null, status: 'available' },
  ] };
  assert.equal(proposeUpdate(dive, items.find(i => i.sourceUrl.endsWith('/kite-dive'))!.state, { authoritative: true, today: TODAY }), null);
});

test('sickdogsurf: year-less weekly table gets the right years (handover 2026-10-12: was written as 2025)', async () => {
  const { sickdogsurf, parseSdsSchedule } = await import('../../src/cruise-adapters/adapters/sickdogsurf.js');
  const [item] = await sickdogsurf.fetchStates();
  const deps = item.state.departures!;
  assert.equal(deps.length, 33);
  assert.deepEqual([deps[0].start_date, deps[0].end_date, deps[0].status, deps[0].price], ['2026-10-17', '2026-10-24', 'available', 900]);
  assert.equal(deps[1].status, 'sold_out');
  assert.equal(deps[4].status, 'few_spots');                                         // "1050€ - Last Cabin"
  assert.deepEqual([deps[6].start_date, deps[6].end_date], ['2026-12-26', '2027-01-02']); // crosses the year
  assert.equal(deps[7].start_date, '2027-03-06');                                     // second table rolls the year
  assert.deepEqual([deps[32].start_date, deps[32].end_date], ['2027-08-28', '2027-09-04']);
  assert.deepEqual(item.state.pricePP, { amount: 900, currency: 'EUR' });
  // a heading without a season year → nothing (never guess a year)
  assert.deepEqual(parseSdsSchedule('<p>WEEKS BOAT PRICE PER PERSON October 17 - 24 Heaven Liberty 900€</p>'), []);
});

test('golden-dolphin: dive safaris in "Upcoming trips" never become kite departures', async () => {
  const { goldenDolphin, parseGdTrips } = await import('../../src/cruise-adapters/adapters/golden-dolphin.js');
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = join(import.meta.dirname, '../fixtures/cruise');
  const html = readFileSync(join(dir, readdirSync(dir).find(f => f.startsWith('www.golden-dolphin'))!), 'utf8');
  assert.equal(parseGdTrips(html).length, 3);
  const [item] = await goldenDolphin.fetchStates();
  assert.equal(item.state.departures, null, 'no kite trip scheduled → states nothing');
  assert.ok(isAdapterUrl('https://golden-dolphin.net/'), 'the LLM no longer reads this page');
});
