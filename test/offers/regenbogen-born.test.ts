// Regenbogen Born: replays the park page recorded 2026-10-14 (scripts / styles dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { regenbogenBorn, RBO_SHEET } from '../../src/offers/adapters/regenbogen-born.js';
import { rgbOpening, rgbPin, rgbPriceListHref, rgbRentalOffers, rgbSlotsFromPage } from '../../src/offers/adapters/regenbogen-ummanz.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/regenbogen-born');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('www.regenbogen.ag_ferienanlagen_born.html.');

test('rbo: page facts', () => {
  assert.deepEqual(rgbOpening(html), { start: '2026-03-20', end: '2026-11-01' });
  assert.equal(rgbPriceListHref(html), RBO_SHEET.href);
  assert.deepEqual(rgbPin(html), { lat: 54.38397, lng: 12.50449 });
  assert.deepEqual(rgbRentalOffers(html).map(o => [o.example, o.price]), [['17.10.26 - 24.10.26', 332], ['04.06.27 - 08.06.27', null]]);
});

test('rbo: slots = Holli rows x open season band', () => {
  const slots = rgbSlotsFromPage(html, RBO_SHEET, '2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.occupancy]), [
    ['ferienhaus-holli|2026-09-02', '2026-09-02', '2026-10-31', 55, null],
    ['ferienhaus-holli-mit-haustiererlaubnis|2026-09-02', '2026-09-02', '2026-10-31', 55, null],
    ['ferienhaus-holli-exklusiv|2026-09-02', '2026-09-02', '2026-10-31', 76, 6],
    ['ferienhaus-holli-exklusiv-mit-haustiererlaubnis|2026-09-02', '2026-09-02', '2026-10-31', 76, 6],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR' && s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'));
  assert.equal(rgbSlotsFromPage(html, RBO_SHEET, '2026-07-10').find(s => s.key === 'ferienhaus-holli-exklusiv|2026-07-02')?.price, 173);
});

test('rbo: adapter slots and content', async () => {
  assert.deepEqual(checkSlots(await regenbogenBorn.fetchSlots(ctx)).problems, []);
  const c = await regenbogenBorn.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Born, Fischland-Darß');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.match(c.summary, /VDWS school on the park teaches kitesurfing and windsurfing/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Ferienunterkunft Holli®', 'Ferienunterkunft Holli® Komfort', 'Ferienunterkunft Holli® Exklusiv']);
  assert.equal(c.rooms[2].description, 'Holli® holiday unit of about 40 m² for up to 6 persons.');
  assert.ok(c.rooms[2].features.includes('Ferienhaus Holli® Exklusiv: 2026 from EUR 76 (season A+B) / 129 (C) / 173 (D) per night'));
  assert.ok(!c.optionalServices.some(s => /Mietwohnwagen|caravan/i.test(s)));
  assert.ok(c.imageUrls.length >= 15 && c.imageUrls.every(u => u.startsWith('https://www.regenbogen.ag/_img/')));
});
