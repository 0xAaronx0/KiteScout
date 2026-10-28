// Haugastøl Turistsenter (snowkite base, Hardangervidda): replays the six /en/ pages recorded 2026-10-28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { haugastolTuristsenterHardangervidda, hgImages, hgLines, parseHgRooms } from '../../src/offers/adapters/haugastol-turistsenter-hardangervidda.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/haugastol-turistsenter-hardangervidda');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };

test('haugastol: room cards with their detail pairs', () => {
  const rooms = parseHgRooms(hgLines(read('www.haugastol.no_en_accommodation.')));
  assert.deepEqual(rooms.map(r => r.name), ['Type A', 'Type B', 'Type D', 'Mountain room (shared)']);
  assert.ok(rooms[0].features.includes('Capacity: 1-4 guests (1 bunk + two sofa beds)'));
  assert.ok(rooms[3].features.includes('Meals: can only be booked with half board (dinner and breakfast)'));
  for (const r of rooms) assert.ok(!/[–—]/.test(`${r.description} ${r.features.join(' ')}`), r.name);
});

test('haugastol: images come from /images/, never the robots-blocked /_next/ proxy', () => {
  const imgs = hgImages([read('www.haugastol.no_en_kite-course.'), read('www.haugastol.no_en_snowkiting.')]);
  assert.ok(imgs.length >= 10);
  for (const u of imgs) assert.match(u, /^https:\/\/www\.haugastol\.no\/images\//);
  assert.ok(imgs.includes('https://www.haugastol.no/images/00/00/89-0168f4b4b6-2048.jpg')); // 2048 preferred over 1024
  assert.ok(!imgs.some(u => /eco-lighthouse|\/00\/03\/26-/.test(u)));
});

test('haugastol: no prices on the site -> no slots, no note', async () => {
  notes.length = 0;
  const slots = await haugastolTuristsenterHardangervidda.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
});

test('haugastol: content', async () => {
  const c = await haugastolTuristsenterHardangervidda.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Norway');
  assert.equal(c.region, 'Hardangervidda');
  assert.match(c.summary, /Kitekurs\.no and Vindskolen\.no run weekend snowkite courses every winter weekend from the hotel with kite gear included/);
  assert.match(c.summary, /often snow from late October to late May, best from February to April/);
  assert.ok(c.optionalServices.includes('Dinner NOK 490, breakfast NOK 210 (pre-book 2 days ahead, main seasons)'));
  assert.ok(c.optionalServices.some(s => /^Winter package: two nights with dinner Saturday evening/.test(s)));
  assert.equal(c.imageUrls.length, 28);
  assert.ok(!/[–—]/.test(c.summary));
  assert.deepEqual(haugastolTuristsenterHardangervidda.disciplines, ['snowkite']);
  assert.equal(haugastolTuristsenterHardangervidda.operator.contactEmail, 'mail@haugastol.no');
});
