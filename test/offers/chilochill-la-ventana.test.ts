// Chilochill Glamping Resort and Kiteschool (La Ventana, BCS): replays the relaunched (Next.js) pages recorded
// 2026-10-28 (scripts, styles, SVGs and comments trimmed). The old WordPress /kitesurf and /glamping pages answer 404
// since the relaunch, which turned the daily slots job red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCcSlots, ccHasKiteAndStay, ccImages, chilochillLaVentana, parseCcLessonFormats, parseCcPackages, parseCcTent,
} from '../../src/offers/adapters/chilochill-la-ventana.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/chilochill-la-ventana');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = () => { const notes: string[] = []; return { notes, note: (t: string) => notes.push(t), incomplete: () => {} }; };
const home = read('chilochill.com_en_.');
const kite = read('chilochill.com_en_kitesurf_.');
const packagePage = read('chilochill.com_en_packages_kite-and-stay_.');
const king = read('chilochill.com_en_king_.');
const queen = read('chilochill.com_en_double-queen_.');

test('chilochill: lesson formats and the two tent types from the relaunched pages', () => {
  assert.deepEqual(parseCcLessonFormats(kite), [3, 6, 9, 12]);
  assert.deepEqual(parseCcTent(king), { name: 'King glamping tent', description: 'A private escape for two, with a king bed and the easy rhythm of life by the water.', features: ['1 king bed', 'Private bathroom', 'Wi-Fi', 'Hot shower'] });
  assert.deepEqual(parseCcTent(queen)?.features, ['2 queen beds', 'Private bathroom', 'Wi-Fi', 'Hot shower']);
  assert.equal(parseCcTent('<main><h1>Gallery</h1></main>'), null);
});

test('chilochill: photos are the own Vercel Blob originals (no thumbnails, AVIF copies or logo)', () => {
  const imgs = ccImages({ home, kite, packagePage, king, queen });
  assert.ok(imgs.length >= 15);
  assert.ok(imgs.every(u => /blob\.vercel-storage\.com\/chilochill\//.test(u)));
  assert.ok(!imgs.some(u => /-\d+x\d+\.|\.avif$|logo|wordmark/i.test(u)));
  assert.match(imgs[0], /\/kite\.webp$/);
});

test('chilochill: no prices since the relaunch -> no slots, with a note; the package guard passes', async () => {
  const c = ctx();
  const slots = await chilochillLaVentana.fetchSlots(c);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(c.notes.join(' '), /no prices on the own site since the 2026-10 relaunch/);
  // the guard: a package page without "Kite & Stay" means the layout changed or the package is gone
  assert.equal(ccHasKiteAndStay(packagePage), true);
  assert.equal(ccHasKiteAndStay(packagePage.replace(/Kite &amp; Stay|Kite & Stay/g, 'Something else')), false);
});

test('chilochill: the old priced package blocks still parse (picked up again if the site prints them)', () => {
  const old = '<main><p>3 DAY PACKAGE</p><p>KITE &amp; BED</p><p>Lodging for 2 people glamping king size bed, 2 nights 3 days.</p><p>9 hours of kite lessons</p><p>PRICE: $25,150°° MXN</p>'
    + '<p>4 DAY PACKAGE</p><p>KITE &amp; BED</p><p>Lodging for 2 people glamping king size bed, 6 nights 7 days.</p><p>12 hours</p><p>PRICE: $33,500°° MXN</p></main>';
  const p = parseCcPackages(old);
  assert.deepEqual(p.map(x => [x.headingDays, x.nights, x.price, x.currency, x.consistent]), [[3, 2, 25150, 'MXN', true], [4, 6, 33500, 'MXN', false]]);
  const c = ctx();
  const slots = buildCcSlots(p, c);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.packageNights]), [['kite-and-bed-3d', 25150, 2]]);
  assert.match(c.notes[0], /4 DAY PACKAGE" left out/);
});

test('chilochill: content', async () => {
  const c = await chilochillLaVentana.fetchContent(ctx());
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.sourceUrl, 'https://chilochill.com/en/packages/kite-and-stay/');
  assert.deepEqual(c.rooms.map(r => r.name), ['King glamping tent', 'Double Queen glamping tent']);
  assert.deepEqual(c.languages, ['en', 'es', 'de', 'fr']);
  assert.match(c.summary, /IKO-certified/);
  assert.match(c.summary, /3 h, 6 h, 9 h, 12 h formats/);
  assert.match(c.summary, /quoted on request/);
  assert.ok(c.optionalServices.some(s => /Kite lessons, 3 h \/ 6 h \/ 9 h \/ 12 h \(price on request\)/.test(s)));
  assert.ok(!/[–—]/.test(c.summary));
  assert.equal(chilochillLaVentana.confidence, 'low');
});
