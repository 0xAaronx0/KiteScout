// Kite Hostel Stagnone (Marsala, Lo Stagnone): replays the pages recorded 2026-10-12. Slots = the undated "Per night
// from" cards on /rooms/ (edited 2026-04-08), kept while the page is fresh (gate tested with fixed dates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteHostelStagnoneMarsala, buildKhsSlots, khsFresh, khsImages, khsModified, parseKhsFaq, parseKhsPrices, parseKhsRoomPage,
} from '../../src/offers/adapters/kite-hostel-stagnone-marsala.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { todayIso } from '../../src/offers/parse.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-hostel-stagnone-marsala');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const roomsHtml = read('www.kitehostelstagnone.com_rooms_.');
const ctx = { note: () => {}, incomplete: () => {} };

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

test('khs: fetchSlots replays /rooms/ (result follows the gate for today)', async () => {
  const notes: string[] = [];
  const slots = await kiteHostelStagnoneMarsala.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, buildKhsSlots(roomsHtml, todayIso()));
  if (slots.length === 0) assert.match(notes[0], /last edited 2026-04-08/);
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
