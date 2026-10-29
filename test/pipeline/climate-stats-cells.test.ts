// Offer points prefer Copernicus cells when a token is set (Aaron 2026-10-29, "klima 1")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsCellFetch, offerCell } from '../../src/pipeline/climate-stats.js';

const cell = (lat10: number, lng10: number, sources: string) => ({
  lat10, lng10, sources, sample_lat: lat10 / 10, sample_lng: lng10 / 10, elevation_m: 0,
  uv_months: Array(12).fill(5), uv_clear_sky_months: Array(12).fill(5), air_temp_max_months: Array(12).fill(25),
  air_temp_min_months: Array(12).fill(18), water_temp_months: Array(12).fill(24),
});
const openMeteo = cell(-231, 436, 'UV: CAMS global via Open-Meteo Air Quality API 2023-2025; air temp: ERA5 via Open-Meteo Historical API 2016-2025; water temp: Open-Meteo Marine API SST 2023-2025');
const copernicus = cell(-231, 436, 'Copernicus (CC-BY 4.0): air temp + SST: ERA5 hourly point time series');

test('an offer point with only an Open-Meteo cell is fetched when a Copernicus token is set', () => {
  assert.equal(needsCellFetch([openMeteo], -23.1, 43.6, true), true);
  assert.equal(needsCellFetch([copernicus], -23.1, 43.6, true), false);
});

test('without a token the existing behaviour stays: any cached cell is enough', () => {
  assert.equal(needsCellFetch([openMeteo], -23.1, 43.6, false), false);
  assert.equal(offerCell([openMeteo], -23.1, 43.6, false), openMeteo);
  assert.equal(needsCellFetch([], -23.1, 43.6, false), true);
});

test('the offer row takes the Copernicus cell, and keeps the old one when that fetch failed', () => {
  // a neighbouring Copernicus cell inside the tolerance wins over a closer Open-Meteo cell
  const nearOld = cell(-231, 436, openMeteo.sources), nearNew = cell(-230, 436, copernicus.sources);
  assert.equal(offerCell([nearOld, nearNew], -23.07, 43.6, true), nearNew); // old 0.03°, new 0.07° (tolerance 0.075°)
  assert.equal(offerCell([nearOld, nearNew], -23.07, 43.6, false), nearOld); // without a token the nearest cell
  // fetch failed: no Copernicus cell, the old row stays instead of the offer being deferred
  assert.equal(offerCell([openMeteo], -23.1, 43.6, true), openMeteo);
  assert.equal(offerCell([], -23.1, 43.6, true), null);
});
