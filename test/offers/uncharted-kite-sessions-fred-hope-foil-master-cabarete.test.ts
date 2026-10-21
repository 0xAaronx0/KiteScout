// Uncharted Kite Sessions Fred Hope Foil Master, replayed from the fixtures recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import {
  buildUksFredSlots, parseUksCamp, parseUksFredContent, uksCampLinks,
} from '../../src/offers/adapters/uncharted-kite-sessions-fred-hope-foil-master-cabarete.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/uncharted-kite-sessions-fred-hope-foil-master-cabarete');
process.env.OFFERS_FIXTURE_DIR = DIR;
const camp = readFileSync(join(DIR, 'www.unchartedkitesessions.com_destinations_fred-hope-foil-master-2027.2ff4e914.txt'), 'utf8');
const villas = readFileSync(join(DIR, 'www.unchartedkitesessions.com_uncharted-villas.5cee7767.txt'), 'utf8');
const TODAY = '2026-10-21';

test('parseUksCamp: the facts list', () => {
  const c = parseUksCamp(camp);
  assert.equal(c.title, 'Fred Hope Foil Master 2027');
  assert.deepEqual(c.range, { start: '2027-04-04', end: '2027-04-10' });
  assert.deepEqual([c.price, c.currency, c.perPerson, c.from, c.maxGuests, c.nights], [4800, 'USD', false, false, 6, 6]);
  assert.equal(c.includes.length, 11);
  assert.ok(c.includes.includes('Advanced kite-flying course'));
  assert.equal(c.includes.find(s => s.startsWith('Professional photography')), 'Professional photography & video');
});

test('fred hope slots: future edition kept, past edition dropped', () => {
  const c = parseUksCamp(camp);
  const slots = buildUksFredSlots(c, TODAY);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.startDate, s.endDate, s.price, s.priceBasis, s.packageNights, s.availability]),
    [['2027-04-04', '2027-04-04', '2027-04-10', 4800, 'person', 6, 'on_request']]);
  assert.deepEqual(buildUksFredSlots(c, '2027-04-05'), []);
});

test('nav links: only the 2027 edition', () => {
  assert.deepEqual(uksCampLinks(camp).filter(l => /Fred Hope/.test(l.text)).map(l => l.url),
    ['https://www.unchartedkitesessions.com/destinations/fred-hope-foil-master-2027']);
});

test('fred hope content (pinned today)', () => {
  const c = parseUksFredContent(camp, villas, TODAY);
  assert.equal(contentProblem(c), null);
  assert.equal(c.durationDays, 7);
  assert.equal(c.spot, 'Kite Beach, Cabarete');
  assert.match(c.summary, /2027-04-04 to 2027-04-10 for at most 6 guests and costs USD 4,800/);
  assert.match(parseUksFredContent(camp, villas, '2027-05-01').summary, /next edition is not published yet/);
  assert.doesNotMatch(c.summary, /[—–]/);
  assert.equal(c.imageUrls.length, 10);
  assert.ok(c.imageUrls.every(u => !/logo/i.test(u)));
  assert.ok(c.imageUrls.some(u => u.endsWith('9653b574708b7a6469e28ee67a57dc73_XL.jpg')), 'villa cards upscaled to XL');
});
