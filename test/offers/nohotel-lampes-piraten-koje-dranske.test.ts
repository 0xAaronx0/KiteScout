// NoHotel - Lampes Piraten Koje (Dranske, Rügen): replays the Jimdo pages recorded 2026-10-14 (scripts / styles / srcsets dropped).
// Price list is an image -> price on request (Aaron's call 2026-10-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nohotelLampesPiratenKojeDranske, nhEmails, nhImages, nhLines, nhTextPrices,
} from '../../src/offers/adapters/nohotel-lampes-piraten-koje-dranske.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/nohotel-lampes-piraten-koje-dranske');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');

test('nohotel: price list is an image -> no slots, no note', async () => {
  const notes: string[] = [];
  const slots = await nohotelLampesPiratenKojeDranske.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(nhTextPrices(read('www.nohotel.de_nohotel-english-1_prices_.')), []);
  assert.match(nhLines(read('www.nohotel.de_nohotel-english-1_prices_.')).join(' '), /minimum stay policy of three nights/);
  // a text price would be reported
  assert.deepEqual(nhTextPrices('<p>Get in touch</p><p>Double room 60 € per night</p><p>NOHOTEL - LAMPES PIRATEN KOJE</p>'), ['Double room 60 € per night']);
});

test('nohotel: contact mail behind Cloudflare obfuscation, photos without icons', () => {
  assert.deepEqual(nhEmails(read('www.nohotel.de_.')), ['info@nohotel.de', 'doreen@inselnorden-lampe.com']);
  const imgs = nhImages([read('www.nohotel.de_nohotel-english-1_accomodation_.'), read('www.nohotel.de_.')]);
  assert.ok(imgs.length >= 15);
  assert.ok(imgs.every(u => /\/transf\/none\//.test(u)));
  assert.ok(!imgs.some(u => /i9658c79b20b03d61|i31de6d657e54cdab|i65f474847f0e9bd2/.test(u))); // 57 px icons, 240 px logo
});

test('nohotel: content', async () => {
  const c = await nohotelLampesPiratenKojeDranske.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'NoHotel - Lampes Piraten Koje');
  assert.equal(c.region, 'Dranske, Rügen');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /run by Doreen Lamprecht since 2020 and open all year/);
  assert.match(c.summary, /close to the Rügen Piraten water sports school in Dranske, which teaches kitesurfing/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Dorm room', 'Double room', 'Triple room', 'Holiday apartment']);
  assert.ok(c.optionalServices.includes('Service fee EUR 2 per day (water dispenser, coffee, tea)'));
  assert.equal(c.imageUrls.length, 22);
  assert.match(c.sourceText ?? '', /MOST BEAUTIFUL SURF AND KITESPOT ON RÜGEN/);
  assert.equal(nohotelLampesPiratenKojeDranske.confidence, 'low');
});
