// Pandanus Resort (Mui Ne, Vietnam): replays the resort and Source Kiteboarding pages recorded 2026-10-12 (fixtures
// trimmed: script/style bodies dropped). Content only: rates sit in the SynXis engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pandanusResortMuiNe, parsePrCoords, parsePrRooms, parseSource } from '../../src/offers/adapters/pandanus-resort-mui-ne.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pandanus-resort-mui-ne');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('pandanus: room slider (7 types with size, bedrooms, view, beds)', () => {
  const rooms = parsePrRooms(read('www.pandanusresort.com_.'));
  assert.deepEqual(rooms.map(r => [r.name, r.sizeM2]), [
    ['Signature Suite', 83], ['Bungalow', 53], ['Superior Comfort', 42], ['Superior Deluxe', 32],
    ['Superior Standard', 30], ['Family Suite', 53], ['Executive Suite', 76],
  ]);
  assert.match(rooms[1].text ?? '', /private outdoor baths and showers/);
});

test('pandanus: map pin from the contact page embed', () => {
  assert.deepEqual(parsePrCoords(read('www.pandanusresort.com_contact_.')), { lat: 10.94500338921416, lng: 108.29446007462968 });
});

test('pandanus: Source Kiteboarding names the resort as its watersports school location', () => {
  const s = parseSource(read('www.sourcekiteboarding.com_.'), read('sourcekiteboarding.com_services_accommodation_.'));
  assert.equal(s.atPandanus, true);
  assert.ok(s.facts.includes('Watersports School Pandanus Resort, Khu Pho 5'));
  assert.ok(s.facts.some(f => /^Pandanus Resort Just a few steps from our watersports center/.test(f)));
});

test('pandanus: no slots (price on request), no network', async () => {
  const before = requestsSoFar();
  const slots = await pandanusResortMuiNe.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.ok(notes.some(n => /SynXis/.test(n)));
});

test('pandanus: content', async () => {
  const c = await pandanusResortMuiNe.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pandanus Resort');
  assert.equal(c.country, 'Vietnam');
  assert.equal(c.spot, 'Mui Ne');
  assert.deepEqual(c.spotCoords, { lat: 10.94500338921416, lng: 108.29446007462968 });
  assert.match(c.summary, /Source Kiteboarding runs its watersports school on the resort's beach/);
  assert.match(c.summary, /from 30 m² superior rooms to 83 m² suites/);
  assert.deepEqual(c.includedServices, ['Mui Ne walking tour', 'Daily yoga and tai chi classes', 'In-room minibar snacks']);
  assert.equal(c.rooms.length, 7);
  assert.equal(c.imageUrls.length, 20);
  assert.ok(c.imageUrls.every(u => /^https:\/\/www\.pandanusresort\.com\/wp-content\/uploads\//.test(u) && !/1080x1920|logo/i.test(u)));
  assert.match(c.bookingUrl ?? '', /be\.synxis\.com\/\?chain=9005&hotel=60700/);
});
