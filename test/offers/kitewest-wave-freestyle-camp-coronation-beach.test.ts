// KiteWest Wave & Freestyle Kite Camp, Coronation Beach: replays /wave-freestyle/ recorded 2026-10-19
// ("2027 Calendar dates TBA" -> no slots) and the co-operator's camp page on sharkbaykitesurfing.com recorded
// 2026-10-21 (photos only). The date parser is checked with a synthetic dated line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildKwSlots, kitewestWaveFreestyleCampCoronationBeach, parseKwCamp, parseKwPartnerImages,
} from '../../src/offers/adapters/kitewest-wave-freestyle-camp-coronation-beach.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitewest-wave-freestyle-camp-coronation-beach');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.includes('wave-freestyle'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kitewest: room prices AUD per person, 7 days / 6 nights, 2027 dates TBA', () => {
  const c = parseKwCamp(html);
  assert.deepEqual(c.rooms.map(r => [r.unit, r.price, r.occupancy]), [
    ['Shared tent 2 beds', 3295, 2], ['Private single 1 bed', 3395, 1], ['Private double bed', 3595, null],
  ]);
  assert.equal(c.currency, 'AUD');
  assert.deepEqual([c.days, c.nights], [7, 6]);
  assert.equal(c.weeks.length, 0);
  assert.match(c.datesNote!, /2027/);
});

test('kitewest: no slots today; dated lines become slots once printed', async () => {
  assert.deepEqual(await kitewestWaveFreestyleCampCoronationBeach.fetchSlots(ctx), []);
  const dated = html.replace('2027 Calendar dates TBA', '2027 Calendar dates TBA</p><p>07-13 February 2027</p><p>01-07 October 2026');
  const c = parseKwCamp(dated);
  assert.deepEqual(c.weeks.map(w => [w.start, w.end]), [['2027-02-07', '2027-02-13'], ['2026-10-01', '2026-10-07']]);
  const slots = buildKwSlots(c, '2026-10-19');
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.length, 3);
  assert.ok(slots.every(s => s.startDate === '2027-02-07' && s.currency === 'AUD' && s.priceBasis === 'person'));
});

test('kitewest: valid camp content, photos from the partner camp page only', async () => {
  const c = await kitewestWaveFreestyleCampCoronationBeach.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.durationDays, 7);
  const U = 'https://sharkbaykitesurfing.com/wp-content/uploads/';
  assert.deepEqual(c.imageUrls, [
    'slider-3-image-new19.jpg', 'F8nWa.webp', 'FullSizeRender-8-600x600-1.jpg', 'IMG_1029-350x350-1.jpg',
    'IMG_1756-2-600x600-1.jpg', '054LR.jpg', 'yurts-camp.webp', 'IMG_1480.webp', 'Camp.webp', '52-pm.webp', 'AM5_4346-scaled-1.webp',
    '3c893fc1-b8cd-40be-8eb2-1bb4df9780af-copy-600x600-1.jpg',
  ].map(f => U + f));
  // never kitewest.com.au (robots disallows /wp-content/), no logos, stock, other places or optional-activity tiles
  assert.ok(!c.imageUrls.some(u => /kitewest\.com\.au|logo|pexels|fone_|uePQj|IMG_0015|r7EwU|dive-ocean|LLfOS|2CyKD|(09|58)-pm/i.test(u)));
  assert.match(c.summary, /2027 dates are not published yet/);
  assert.match(c.summary, /AUD 3,295 in a shared tent to AUD 3,595/);
  assert.doesNotMatch(c.summary, /[–—]/);
});

test('kitewest: partner images map thumbnails to originals and keep re-upload names', () => {
  const html = `<img src="https://sharkbaykitesurfing.com/wp-content/uploads/slider-3-image-new19-1024x427.jpg">
    <style>.gb-a{background-image:url(https://sharkbaykitesurfing.com/wp-content/uploads/IMG_1756-2-600x600-1.jpg);}
    .gb-b{background-image:url(https://sharkbaykitesurfing.com/wp-content/uploads/pexels-pixabay-262945-600x600-1.jpg);}</style>
    <img src="https://sharkbaykitesurfing.com/wp-content/uploads/SharkBayKiteSurfing-Logo-img-2.png">`;
  assert.deepEqual(parseKwPartnerImages(html), [
    'https://sharkbaykitesurfing.com/wp-content/uploads/slider-3-image-new19.jpg',
    'https://sharkbaykitesurfing.com/wp-content/uploads/IMG_1756-2-600x600-1.jpg',
  ]);
});
