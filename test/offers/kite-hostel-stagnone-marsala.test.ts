// Kite Hostel Stagnone (Marsala, Lo Stagnone): replays the pages recorded 2026-10-12 and the Octorate availability
// calendar recorded 2026-10-14. Slots = the "Per night from" cards on /rooms/ (edited 2026-04-08), kept while the page is
// fresh (gate tested with fixed dates), banded by the calendar's open / closed days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  kiteHostelStagnoneMarsala, buildKhsCalendarSlots, buildKhsSlots, fetchKhsSlots, khsFresh, khsImages, khsModified, parseKhsCalendar,
  parseKhsFaq, parseKhsPrices, parseKhsRoomPage,
} from '../../src/offers/adapters/kite-hostel-stagnone-marsala.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-hostel-stagnone-marsala');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const roomsHtml = read('www.kitehostelstagnone.com_rooms_.');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-14';
const calJs = read('api.octorate.com_connect_rest_v1_reservation_calendar_390941');

test('khs: /rooms/ price cards + page date', () => {
  assert.deepEqual(parseKhsPrices(roomsHtml).map(p => [p.title, p.amount]), [
    ['Mix dorm', 33], ['Female dorm', 36], ['Private room (Pixel)', 95], ['Private room (Agrumi)', 75],
  ]);
  assert.equal(khsModified(roomsHtml), '2026-04-08');
});

test('khs: slots = one undated unit per card (dorms per bed, private rooms per room)', () => {
  const slots = buildKhsSlots(roomsHtml, '2026-10-12');
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.priceBasis, s.occupancy]), [
    ['mixed-dorm-bed', 'Mixed dorm (bed)', 33, 'person', 1],
    ['female-dorm-bed', 'Female dorm (bed)', 36, 'person', 1],
    ['private-double-room-pixel', 'Private double room (Pixel)', 95, 'room', 2],
    ['private-single-room-agrumi', 'Private single room (Agrumi)', 75, 'room', 1],
  ]);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.availability === 'unknown' && s.startDate === null));
});

test('khs: freshness gate (15 months after the page edit)', () => {
  assert.equal(khsFresh('2026-04-08', '2027-07-08'), true);
  assert.equal(khsFresh('2026-04-08', '2027-07-09'), false);
  assert.equal(khsFresh(null, '2026-10-12'), false);
  assert.deepEqual(buildKhsSlots(roomsHtml, '2027-08-01'), []);
});

test('khs: Octorate calendar script -> day flags, minimum stays, messages', () => {
  const cal = parseKhsCalendar(calJs);
  assert.equal(Object.keys(cal.days).length, 700);
  assert.deepEqual([cal.days['2026-10-14'], cal.days['2026-10-15'], cal.days['2026-11-02'], cal.days['2026-11-03'], cal.days['2027-07-10']], [0, undefined, 1, 0, 0]);
  assert.deepEqual(cal.minstay, {});
  assert.equal(cal.messages.closed, 'Not available');
  assert.throws(() => parseKhsCalendar('var x = 1;'), /without "octorateAvailCalendar"/);
});

test('khs: slots = room cards banded by the calendar (open -> available with the card price, 0 -> closed)', async () => {
  const slots = await fetchKhsSlots(ctx, TODAY);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 16);
  assert.deepEqual(slots.filter(s => s.unit === 'Mixed dorm (bed)').map(s => [s.key, s.endDate, s.price, s.availability]), [
    ['mixed-dorm-bed|2026-10-14', '2026-10-14', null, 'closed'],
    ['mixed-dorm-bed|2026-10-15', '2026-11-01', 33, 'available'],
    ['mixed-dorm-bed|2026-11-02', '2026-11-02', 33, 'available'],
    ['mixed-dorm-bed|2026-11-03', '2027-09-30', null, 'closed'],
  ]);
  const pixel = slots.find(s => s.key === 'private-double-room-pixel|2026-10-15')!;
  assert.deepEqual([pixel.price, pixel.currency, pixel.priceUnit, pixel.priceBasis, pixel.occupancy], [95, 'EUR', 'per_night', 'room', 2]);
  assert.match(slots.find(s => s.key === 'mixed-dorm-bed|2026-11-02')!.availabilityText!, /Closed to arrival/);
  // minimum stays split the bands and set minNights
  const withMin = buildKhsCalendarSlots(buildKhsSlots(roomsHtml, TODAY).slice(0, 1),
    { days: { '2026-11-03': 0 }, minstay: { '2026-10-20': 3 }, messages: {} }, TODAY);
  assert.deepEqual(withMin.map(s => [s.startDate, s.endDate, s.availability, s.minNights ?? null]), [
    ['2026-10-14', '2026-10-19', 'available', null], ['2026-10-20', '2026-10-20', 'available', 3],
    ['2026-10-21', '2026-11-02', 'available', null], ['2026-11-03', '2026-11-03', 'closed', null], ['2026-11-04', '2027-09-30', 'available', null],
  ]);
  assert.equal(kiteHostelStagnoneMarsala.liveAvailability, true);
});

test('khs: calendar not readable -> the undated cards, reported as incomplete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'khs-'));
  const roomsFile = files.find(f => f.startsWith('www.kitehostelstagnone.com_rooms_.'))!;
  copyFileSync(join(DIR, roomsFile), join(dir, roomsFile));
  process.env.OFFERS_FIXTURE_DIR = dir;
  try {
    const missing: string[] = [];
    const slots = await fetchKhsSlots({ note: () => {}, incomplete: r => missing.push(r) }, TODAY);
    assert.deepEqual(slots, buildKhsSlots(roomsHtml, TODAY));
    assert.match(missing[0], /Octorate calendar not read \(fixture missing/);
  } finally {
    process.env.OFFERS_FIXTURE_DIR = DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('khs: stale /rooms/ -> [] ("price on request") without asking the engine', async () => {
  const missing: string[] = [];
  const notes: string[] = [];
  assert.deepEqual(await fetchKhsSlots({ note: n => notes.push(n), incomplete: r => missing.push(r) }, '2027-08-01'), []);
  assert.match(notes[0], /last edited 2026-04-08/);
  assert.deepEqual(missing, []);
});

test('khs: room pages, FAQ, media photos', () => {
  const agrumi = parseKhsRoomPage(read('www.kitehostelstagnone.com_private-single-room-agrumi_.'));
  assert.equal(agrumi.name, 'Private single room (Agrumi)');
  assert.equal(agrumi.from, 75);
  assert.ok(agrumi.offers.includes('Towels included'));
  const faq = parseKhsFaq(read('www.kitehostelstagnone.com_faq-kitesurf-kiteschool_.'));
  assert.match(faq.find(x => /lessons/i.test(x.q))!.a, /^No, we don.t/);
  const imgs = khsImages(JSON.parse(read('www.kitehostelstagnone.com_wp-json_wp_v2_media_')));
  assert.match(imgs[0], /Mixed_Dorm_7\.jpg$/);
  assert.ok(imgs.every(u => !/logo|profile|review|-w380|\.png$/i.test(u)));
});

test('khs: content', async () => {
  const c = await kiteHostelStagnoneMarsala.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Hostel Stagnone');
  assert.equal(c.country, 'Italy');
  assert.equal(c.spot, 'Lo Stagnone');
  assert.equal(c.kiteLessons, false); // "Do you take kitesurfing lessons or rent equipment? No, we don't"
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /10-20 min by bike from the kite schools/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Mixed dorm', 'Girls dorm', 'Private double room (Pixel)', 'Private single room (Agrumi)']);
  assert.ok(c.includedServices.includes('Kite equipment storage room'));
  assert.equal(c.imageUrls.length, 30);
  assert.equal(kiteHostelStagnoneMarsala.confidence, 'medium');
});
