// La Ballena Alegre (Sant Pere Pescador): replays the site pages and the MasterCamping answers recorded 2026-10-12
// (bungalow overview trimmed to the OTROS_ELEMENTOS data with the price paragraph only; info JSON trimmed to products,
// categories and geoPosition; availability and the 24 budgets answers verbatim). Slots are built with today pinned to
// the recording day so the sample stays (and their fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  laBallenaAlegreSantPerePescador, baBudgetsUrl, baSamples, changeoverDay, fetchBaSlots, parseBaBungalows, parseBaSeason,
  parseMcAvailability, parseMcBudgets, parseMcGeo, parseMcProducts,
} from '../../src/offers/adapters/la-ballena-alegre-sant-pere-pescador.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/la-ballena-alegre-sant-pere-pescador');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const incomplete: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: (r: string) => { incomplete.push(r); } };
const TODAY = '2026-10-12';
const info = read('rsv4.mastercamping.com_api_info_');
const avail = parseMcAvailability(read('rsv4.mastercamping.com_api_availability_'));

test('ballena: bungalow records of the overview page', () => {
  const b = parseBaBungalows(read('www.ballena-alegre.com_costabrava_en_feel-at-home_.'));
  assert.equal(b.length, 14);
  assert.deepEqual(b.map(x => [x.title, x.changeover, x.area, x.capacity, x.fromPerNight]).slice(0, 3), [
    ['E-Devesa', 'Sunday to Sunday', '77 m²', '5 + 1', 223],
    ['Mare Nostrum', 'Sunday to Sunday', '75 m²', '5 + 1', 177],
    ['Cortal Garden', 'Friday to Friday', '64 m²', '5 + 1', 183],
  ]);
  assert.equal(Math.min(...b.map(x => x.fromPerNight!)), 113);
  assert.ok(b[0].facilities.includes('Access to the beach'));
  assert.match(b[0].description ?? '', /located at the seafront and close to the kitesurfing school/);
});

test('ballena: season line and engine geo', () => {
  assert.deepEqual(parseBaSeason(read('www.ballena-alegre.com_costabrava_en_.')), { from: '2026-05-08', to: '2026-10-18', text: 'Open from May 8th to October 18th, 2026' });
  assert.deepEqual(parseMcGeo(info), { lat: 42.15222, lng: 3.11167 });
});

test('ballena: engine products and availability matrix', () => {
  const products = parseMcProducts(info);
  assert.equal(products.length, 23);
  assert.deepEqual(products.filter(p => p.year === 2027).map(p => p.unit).sort(), [
    'Bungalow Cortal', 'Bungalow Empúries', 'Bungalow Empúries SUITES', 'Bungalow Fluvià Friday', 'Bungalow Fluvià Saturday',
    'Bungalow Garbí', 'Bungalow Mare Nostrum', 'Bungalow Tamariu', 'Bungalow Tamariu Suite', 'Bungalow Xaloc (duplex)', 'Bungalow e-Devesa',
  ]);
  assert.deepEqual(avail.get(245)!.find(a => a.date === '2027-05-16')!.stays, [7, 12, 14, 21]);
  assert.equal(changeoverDay(avail.get(245)!.filter(a => a.stays.includes(7)).map(a => a.date)), 0); // Sunday
  const samples = baSamples(products, avail, TODAY);
  assert.equal(samples.length, 24);
  assert.deepEqual(samples[0], { day: 0, month: '2027-05', checkin: '2027-05-16', checkout: '2027-05-23', products: [246, 245] });
  assert.equal(baBudgetsUrl('2027-07-04', '2027-07-11'), 'https://booking.ballena-alegre.com/api/budgets?checkin=2027-07-04&checkout=2027-07-11&guestAges=18,18&lang=en&idProperty=10');
  const jul = parseMcBudgets(read('booking.ballena-alegre.com_api_budgets_checkin_2027-07-04_'));
  assert.deepEqual(jul.find(b => b.idProduct === 245), { idProduct: 245, totalPrice: 2703.48, touristTax: 18.48, available: 16 });
});

test('ballena: slots = bands per bungalow type (weekly stays, month samples)', async () => {
  const slots = await fetchBaSlots(ctx, TODAY);
  assert.deepEqual(incomplete, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 68);
  const pick = (key: string) => slots.find(s => s.key === key)!;
  const jul = pick('bungalow-e-devesa|2027-07-04');
  assert.deepEqual([jul.startDate, jul.endDate, jul.unit, jul.price, jul.currency, jul.priceUnit, jul.priceBasis, jul.packageNights, jul.availability],
    ['2027-07-04', '2027-07-31', 'Bungalow e-Devesa', 2703.48, 'EUR', 'package', 'room', 7, 'available']);
  const soldOut = pick('bungalow-cortal|2027-05-28');
  assert.deepEqual([soldOut.endDate, soldOut.price, soldOut.availability], ['2027-06-10', null, 'sold_out']);
  const limited = pick('bungalow-xaloc-duplex|2027-08-06');
  assert.deepEqual([limited.endDate, limited.price, limited.availability, limited.spotsLeft], ['2027-08-12', 2916.48, 'limited', 1]);
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 766.1);
  assert.ok(slots.every(s => s.startDate! >= '2027-05-14' && s.endDate! <= '2027-10-14' && s.minNights === 7));
});

test('ballena: content', async () => {
  const c = await laBallenaAlegreSantPerePescador.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'La Ballena Alegre');
  assert.equal(c.country, 'Spain');
  assert.equal(c.region, 'Catalonia');
  assert.deepEqual(c.spotCoords, { lat: 42.15222, lng: 3.11167 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /open from 8 May to 18 October 2026/);
  assert.match(c.summary, /ION Club Golf de Roses kite, windsurf, wingfoil and SUP center is located on the campsite/);
  assert.match(c.summary, /14 bungalow types \(48-77 m², 5 to 6 guests\)/);
  assert.match(c.summary, /from EUR 113 to 223 per night as printed on the site/);
  assert.equal(c.rooms.length, 14);
  assert.ok(c.rooms[0].features.includes('From EUR 223 per night (as printed on the site)'));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.ballena-alegre.com/costabrava/wp-content/uploads/') && !/plano/i.test(u)));
});
