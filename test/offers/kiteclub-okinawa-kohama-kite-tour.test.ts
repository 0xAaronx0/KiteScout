// KITECLUB Okinawa Kohama Island kite tour: replays the shared tours index recorded 2026-10-19. The 2026 edition
// (16-20 Oct) had started on the recording day, so the adapter returns no slots; the parser is checked with an earlier "today".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchKohamaSlots, kiteclubOkinawaKohamaKiteTour, parseKohamaReportImages } from '../../src/offers/adapters/kiteclub-okinawa-kohama-kite-tour.js';
import { kcoAnnouncements, parseKcoPosts, parseKcoTour } from '../../src/offers/adapters/kiteclub-okinawa-kumejima-tour.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kiteclub-okinawa-kohama-kite-tour');
process.env.OFFERS_FIXTURE_DIR = DIR;
const index = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('kiteclub-okinawa.biz_category_info_tours_'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('kohama: newest announcement is the 2026 edition, 2025 found as earlier edition', () => {
  const ann = kcoAnnouncements(parseKcoPosts(index), /小浜島/);
  assert.deepEqual(ann.map(p => p.id), [13191, 12592]); // 12840 is the 2025 trip report
  const t = parseKcoTour(ann[0]);
  assert.equal(t.year, 2026);
  assert.deepEqual(t.departures.map(d => [d.start, d.end, d.nights, d.price]), [
    ['2026-10-16', '2026-10-20', 4, 63000], ['2026-10-16', '2026-10-19', 3, 53000],
  ]);
  assert.deepEqual(parseKcoTour(ann[1]).departures.map(d => [d.start, d.end]), [
    ['2025-10-24', '2025-10-28'], ['2025-10-24', '2025-10-27'], ['2025-10-24', '2025-10-26'],
  ]);
});

test('kohama: slots before the start, none once it started', async () => {
  const early = await fetchKohamaSlots('2026-09-20');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.endDate, s.availability]), [
    ['2026-10-16|4n', 63000, 'JPY', 'package', 'person', 4, '2026-10-20', 'on_request'],
    ['2026-10-16|3n', 53000, 'JPY', 'package', 'person', 3, '2026-10-19', 'on_request'],
  ]);
  const notes: string[] = [];
  assert.deepEqual(await fetchKohamaSlots('2026-10-19', { note: t => notes.push(t) }), []);
  assert.match(notes[0], /only has started\/past dates/);
});

test('kohama: content', async () => {
  const c = await kiteclubOkinawaKohamaKiteTour.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.sourceUrl], ['camp', 5, 'Japan', 'Yaeyama Islands, Okinawa', 'Kohama Island', 'https://kiteclub-okinawa.biz/info/blog/13191/']);
  assert.match(c.summary, /Runs every year in autumn \(2025, 2026\); 2027 dates not yet published \(2026 edition: 16-20 Oct 2026, 4 nights, JPY 63,000; 16-19 Oct 2026, 3 nights, JPY 53,000, per person\)/);
  assert.deepEqual(c.includedServices, [
    'Return ferry Ishigaki - Kohama', 'Nights at the guesthouse Kohama no Yado panapana, breakfast included',
    'Rental car (fuel included)', 'Guiding at the kite spots (spot attendance by the school)',
  ]);
  // photos from the trip reports (max 3 per report), never the announcements' tide-table screenshots
  assert.equal(c.imageUrls.length, 20);
  assert.equal(c.imageUrls[0], 'https://kiteclub-okinawa.biz/wp-content/uploads/2020/07/20E8BED0-E7EF-42CA-965E-D35372AE8F03.jpeg');
  assert.ok(c.imageUrls.includes('https://kiteclub-okinawa.biz/wp-content/uploads/2018/06/P6160230.jpg'));
  assert.ok(!c.imageUrls.some(u => /IMG_7359|838FBEFF|05E3E8C7/.test(u)));
  assert.ok(!/[–—]/.test(c.summary));
});

test('kohama: report photos skip announcements and cap per report', () => {
  const img = (n: number) => `<img src="https://kiteclub-okinawa.biz/wp-content/uploads/2020/07/p${n}-940x704.jpeg">`;
  const posts = [
    { id: 3, title: { rendered: '2026年10月小浜島ツアー開催のお知らせ' }, content: { rendered: img(9) } },
    { id: 2, title: { rendered: 'カーチバイ小浜島ツアー2020' }, content: { rendered: [1, 2, 3, 4].map(img).join('') } },
    { id: 1, title: { rendered: '久米島ツアー' }, content: { rendered: img(8) } },
  ];
  assert.deepEqual(parseKohamaReportImages(posts), [1, 2, 3].map(n => `https://kiteclub-okinawa.biz/wp-content/uploads/2020/07/p${n}.jpeg`));
});
