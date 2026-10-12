// OysterRock (Langebaan, South Africa): replays the home and booking pages recorded 2026-10-12 (fixtures trimmed,
// Maps key redacted). Content only: the site prints no prices (Airbnb links only), so no slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { oysterrockLangebaan, parseOrPads } from '../../src/offers/adapters/oysterrock-langebaan.js';
import { contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/oysterrock-langebaan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('or: five pads with sizes', () => {
  assert.deepEqual(parseOrPads(read('oysterrock.com_.')).map(p => [p.name, p.sizeM2, p.sleeps]), [
    ['Pad one', null, 2], ['Pad two', 42, 2], ['Pad three', 28, 2], ['Pad four', 62, 4], ['Pad five', 44, 2],
  ]);
});

test('or: no slots (price on request), with a note', async () => {
  assert.deepEqual(await oysterrockLangebaan.fetchSlots(ctx), []);
  assert.ok(notes.some(n => /Airbnb/.test(n)));
  assert.equal(oysterrockLangebaan.confidence, 'low');
});

test('or: content', async () => {
  const c = await oysterrockLangebaan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'OysterRock self catering by the beach');
  assert.equal(c.country, 'South Africa');
  assert.equal(c.spot, 'Langebaan');
  assert.match(c.summary, /5 renovated self-catering apartments/);
  assert.match(c.summary, /up to 12 guests/);
  assert.ok(c.includedServices.includes('Lockable kite gear store per unit'));
  assert.equal(c.rooms.length, 5);
  assert.ok(c.rooms.every(r => !/[–—]/.test(r.description ?? '')));
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/oysterrock\.com\/wp-content\/uploads\//.test(u) && !/google-hotels|airbnb|-\d+x\d+\./.test(u)));
});
