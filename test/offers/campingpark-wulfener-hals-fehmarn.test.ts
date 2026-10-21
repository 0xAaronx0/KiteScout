// Campingpark Wulfener Hals (Fehmarn): replays the English (machine-translated) pages recorded 2026-10-12: home,
// kite page, specials table and seven rental pages (script / style bodies, SVGs and comments trimmed), plus the Compusoft
// answers recorded 2026-10-14 for the 12 sample weeks (profile lists and price answers trimmed to the fields the parser
// reads). Engine slots are built with today pinned to the recording day so the sample weeks (and fixtures) stay the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingparkWulfenerHalsFehmarn, buildWhEngineSlots, buildWhSlots, fetchWhLiveSlots, fetchWhSlots, parseWhKitePrices, parseWhSpecials,
  parseWhSpecialsNotes, parseWhUnits, whOpenGroupsOnly, whSampleCheckIns, whUnitName, WH_PORTAL, WH_ROOMS,
} from '../../src/offers/adapters/campingpark-wulfener-hals-fehmarn.js';
import { parseCsobList, type CsobSample } from '../../src/offers/adapters/hvide-sande-camping.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/campingpark-wulfener-hals-fehmarn');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const specials = read('www.wulfenerhals.de_specials-angebote.');

test('wulfener-hals: specials table, economy rental trailer column', () => {
  const s = parseWhSpecials(specials);
  assert.equal(s.length, 18);
  assert.deepEqual(s[0], { name: 'Easter Break 1', start: '2026-03-21', end: '2026-03-28', nights: 7, flexibleWeeks: 0, price: 279, benefits: '1' });
  assert.deepEqual(s.find(x => x.name === 'Easter Break 3'), { name: 'Easter Break 3', start: '2026-03-21', end: '2026-04-11', nights: 14, flexibleWeeks: 2, price: 559, benefits: '1,3' });
  assert.deepEqual(s[s.length - 1], { name: 'Golden Autumn', start: '2026-10-02', end: '2026-11-02', nights: 7, flexibleWeeks: 1, price: 359, benefits: '1' });
  assert.ok(parseWhSpecialsNotes(specials).includes('Accommodations for up to 4 people from one family (2 adults and 2 children under 12, or 3 adults)'));
});

test('wulfener-hals: slots = specials still bookable (fixed term: by start; flexible: last possible arrival)', () => {
  const s = parseWhSpecials(specials);
  assert.deepEqual(buildWhSlots(s, '2026-10-05').map(x => x.unit), ['Economy rental trailer - Fall Speed 3', 'Economy rental trailer - Golden Autumn']);
  const all = buildWhSlots(s, '2026-01-01');
  assert.equal(all.length, 18);
  assert.deepEqual(checkSlots(all).problems, []);
  const fall3 = all.find(x => x.unit === 'Economy rental trailer - Fall Speed 3')!;
  assert.deepEqual([fall3.startDate, fall3.endDate, fall3.price, fall3.packageNights, fall3.availabilityText], ['2026-10-10', '2026-10-23', 599, 14, null]);
});

test('wulfener-hals: fetchSlots replay on 2026-10-12 -> Golden Autumn only', async () => {
  const slots = await fetchWhSlots('2026-10-12');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots, [{
    key: 'economy-rental-trailer|golden-autumn|2026-10-02',
    startDate: '2026-10-02', endDate: '2026-11-01', unit: 'Economy rental trailer - Golden Autumn',
    price: 359, currency: 'EUR', priceUnit: 'package', priceBasis: 'room', occupancy: null,
    availability: 'unknown', availabilityText: '7 nights within the period', spotsLeft: null, packageNights: 7,
  }]);
  assert.deepEqual(buildWhSlots(parseWhSpecials(specials), '2026-11-01'), []);
});

test('wulfener-hals: kite course prices and rental units', () => {
  assert.deepEqual(parseWhKitePrices(read('www.wulfenerhals.de_surfen-kiten-segeln.')).map(x => [x.course, x.price]), [
    ['Basis-Block', 125], ['Training Block 4/1', 110], ['Training Block 2/1', 165], ['Training Block 1/1', 190],
  ]);
  assert.deepEqual(parseWhUnits(read('www.wulfenerhals.de_mobilheimpark.'), 'Mobile home').map(u => [u.name, u.info]), [
    ['Sumba Model', '32 m², for 4 people'], ['Ocala Model', '37 m², sleeps 4'], ['Chatel Model', '19 m², for 2 people'], ['Romantiksuite Model', null],
  ]);
  assert.deepEqual(parseWhUnits(read('www.wulfenerhals.de_ferienhaeuser-im-baltic-park.'), 'Holiday home Baltic-Park').map(u => u.name), ['Seeschwalbe']);
});

test('wulfener-hals: content', async () => {
  const c = await campingparkWulfenerHalsFehmarn.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Campingpark Wulfener Hals');
  assert.equal(c.country, 'Germany');
  assert.equal(c.spot, 'Wulfen, Fehmarn');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.beginnerFriendly, true);
  assert.match(c.summary, /open all year/);
  assert.match(c.summary, /rents about 100 rental trailers/);
  assert.match(c.summary, /daily from Easter to the end of October \(basic block 4 hours \/ 4 students, EUR 125 per person\)/);
  assert.equal(c.rooms.length, 16);
  assert.ok(c.rooms.some(r => r.name === 'Holiday home Dünenpark: Seagull Model' && /35 m²/.test(r.description ?? '')));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.wulfenerhals.de/files/bilder/') && !/Grundriss|logo/i.test(u)));
});

const TODAY = '2026-10-14';

test('wulfener-hals engine: 12 monthly sample weeks, rental units only, English names', () => {
  assert.deepEqual(whSampleCheckIns(TODAY), [
    '2026-10-17', '2026-11-07', '2026-12-05', '2027-01-02', '2027-02-06', '2027-03-06',
    '2027-04-03', '2027-05-01', '2027-06-05', '2027-07-03', '2027-08-07', '2027-09-04',
  ]);
  const list = files.filter(f => f.startsWith('v3.onlinebooking.dk_profile_getCSProfileListViewModel')).flatMap(f => parseCsobList(readFileSync(join(DIR, f), 'utf8')));
  const units = [...new Set(list.filter(WH_PORTAL.isUnit).map(whUnitName))].sort();
  assert.ok(['Premium rental trailer', 'Comfort rental trailer', 'Economy rental trailer', 'Holiday home Dünenpark', 'Mobile home Chatel',
    'Holiday apartment at the golf course', 'Holiday apartment on the campsite', 'Economy rental trailer special: Indian-Summer'].every(u => units.includes(u)));
  // pitches, the motorhome park, camping specials, the group trailer profile and the sleeping beach chair are not rental units
  assert.ok(list.filter(WH_PORTAL.isUnit).every(p => !/Pl(a|ä)tze|Wohnmobilpark|Camping$|^Gruppen$|Strandkorb/.test(p.title)));
});

test('wulfener-hals engine: replay 2026-10-14 -> 99 slots, EUR per unit for 7 nights', async () => {
  const incomplete: string[] = [];
  const slots = await fetchWhLiveSlots(TODAY, { note: () => {}, incomplete: r => { incomplete.push(r); } });
  assert.deepEqual(incomplete, []);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 99);
  const eco = slots.find(x => x.key === 'economy-rental-trailer|2027-06-05')!;
  assert.deepEqual([eco.unit, eco.startDate, eco.endDate, eco.price, eco.currency, eco.priceUnit, eco.packageNights, eco.priceBasis, eco.availability, eco.spotsLeft],
    ['Economy rental trailer', '2027-06-05', '2027-06-11', 639.1, 'EUR', 'package', 7, 'room', 'available', 18]);
  const prem = slots.find(x => x.key === 'premium-rental-trailer|2027-08-07')!;
  assert.deepEqual([prem.price, prem.availability, prem.spotsLeft], [1409.1, 'limited', 1]);
  const ecoAug = slots.find(x => x.key === 'economy-rental-trailer|2027-08-07')!;
  assert.deepEqual([ecoAug.price, ecoAug.availability, ecoAug.spotsLeft], [null, 'sold_out', 0]); // Premium / Comfort free that week
  assert.equal(Math.min(...slots.filter(x => x.price != null).map(x => x.price!)), 309.5); // special "Kennenlernangebot", 03.-10.04.2027
  // rental trailers are not offered in winter: the whole group is 0 -> skipped, not sold out
  assert.ok(!slots.some(x => /rental trailer$/.test(x.unit ?? '') && x.startDate! >= '2026-11-01' && x.startDate! <= '2027-03-31'));
  // specials outside their term are skipped, never sold out
  assert.ok(slots.filter(x => /special/.test(x.unit ?? '')).every(x => x.availability !== 'sold_out'));
});

test('wulfener-hals engine: group rule (sold out only next to a free unit of the same group)', () => {
  const p = (title: string, sub: string, units: number) => ({ id: title.length, uniqueId: title, siteId: 1, title, subTitle: `(Camping- und Ferienpark Wulfener Hals, ${sub})`, units, customerType: '' });
  const s: CsobSample = {
    checkIn: '2027-07-03', nights: 7, open: true, prices: new Map(),
    profiles: [p('Premium', 'Mietwohnwagen', 0), p('Komfort', 'Mietwohnwagen', 2), p('Mobilheim Chatel', 'Mobilheim', 0)],
  };
  assert.deepEqual(whOpenGroupsOnly([s])[0].profiles.map(x => x.title), ['Premium', 'Komfort']);
  const next: CsobSample = { ...s, checkIn: '2027-07-10', profiles: [p('Premium', 'Mietwohnwagen', 3)], prices: new Map([['Premium', { total: 1269.1, accommodation: null, currency: 'EUR' }]]) };
  assert.deepEqual(buildWhEngineSlots([s, next]).filter(x => x.key.startsWith('premium')).map(x => [x.key, x.price, x.availability]), [
    ['premium-rental-trailer|2027-07-03', null, 'sold_out'], ['premium-rental-trailer|2027-07-10', 1269.1, 'available'],
  ]);
});

test('wulfener-hals: adapter flags', () => {
  assert.equal(campingparkWulfenerHalsFehmarn.slotMethod, 'booking_engine');
  assert.equal(campingparkWulfenerHalsFehmarn.liveAvailability, true);
  assert.equal(campingparkWulfenerHalsFehmarn.instantBooking, true);
});

test('wulfener-hals: engine units link to their content rooms, ambiguous ones and specials stay unlinked', async () => {
  const names = (await campingparkWulfenerHalsFehmarn.fetchContent(ctx)).rooms.map(r => r.name);
  assert.ok(Object.values(WH_ROOMS).every(r => names.includes(r)));
  const slots = await fetchWhLiveSlots('2026-10-14', ctx);
  const linked = new Map(slots.map(s => [s.unit!, slotRoom(names, s)]));
  assert.equal(linked.get('Economy rental trailer'), 'Rental trailer');
  assert.equal(linked.get('Premium rental trailer'), 'Rental trailer');
  assert.equal(linked.get('Holiday home Baltikpark'), 'Holiday home Baltic-Park: Seeschwalbe');
  assert.equal(linked.get('Mobile home Ocala'), 'Mobile home: Ocala Model');
  assert.deepEqual([...linked].filter(([, r]) => !r).map(([u]) => u).sort(), [
    'Economy rental trailer special: Indian-Summer', 'Economy rental trailer special: Kennenlernangebot',
    'Holiday apartment at the golf course', 'Holiday apartment on the campsite', 'Holiday home Dünenpark',
  ]);
});
