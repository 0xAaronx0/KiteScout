// Kite HI Maui downwinder: replays kitehi.com fixtures recorded 2026-10-09 (fareharbor.com is never fetched).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kitehiMauiDownwinder, kitehiBookingLink, parseKitehiSlots,
} from '../../src/offers/adapters/kitehi-maui-downwinder.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { robotsAllows, parseRobots } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitehi-maui-downwinder');
process.env.OFFERS_FIXTURE_DIR = DIR;
const about = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('kitehi.com_about'))!), 'utf8');
const ctx = () => { const notes: string[] = []; return { notes, note: (t: string) => notes.push(t), incomplete: (r: string) => notes.push(r) }; };

test('kitehi: FareHarbor stays off-limits for our fetch layer (robots.txt 2026-10-09)', () => {
  const fh = parseRobots('User-agent: *\n\nDisallow: /embeds/api/\nDisallow: /embeds/checkin/\nDisallow: /embeds/partners/\nDisallow: /embeds/script/\nDisallow: /embeds/book/\nDisallow: /help/internal/\n\nDisallow: /fhbr-console/\n\nDisallow: /api/v1/\n');
  assert.equal(robotsAllows(fh, '/embeds/book/kitehi/items/49060/'), false);
  assert.equal(robotsAllows(fh, '/api/v1/companies/kitehi/items/'), false);
});

test('kitehi: booking link liveness gates the constant products', () => {
  assert.match(kitehiBookingLink(about) ?? '', /^https:\/\/fareharbor\.com\/embeds\/book\/kitehi\//);
  assert.deepEqual(parseKitehiSlots('<html><a href="/contact">Contact</a></html>'), []);
});

test('kitehi: two products, on request, no dates', async () => {
  const c = ctx();
  const slots = await kitehiMauiDownwinder.fetchSlots(c);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency, s.availability, s.startDate, s.endDate]), [
    ['half-day', 'Half day', 350, 'USD', 'on_request', null, null],
    ['full-day', 'Full day', 650, 'USD', 'on_request', null, null],
  ]);
  assert.ok(c.notes.some(n => /robots\.txt blocks fareharbor/.test(n)));
});

test('kitehi: content from kitehi.com', async () => {
  const c = await kitehiMauiDownwinder.fetchContent(ctx());
  assert.equal(contentProblem(c), null);
  assert.equal(c.country, 'United States');
  assert.equal(c.region, 'Hawaii');
  assert.equal(c.durationDays, 1);
  assert.equal(c.kiteLessons, true);
  assert.ok(c.imageUrls.length >= 20, `images ${c.imageUrls.length}`);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://kitehi.com/wp-content/uploads/') && !/\.png$/.test(u)));
  assert.equal(c.bookingUrl, 'https://fareharbor.com/embeds/book/kitehi/items/49060/');
  assert.match(c.summary, /half day \(USD 350\) or a full day \(USD 650\)/);
  assert.ok(!/[—–]/.test(c.summary), 'summary has no em/en dashes');
});
