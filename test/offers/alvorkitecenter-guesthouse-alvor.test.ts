// AlvorKiteCenter Guesthouse (Alvor): replays the pages recorded 2026-10-12. Content only; no room rates on the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  alvorkitecenterGuesthouseAlvor, akcList, parseAkcPacks,
} from '../../src/offers/adapters/alvorkitecenter-guesthouse-alvor.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/alvorkitecenter-guesthouse-alvor');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const home = read('alvorkitecenter.com_.');
const ctx = { note: () => {}, incomplete: () => {} };

test('akc: guesthouse room options + facilities from the <br> lists', () => {
  assert.deepEqual(akcList(home, /^Room Options:?$/i), ['Family Room', 'Double Room', 'Triple Room', 'Suite']);
  const fac = akcList(home, /^Facilities:?$/i);
  assert.equal(fac.length, 4);
  assert.match(fac[0], /^Air conditioning, Wi-Fi, satellite TV, and mini-bars in each room/);
});

test('akc: kite packs = 4 levels, each with 7 nights Premium Room, no prices in the include lists', () => {
  const packs = parseAkcPacks(home);
  assert.deepEqual(packs.map(p => p.level), ['Level 1', 'Level 2', 'Level 3', 'Level 4']);
  assert.ok(packs.every(p => p.includes.includes('7 nights Premium Room')));
  assert.ok(packs.every(p => p.includes.every(i => !/euros|Prices/i.test(i))));
  assert.equal(packs[3].audience, 'For Independent riders');
  assert.ok(packs[3].includes.includes('25% off at any other activities with our school'));
});

test('akc: no slots (no room rates, Amenitiz engine 403), with a run note', async () => {
  const notes: string[] = [];
  const slots = await alvorkitecenterGuesthouseAlvor.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /price on request/);
  assert.equal(alvorkitecenterGuesthouseAlvor.confidence, 'low');
});

test('akc: content', async () => {
  const c = await alvorkitecenterGuesthouseAlvor.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'AlvorKiteCenter Guesthouse');
  assert.equal(c.country, 'Portugal');
  assert.equal(c.spot, 'Alvor');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /family, double and triple rooms and a suite with air conditioning/);
  assert.match(c.summary, /weekly kite packs with 7 nights in the guesthouse/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Family Room', 'Double Room', 'Triple Room', 'Suite']);
  assert.deepEqual(c.rooms[0].features, ['Air conditioning', 'Wi-Fi', 'Satellite TV', 'Minibar']);
  assert.deepEqual(c.includedServices.slice(4), ['Shared kitchen', 'Veranda', 'Jacuzzi and lounge area']);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.imageUrls.length, 30);
  assert.match(c.imageUrls[0], /\/2025\/04\/jacuzziroom\.jpg$/);
  assert.ok(c.imageUrls.every(u => !/logo|wave|burguer|\.png$/i.test(u)));
  assert.ok(!/toto|gambl/i.test(c.sourceText ?? ''));
});
