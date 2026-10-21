// Regenbogen Ummanz: replays the park page recorded 2026-10-14 (scripts / styles dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  regenbogenUmmanz, RUM_SHEET, buildRgbSlots, rgbOpening, rgbPin, rgbPriceListHref, rgbRentalOffers, rgbRooms, rgbSlotsFromPage,
} from '../../src/offers/adapters/regenbogen-ummanz.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { slotRoom } from '../../src/offers/ingest.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/regenbogen-ummanz');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const html = read('www.regenbogen.ag_ferienanlagen_ummanz.html.');

test('rum: page facts (opening, linked price list, map pin, offers)', () => {
  assert.deepEqual(rgbOpening(html), { start: '2026-03-20', end: '2026-11-01' });
  assert.equal(rgbPriceListHref(html), RUM_SHEET.href);
  assert.deepEqual(rgbPin(html), { lat: 54.46426, lng: 13.13833 });
  const offers = rgbRentalOffers(html);
  assert.deepEqual(offers.map(o => [o.name, o.example, o.price]), [
    ['SPAR-ANGEBOT-MIETOBJEKT', '15.10.26 - 22.10.26', 257],
    ['MIETOBJEKT FRÜHBUCHER-ANGEBOT', '23.04.27 - 26.04.27', null],
  ]);
  // the 7-night saver (6th + 7th night EUR 1) matches the Mietwohnwagen A+B row: 5 x 51 + 2 = 257 (per night per unit)
  assert.equal(5 * RUM_SHEET.units[0].prices['A+B'] + 2, 257);
});

test('rum: slots = rental row x season band clipped to the opening', () => {
  const slots = rgbSlotsFromPage(html, RUM_SHEET, '2026-10-14');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 9);
  assert.deepEqual(slots.slice(0, 2).map(s => [s.key, s.startDate, s.endDate, s.price, s.occupancy, s.priceUnit, s.priceBasis, s.availability]), [
    ['mietwohnwagen|2026-09-02', '2026-09-02', '2026-10-31', 51, null, 'per_night', 'room', 'unknown'],
    ['ferienhaus-holli-boddenblick-2-personen|2026-09-02', '2026-09-02', '2026-10-31', 84, 2, 'per_night', 'room', 'unknown'],
  ]);
  assert.ok(slots.every(s => s.currency === 'EUR'));
  // a whole season: C (13.05.-25.05.) and D (02.07.-01.09.) bands exist, the winter D band (27.12.-03.01.) lies after closing
  const may = buildRgbSlots(RUM_SHEET, { start: '2026-03-20', end: '2026-11-01' }, '2026-03-01');
  assert.deepEqual([...new Set(may.map(s => `${s.startDate}..${s.endDate}`))], [
    '2026-03-20..2026-05-12', '2026-05-13..2026-05-25', '2026-05-26..2026-07-01', '2026-07-02..2026-09-01', '2026-09-02..2026-10-31',
  ]);
  assert.equal(may.find(s => s.key === 'ferienhaus-holli-boddenblick|2026-07-02')?.price, 156);
  assert.deepEqual(rgbSlotsFromPage(html, RUM_SHEET, '2026-11-02'), []); // 2026 list used up
  assert.deepEqual(rgbSlotsFromPage(html.replace(RUM_SHEET.href, '/resources/persistent/abc/Ummanz_Preisliste-2027-1.pdf'), RUM_SHEET, '2026-10-14'), []); // new list -> re-read
});

test('rum: adapter slots and content', async () => {
  assert.deepEqual(checkSlots(await regenbogenUmmanz.fetchSlots(ctx)).problems, []);
  const c = await regenbogenUmmanz.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.region, 'Suhrendorf, Rügen');
  assert.deepEqual(c.spotCoords, { lat: 54.46426, lng: 13.13833 });
  assert.match(c.summary, /UMMAII kite and surf school is on the site/);
  assert.match(c.summary, /open from 20 March 2026 to 1 November 2026/);
  assert.deepEqual(rgbRooms(html).map(r => r.name), ['Mietwohnwagen', 'Ferienunterkunft Holli', 'Ferienunterkunft Holli Boddenblick']);
  assert.equal(c.rooms[0].description, 'Rental caravan of about 10 m² for up to 4 persons.');
  assert.ok(c.rooms[0].features.includes('Mietwohnwagen: 2026 from EUR 51 (season A+B) / 59 (C) / 62 (D) per night'));
  assert.ok(c.optionalServices.some(s => /example 15\.10\.26 - 22\.10\.26 from EUR 257/.test(s)));
  assert.ok(c.imageUrls.length >= 10 && c.imageUrls.every(u => u.startsWith('https://www.regenbogen.ag/_img/') && !/unsplash|Tiki_Bar/i.test(u)));
});

test('rum: Ferienhaus rows price the Ferienunterkunft panes (occupancy and pet variants), Boddennähe and the ambiguous pet 2/3-person rows stay unlinked', async () => {
  const names = (await regenbogenUmmanz.fetchContent(ctx)).rooms.map(r => r.name);
  const slots = rgbSlotsFromPage(html, RUM_SHEET, '2026-10-14');
  assert.deepEqual(slots.map(s => [s.unit, slotRoom(names, s)]), [
    ['Mietwohnwagen', 'Mietwohnwagen'],
    ['Ferienhaus Holli® Boddenblick 2 Personen', 'Ferienunterkunft Holli Boddenblick'],
    ['Ferienhaus Holli® 2 Personen mit Haustiererlaubnis', null],
    ['Ferienhaus Holli® Boddenblick 3 Personen', 'Ferienunterkunft Holli Boddenblick'],
    ['Ferienhaus Holli® 3 Personen mit Haustiererlaubnis', null],
    ['Ferienhaus Holli®', 'Ferienunterkunft Holli'],
    ['Ferienhaus Holli® mit Haustiererlaubnis', 'Ferienunterkunft Holli'],
    ['Ferienhaus Holli® Boddennähe', null],
    ['Ferienhaus Holli® Boddenblick', 'Ferienunterkunft Holli Boddenblick'],
  ]);
  assert.ok(RUM_SHEET.units.every(u => !u.room || names.includes(u.room)));
});
