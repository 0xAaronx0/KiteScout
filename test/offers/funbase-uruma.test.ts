// FUNBASE Uruma: replays home, /fee/, /roomguide/, /floorguide/ and /spot/ recorded 2026-10-21 (scripts and styles
// stripped). Two rate tables on /fee/: current (2024-10-01..2026-12-29) and revised (from 2026-12-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFbSlots, fbImages, fetchFbSlots, funbaseUruma, parseFbFee, parseFunbaseContent } from '../../src/offers/adapters/funbase-uruma.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/funbase-uruma');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const TODAY = '2026-10-21';

test('funbase: fee page -> two bands, general + member rates, tax, booking window', () => {
  const fee = parseFbFee(read('funbase.jp_fee_'));
  assert.deepEqual(fee.bands.map(b => [b.start, b.end, b.flatGeneral, b.rates.length]), [
    ['2026-12-30', null, true, 12], ['2024-10-01', '2026-12-29', false, 12],
  ]);
  const [revised, current] = fee.bands;
  assert.deepEqual(revised.rates[0], {
    roomKey: 'twin-1f', guests: 1,
    general: { normal: 10450, preHoliday: null, yearEnd: null },
    member: { normal: 6270, preHoliday: 7920, yearEnd: 9240 },
  });
  assert.deepEqual(current.rates.find(r => r.roomKey === 'large-1f' && r.guests === 5), {
    roomKey: 'large-1f', guests: 5,
    general: { normal: 30000, preHoliday: 34000, yearEnd: 37000 },
    member: { normal: 18000, preHoliday: 20400, yearEnd: 22200 },
  });
  // /fee/ prints room 203 for 2 guests correctly (the /roomguide/ copy repeats the 1-guest rate)
  assert.equal(revised.rates.find(r => r.roomKey === 'twin-2f-miinishi' && r.guests === 2)!.general.normal, 20900);
  assert.equal(fee.taxIncluded, true);
  assert.deepEqual(fee.lodgingTax, { from: '2027-02-01', percent: 2 });
  assert.equal(fee.bookingMonthsAhead, 6);
  assert.deepEqual(fee.discounts.slice(0, 2), ['5% off for 3+ nights', '10% off for 6+ nights']);
  assert.equal(fee.petFee, 3000);
});

test('funbase: slots per band x room x guests, current band clipped to today, revised to the booking window', () => {
  const slots = buildFbSlots(parseFbFee(read('funbase.jp_fee_')), TODAY);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 24);
  const cur = slots.find(s => s.key === 'twin-1f|1p|2024-10-01')!;
  assert.deepEqual([cur.startDate, cur.endDate, cur.price, cur.currency, cur.priceUnit, cur.priceBasis, cur.occupancy, cur.availability],
    ['2026-10-21', '2026-12-29', 9500, 'JPY', 'per_night', 'room', 1, 'on_request']);
  assert.match(cur.availabilityText!, /JPY 12,000 the night before a holiday; member rate JPY 5,700/);
  assert.doesNotMatch(cur.availabilityText!, /30 Dec/); // year-end column does not apply before 30 Dec
  const rev = slots.find(s => s.key === 'twin-2f|3p|2026-12-30')!;
  assert.deepEqual([rev.startDate, rev.endDate, rev.price, rev.occupancy], ['2026-12-30', '2027-04-30', 25850, 3]);
  assert.match(rev.availabilityText!, /same on all days incl\. year end; member rate JPY 15,510.*accommodation tax 2% from 1 Feb 2027/);
  // after 29 Dec the current band is gone, keys of the revised band stay
  const later = buildFbSlots(parseFbFee(read('funbase.jp_fee_')), '2027-01-15');
  assert.equal(later.length, 12);
  assert.ok(later.every(s => s.key.endsWith('|2026-12-30') && s.startDate === '2027-01-15' && s.endDate === '2027-07-31'));
});

test('funbase: fetchSlots replays with notes only for gaps', async () => {
  const notes: string[] = [];
  const slots = await fetchFbSlots(TODAY, { note: t => notes.push(t) });
  assert.equal(slots.length, 24);
  assert.deepEqual(notes, []);
});

test('funbase: content', async () => {
  const c = parseFunbaseContent({
    home: read('funbase.jp_.'), fee: read('funbase.jp_fee_'), rooms: read('funbase.jp_roomguide_'),
    floor: read('funbase.jp_floorguide_'), spot: read('funbase.jp_spot_'),
  }, TODAY);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.country, c.region, c.spot, c.durationDays, c.kiteLessons, c.mealPlan], ['accommodation', 'Japan', 'Uruma, Okinawa', 'Kaichu-doro', null, false, 'breakfast optional']);
  assert.match(c.summary, /open since June 2021/);
  assert.match(c.summary, /kite beach \(Oasis beach\)/);
  assert.match(c.summary, /Rooms from JPY 9,500 per room per night incl\. consumption tax \(general rate until 29 Dec 2026, revised rates from 30 Dec 2026; Okinawa accommodation tax 2% extra from 1 Feb 2027\)/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.equal(c.rooms.length, 5);
  assert.ok(c.optionalServices.includes('Breakfast JPY 1,000 (Japanese style)'));
  assert.ok(c.includedServices.includes('Free parking (12 cars)'));
  assert.doesNotMatch(c.sourceText!, /rooms not found on \/roomguide\//);
  // kite beach photos first, then the home slideshow; no theme art, banners, QR codes, flyers
  assert.deepEqual(c.imageUrls.slice(0, 4), [
    'https://funbase.jp/wp/wp-content/uploads/2021/11/spot01.jpg',
    'https://funbase.jp/wp/wp-content/uploads/2021/11/spot1-01.jpg',
    'https://funbase.jp/wp/wp-content/uploads/2021/11/spot1-02.jpg',
    'https://funbase.jp/wp/wp-content/uploads/2021/10/slideshow01.jpg',
  ]);
  assert.ok(!c.imageUrls.some(u => /themes|logo|bnr_|qrcode|chirashi|mark_|\.png$|\.gif$|-\d+x\d+\./.test(u)));
});

test('funbase: adapter fetchContent through the fixtures', async () => {
  const c = await funbaseUruma.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
});

test('funbase: image filter', () => {
  const html = '<img src="https://funbase.jp/wp/wp-content/uploads/2021/10/IMG_1-1024x768.jpg"><img src="https://funbase.jp/wp/wp-content/uploads/2021/11/logo-f.png"><div style="background:url(https://funbase.jp/wp/wp-content/uploads/2021/10/IMG_2-scaled.jpg)"></div><img src="https://funbase.jp/wp/wp-content/uploads/2021/12/qrcode_kaicyu.jpg">';
  assert.deepEqual(fbImages(html), ['https://funbase.jp/wp/wp-content/uploads/2021/10/IMG_2.jpg', 'https://funbase.jp/wp/wp-content/uploads/2021/10/IMG_1.jpg']);
});
