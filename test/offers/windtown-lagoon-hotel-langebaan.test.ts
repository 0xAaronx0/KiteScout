// Windtown Lagoon Hotel (Langebaan, South Africa): replays the one-page site recorded 2026-10-12 (fixture trimmed:
// script/style bodies dropped). Content only: the STAAH booking engine host refused us (403), so no slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { windtownLagoonHotelLangebaan, parseWtRooms } from '../../src/offers/adapters/windtown-lagoon-hotel-langebaan.js';
import { contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/windtown-lagoon-hotel-langebaan');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('windtown: room cards (name, persons, beds, floor)', () => {
  assert.deepEqual(parseWtRooms(read('www.windtown-sa.com_.')).map(r => [r.name, r.persons, r.beds, r.floor]), [
    ['Basic Double Rooms', 2, '1 double bed', 'Ground floor'],
    ['Standard double rooms', 2, '1 double bed', 'Ground floor'],
    ['Standard twin rooms', 2, '2 single beds', 'Ground floor'],
    ['Double deluxe rooms', 2, '1 double bed', 'First floor'],
    ['Triple rooms - single beds', 3, '3 single beds', 'Ground floor'],
    ['Triple rooms - Double & Single', 3, '1 double bed & 1 single bed', 'Ground floor'],
  ]);
});

test('windtown: no slots (price on request), with a note', async () => {
  assert.deepEqual(await windtownLagoonHotelLangebaan.fetchSlots(ctx), []);
  assert.ok(notes.some(n => /mybookingsite\.io answered 403/.test(n)));
  assert.equal(windtownLagoonHotelLangebaan.confidence, 'low');
});

test('windtown: content (Langebaan only, not the Cumbuco sister hotel)', async () => {
  const c = await windtownLagoonHotelLangebaan.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Windtown Lagoon Hotel');
  assert.equal(c.country, 'South Africa');
  assert.equal(c.spot, 'Langebaan');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /IKO certified since 2001/);
  assert.match(c.summary, /kite yoga camp \(13-20 Dec 2026\)/);
  assert.doesNotMatch(`${c.summary} ${c.bookingUrl}`, /Cumbuco|windtownbeachdirect/);
  assert.match(c.bookingUrl ?? '', /^https:\/\/www\.mybookingsite\.io\/inst\/#home\?propertyId=/);
  assert.ok(c.optionalServices.some(s => /RACK-RATE-2026-27-Season\.pdf/.test(s)));
  assert.equal(c.rooms.length, 6);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls.every(u => /windtown-sa\.com\/wp-content\/uploads\//.test(u) && !/-\d+x\d+\./.test(u)));
});
