// ExotiKite Baja Wave Camps: replays the camp page recorded 2026-10-19 (all 2026 weeks past -> no slots) and the
// page sitemap recorded 2026-10-21 (image list for the kiting photos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exotikiteBajaWaveCamps, buildExoSlots, fetchExoSlots, parseExoCamps, parseExoContent } from '../../src/offers/adapters/exotikite-baja-wave-camps.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/exotikite-baja-wave-camps');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const html = readFileSync(join(DIR, files.find(f => f.startsWith('exotikite.com_baja-wave-camps'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('exotikite: 2026 weeks, FULL marks, price', () => {
  const c = parseExoCamps(html);
  assert.equal(c.year, 2026);
  assert.deepEqual(c.weeks.map(w => [w.start, w.end, w.full]), [
    ['2026-04-04', '2026-04-11', false], ['2026-04-11', '2026-04-18', false], ['2026-04-18', '2026-04-25', false],
    ['2026-04-25', '2026-05-02', true], ['2026-05-02', '2026-05-09', true],
  ]);
  assert.equal(c.price, 2999);
});

test('exotikite: slots only for future weeks', async () => {
  const early = buildExoSlots(parseExoCamps(html), '2026-04-15');
  assert.deepEqual(checkSlots(early).problems, []);
  assert.deepEqual(early.map(s => [s.key, s.availability, s.price, s.currency]), [
    ['2026-04-18', 'on_request', 2999, 'USD'], ['2026-04-25', 'sold_out', 2999, 'USD'], ['2026-05-02', 'sold_out', 2999, 'USD'],
  ]);
  const notes: string[] = [];
  assert.deepEqual(await fetchExoSlots('2026-10-19', { note: x => notes.push(x) }), []);
  assert.match(notes[0], /all 2026 weeks are past/);
});

test('exotikite: content, region-level location without a spot', async () => {
  const c = parseExoContent(html, '2026-10-19');
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 8, 'Mexico', 'Baja California Sur Pacific coast', 'Pacific coast near San Juanico']);
  assert.match(c.summary, /The 2027 weeks are not published yet/);
  const live = await exotikiteBajaWaveCamps.fetchContent(ctx);
  assert.equal(contentProblem(live), null);
  // the 4 coach portraits of the camp page + 4 ExotiKite kiting photos from the page sitemap (Los Barriles; the site
  // has no Pacific wave-camp photo); no lifestyle, yoga, kids, rental-house or real-estate pictures
  const U = 'https://exotikite.com/wp-content/uploads/2022/10/';
  assert.deepEqual(live.imageUrls, [
    'Justi.jpg', 'megan.jpg', 'ian.jpg', 'jose.jpg', 'wave-camps-los-barriles-baja.webp',
    'exotikite-los-barriles-kite-boarding-school.webp', 'advanced-kiteboarding-lessons.jpg',
    'kite-wind-conditions-los-barriles-baja-mexico.webp',
  ].map(f => U + f));
  assert.ok(!live.imageUrls.some(u => /yoga|kid|vacation|hotel|Megan\.jpeg|\/assets\//.test(u)));
});
