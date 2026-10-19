// NICEKITE lesson camp at The Beach House, Kaseda: replays /lesson-camp/ + /master/ recorded 2026-10-19.
// No package price is published -> no slots (price on request); the plan's presence is the liveness check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchNicekiteSlots, nicekiteLessonCampKaseda, parseNicekiteMaster, parseNicekitePlan } from '../../src/offers/adapters/nicekite-lesson-camp-kaseda.js';
import { contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/nicekite-lesson-camp-kaseda');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('nicekite: plan present, master course price', () => {
  assert.deepEqual(parseNicekitePlan(read('nicekite.jp_lesson-camp_')), { beachHousePlan: true, onRequest: true });
  assert.deepEqual(parseNicekitePlan('<div id="contentstxt"><p>マスターコース</p></div>'), { beachHousePlan: false, onRequest: false });
  assert.deepEqual(parseNicekiteMaster(read('nicekite.jp_master_')), { price: 55000, wetsuit: 1500 });
});

test('nicekite: no slots (price on request)', async () => {
  const notes: string[] = [];
  assert.deepEqual(await fetchNicekiteSlots({ note: t => notes.push(t) }), []);
  assert.match(notes[0], /no package price published/);
});

test('nicekite: content', async () => {
  const c = await nicekiteLessonCampKaseda.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot], ['camp', 3, 'Japan', 'Minamisatsuma, Kagoshima', 'Kaseda']);
  assert.match(c.summary, /Master course \(JPY 55,000 incl\. tax/);
  assert.match(c.summary, /no published price/);
  assert.ok(c.imageUrls.includes('https://nicekite.jp/wp-content/uploads/2025/06/hotelplan-tbh.png'));
  assert.ok(c.imageUrls.every(u => !/\/themes\//.test(u)));
  assert.ok(!/[–—]/.test(c.summary));
});
