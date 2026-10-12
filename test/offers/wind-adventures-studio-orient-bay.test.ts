// Wind Adventures Studio (Orient Bay): bstoked snapshot (Aaron's exception 2026-10-12). Replays bstoked listing
// 6831 and its partials recorded 2026-10-12 (main page trimmed to header + main, Maps key redacted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  windAdventuresStudioOrientBay, parseBstImages, parseBstListing, parseBstRooms, parseBstServices, WA_SITE_URL,
} from '../../src/offers/adapters/wind-adventures-studio-orient-bay.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/wind-adventures-studio-orient-bay');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('wind-adventures: bstoked listing blocks', () => {
  const l = parseBstListing(read('bstoked.net_listings_6831_.'));
  assert.equal(l.title, 'Oceanside Studio Accomodation');
  assert.equal(l.location, 'Saint Martin, Caribbean');
  assert.match(l.summary!, /top floor studios located in the Orient Beach Resort/);
  assert.match(l.conditions!, /average of 13-18 knots/);
  assert.deepEqual(l.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.deepEqual(l.kiteServices, ['gear rental', 'gear storage', 'lessons or coaching', 'spot guidance', 'rescue service']);
  assert.equal(l.trip['typical pickup'], 'Collectivité de Saint-Martin, Saint-Martin');
  assert.match(l.accommodation!, /two minutes walk from the beach/);
  assert.deepEqual([l.lat, l.lng], [18.086863321704502, -63.01855444908142]);
});

test('wind-adventures: studio card, services, host photos', () => {
  const rooms = parseBstRooms(read('bstoked.net_listings_accommodations_id_6831.'));
  assert.deepEqual(rooms.map(r => [r.name, r.features, r.photos.length]),
    [['Studio Inside Orient Bay Resort', ['Maids services once a week', 'Walking distance to spot'], 5]]);
  assert.match(rooms[0].description!, /one king size bed, air conditioning/);
  const svc = parseBstServices(read('bstoked.net_listings_services_id_6831.'));
  assert.deepEqual(svc.included, []);
  assert.deepEqual(svc.optional.map(s => s.group), ['Lessons & Coaching', 'Lessons & Coaching', 'Lessons & Coaching', 'Gear Rental', 'Other']);
  assert.equal(svc.optional[3].item, 'Weekly rental (Cabrinha gear)');
  const imgs = parseBstImages(read('bstoked.net_listings_images_id_6831.'), '6831');
  assert.equal(imgs.length, 12);
  assert.ok(imgs.every(u => /^https:\/\/bstoked\.azureedge\.net\/l-6831-[A-Za-z0-9]+\.(jpe?g|png|webp)\?width=1920$/i.test(u)));
});

test('wind-adventures: content passes the gate, sourceUrl is the own site', async () => {
  const c = await windAdventuresStudioOrientBay.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'Wind Adventures Studio');
  assert.equal(c.country, 'Saint Martin');
  assert.equal(c.spot, 'Orient Bay');
  assert.equal(c.sourceUrl, WA_SITE_URL);
  assert.ok(!c.sourceUrl.includes('bstoked'));
  assert.deepEqual(c.spotCoords, { lat: 18.086863321704502, lng: -63.01855444908142 });
  assert.match(c.summary, /^Studio with a king-size bed, kitchenette, air conditioning and a balcony on the top floor of the Orient Beach Resort/);
  assert.match(c.summary, /1\.5 miles wide and offers flat water in the lagoon, chop, swell and a reef wave, with 13-18 knots most of the year/);
  assert.match(c.summary, /Private lessons, weekly Cabrinha gear rental and boat day trips to kite in Anguilla/);
  const sentences = c.summary.split(/(?<=\.)\s+(?=[A-Z])/);
  assert.ok(sentences.length >= 2 && sentences.length <= 4, `${sentences.length} sentences`);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.beginnerFriendly, false);
  assert.equal(c.mealPlan, 'self_catering');
  assert.equal(c.imageUrls.length, 17); // 12 gallery + 5 studio photos, all host uploads on bstoked
  assert.match(c.sourceText ?? '', /BSTOKED SNAPSHOT \(Aaron's exception 2026-10-12\)/);
});

test('wind-adventures: no slots (price on request), no request', async () => {
  const before = requestsSoFar();
  const slots = await windAdventuresStudioOrientBay.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.equal(windAdventuresStudioOrientBay.confidence, 'low');
  assert.ok(notes.some(n => /price on request/.test(n)));
});
