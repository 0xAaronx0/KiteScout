// Campingpark Wulfener Hals (Fehmarn): replays the English (machine-translated) pages recorded 2026-10-12: home,
// kite page, specials table and seven rental pages (script / style bodies, SVGs and comments trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  campingparkWulfenerHalsFehmarn, buildWhSlots, fetchWhSlots, parseWhKitePrices, parseWhSpecials, parseWhSpecialsNotes, parseWhUnits,
} from '../../src/offers/adapters/campingpark-wulfener-hals-fehmarn.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

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
