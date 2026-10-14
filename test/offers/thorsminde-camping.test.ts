// Thorsminde Camping: replays the English content pages and the Danish price page recorded 2026-10-14
// (scripts / styles / srcsets dropped), plus the Compusoft answers recorded 2026-10-14 (profile lists and the price answer
// trimmed to the fields the parser reads): three 2027 sample weeks with nothing loaded, and one 3-night stay 15.-18.10.2026.
// Engine slots are built with today pinned to the recording day so the sample weeks (and their fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  thorsmindeCamping, buildTmcEngineSlots, buildTmcSlots, fetchTmcLiveSlots, fetchTmcSample, fetchTmcSlots, parseTmcCabins, parseTmcPrices,
  tmcSampleSeasons, TMC_PORTAL,
} from '../../src/offers/adapters/thorsminde-camping.js';
import { csobSaturdaySamples } from '../../src/offers/adapters/hvide-sande-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/thorsminde-camping');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const prices = read('thorsmindecamping.dk_priser_.');

test('tmc: 2026 cabin prices, opening and season bands', () => {
  const p = parseTmcPrices(prices);
  assert.equal(p.year, 2026);
  assert.deepEqual([p.open, p.close], ['2026-03-27', '2026-10-18']);
  assert.equal(p.printedHigh, '27/6-18/10'); // overlaps the low season; the pitch-fee line 27/6-16/8 is used
  assert.deepEqual(p.bands, [
    { season: 'low', start: '2026-03-27', end: '2026-06-26' },
    { season: 'high', start: '2026-06-27', end: '2026-08-16' },
    { season: 'low', start: '2026-08-17', end: '2026-10-17' },
  ]);
  assert.deepEqual(p.rates.map(r => [r.type, r.season, r.night, r.week]), [
    ['fiskehytte', 'low', 450, 3150], ['familiehytte', 'low', 740, 5180], ['enghytte', 'low', 790, 5530],
    ['fiskehytte', 'high', 550, 3850], ['familiehytte', 'high', 890, 6230], ['enghytte', 'high', 990, 6930],
  ]);
  assert.deepEqual(p.cleaning, { fiskehytte: 300, familiehytte: 500, enghytte: 500 });
});

test('tmc: slots = cabin type x future band, DKK per night', async () => {
  const slots = await fetchTmcSlots('2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.unit, s.startDate, s.endDate, s.price, s.priceUnit, s.availability]), [
    ['fiskehytte|2026-08-17', 'Fishing hut (2 people)', '2026-08-17', '2026-10-17', 450, 'per_night', 'unknown'],
    ['familiehytte|2026-08-17', 'Family cabin (4-6 people)', '2026-08-17', '2026-10-17', 740, 'per_night', 'unknown'],
    ['enghytte|2026-08-17', 'Meadow cabin (6 people)', '2026-08-17', '2026-10-17', 790, 'per_night', 'unknown'],
  ]);
  assert.equal(buildTmcSlots(parseTmcPrices(prices), '2026-04-01').length, 9);
  assert.deepEqual(buildTmcSlots(parseTmcPrices(prices), '2026-10-18'), []);
});

test('tmc: cabins and content', async () => {
  assert.deepEqual(parseTmcCabins(read('thorsmindecamping.dk_en_cabins_.')).map(c => c.name), [
    'Meadow cabins with toilet and shower', 'Family cabin with toilet and shower', 'Fishing cabin with shared toilet and shower',
  ]);
  const c = await thorsmindeCamping.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Thorsminde, West Jutland');
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /seven-day VDWS beginner courses at the campsite/);
  assert.match(c.summary, /2026 prices run from DKK 450 to 990 per night/);
  assert.ok(c.rooms[0].features.includes('2026 high season: DKK 990 per night, DKK 6,930 per week'));
  assert.ok(c.optionalServices.includes('Kite day pass for non-guests DKK 75'));
  assert.match(c.sourceText ?? '', /school https:\/\/thorsminde-kiten\.com\//);
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => !/ACSI|DK-CAMP|logo/i.test(u)));
});

const TODAY = '2026-10-14';

test('tmc engine: sample weeks = printed 2026 season (no full week left) + 1 April - 31 October 2027', () => {
  const p = parseTmcPrices(prices);
  assert.deepEqual(tmcSampleSeasons(p, TODAY), [{ start: '2026-03-27', end: '2026-10-18' }, { start: '2027-04-01', end: '2027-10-31' }]);
  assert.deepEqual(csobSaturdaySamples(TODAY, tmcSampleSeasons(p, TODAY), { max: 9 }),
    ['2027-04-03', '2027-05-01', '2027-06-05', '2027-07-03', '2027-08-07', '2027-09-04', '2027-10-02']);
});

test('tmc engine: 2027 not loaded -> stops after 3 closed weeks, printed table used', async () => {
  const notes: string[] = [];
  const incomplete: string[] = [];
  const slots = await fetchTmcLiveSlots(TODAY, { note: t => { notes.push(t); }, incomplete: t => { incomplete.push(t); } });
  assert.deepEqual(incomplete, []);
  assert.ok(notes.some(n => /3 sample weeks in a row \(last 2027-06-05\)/.test(n)));
  assert.ok(notes.some(n => /printed price table used/.test(n)));
  assert.deepEqual(slots.map(s => [s.key, s.price, s.priceUnit, s.availability]), [
    ['fiskehytte|2026-08-17', 450, 'per_night', 'unknown'], ['familiehytte|2026-08-17', 740, 'per_night', 'unknown'], ['enghytte|2026-08-17', 790, 'per_night', 'unknown'],
  ]);
  const closed = await fetchTmcSample('2027-06-05');
  assert.equal(closed.open, false); // only the year-round motorhome spot (21 free) is bookable
  assert.deepEqual(closed.profiles.map(x => [x.title, x.units]), [
    ['Meadow hut with toilet and shower', 0], ['Family cabin with shower and toilet', 0], ['Fishing hut with access to shared toilet and shower', 0],
  ]);
});

test('tmc engine: cabin profiles, prices and slot states (3-night stay 15.-18.10.2026)', async () => {
  const s = await fetchTmcSample('2026-10-15', 3);
  assert.equal(s.open, true);
  assert.ok(s.profiles.every(x => TMC_PORTAL.isUnit(x)) && s.profiles.length === 3);
  const p = parseTmcPrices(prices);
  const slots = buildTmcEngineSlots([s], p);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(x => [x.key, x.unit, x.startDate, x.endDate, x.price, x.currency, x.priceUnit, x.packageNights, x.availability, x.spotsLeft]), [
    ['enghytte|2026-10-15', 'Meadow cabin (6 people)', '2026-10-15', '2026-10-17', 2370, 'DKK', 'package', 3, 'available', 7],
    ['familiehytte|2026-10-15', 'Family cabin (4-6 people)', '2026-10-15', '2026-10-17', 2220, 'DKK', 'package', 3, 'limited', 1],
    ['fiskehytte|2026-10-15', 'Fishing hut (2 people)', '2026-10-15', '2026-10-17', 1350, 'DKK', 'package', 3, 'available', 6],
  ]);
  // engine = printed table: 3 nights x 790 / 740 / 450 DKK low season
  assert.deepEqual(slots.map(x => x.price! / 3), [790, 740, 450]);
  // a cabin type free in another sampled week but 0 in an open week -> sold_out without price
  const family = s.profiles.find(x => /Family/.test(x.title))!;
  const full = {
    ...s, checkIn: '2026-10-22',
    profiles: s.profiles.map(x => (x === family ? { ...x, units: 0 } : x)),
    prices: new Map([...s.prices].filter(([id]) => id !== family.uniqueId)), // the price call only asks for free units
  };
  const sold = buildTmcEngineSlots([s, full], p).find(x => x.key === 'familiehytte|2026-10-22')!;
  assert.deepEqual([sold.availability, sold.price, sold.spotsLeft], ['sold_out', null, 0]);
});

test('tmc: adapter flags', () => {
  assert.equal(thorsmindeCamping.slotMethod, 'booking_engine');
  assert.equal(thorsmindeCamping.liveAvailability, true);
  assert.equal(thorsmindeCamping.instantBooking, true);
});
