// Casa no Campo CNC Kite&Wing Camp, Porto Covo: replays the kite page recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCncSlots, casaNoCampoKiteWingCampPortoCovo, cncImages, parseCncPrices,
} from '../../src/offers/adapters/casa-no-campo-kite-wing-camp-porto-covo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/casa-no-campo-kite-wing-camp-porto-covo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR)[0]), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('casa no campo: price tables incl. the camp package', () => {
  const p = parseCncPrices(html);
  assert.deepEqual(p.map(x => [x.name, x.amount]), [
    ['Daily Course - 2h', 95], ['Daily Course - 3h', 135], ['Complete Course', 420], ['Private Lesson', 70], ['PACKAGE KITE&WING CAMP', 890],
  ]);
});

test('casa no campo: one undated package slot, EUR 890 for 7 nights, on request', () => {
  const { ok, problems } = checkSlots(buildCncSlots(parseCncPrices(html)));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.priceUnit, s.priceBasis, s.packageNights, s.startDate, s.availability]), [
    ['kite-wing-camp|dorm', 'Dorm room', 890, 'EUR', 'package', 'person', 7, null, 'on_request'],
  ]);
});

test('casa no campo: slider photos only', () => {
  const imgs = cncImages(html);
  assert.equal(imgs.length, 8);
  assert.ok(!imgs.some(u => /logo|rentals|\.svg/i.test(u)));
});

test('casa no campo: content is a valid 8-day camp', async () => {
  const c = await casaNoCampoKiteWingCampPortoCovo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'camp');
  assert.equal(c.country, 'Portugal');
  assert.equal(c.spot, 'Porto Covo');
  assert.equal(c.durationDays, 8);
  assert.match(c.summary, /EUR 890/);
  assert.ok(c.includedServices.includes('7 nights in a Dorm Room'));
  assert.ok(!/[–—]/.test(c.summary + c.title));
  assert.equal(checkSlots(await casaNoCampoKiteWingCampPortoCovo.fetchSlots(ctx)).ok.length, 1);
  assert.equal(casaNoCampoKiteWingCampPortoCovo.instantBooking, undefined);
});
