// Seahorse Resort & Spa (Mui Ne, Vietnam): replays the resort and Surfpoint pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped). Content only: rates sit in the Exely widget; the printed 2026 vouchers are residents-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  seahorseResortMuiNe, parseShCoords, parseShRooms, parseShVoucher, parseSurfpoint, shRoomName,
} from '../../src/offers/adapters/seahorse-resort-mui-ne.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/seahorse-resort-mui-ne');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('seahorse: Vietnamese room titles -> English names', () => {
  assert.deepEqual(shRoomName('PHÒNG DELUXE GIA ĐÌNH HƯỚNG BIỂN'), { name: 'Deluxe Family Room, sea view', family: true, view: 'sea view' });
  assert.equal(shRoomName('BUNGALOW TRƯỚC BIỂN').name, 'Beachfront Bungalow');
  assert.equal(shRoomName('PHÒNG HƯỚNG BIỂN CAO CẤP').name, 'Premium Room, sea view');
  assert.equal(shRoomName('BUNGALOW HƯỚNG HỒ BƠI').name, 'Bungalow, pool view');
});

test('seahorse: room cards of both list pages', () => {
  const deluxe = parseShRooms(read('www.seahorseresortvn.com_phong-deluxe.'));
  const bung = parseShRooms(read('www.seahorseresortvn.com_phong-bungalow.'));
  assert.equal(deluxe.length, 7);
  assert.deepEqual(bung.map(r => r.name), ['Bungalow, garden view', 'Bungalow, pool view', 'Bungalow, sea view', 'Beachfront Bungalow']);
  assert.ok(bung.every(r => r.bookingRoomId === '5049885'));
});

test('seahorse: coordinates from the own /vi-tri page', () => {
  assert.deepEqual(parseShCoords(read('www.seahorseresortvn.com_vi-tri.')), { lat: 10.9426053, lng: 108.1908569 });
});

test('seahorse: 2026 voucher is dated and residents-only (kept out of slots)', () => {
  const v = parseShVoucher(read('www.seahorseresortvn.com_summer-cash-voucher-2026'));
  assert.equal(v.price, '2.250.000');
  assert.equal(v.validity, '01/04/2026 - 31/10/2026');
  assert.equal(v.residentsOnly, true);
});

test('seahorse: Surfpoint places its kite station at the resort', () => {
  const sp = parseSurfpoint(read('www.surfpoint-vietnam.com_.'), read('www.surfpoint-vietnam.com_traveling-information.'));
  assert.equal(sp.atSeahorse, true);
  assert.ok(sp.facts.some(f => /^Home to our kite and wing station, Sea Horse Resort and Spa/.test(f)));
  assert.ok(sp.facts.some(f => /secure lockers\.$/.test(f)));
  assert.ok(sp.facts.every(f => !/\{|data-color/.test(f)));
});

test('seahorse: no slots (price on request), no network', async () => {
  const before = requestsSoFar();
  const slots = await seahorseResortMuiNe.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.ok(notes.some(n => /residents of Vietnam only/.test(n)));
});

test('seahorse: content', async () => {
  const c = await seahorseResortMuiNe.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Seahorse Resort & Spa');
  assert.equal(c.country, 'Vietnam');
  assert.equal(c.spot, 'Mui Ne');
  assert.deepEqual(c.spotCoords, { lat: 10.9426053, lng: 108.1908569 });
  assert.match(c.summary, /Surfpoint Kite & Wing School has its kite and wing station on the resort's beach/);
  assert.match(c.summary, /7 deluxe and premium room types .* 4 bungalow types/);
  assert.equal(c.rooms.length, 11);
  assert.ok(c.imageUrls.length >= 12);
  assert.ok(c.imageUrls.every(u => /^https:\/\/www\.seahorseresortvn\.com\/uploads\/images\//.test(u) && !/voucher|logo|favicon/i.test(u)));
  assert.match(c.sourceText ?? '', /residents only: true/);
});
