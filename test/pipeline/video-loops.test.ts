import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LOOP_HEIGHT, LOOP_SECONDS, LOOP_WIDTH, loopArgs, loopKeyFor, loopPathsFor, stillArgs } from '../../src/lib/video-loops.js';

const url = 'https://anthkvmnnruranachhgf.supabase.co/storage/v1/object/public/cruise-videos/cruise-offers/x/hero-8d2dd67c.mp4';

test('loopKeyFor: first 16 hex of sha256(url), trimmed, so the product can derive the same path', () => {
  assert.equal(loopKeyFor(url), createHash('sha256').update(url).digest('hex').slice(0, 16));
  assert.equal(loopKeyFor(`  ${url} `), loopKeyFor(url));
  assert.match(loopKeyFor(url), /^[0-9a-f]{16}$/);
  assert.notEqual(loopKeyFor(url), loopKeyFor(url.replace('8d2dd67c', '00000000')));
});

test('loopKeyFor: shared test vector with KCS tests/unit/hero-video-preview.test.ts', () => {
  assert.equal(loopKeyFor(url.replace('/x/hero-8d2dd67c.mp4', '/110cfdb1-7c25-4924-9716-c78c48c69bbd/kite-safari-canary-islands-catamaran-3-5-or-7-nights/hero-8d2dd67c.mp4')), 'a11c4aa71aa3c742');
});

test('loopPathsFor: loop and still side by side under loops/', () => {
  const { key, video, still } = loopPathsFor(url);
  assert.equal(video, `loops/${key}.mp4`); assert.equal(still, `loops/${key}.jpg`);
});

test('loopArgs / stillArgs: muted 5 s at 208x160 cover crop, faststart; still from the same moment', () => {
  const a = loopArgs('in.mp4', 'out.mp4');
  assert.deepEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4), ['-ss', '1', '-t', String(LOOP_SECONDS)]);
  assert.ok(a.includes('-an') && a.includes('+faststart') && a.includes('baseline'));
  assert.ok(a.some(x => x.startsWith(`scale=${LOOP_WIDTH}:${LOOP_HEIGHT}:force_original_aspect_ratio=increase,crop=${LOOP_WIDTH}:${LOOP_HEIGHT}`)));
  assert.equal(a.at(-1), 'out.mp4');
  assert.deepEqual(loopArgs('in.mp4', 'o.mp4', 0).slice(4, 6), ['-ss', '0']);
  const s = stillArgs('in.mp4', 'still.jpg');
  assert.ok(s.includes('-frames:v') && s.at(-1) === 'still.jpg');
});
