// gallery thumbnails (Aaron 2026-10-29: pre-generate and store): <name>.thumb.webp next to the original, referenced by thumb_path
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  THUMB_HEIGHT, THUMB_WIDTH, createThumb, mergeThumbPaths, needsThumb, renderThumb, thumbPathFor, withThumbPath,
  type ThumbUploader,
} from '../../src/lib/thumbs.js';

async function photo(w = 1280, h = 853): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgb(20,120,200)"/><stop offset="1" stop-color="rgb(240,180,80)"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w / 3}" cy="${h / 2}" r="${h / 4}" fill="rgb(250,250,250)"/></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 75 }).toBuffer();
}

test('thumbPathFor: same folder, <name>.thumb.webp', () => {
  assert.equal(thumbPathFor('cruise-offers/p1/sardinia/3.webp'), 'cruise-offers/p1/sardinia/3.thumb.webp');
  assert.equal(thumbPathFor('cruise-offers/p1/s/a0-1a2b3c4d.webp'), 'cruise-offers/p1/s/a0-1a2b3c4d.thumb.webp');
  assert.equal(thumbPathFor('packages/stay/x-site-y/ac-12-Ab.jpg'), 'packages/stay/x-site-y/ac-12-Ab.thumb.webp');
  // a dot in a folder name is not an extension
  assert.equal(thumbPathFor('packages/stay/v1.2/photo'), 'packages/stay/v1.2/photo.thumb.webp');
  // already a thumb: unchanged (createThumb refuses it, so an original is never overwritten)
  assert.equal(thumbPathFor('a/b/3.thumb.webp'), 'a/b/3.thumb.webp');
});

test('renderThumb: 160x140 WebP cover crop, a few KB', async () => {
  const out = await renderThumb(await photo());
  const m = await sharp(out).metadata();
  assert.equal(m.format, 'webp');
  assert.equal(m.width, THUMB_WIDTH);
  assert.equal(m.height, THUMB_HEIGHT);
  assert.ok(out.byteLength < 10_000, `thumb is ${out.byteLength} B`);
});

test('createThumb: uploads to the derived path and returns it', async () => {
  const calls: Array<{ path: string; bytes: number }> = [];
  const upload: ThumbUploader = async (path, buf) => { calls.push({ path, bytes: buf.byteLength }); return { error: null }; };
  const tp = await createThumb(await photo(), 'cruise-offers/p/o/0.webp', upload);
  assert.equal(tp, 'cruise-offers/p/o/0.thumb.webp');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'cruise-offers/p/o/0.thumb.webp');
});

test('failure omits thumb_path: unreadable image, upload error, thumb-looking path', async () => {
  const ok: ThumbUploader = async () => ({ error: null });
  const fails: ThumbUploader = async () => ({ error: { message: 'bucket down' } });
  const throws: ThumbUploader = async () => { throw new Error('network'); };
  assert.equal(await createThumb(Buffer.from('not an image'), 'a/0.webp', ok), null);
  assert.equal(await createThumb(await photo(), 'a/0.webp', fails), null);
  assert.equal(await createThumb(await photo(), 'a/0.webp', throws), null);
  assert.equal(await createThumb(await photo(), 'a/0.thumb.webp', ok), null);

  const img = { path: 'a/0.webp', source_url: 'https://x/y.jpg', sort: 0, caption: null };
  const kept = withThumbPath(img, null);
  assert.deepEqual(kept, img);
  assert.equal('thumb_path' in kept, false);
  assert.deepEqual(withThumbPath(img, 'a/0.thumb.webp'), { ...img, thumb_path: 'a/0.thumb.webp' });
});

test('mergeThumbPaths: adds only thumb_path, keeps order, length and every other key', () => {
  const current = [
    { path: 'o/a1-x.webp', source_url: 'u1', sort: 0, caption: 'Boat', rights: { status: 'provider_site' }, room: 'Double' },
    { path: 'o/a0-y.webp', source_url: 'u2', sort: 1, caption: null, fallback: true },
    { path: 'o/2.webp', source_url: 'u3', sort: 2, thumb_path: 'o/2.thumb.webp' },
    { source_url: 'u4', sort: 3 }, // no path: left alone
    { path: 'o/new-from-concurrent-apply.webp', source_url: 'u5', sort: 4 }, // not in the thumb map: left alone
  ];
  const before = structuredClone(current);
  const thumbs = new Map([
    ['o/a1-x.webp', 'o/a1-x.thumb.webp'],
    ['o/a0-y.webp', 'o/a0-y.thumb.webp'],
    ['o/2.webp', 'o/2.OTHER.webp'], // already thumbed: must not be overwritten
    ['o/gone.webp', 'o/gone.thumb.webp'], // dropped by a concurrent apply: must not come back
  ]);
  const { images, added } = mergeThumbPaths(current, thumbs);
  assert.equal(added, 2);
  assert.equal(images.length, current.length);
  assert.deepEqual(images.map(i => i.source_url), ['u1', 'u2', 'u3', 'u4', 'u5']);
  assert.deepEqual(images[0], { ...before[0], thumb_path: 'o/a1-x.thumb.webp' });
  assert.deepEqual(images[1], { ...before[1], thumb_path: 'o/a0-y.thumb.webp' });
  assert.deepEqual(images[2], before[2]);
  assert.deepEqual(images[3], before[3]);
  assert.deepEqual(images[4], before[4]);
  // the input is not mutated
  assert.deepEqual(current, before);
  // idempotent: a second merge adds nothing
  assert.equal(mergeThumbPaths(images, thumbs).added, 0);
});

test('needsThumb: string path and no thumb_path', () => {
  assert.equal(needsThumb({ path: 'a/0.webp' }), true);
  assert.equal(needsThumb({ path: 'a/0.webp', thumb_path: 'a/0.thumb.webp' }), false);
  assert.equal(needsThumb({ path: '' }), false);
  assert.equal(needsThumb({ source_url: 'x' }), false);
  assert.equal(needsThumb(null), false);
});
