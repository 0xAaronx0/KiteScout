import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { anthropic } from '../../src/lib/anthropic.js';
import { supabase } from '../../src/lib/supabase.js';
import { curateAndStoreImages, orderHero } from '../../src/lib/images.js';

// A real photo stand-in: noise, so the JPEG is well above the 3 KB "too tiny" floor.
const photo = (): Promise<Buffer> =>
  sharp(randomBytes(800 * 600 * 3), { raw: { width: 800, height: 600, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();

/** Serves the given images (robots.txt 404 = allowed), fakes the bucket, records the vision requests. */
function harness(t: import('node:test').TestContext, images: Record<string, Buffer>, reply: string) {
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = String(input);
    const buf = images[url];
    return buf ? new Response(buf, { headers: { 'content-type': 'image/jpeg' } }) : new Response('', { status: 404 });
  });
  const uploads: string[] = [];
  const bucket = { upload: async (path: string) => { uploads.push(path); return { error: null }; } };
  // `storage` is a prototype getter, which t.mock.getter cannot reach: shadow it on the instance for this test.
  Object.defineProperty(supabase, 'storage', { configurable: true, get: () => ({ getBucket: async () => ({ data: {} }), from: () => bucket }) });
  t.after(() => { delete (supabase as { storage?: unknown }).storage; });
  const calls: Array<Record<string, unknown>> = [];
  t.mock.method(anthropic.messages, 'create', async (params: Record<string, unknown>) => {
    calls.push(params);
    return { model: 'm', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: reply }] };
  });
  return { uploads, calls };
}

const STAY = { offerLabel: 'kite guesthouse', wanted: 'the HOUSE', heroOrder: ['exterior', 'interior', 'spot'] as const };
const run = (urls: string[], brief?: { offerLabel: string; wanted: string; heroOrder?: readonly ('exterior' | 'interior' | 'spot' | 'other')[] }) => curateAndStoreImages({
  candidateUrls: urls, providerId: 'p', slug: 's', sourceUrl: 'https://img.example/', context: 'Test camp', pathPrefix: 'test/p/s',
  ...(brief ? { brief: { ...brief, heroOrder: brief.heroOrder ? [...brief.heroOrder] : undefined } } : {}),
});

// Nordsee 2026-11-02: with DeepSeek thinking on, the reasoning used all 1024 tokens, no JSON came back and every
// listing fell back to largest-by-area without captions.
test('curateAndStoreImages: the vision request turns reasoning off and its captions are stored', async t => {
  const a = 'https://img.example/a.jpg', b = 'https://img.example/b.jpg';
  const h = harness(t, { [a]: await photo(), [b]: await photo() }, '[{"index": 1, "caption": "Dome at sunset"}, {"index": 0, "caption": "Kiter on the lagoon"}]');
  const stored = await run([a, b]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].thinking, { type: 'disabled' });
  assert.deepEqual(stored.map(s => [s.source_url, s.caption]), [[b, 'Dome at sunset'], [a, 'Kiter on the lagoon']]);
});

// The Sitelio house photo ("VipsJpeg: Invalid SOS parameters") only fails sharp's strict full decode; browsers show
// it. A cut-off JPEG fails the same way and stands in for it.
test('curateAndStoreImages: a JPEG that only fails the strict decode is still shown to vision and stored', async t => {
  const full = await photo();
  const cut = full.subarray(0, Math.floor(full.length * 0.7));
  await assert.rejects(sharp(cut).webp().toBuffer()); // the fixture really is broken for the default decoder
  const u = 'https://img.example/house.jpg';
  const h = harness(t, { [u]: cut }, '[{"index": 0, "caption": "House from outside"}]');
  const stored = await run([u]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(stored.map(s => [s.source_url, s.caption]), [[u, 'House from outside']]);
  assert.ok(h.uploads.includes('test/p/s/0.webp'));
});

// Aaron 2026-11-02: a stay opens with the house from outside (aerial too), else a room; the spot only third.
test('orderHero: exterior first, else interior, else spot; the rest keep the model order', () => {
  const p = (role: string | null) => ({ role: role as 'exterior' | 'interior' | 'spot' | 'other' | null });
  const order = ['exterior', 'interior', 'spot'] as const;
  const roles = (list: Array<{ role: string | null }>) => list.map(x => x.role);
  assert.deepEqual(roles(orderHero([p('spot'), p('interior'), p('exterior'), p('spot')], [...order])), ['exterior', 'spot', 'interior', 'spot']);
  assert.deepEqual(roles(orderHero([p('spot'), p('other'), p('interior')], [...order])), ['interior', 'spot', 'other']);
  assert.deepEqual(roles(orderHero([p('other'), p('spot')], [...order])), ['spot', 'other']);
  assert.deepEqual(roles(orderHero([p('spot'), p(null)], [])), ['spot', null]); // cruises, camps, tours: unchanged
  assert.deepEqual(roles(orderHero([p(null), p('other')], [...order])), [null, 'other']);
});

test('curateAndStoreImages: a stay brief asks for roles, puts the exterior first and stores the role', async t => {
  const [a, b, c] = ['spot', 'room', 'house'].map(n => `https://img.example/${n}.jpg`);
  const h = harness(t, { [a]: await photo(), [b]: await photo(), [c]: await photo() },
    '[{"index": 0, "caption": "Kiters on the lagoon", "role": "spot"}, {"index": 1, "caption": "Double room", "role": "interior"}, {"index": 2, "caption": "House from outside", "role": "exterior"}]');
  const stored = await run([a, b, c], STAY);
  const prompt = JSON.stringify(h.calls[0].messages);
  assert.match(prompt, /\\"role\\": \\"<exterior\|interior\|spot\|other>\\"/);
  assert.deepEqual(stored.map(s => [s.caption, s.role, s.sort]), [['House from outside', 'exterior', 0], ['Kiters on the lagoon', 'spot', 1], ['Double room', 'interior', 2]]);
});

test('curateAndStoreImages: without a hero order (cruise, camp, tour) the model order stays and no role is asked or stored', async t => {
  const [a, b] = ['spot', 'house'].map(n => `https://img.example/${n}.jpg`);
  const h = harness(t, { [a]: await photo(), [b]: await photo() }, '[{"index": 0, "caption": "Kiters", "role": "spot"}, {"index": 1, "caption": "House", "role": "exterior"}]');
  const stored = await run([a, b]);
  assert.doesNotMatch(JSON.stringify(h.calls[0].messages), /exterior\|interior/);
  assert.deepEqual(stored.map(s => [s.caption, s.role]), [['Kiters', undefined], ['House', undefined]]);
});
