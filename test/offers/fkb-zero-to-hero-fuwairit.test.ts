// Fuwairit Kite Beach Zero to Hero: replays /kitesurfing/, the home page and /accommodation/ recorded 2026-10-30
// (scripts, styles and SVGs stripped). Slots are built with today pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFkbSlots, fkbZeroToHeroFuwairit, parseFkbCourse } from '../../src/offers/adapters/fkb-zero-to-hero-fuwairit.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/fkb-zero-to-hero-fuwairit');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('fkb: Zero to Hero price, length and season', () => {
  const c = parseFkbCourse(read('www.fkb.qa_kitesurfing_.'))!;
  assert.deepEqual([c.price, c.usd, c.days, c.seasonFrom, c.seasonTo], [2610, 717, 2, 11, 7]);
  assert.equal(parseFkbCourse('<p>Discover Kitesurfing</p>'), null);
});

test('fkb: one season band, the running season clipped to today', () => {
  const c = parseFkbCourse(read('www.fkb.qa_kitesurfing_.'))!;
  const before = buildFkbSlots(c, '2026-10-30');
  assert.deepEqual(checkSlots(before).problems, []);
  assert.deepEqual(before.map(s => [s.key, s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability]),
    [['zero-to-hero|2026-11-01', '2026-11-01', '2027-07-31', 2610, 'QAR', 'package', 'person', 'on_request']]);
  assert.deepEqual(buildFkbSlots(c, '2027-02-10').map(s => [s.key, s.startDate, s.endDate]),
    [['zero-to-hero|2026-11-01', '2027-02-10', '2027-07-31']]);
  assert.deepEqual(buildFkbSlots(c, '2027-08-15').map(s => s.key), ['zero-to-hero|2027-11-01']);
});

test('fkb: content', async () => {
  const c = await fkbZeroToHeroFuwairit.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'course');
  assert.equal(c.country, 'Qatar');
  assert.equal(c.durationDays, 2);
  assert.deepEqual(c.spotCoords, { lat: 26.0196145, lng: 51.381822 });
  assert.match(c.summary, /from QAR 2,610 per person/);
  assert.match(c.sourceText ?? '', /King Kite Beach Room with Sea View/);
  assert.ok(c.imageUrls.length >= 10);
  assert.ok(c.imageUrls.every(u => /^https:\/\/www\.fkb\.qa\/images\/[^/]+\/gallery_master\/\?m=nbf$/.test(u) && !/icon|play-video|iko/.test(u)));
});
