import { test } from 'node:test';
import assert from 'node:assert/strict';
import { climateSeason, pickWind, proposeRegionSeason, distanceKm, regionOverride, stormZone, stormCut, tripMonths, explicitCruiseSeason, AIR_MIN_C, WIND_MIN_PCT } from '../../src/pipeline/season-region.js';

// Live climate rows (2026-10-28) for the examples Aaron named.
const baltic = { air: [4, 6, 8, 12, 17, 21, 22, 23, 19, 14, 8, 5], wind: [null, null, null, 55, 55, 55, 50, 50, 70, 70, null, null] };
const langebaan = { air: [23, 22, 21, 20, 19, 17, 17, 16, 18, 19, 20, 21], wind: [82, 79, 79, 50, 50, 24, 21, 59, 59, 61, 79, 81] };
const kenya = { air: [32, 33, 33, 30, 29, 28, 27, 27, 28, 29, 30, 31], wind: [90, 79, 50, 30, 30, 70, 79, 79, 70, 30, 30, 61] };

test('thresholds are the ones Aaron set (air >= 14 C, >= 40 % windy days)', () => {
  assert.equal(AIR_MIN_C, 14);
  assert.equal(WIND_MIN_PCT, 40);
});

test('German Baltic: no January; South Africa: no July; Kenya: two windows', () => {
  assert.deepEqual(climateSeason(baltic.air, baltic.wind), [5, 6, 7, 8, 9, 10]);
  assert.deepEqual(climateSeason(langebaan.air, langebaan.wind), [1, 2, 3, 4, 5, 8, 9, 10, 11, 12]);
  assert.deepEqual(climateSeason(kenya.air, kenya.wind), [1, 2, 3, 6, 7, 8, 9, 12]);
});

test('a spot without temperature or without any wind value is exempt (null), a single missing month does not veto', () => {
  assert.equal(climateSeason(null, kenya.wind), null);
  assert.equal(climateSeason(kenya.air, null), null);
  assert.equal(climateSeason(kenya.air, Array(12).fill(null)), null);
  assert.deepEqual(climateSeason(Array(12).fill(25), [null, ...Array(11).fill(10)]), [1]);
});

test('wind source: country Bstoked first (ERA5-filled months = below 40 %), ERA5 region only without Bstoked', () => {
  const greece = { wind_months: [77, 69, 39, 50, 59, 70, 81, 81, 62, 61, 70, 76], wind_source_months: ['era5', 'era5', ...Array(8).fill('bstoked'), 'era5', 'era5'] };
  const sicily = { region_key: 'IT-82', country: 'Italy', lat: 37.87, lng: 12.47, wind_months: [50, 42, 49, 42, 31, 21, 28, 23, 26, 33, 40, 46], wind_source_months: Array(12).fill('era5') };
  const brSc = { region_key: 'BR-SC', country: 'Brazil', lat: -28.13, lng: -48.64, wind_months: [11, 5, 7, 7, 7, 6, 10, 21, 27, 24, 30, 20], wind_source_months: Array(12).fill('era5') };
  const italy = { wind_months: [58, 49, 65, 65, 70, 70, 70, 70, 65, 70, 70, 53], wind_source_months: ['era5', 'era5', ...Array(9).fill('bstoked'), 'era5'] };
  const countries = new Map<string, never>([['greece', greece as never], ['italy', italy as never], ['peru', { wind_months: Array(12).fill(60), wind_source_months: Array(12).fill('era5') } as never]]);
  const g = pickWind('Greece', 37.0, 25.1, [], countries);
  assert.deepEqual(g?.wind, [0, 0, 39, 50, 59, 70, 81, 81, 62, 61, 0, 0]);
  assert.deepEqual(climateSeason(Array(12).fill(20), g?.wind), [4, 5, 6, 7, 8, 9, 10], 'Greece: no winter months');
  const lo = pickWind('Italy', 37.87, 12.47, [sicily as never], countries);
  assert.equal(lo?.key, 'country Italy');
  assert.equal(lo?.alt?.key, 'region IT-82 (ERA5)', 'the region result is kept for review');
  assert.equal(pickWind('Brazil', -28.0, -48.6, [brSc as never], countries)?.key, 'region BR-SC (ERA5)', 'no Brazil country row -> region');
  assert.equal(pickWind('Peru', -5, -81, [], countries)?.key, 'country Peru (ERA5)');
  assert.ok(Math.abs(distanceKm(52.52, 13.405, 48.137, 11.575) - 504) < 5, 'Berlin-Munich ~504 km');
});

test('proposal: unknown -> page wind window (not for cruises) or climate; written page season of a stay/camp -> cut by climate', () => {
  const base = { snow: false, known: false, current: [], evidenceBasis: null, climate: [5, 6, 7, 8, 9], pageWind: null };
  assert.deepEqual(proposeRegionSeason({ ...base, type: 'accommodation' }), { months: [5, 6, 7, 8, 9], basis: 'region_inferred' });
  assert.deepEqual(proposeRegionSeason({ ...base, type: 'camp', pageWind: [6, 7, 8] }), { months: [6, 7, 8], basis: 'page_wind' });
  assert.deepEqual(proposeRegionSeason({ ...base, type: 'cruise', pageWind: [6, 7, 8] }), { months: [5, 6, 7, 8, 9], basis: 'region_inferred' });
  assert.equal(proposeRegionSeason({ ...base, type: 'tour', snow: true }), null, 'snowkite is exempt');
  assert.equal(proposeRegionSeason({ ...base, type: 'camp', climate: null }), null, 'no climate data: exempt');
  const yearRound = { ...base, known: true, current: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], evidenceBasis: 'year_round' };
  assert.deepEqual(proposeRegionSeason({ ...yearRound, type: 'accommodation' }), { months: [5, 6, 7, 8, 9], basis: 'page_region' });
  assert.equal(proposeRegionSeason({ ...yearRound, type: 'tour' }), null, 'tours keep their own season');
  assert.equal(proposeRegionSeason({ ...yearRound, type: 'accommodation', evidenceBasis: null }), null, 'only seasons season-extract wrote');
  assert.equal(proposeRegionSeason({ ...yearRound, type: 'accommodation', climate: [1] , current: [6, 7] }), null, 'never cut to nothing');
});

test('North and Baltic Sea: fixed April-October (Aaron 2026-10-28), cutting a year-round page season', () => {
  for (const c of ['Germany', 'Denmark', 'Poland', 'Netherlands', 'Belgium', 'Sweden']) assert.deepEqual(regionOverride(c)?.months, [4, 5, 6, 7, 8, 9, 10], c);
  assert.equal(regionOverride('Spain'), null);
  const fixed = regionOverride('Germany')!.months;
  assert.deepEqual(proposeRegionSeason({ type: 'accommodation', snow: false, known: true, current: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], evidenceBasis: 'year_round', climate: fixed, pageWind: null }), { months: fixed, basis: 'page_region' });
  assert.deepEqual(proposeRegionSeason({ type: 'accommodation', snow: false, known: true, current: [3, 4, 5, 6, 7, 8, 9, 10], evidenceBasis: 'range', climate: fixed, pageWind: null }), { months: fixed, basis: 'page_region' });
});

test('storm zones: Caribbean/Gulf/US east coast and Baja without Aug-Oct, West Pacific typhoons, southern cyclones Jan-Mar', () => {
  assert.equal(stormZone('Antigua and Barbuda', 17, -61.8)?.label, 'Atlantik-Hurrikan');
  assert.equal(stormZone('United States', 35.3, -75.5)?.label, 'Atlantik-Hurrikan', 'Hatteras');
  assert.equal(stormZone('United States', 42.9, -124.5), null, 'Oregon');
  assert.equal(stormZone('United States', 20.9, -156.4), null, 'Maui');
  assert.equal(stormZone('Mexico', 24.0, -109.9)?.label, 'Ostpazifik-Hurrikan', 'La Ventana');
  assert.equal(stormZone('Mexico', 21.4, -86.8)?.label, 'Atlantik-Hurrikan', 'Quintana Roo');
  assert.equal(stormZone('Japan', 24.8, 125.3)?.label, 'Taifun');
  assert.equal(stormZone('Australia', -23.9, 113.5)?.label, 'Zyklon Süd', 'Gnaraloo');
  assert.equal(stormZone('Australia', -35.1, 137.8), null, 'South Australia');
  assert.equal(stormZone('Bonaire', 12.2, -68.3), null, 'outside the hurricane belt');
});

test('storm cut keeps months an explicit offer contradicts and never empties a season', () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepEqual(stormCut(all, [8, 9, 10], new Set()), [1, 2, 3, 4, 5, 6, 7, 11, 12]);
  assert.deepEqual(stormCut(all, [8, 9, 10], new Set([8])), [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]);
  assert.deepEqual(stormCut([9, 10], [8, 9, 10], new Set()), [9, 10]);
});

test('re-run: a written climate season is recomputed, a page_region cut starts again from the page months', () => {
  const base = { type: 'accommodation' as const, snow: false, known: true, pageWind: null };
  assert.deepEqual(proposeRegionSeason({ ...base, current: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], evidenceBasis: 'region_inferred', climate: [1, 2, 3, 4, 5, 6, 7, 11, 12] }), { months: [1, 2, 3, 4, 5, 6, 7, 11, 12], basis: 'region_inferred' });
  assert.equal(proposeRegionSeason({ ...base, current: [5, 6], evidenceBasis: 'region_inferred', climate: [6, 5] }), null, 'unchanged');
  assert.deepEqual(proposeRegionSeason({ ...base, current: [1, 2, 6, 7, 8, 9, 10, 11, 12], evidenceBasis: 'page_region', climate: [1, 2, 3, 4, 5, 6, 7, 11, 12], pageMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }), { months: [1, 2, 3, 4, 5, 6, 7, 11, 12], basis: 'page_region' });
  assert.equal(proposeRegionSeason({ ...base, current: [4, 5], evidenceBasis: 'page_wind', climate: [5] }), null, 'a page wind window is never recomputed');
});

test('contradiction evidence: trips up to 45 days count, long availability windows and booking periods do not', () => {
  assert.deepEqual(tripMonths([{ start_date: '2026-08-28', end_date: '2026-09-04' }, { start_date: '2027-02-07', end_date: '2027-02-14' }]), [2, 8, 9]);
  assert.deepEqual(tripMonths([{ start_date: '2027-05-01', end_date: '2028-12-31' }]), [], 'availability window');
  assert.deepEqual(tripMonths([{ start_date: '2026-09-01', end_date: '2026-09-08', status: 'cancelled' }]), []);
  assert.deepEqual(explicitCruiseSeason('December to August (strongest winds March to July)', 12, 8), [1, 2, 3, 4, 5, 6, 7, 8, 12]);
  assert.deepEqual(explicitCruiseSeason(null, 4, 1), [], 'an extracted season without text');
  assert.deepEqual(explicitCruiseSeason('May 1 2027 – Dec 31 2028', 5, 12), [], 'a booking period over several years');
});
