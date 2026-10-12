// Urla Kite Camp (Gülbahçe, Urla): replays the Turkish one-page site recorded 2026-10-12 (script bodies except
// JSON-LD, SVGs and CSS trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  urlaKiteCampGulbahce, parseUkcSections, ukcVisiblePrices,
} from '../../src/offers/adapters/urla-kite-camp-gulbahce.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/urla-kite-camp-gulbahce');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const home = read('www.urlakitecamp.com_.');

test('ukc: sections and facts; commented-out course items are ignored', () => {
  const s = parseUkcSections(home);
  assert.deepEqual(s.map(x => x.id), ['kitesurf', 'hotel', 'cafe', 'shop', 'kite-stay', 'community', 'spot', 'contact']);
  const kite = s.find(x => x.id === 'kitesurf')!;
  assert.equal(kite.facts.length, 7);
  assert.ok(kite.facts.every(f => !/Wing Foil|Ekipman Kiralama/i.test(`${f.title} ${f.detail}`)));
  assert.match(home, /<h3 class="section__facts-title">Ekipman Kiralama<\/h3>/); // present in the HTML, but inside a comment
  const stay = s.find(x => x.id === 'kite-stay')!;
  assert.deepEqual(stay.facts.slice(0, 2), [
    { title: 'Paket İçeriği', detail: '2 Gece 3 Gün Konaklama' },
    { title: 'Kitesurf Eğitimi', detail: '6 Saat Kitesurf Eğitimi ve tüm ekipman kullanımı' },
  ]);
});

test('ukc: no price on the site -> [] (price on request); lira amounts would be reported', async () => {
  assert.deepEqual(ukcVisiblePrices(home), []);
  const slots = await urlaKiteCampGulbahce.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(ukcVisiblePrices('<body><section id="hotel"><p>Classic Room 3.500 TL / gece</p></section></body>'), ['3.500 TL']);
});

test('ukc: content', async () => {
  const c = await urlaKiteCampGulbahce.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Urla Kite Camp');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Turkey');
  assert.equal(c.region, 'İzmir');
  assert.equal(c.spot, 'Gülbahçe, Urla');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, null);
  assert.deepEqual(c.rooms.map(r => r.name), ['Design Room', 'Classic Room', 'Tent (camping area)']);
  assert.match(c.summary, /Turkish representative of Naish Kites/);
  assert.match(c.summary, /2 nights \/ 3 days with 6 hours of lessons and all equipment/);
  assert.deepEqual(c.languages, ['tr']);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls[0].endsWith('/img/hotel/oda1.jpg'));
  assert.ok(c.imageUrls.every(u => u.startsWith('https://www.urlakitecamp.com/img/') && !/logo/i.test(u)));
  assert.equal(c.bookingUrl, 'https://wa.me/905326065579');
});
