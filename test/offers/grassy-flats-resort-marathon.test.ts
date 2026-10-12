// Grassy Flats Resort & Beach Club (Grassy Key, Marathon, Florida Keys): replays the pages recorded 2026-10-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  grassyFlatsResortMarathon, parseGfGeo, parseGfLessons, parseGfRooms,
} from '../../src/offers/adapters/grassy-flats-resort-marathon.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/grassy-flats-resort-marathon');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');

test('grassy flats: room cards', () => {
  const rooms = parseGfRooms(read('www.grassyflats.com_accommodations.'));
  assert.deepEqual(rooms.map(r => r.name), [
    'Wreckers House Standard Rooms', 'Wreckers House Galleon Suites', 'Humidor House King Suites',
    'Conch House Two Bedroom Suites', 'Conch House Three Bedroom Suites',
  ]);
  assert.ok(rooms[0].lines.includes('Available for guests ages 21+ only.'));
  assert.ok(rooms[3].lines.includes('2 night minimum stay.'));
});

test('grassy flats: lesson steps with prices (content)', () => {
  assert.deepEqual(parseGfLessons(read('www.grassyflats.com_kiteboarding-lessons-florida-keys.')).map(l => [l.name, l.price]), [
    ['Cable for Kiteboarding', '$249 · 1-2 people'],
    ['Intro to Kite Flying', '$249 / 1 · $299 / 2'],
    ['Kiteboarding Lessons', '$150/hr · 1 · $200/hr · 2'],
    ['Guided Downwinder - Coco Plum or Curry Hammock', '$200 without instruction · $300 with · per 5-person trip'],
  ]);
});

test('grassy flats: business location from the site settings', () => {
  assert.deepEqual(parseGfGeo(read('www.grassyflats.com_.')), { lat: 24.7599446, lng: -80.9537531 });
});

test('grassy flats: no slots (no rates on the site, Mews robots-disallowed)', async () => {
  const notes: string[] = [];
  const slots = await grassyFlatsResortMarathon.fetchSlots({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /mews/i);
});

test('grassy flats: content', async () => {
  const c = await grassyFlatsResortMarathon.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Grassy Flats Resort & Beach Club');
  assert.equal(c.country, 'United States');
  assert.deepEqual(c.spotCoords, { lat: 24.7599446, lng: -80.9537531 });
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /Matt Sexton/);
  assert.match(c.summary, /November to April .* USD 150 per hour for one rider and USD 200 for two/);
  assert.equal(c.rooms.length, 5);
  assert.deepEqual(c.rooms[0].features, ['Available for guests ages 21+ only']);
  assert.equal(c.imageUrls.length, 27);
  assert.ok(c.imageUrls.every(u => /^https:\/\/static\.wixstatic\.com\/media\/[^/]+$/.test(u)));
});
