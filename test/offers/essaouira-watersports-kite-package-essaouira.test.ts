// Essaouira Watersports kitesurf packages: replays /packages/kitesurf + the three stay pages recorded 2026-10-19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { essaouiraWatersportsKitePackage, parseEwPackages, buildEwSlots } from '../../src/offers/adapters/essaouira-watersports-kite-package-essaouira.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

process.env.OFFERS_FIXTURE_DIR = join(import.meta.dirname, '../fixtures/offers/essaouira-watersports-kite-package-essaouira');
const ctx = { note: () => {}, incomplete: () => {} };

test('ew: one undated slot per stay x nights x persons, read from the Book-now links', async () => {
  const slots = await essaouiraWatersportsKitePackage.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 20);
  const by = Object.fromEntries(slots.map(s => [s.key, s]));
  assert.deepEqual([by['hostel|3n|1p'].price, by['hostel|6n|1p'].price, by['maison-du-sud|3n|1p'].price, by['riad-zahra-authentic|6n|1p'].price], [214, 418, 310, 640]);
  const two = by['riad-zahra-authentic|4n|2p'];
  assert.deepEqual([two.price, two.priceTotal, two.occupancy, two.packageNights, two.currency, two.priceBasis, two.availability],
    [346, 692, 2, 4, 'EUR', 'person', 'unknown']);
  assert.ok(slots.every(s => s.startDate === null && s.priceUnit === 'package'));
  assert.ok(!slots.some(s => s.key.startsWith('hostel|') && s.occupancy === 2)); // the hostel sells single places only
});

test('ew: package link parser ignores other sports and malformed links', () => {
  const html = '<a href="/book/book-multi-sport-packages?sport=surf&amp;accommodation=hostel&amp;duration=3nights&amp;hours=6h&amp;price=141&amp;persons=1">x</a>'
    + '<a href="/book/book-multi-sport-packages?sport=kitesurf&amp;accommodation=hostel&amp;duration=5nights&amp;hours=10h&amp;price=350&amp;persons=1">y</a>'
    + '<a href="/book/book-multi-sport-packages?sport=kitesurf&amp;accommodation=hostel&amp;duration=xx&amp;price=1">z</a>';
  assert.deepEqual(parseEwPackages(html), [{ stay: 'hostel', nights: 5, hours: 10, price: 350, persons: 1 }]);
  assert.equal(buildEwSlots([], parseEwPackages(html))[0].unit, 'hostel, 5 nights + 10h kitesurfing, 1 person');
});

test('ew: content', async () => {
  const c = await essaouiraWatersportsKitePackage.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 7, 'Morocco', 'Marrakech-Safi', 'Essaouira', 'breakfast']);
  assert.deepEqual(c.rooms.map(r => r.name), ['Riad Zahra Authentic', 'Maison du Sud', 'Hostel']);
  assert.match(c.summary, /3 to 6 nights .*Packages start at EUR 214 for 3 nights and 6 hours \(1 person, Hostel\)/);
  assert.equal(c.imageUrls[0], 'https://www.essaouirawatersports.com/images/photos/kitesurfer.webp');
  assert.equal(c.imageUrls.length, 5);
  assert.deepEqual(c.spotCoords, { lat: 31.5085, lng: -9.7595 });
  assert.equal(essaouiraWatersportsKitePackage.instantBooking, true);
});
