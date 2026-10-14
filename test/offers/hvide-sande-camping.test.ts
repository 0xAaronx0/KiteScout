// Hvide Sande Camping: replays the site pages and the Compusoft answers recorded 2026-10-12 (pages without
// scripts / styles / srcsets; profile lists trimmed to id, title, units; price answers trimmed to the rate fields).
// Slots are built with today pinned to the recording day so the sample weeks (and their fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hvideSandeCamping, HSC_PORTAL, csobListUrl, csobPriceUrl, csobSaturdaySamples, csobSlots, fetchHscSlots, parseCsobList,
  parseCsobPrices, parseHscCabinPrices, parseHscCabins, parseHscSeasons,
} from '../../src/offers/adapters/hvide-sande-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/hvide-sande-camping');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const incomplete: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: (r: string) => { incomplete.push(r); } };
const TODAY = '2026-10-12';
const prices = read('hvidesandecamping.dk_priser_.');

test('hsc: seasons and printed cabin prices of /priser/', () => {
  const seasons = parseHscSeasons(prices);
  assert.deepEqual(seasons, [
    { year: 2026, start: '2026-03-28', end: '2026-10-31' },
    { year: 2027, start: '2027-03-13', end: '2027-10-31' },
  ]);
  const t = parseHscCabinPrices(prices);
  assert.equal(t.length, 22);
  assert.deepEqual(t.find(r => r.year === 2026 && r.type === 11), { year: 2026, name: 'Strandhytte', type: 11, low: 999, high: 1190, cleaning: 700 });
  assert.deepEqual(t.find(r => r.year === 2027 && r.type === 3), { year: 2027, name: 'Surferhytter', type: 3, low: 500, high: 600, cleaning: 350 });
});

test('hsc: cabin cards of the English overview', () => {
  const c = parseHscCabins(read('hvidesandecamping.dk_cabins-and-holiday-apartments_lang_en.'));
  assert.equal(c.length, 11);
  assert.deepEqual(c.map(x => x.danish), ['Troldehytten', 'Surferhytten', 'Fjordhytten', 'Klithytten', 'Fiskerhytten', 'Hvide Sande Hytten',
    'Vesterhavshytten', 'Strandhytten', 'Hytte 4', 'Havnehytten', null]);
  assert.deepEqual(c[1].features, ['2 people', 'Dog allowed', 'Free WiFi', 'Sportshytten']);
  assert.equal(c[7].image, 'https://hvidesandecamping.dk/wp-content/uploads/2026/05/strandhytten_ny.jpg');
});

test('hsc: Compusoft sample weeks, urls and answers', () => {
  const weeks = csobSaturdaySamples(TODAY, parseHscSeasons(prices), { max: 9 });
  assert.deepEqual(weeks, ['2026-10-17', '2027-03-13', '2027-04-03', '2027-05-01', '2027-06-05', '2027-07-03', '2027-08-07', '2027-09-04', '2027-10-02']);
  // season limits: no stay leaves the season (31.10.2026 close, 13.03.2027 opening)
  assert.deepEqual(csobSaturdaySamples('2026-10-25', [{ start: '2026-03-28', end: '2026-10-31' }]), []);
  assert.match(csobListUrl(HSC_PORTAL, '2027-06-05', 7), /getCSProfileListViewModel\?portalKey=e1a8e897-51ff-42e9-8086-d0cccc0fd8ae&languageShortName=en&.*fromDateStr=20270605-000000&toDateStr=20270612-000000/);
  const list = parseCsobList(readFileSync(join(DIR, files.find(f => f.startsWith('v3.onlinebooking.dk_profile_getCSProfileListViewModel'))!), 'utf8'));
  assert.equal(list.length, 12);
  assert.deepEqual(list.filter(p => !HSC_PORTAL.isUnit(p)).map(p => p.title), ['Camping Pitch']);
  const url = csobPriceUrl(HSC_PORTAL, list.slice(1, 2), '2027-06-05', 7);
  assert.match(decodeURIComponent(decodeURIComponent(url.split('ids=')[1].split('&')[0])), /,2017,9,,"2027-06-05T00:00:00\.000Z","2027-06-12T00:00:00\.000Z",en,DKK$/);
  const p = parseCsobPrices('{"success":true,"csProfilePriceModelList":[{"UniqueId":"u1","Rates":[{"price":1020.39,"currencyShortName":"GBP","profileItemPrice":941.29},{"price":9030,"currencyShortName":"DKK","profileItemPrice":8330}]}]}', 'DKK');
  assert.deepEqual(p.get('u1'), { total: 9030, accommodation: 8330, currency: 'DKK' });
});

test('hsc: slots = cabin type x sample week, DKK per cabin for 7 nights incl. cleaning', async () => {
  const slots = await fetchHscSlots(TODAY, ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 99);
  assert.deepEqual(incomplete, []);
  const beach = slots.find(s => s.key === 'beach-cabins|2026-10-17')!;
  assert.deepEqual([beach.startDate, beach.endDate, beach.price, beach.currency, beach.priceUnit, beach.packageNights, beach.availability, beach.spotsLeft],
    ['2026-10-17', '2026-10-23', 7693, 'DKK', 'package', 7, 'limited', 1]); // 7 x 999 + 700 cleaning = 2026 low season table
  assert.equal(slots.find(s => s.key === 'surfer-cabins|2027-06-05')!.price, 4200);
  assert.equal(slots.find(s => s.key === 'holiday-apartment|2027-06-05')!.availability, 'sold_out');
  assert.equal(slots.find(s => s.key === 'holiday-apartment|2027-06-05')!.price, null);
  assert.ok(slots.every(s => !/pitch/i.test(s.unit ?? '')));
  assert.equal(Math.min(...slots.filter(s => s.price !== null).map(s => s.price!)), 3500); // Surfer Cabins 17.-24.10.2026
  // a week in which nothing is bookable produces no slots
  assert.deepEqual(csobSlots([{ checkIn: '2027-01-02', nights: 7, profiles: [], open: false, prices: new Map() }]), []);
});

test('hsc: content', async () => {
  const c = await hvideSandeCamping.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Hvide Sande Camping');
  assert.equal(c.region, 'Hvide Sande, West Jutland');
  assert.deepEqual(c.spotCoords, { lat: 56.0342, lng: 8.1527 });
  assert.match(c.summary, /open 28\.3\.2026-31\.10\.2026 and 13\.3\.2027-31\.10\.2027/);
  assert.match(c.summary, /starts at DKK 500 per night \(surfer's cottage, low season\)/);
  assert.match(c.summary, /Westwind Surf School right opposite/);
  assert.equal(c.rooms.length, 11);
  assert.ok(c.rooms.find(r => r.name === 'The Beach Cottage (Strandhytten)')!.features
    .includes('2027 (Strandhytte, type 11): low season from DKK 900, high season from DKK 1,250 per night, final cleaning DKK 700'));
  assert.ok(c.imageUrls.length >= 12 && c.imageUrls.every(u => u.startsWith('https://hvidesandecamping.dk/wp-content/uploads/') && !/imgi_1_A|\.svg/.test(u)));
  assert.match(c.sourceText ?? '', /perfect conditions for windsurfing, kitesurfing and SUP/);
});
