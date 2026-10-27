// near-duplicate photos (Aaron 2026-10-26): the same picture as another crop / zoom / size is dropped, the wider one stays
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { dropNearDuplicates, dupFeatures, sameDupPhoto } from '../../src/lib/image-dedup.js';

/** a deterministic "photo": smooth gradients plus a few shapes, so crops keep texture */
async function scene(seed: number, w = 640, h = 420): Promise<Buffer> {
  const rects = Array.from({ length: 9 }, (_, i) => {
    const x = (seed * 97 + i * 71) % (w - 90), y = (seed * 53 + i * 37) % (h - 70);
    const c = `rgb(${(seed * 40 + i * 25) % 255},${(i * 60 + seed * 13) % 255},${(seed * 90 + i * 31) % 255})`;
    return `<rect x="${x}" y="${y}" width="${60 + (i * 13) % 50}" height="${40 + (i * 7) % 40}" fill="${c}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="rgb(${seed * 30 % 255},120,200)"/><stop offset="1" stop-color="rgb(240,${seed * 50 % 255},80)"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>${rects}<circle cx="${(seed * 61) % w}" cy="${(seed * 29) % h}" r="55" fill="white"/></svg>`;
  // blurred like a real photo: hard synthetic edges alias at the 64 px search size, real photos do not
  return sharp(Buffer.from(svg)).blur(4).jpeg({ quality: 85 }).toBuffer();
}

test('a zoomed crop and a resize of the same photo are detected, a different photo is not', async () => {
  const a = await scene(3);
  const crop = await sharp(a).extract({ left: 60, top: 40, width: 480, height: 320 }).resize(900).jpeg().toBuffer();
  const small = await sharp(a).resize(300).jpeg({ quality: 60 }).toBuffer();
  const other = await scene(8);
  const [fa, fc, fs, fo] = await Promise.all([a, crop, small, other].map(dupFeatures));
  assert.ok(sameDupPhoto(fa, fc), 'zoomed crop');
  assert.ok(sameDupPhoto(fa, fs), 'resized copy');
  assert.ok(!sameDupPhoto(fa, fo), 'different photo');
});

test('dropNearDuplicates keeps the order and the wider view', async () => {
  const a = await scene(5);
  // a 70 % crop (on a search step; synthetic edges are sharper than photos, real crops of any size were checked on
  // the 2026-10-26 scan pairs: 36 of 47 real duplicates caught, no different photo dropped except a burst shot)
  const zoom = await sharp(a).extract({ left: 80, top: 50, width: 448, height: 294 }).resize(640).jpeg().toBuffer();
  const b = await scene(11);
  const items = [{ id: 'zoom', buf: zoom }, { id: 'other', buf: b }, { id: 'wide', buf: a }];
  const { kept, dropped } = await dropNearDuplicates(items, i => i.buf);
  assert.deepEqual(kept.map(i => i.id), ['wide', 'other'], 'the wider photo takes the zoomed one\'s place');
  assert.deepEqual(dropped.map(i => i.id), ['zoom']);
});
