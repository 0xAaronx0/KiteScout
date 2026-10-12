// No 22 Riders' Inn (Akyaka): replays the pages recorded 2026-10-12. Content only; the site prints no prices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { no22RidersInnAkyaka, parseN22Coords, parseN22Icons } from '../../src/offers/adapters/no22-riders-inn-akyaka.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/no22-riders-inn-akyaka');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('n22: ROOMS / FACILITIES icon lists', () => {
  const icons = parseN22Icons(read('no22ridersinn.com_accommodation_.'));
  assert.deepEqual(icons.rooms, ['Air conditioning', 'Wi-Fi', 'Hot water', 'Hair dryer']);
  assert.ok(['Parking', 'Garden', 'Pool', 'Restaurant', 'Bar', 'Storage', 'Airport transfer'].every(f => icons.facilities.includes(f)));
});

test('n22: coordinates from the contact page map embed', () => {
  assert.deepEqual(parseN22Coords(read('no22ridersinn.com_contact_.')), { lat: 37.05147, lng: 28.32598 });
  assert.equal(parseN22Coords('<iframe src="https://www.google.com/maps/embed?pb=!2d28.1!3d37.1!2sElsewhere"></iframe>'), null);
});

test('n22: no slots (no prices, contact form only), with a run note', async () => {
  const notes: string[] = [];
  const slots = await no22RidersInnAkyaka.fetchSlots({ note: t => notes.push(t), incomplete: () => {} });
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.match(notes[0], /price on request/);
  assert.equal(no22RidersInnAkyaka.confidence, 'low');
});

test('n22: content', async () => {
  const c = await no22RidersInnAkyaka.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, "No 22 Riders' Inn");
  assert.equal(c.country, 'Turkey');
  assert.equal(c.spot, 'Akyaka');
  assert.deepEqual(c.spotCoords, { lat: 37.05147, lng: 28.32598 });
  assert.match(c.summary, /14-room inn in the centre of Akyaka on Gökova Bay/);
  assert.match(c.summary, /9-hour beginner course/);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.equal(c.rooms.length, 1);
  assert.equal(c.imageUrls.length, 28);
  assert.ok(c.imageUrls.every(u => /\/uploads\/2025\/07\/no22riders-konaklama-\d+\.jpg$/.test(u)));
});
