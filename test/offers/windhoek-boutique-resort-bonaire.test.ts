// Windhoek Boutique Resort (Bonaire): replays the four /en pages recorded 2026-10-12 (script/style bodies trimmed,
// the Duda config script with PublicationDate kept). Content only: RoomRaccoon is robots-disallowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windhoekBoutiqueResortBonaire, whPublicationDate } from '../../src/offers/adapters/windhoek-boutique-resort-bonaire.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/windhoek-boutique-resort-bonaire');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('windhoek: no slots (RoomRaccoon robots.txt, no rates on the site)', async () => {
  const notes: string[] = [];
  const slots = await windhoekBoutiqueResortBonaire.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /RoomRaccoon robots\.txt/);
});

test('windhoek: site republished in 2026', () => {
  assert.equal(whPublicationDate(read('www.windhoekbonaire.com_en.')), 'Aug 28, 2026');
});

test('windhoek: content', async () => {
  const c = await windhoekBoutiqueResortBonaire.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Windhoek Boutique Resort Bonaire');
  assert.equal(c.country, 'Bonaire');
  assert.equal(c.spot, 'Kralendijk');
  assert.match(c.summary, /ten one-bedroom villas \(61 m², up to two guests\) and two two-bedroom villas \(83 m², up to four guests\)/);
  assert.match(c.summary, /founded the Kiteboarding Bonaire school in 2002/);
  assert.match(c.summary, /secure kite gear storage/);
  assert.match(c.summary, /Kiteboarding Bonaire and FX Kiteboarding/);
  assert.deepEqual(c.rooms.map(r => r.name), ['One-Bedroom Villa', 'Two-Bedroom Villa']);
  assert.ok(c.rooms[1].features.includes('Walk-in closets'));
  assert.ok(c.includedServices.includes('Secure kite gear storage'));
  assert.equal(c.imageUrls.length, 20);
  assert.ok(c.imageUrls.every(u => /^https:\/\/irp\.cdn-website\.com\/5f5c5714\/.*-1920w\.(jpe?g|webp)$/.test(u)));
  assert.match(c.sourceText!, /site published: Aug 28, 2026/);
});
