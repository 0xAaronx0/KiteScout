// Aaron 2026-10-26: a listing the app shows must have at least one photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isShowable } from '../../src/offers/ingest.js';

test('isShowable: only rows with at least one image are visible', () => {
  assert.equal(isShowable(0), false);
  assert.equal(isShowable(1), true);
  assert.equal(isShowable(12), true);
});

test('ingest writes is_active from the image count on both write paths', () => {
  const src = readFileSync(new URL('../../src/offers/ingest.ts', import.meta.url), 'utf8');
  // the content upsert: hidden until images exist
  assert.match(src, /rooms: roomsWithPrices\(content, slots, today, lastPublished\), is_active: isShowable\(before\.length\) \}/);
  // the image update: visibility follows the stored images
  assert.match(src, /update\(\{ images: noNul\(images\), is_active: isShowable\(images\.length\) \}\)/);
});
