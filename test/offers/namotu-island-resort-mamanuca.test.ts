// Namotu Island Resort (Mamanuca, Fiji): replays the WordPress pages recorded 2026-10-12 (fixtures trimmed:
// script/style bodies dropped). Content only: no prices on the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { namotuIslandResortMamanuca, parseNiRoomPhotos, parseNiRooms, parseNiWeeks } from '../../src/offers/adapters/namotu-island-resort-mamanuca.js';
import { contentProblem } from '../../src/offers/validate.js';
import { planGallery } from '../../src/offers/gallery.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/namotu-island-resort-mamanuca');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('namotu: room names from the accommodation overview', () => {
  assert.deepEqual(parseNiRooms(read('www.namotuislandfiji.com_the-resort_accommodations_.')), [
    'Hideaway Room', 'Shallows 7 & 8', 'Mana Suite', 'Cobalt Suite', 'Cloudbreak Suite', 'Pool Suite', 'Love Shack',
    'Pacific Bures & Sunset Bures', 'Villa Suite', 'Beach Bures',
  ]);
});

test('namotu: Unlimited Weeks dates as printed (heading 2027, dates 2026) -> no slots, a note', async () => {
  const w = parseNiWeeks(read('www.namotuislandfiji.com_signature-week_ben-wilson-kite-weeks_.'));
  assert.equal(w.heading, '2027 DATES');
  assert.deepEqual([w.dates.length, w.dates[0], w.dates[8]], [9, '06-13 June 2026', '22-29 Aug 2026']);
  assert.deepEqual(await namotuIslandResortMamanuca.fetchSlots(ctx), []);
  assert.ok(notes.some(n => /heading "2027 DATES" lists 9 dates/.test(n)));
});

test('namotu: content', async () => {
  const c = await namotuIslandResortMamanuca.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Namotu Island Resort');
  assert.equal(c.country, 'Fiji');
  assert.equal(c.mealPlan, 'full_board');
  assert.match(c.summary, /with 12 air-conditioned rooms/);
  assert.match(c.summary, /minimum 7 nights, check-in on Sunday/);
  assert.match(c.summary, /opened in 1994/);
  assert.ok(c.includedServices.includes('Round trip Airport transfers via car and boat'));
  assert.ok(c.optionalServices.includes('Unlimited Week booking deposit: USD$2,500 per person deposit'));
  assert.equal(c.rooms.length, 10);
  assert.ok(c.imageUrls.length >= 15);
  assert.ok(c.imageUrls.every(u => /namotuislandfiji\.com\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
});

test('namotu: each room gets its own card photo, the shared Shallows photo stays with Shallows, kite page as spot', async () => {
  const c = await namotuIslandResortMamanuca.fetchContent(ctx);
  const file = (u: string) => u.split('/').pop();
  assert.deepEqual(c.rooms.map(r => [r.name, r.imageUrls?.length ?? 0, r.imageUrls ? file(r.imageUrls[0]) : null]), [
    ['Hideaway Room', 0, null], // its card shows the Shallows photo "shallows-bed"
    ['Shallows 7 & 8', 1, 'shallows-bed.jpg'],
    ['Mana Suite', 1, 'Photo-18-8-2026-12-34-45-pm.jpg'],
    ['Cobalt Suite', 1, '03A9786.jpg'],
    ['Cloudbreak Suite', 1, 'cloudbreak-suite-namotu-2.jpg'],
    ['Pool Suite', 1, 'Pool-Suite-Namotu-Island-accommodation-01.jpg'],
    ['Love Shack', 1, 'Love-Shack-Namotu-Island-accommodation-01.jpg'],
    ['Pacific Bures & Sunset Bures', 1, 'Pacific-Bure-Namotu-Island-accommodation-01.jpg'],
    ['Villa Suite', 1, 'namotu-island-villa-suite-accommodation-bed-01.jpg'],
    ['Beach Bures', 1, 'Photo-Jan-06-5-20-48-AM.jpg'],
  ]);
  assert.equal(parseNiRoomPhotos(read('www.namotuislandfiji.com_the-resort_accommodations_.')).size, 9);
  const all = c.rooms.flatMap(r => r.imageUrls ?? []);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(u => /^https:\/\/www\.namotuislandfiji\.com\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
  // the og:image of the overview is the Villa Suite card photo: same URL in both lists
  assert.ok(c.imageUrls.includes(c.rooms.find(r => r.name === 'Villa Suite')!.imageUrls![0]));

  assert.equal(c.spotImageUrls?.length, 7);
  assert.match(c.spotImageUrls![0], /kite-surfer-in-the-air-next-to-beach-of-namotu-island-fiji-01\.jpg$/);
  assert.ok(c.spotImageUrls!.some(u => /DJI_0301-sky-namotu-lefts-kitesurfing-\.jpg$/.test(u)));
  assert.ok(c.spotImageUrls!.every(u => /^https:\/\/www\.namotuislandfiji\.com\/wp-content\/uploads\//.test(u) && !/\.(png|heic)$/.test(u)));

  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const r of c.rooms.filter(x => x.imageUrls)) assert.ok(r.imageUrls!.some(u => first24.includes(u)), r.name);
  assert.ok(first24.includes(c.spotImageUrls![0]));
});
