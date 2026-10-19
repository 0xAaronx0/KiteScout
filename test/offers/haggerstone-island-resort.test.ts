// Haggerstone Island Resort: replays the kiteboarding, stay and contact pages recorded 2026-10-19 (content only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { haggImages, haggerstoneIslandResort, parseHaggVillas } from '../../src/offers/adapters/haggerstone-island-resort.js';
import { contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/haggerstone-island-resort');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('haggerstone: villas from /stay, the Light-House (in development) left out', () => {
  assert.deepEqual(parseHaggVillas(read('_stay')).map(v => v.name), ['Haus Mawu', 'Lagoon Hut', 'Kwilla Hut', 'Beach Hut']);
});

test('haggerstone: CSS background photos, no screenshot', () => {
  const imgs = haggImages(read('kiteboarding'));
  assert.equal(imgs.length, 4);
  assert.ok(imgs[0].startsWith('https://www.haggerstoneisland.com.au/files/media/thumbcache/'));
  assert.ok(!haggImages(read('_stay')).some(u => /Screen-Shot|Lighthouse/i.test(u)));
});

test('haggerstone: valid content, no slots (rates only in a PDF)', async () => {
  const c = await haggerstoneIslandResort.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.match(c.summary, /only resort on the reef that formally offers kiteboarding/);
  assert.match(c.summary, /5 individually designed beachfront villas \(one still in development\)/);
  assert.doesNotMatch(c.summary, /[–—]/);
  const before = requestsSoFar();
  assert.deepEqual(await haggerstoneIslandResort.fetchSlots(ctx), []);
  assert.equal(requestsSoFar(), before);
});
