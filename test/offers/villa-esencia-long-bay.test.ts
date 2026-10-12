// Villa Esencia (Long Bay Beach, Providenciales): replays the two site pages (script/style bodies trimmed) and the
// Streamline plugin answers recorded 2026-10-12 via the site's own admin-ajax proxy (unit list + 15 rate tables).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  villaEsenciaLongBay, buildVeSlots, fetchVeSlots, parseVeRates, parseVeUnits, veCoords, veIsTci, veRatesUrl, VE_LIST_URL,
} from '../../src/offers/adapters/villa-esencia-long-bay.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { fetchText } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/villa-esencia-long-bay');
process.env.OFFERS_FIXTURE_DIR = DIR;
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-12';
const post = (url: string) => fetchText(url, { method: 'POST', contentType: 'application/json' });

test('villa-esencia: proxy URLs as the plugin builds them', () => {
  assert.equal(VE_LIST_URL, 'https://www.villaesencia.com/wp-admin/admin-ajax.php?action=streamlinecore-api-request&params=%7B%22methodName%22%3A%22GetPropertyListWordPress%22%2C%22params%22%3A%7B%22page_number%22%3A1%2C%22page_results_number%22%3A50%2C%22use_description%22%3A%22no%22%2C%22use_amenities%22%3A%22no%22%7D%7D');
  assert.match(veRatesUrl(411655), /params=%7B%22methodName%22%3A%22GetPropertyRatesRawData%22%2C%22params%22%3A%7B%22unit_id%22%3A411655%7D%7D$/);
  assert.ok(readdirSync(DIR).length === 18);
});

test('villa-esencia: unit list (Turks and Caicos only) and the property pin', async () => {
  const all = parseVeUnits(await post(VE_LIST_URL));
  assert.equal(all.length, 17);
  const tci = all.filter(veIsTci);
  assert.equal(tci.length, 15);
  assert.ok(!tci.some(u => /Mountain/.test(u.name)));
  const w1 = tci.find(u => u.id === 411655)!;
  assert.deepEqual([w1.name, w1.bedrooms, w1.maxGuests, w1.view, w1.fromDaily, w1.currency], ['Wyakha 1 Garden View', 1, 3, 'Garden View', 266.51, 'USD']);
  assert.deepEqual(veCoords(tci), { lat: 21.788149, lng: -72.153679 });
});

test('villa-esencia: rate periods with real dates and minimum stay', async () => {
  const rates = parseVeRates(await post(veRatesUrl(411655)));
  assert.deepEqual(rates.map(r => [r.season, r.start, r.end, r.price, r.minNights]), [
    ['Low 2026', '2026-09-07', '2026-10-20', 266.51, 3],
    ['Mid Autumn 2026', '2026-10-21', '2026-12-15', 410.8, 3],
    ['Pre-Holiday 2026', '2026-12-16', '2026-12-23', 606.61, 3],
    ['Holiday 2026-2027', '2026-12-24', '2027-01-04', 679.88, 3],
    ['High 2027', '2027-01-05', '2027-04-30', 514.8, 3],
    ['Mid Spring 2027', '2027-05-01', '2027-09-06', 410.8, 3],
    ['Low 2027', '2027-09-07', '2027-10-20', 266.51, 3],
    ['Mid Autumn 2027', '2027-10-21', '2027-12-15', 410.8, 3],
  ]);
  const unit = parseVeUnits(await post(VE_LIST_URL)).find(u => u.id === 411655)!;
  assert.equal(buildVeSlots([{ unit, rates }], '2026-10-21').length, 7); // the period that ended 2026-10-20 is dropped
});

test('villa-esencia: slots = unit x rate period, USD per night, availability unknown', async () => {
  const slots = await fetchVeSlots(ctx, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 120);
  const s = slots.find(x => x.key === 'wyakha-1-garden-view|2027-01-05')!;
  assert.deepEqual([s.startDate, s.endDate, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.minNights],
    ['2027-01-05', '2027-04-30', 'Wyakha 1 Garden View', 514.8, 'USD', 'per_night', 'room', 'unknown', 3]);
  assert.equal(Math.min(...slots.map(x => x.price!)), 192.91);
  assert.equal(new Set(slots.map(x => x.unit)).size, 15);
});

test('villa-esencia: content', async () => {
  const c = await villaEsenciaLongBay.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Villa Esencia');
  assert.equal(c.country, 'Turks and Caicos Islands');
  assert.equal(c.spot, 'Long Bay Beach');
  assert.match(c.summary, /2\.25-acre beachfront property/);
  assert.match(c.summary, /10 suites in 4 villas/);
  assert.match(c.summary, /compressed air on the beach, two self-launch and landing posts/);
  assert.match(c.summary, /early October until end of August/);
  assert.match(c.summary, /USD 193 to USD 1155 per night/);
  assert.ok(c.includedServices.includes('Compressed air directly on the beach'));
  assert.equal(c.rooms.length, 15);
  assert.equal(c.rooms.filter(r => r.description).length, 1); // the shared Long Bay text is dropped
  assert.ok(c.imageUrls.length >= 20);
  assert.ok(c.imageUrls.every(u => /villaesencia\.com\/wp-content\/uploads\/|gallery\.streamlinevrs\.com\//.test(u) && !/logo/i.test(u)));
});
