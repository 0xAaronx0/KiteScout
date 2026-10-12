// Surfescape Fuerteventura (Lajares): replays /destinations/fuerteventura and / recorded 2026-10-12 (script bodies
// except JSON-LD and the Framer handover data, styles, SVGs and inline style attributes trimmed). Cloudbeds is not called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  surfescapeLajares, framerRichTextLines, parseSeAmenities, parseSeRooms, parseSeSchool, sePrices,
} from '../../src/offers/adapters/surfescape-lajares.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/surfescape-lajares');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };
const page = read('www.surfescape.com_destinations_fuerteventura.');

test('surfescape: Framer rich text decoder', () => {
  assert.deepEqual(framerRichTextLines('[1,[4,"p",{"dir":"auto"},[5,"Intro"]],[4,"ul",{},[4,"li",{},[4,"p",null,[5,"3 days: "],[4,"strong",null,[5,"€395"]]]]]]'),
    ['Intro', '3 days: €395']);
});

test('surfescape: room cards and shared amenities', () => {
  assert.deepEqual(parseSeRooms(page).map(r => r.name), ['Apartment', 'Casa Wood Studio', 'Large double room', 'Standard Double Room', 'Two bedroom villa']);
  assert.equal(parseSeRooms(page)[4].description, 'Perfect for up to 4 guests, large garden and space for the furry friend.');
  assert.deepEqual(parseSeAmenities(page), ['Wifi modem', 'Private bathroom', 'Private balcony or terrace', 'Work desk', 'Air conditioning or fan']);
});

test('surfescape: kite lesson prices from the CMS handover data', () => {
  const school = parseSeSchool(page);
  const beg = school.find(x => /^Beginner kite/.test(x.title))!;
  const int = school.find(x => /^Intermediate kite/.test(x.title))!;
  assert.deepEqual(sePrices(beg.lines), [{ label: '3 days', amount: 395 }, { label: '4 days', amount: 505 }, { label: '5 days', amount: 615 }]);
  assert.deepEqual(sePrices(int.lines).map(x => x.amount), [175, 295, 405, 515, 625]);
  assert.ok(school.some(x => /surf and yoga camp/.test(x.title) && x.lines.includes('private double 875€/week/person')));
});

test('surfescape: no slots (no room prices, Cloudbeds 403) -> price on request', async () => {
  const slots = await surfescapeLajares.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.ok(notes.some(n => /Cloudbeds/.test(n)));
});

test('surfescape: content', async () => {
  const c = await surfescapeLajares.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Surfescape Fuerteventura');
  assert.equal(c.region, 'Canary Islands');
  assert.equal(c.spot, 'Lajares, Fuerteventura');
  assert.deepEqual(c.spotCoords, { lat: 28.681183, lng: -13.943622 });
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate']);
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /beginner courses \(kite control, body dragging, water start\) cost EUR 395 for 3 days/);
  assert.match(c.summary, /north shore is a 5-minute drive away/);
  assert.ok(c.optionalServices.includes('Beginner kite lessons (3 days EUR 395, 4 days EUR 505, 5 days EUR 615)'));
  assert.equal(c.rooms.length, 5);
  assert.match(c.sourceText ?? '', /Early booker 10% off, summer 27\. "EARLY" Fuerteventura May 2027/);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /^https:\/\/framerusercontent\.com\/images\/[A-Za-z0-9]+\.(jpe?g|webp)$/.test(u)));
});
