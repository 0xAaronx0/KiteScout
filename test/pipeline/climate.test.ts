import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RateLimitError, fetchCellClimate, findCell, getWithLimits, monthlyMeanOfDailyMax, monthlyMeanOfDailyMean,
  openMeteoUrl, portKey, resolvePoint, round10, type OfferRef, type PortPoint,
} from '../../src/pipeline/climate.js';

const ports = new Map<string, PortPoint>([
  [portKey('Hurghada', 'Egypt'), { departure_port: 'Hurghada', country: 'Egypt', lat: 27.23, lng: 33.84, name: 'Hurghada Marina' }],
]);
const offer = (o: Partial<OfferRef>): OfferRef => ({
  offer_id: 'x', offer_table: 'cruise_offers', offer_type: 'cruise', country: null, departure_port: null, itinerary_spots: [], ...o,
});

test('cruise uses its departure port, tour its start point', () => {
  const spots = [{ name: 'Spot', lat: 27.5, lng: 33.9 }];
  assert.deepEqual(resolvePoint(offer({ country: 'Egypt', departure_port: 'Hurghada', itinerary_spots: spots }), ports),
    { basis: 'departure_port', name: 'Hurghada Marina', lat: 27.23, lng: 33.84 });
  assert.equal(resolvePoint(offer({ offer_type: 'tour', offer_table: 'package_offers', country: 'Egypt', departure_port: 'Hurghada' }), ports)?.basis, 'start_point');
});

test('unknown port falls back to the first itinerary spot and is reported', () => {
  const p = resolvePoint(offer({ country: 'Italy', departure_port: 'Nowhere', itinerary_spots: [{ name: 'A', lat: 41.2, lng: 9.3 }] }), ports);
  assert.equal(p?.basis, 'first_itinerary_spot');
  assert.equal(p?.unknownPort, 'Nowhere');
});

test('accommodation uses its location; no coordinates -> no point', () => {
  const acc = offer({ offer_type: 'accommodation', offer_table: 'package_offers', departure_port: 'Hurghada', country: 'Egypt',
    itinerary_spots: [{ name: 'Villa', lat: '37.1', lng: '-8.6' }] });
  assert.deepEqual(resolvePoint(acc, ports), { basis: 'location', name: 'Villa', lat: 37.1, lng: -8.6 });
  assert.equal(resolvePoint(offer({ offer_type: 'accommodation', itinerary_spots: [{ name: 'Villa' }] }), ports), null);
});

test('cells: round half away from zero, nearest within tolerance', () => {
  assert.equal(round10(-179.95), -1800);
  assert.equal(round10(37.05), 371);
  const cells = [{ lat10: 371, lng10: -86 }, { lat10: 372, lng10: -86 }];
  assert.deepEqual(findCell(cells, 37.13, -8.59), { lat10: 371, lng10: -86 });
  assert.equal(findCell(cells, 37.5, -8.6), null); // moved pin -> new cell needed
});

test('monthly aggregation: mean of daily max, SST needs every month', () => {
  const time: string[] = []; const v: number[] = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) for (const h of ['06', '12']) {
    time.push(`2024-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${h}:00`);
    v.push(h === '12' ? m : 0);
  }
  assert.deepEqual(monthlyMeanOfDailyMax(time, v), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(monthlyMeanOfDailyMean(time, v), [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
  assert.equal(monthlyMeanOfDailyMean(time.slice(0, 56), v.slice(0, 56)), null);
});

test('rate limits: minutely waits, hourly throws', async () => {
  let n = 0;
  const r = await getWithLimits(async () => (++n === 1 ? { error: true, reason: 'Minutely API request limit exceeded.' } : { ok: 1 }), 'u', async () => {});
  assert.deepEqual(r, { ok: 1 });
  await assert.rejects(getWithLimits(async () => ({ error: true, reason: 'Hourly API request limit exceeded.' }), 'u', async () => {}), RateLimitError);
});

test('api key switches to customer hosts', () => {
  assert.match(openMeteoUrl('marine', { latitude: 1 }, 'k'), /^https:\/\/customer-marine-api\.open-meteo\.com\/v1\/marine\?latitude=1&apikey=k$/);
  assert.match(openMeteoUrl('archive', { latitude: 1 }), /^https:\/\/archive-api\.open-meteo\.com/);
});

test('fetchCellClimate: no sea cell -> water NULL', async () => {
  const hours: string[] = []; const days: string[] = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) {
    const day = `2024-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push(day); hours.push(`${day}T12:00`);
  }
  const fetchJson = async (url: string) => {
    if (url.includes('air-quality')) return { hourly: { time: hours, uv_index: hours.map(() => 9), uv_index_clear_sky: hours.map(() => 10) } };
    if (url.includes('archive')) return { daily: { time: days, temperature_2m_max: days.map(() => 30), temperature_2m_min: days.map(() => 20) } };
    return { error: true, reason: 'No data is available for this location' };
  };
  const c = await fetchCellClimate(45.8, 10.7, { fetchJson, sleep: async () => {} });
  assert.equal(c.uv_months[6], 9);
  assert.equal(c.air_temp_min_months[0], 20);
  assert.equal(c.water_temp_months, null);
});

test('medianOfferSpot: the offer spot nearest the median of all spots', async () => {
  const { medianOfferSpot } = await import('../../src/pipeline/climate.js');
  const s = medianOfferSpot([
    { lat: -3.0, lng: -39.6, name: 'Icarai' }, { lat: -2.9, lng: -40.4, name: 'Jeri' },
    { lat: -3.7, lng: -38.7, name: 'Cumbuco' }, { lat: -28.1, lng: -48.6, name: 'Ibiraquera' },
  ]);
  assert.equal(s.name, 'Icarai');
});

test('combineWind: Bstoked where real, ERA5 only in months with water >= 10 C, else null', async () => {
  const { combineWind } = await import('../../src/pipeline/climate.js');
  const water = [4, 3, 4, 7, 11, 16, 18, 19, 17, 13, 10, 5];
  const r = combineWind([10, 10, 10, 55, 55, 55, 50, 50, 70, 70, 10, 10], [80, 74, 66, 57, 60, 54, 62, 54, 65, 81, 76, 79], water);
  assert.deepEqual(r.wind_months, [null, null, null, 55, 55, 55, 50, 50, 70, 70, 76, null]);
  assert.deepEqual(r.wind_source_months.slice(9, 12), ['bstoked', 'era5', null]);
  assert.deepEqual(combineWind(null, Array(12).fill(40), null).wind_months, Array(12).fill(null)); // lake: no fill
  assert.deepEqual(combineWind(null, Array(12).fill(40), Array(12).fill(15)).wind_source_months, Array(12).fill('era5'));
});
