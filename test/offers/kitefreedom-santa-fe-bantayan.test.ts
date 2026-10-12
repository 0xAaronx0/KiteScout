// KiteFreedom Kiteboard Center (Santa Fe, Bantayan): replays the Wix pages recorded 2026-10-12 (trimmed to markup +
// the business-location fragment).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitefreedomSantaFeBantayan, buildKfSlots, kfCoords, kfFooterYear, kfImages, parseKfAccommodation, parseKfPackage,
} from '../../src/offers/adapters/kitefreedom-santa-fe-bantayan.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitefreedom-santa-fe-bantayan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const pkgHtml = read('www.kitefreedomsantafe.com_learn-kitesurfing_kitesurfing-package.');
const accHtml = read('www.kitefreedomsantafe.com_beach-accommodation.');

test('kitefreedom: package block = 3-day course + 4-night cabana stay', () => {
  const p = parseKfPackage(pkgHtml);
  assert.deepEqual([p.courseDays, p.coursePrice, p.nights, p.stayPrice, p.guests, p.children], [3, 27000, 4, 24400, 2, 1]);
  assert.equal(kfFooterYear(pkgHtml), 2026);
});

test('kitefreedom: package line variants', () => {
  const html = ['THE KITESURFING PACKAGE INCLUDES:', '3 Day = 27,000php', 'Zero - Hero Kiteboard Course', '+', '5 Days = 24,400php', 'Up to 2 guests + 1 child', 'CHECK AVAILABILITY']
    .map(t => `<p>${t}</p>`).join('');
  const p = parseKfPackage(html);
  // "5 Days" (the /learn-kitesurfing wording) is not a night count: no stay price without "Nights"
  assert.deepEqual([p.courseDays, p.coursePrice, p.nights, p.stayPrice], [3, 27000, null, null]);
  assert.deepEqual(buildKfSlots(p), []);
});

test('kitefreedom: slot = cabana package price, PHP per cabana, on request', async () => {
  const slots = await kitefreedomSantaFeBantayan.fetchSlots(ctx);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.packageNights, s.availability]), [
    ['cabana-package-4n', 'Beachfront cabana (kitesurfing package)', 24400, 'PHP', 'package', 'room', 2, 4, 'on_request'],
  ]);
});

test('kitefreedom: accommodation units, coordinates, photos', () => {
  const units = parseKfAccommodation(accHtml);
  assert.deepEqual(units.map(u => u.name), ['Casita with private pool', 'Cabanas with sea view']);
  assert.deepEqual(units[0].features, ['Private Swimming Pool', 'Beach Bar']);
  assert.match(units[1].description, /one queen size double bed, air conditioning/);
  assert.deepEqual(kfCoords(pkgHtml), { lat: 11.155968, lng: 123.80817 });
  const imgs = kfImages(accHtml);
  assert.ok(imgs.length >= 4 && imgs.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[0-9a-f_]+~mv2\.(jpe?g|webp)$/.test(u)));
});

test('kitefreedom: content', async () => {
  const c = await kitefreedomSantaFeBantayan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Philippines');
  assert.equal(c.spot, 'Santa Fe, Bantayan Island');
  assert.deepEqual(c.spotCoords, { lat: 11.155968, lng: 123.80817 });
  assert.match(c.summary, /4 nights in a beachfront bamboo cabana .* 3-day one-on-one Zero to Hero course taught to IKO and BKSA standards/);
  assert.match(c.summary, /end of October to April with 12-25 knots/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Casita with private pool', 'Beachfront cabana with sea view']);
  assert.ok(c.rooms[1].features.includes('Kitesurfing package: 4 nights PHP 24,400 (up to 2 guests + 1 child)'));
  assert.ok(c.optionalServices[0].startsWith('3-day Zero to Hero course, one-on-one (PHP 27,000'));
  assert.ok(c.imageUrls.length >= 8 && c.imageUrls.every(u => !/\.png$/i.test(u)));
});
