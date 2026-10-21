// AIRJUNK kiteboarder stay at Sakai Beach, Tokoname: replays /kiteschool.html recorded 2026-10-21 (UTF-8 page; scripts,
// styles and the customer-portrait images stripped). The page says the school's 2026 bookings are closed until Feb 2027.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { airjunkTokoname, ajImages, ajSchoolClosed, buildAjSlots, fetchAjSlots, parseAirjunkContent, parseAjSchool } from '../../src/offers/adapters/airjunk-tokoname.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/airjunk-tokoname');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('airjunk.jp_kiteschool'))!), 'utf8');
const TODAY = '2026-10-21';

test('airjunk: stay prices (tax excluded), course menu, closure notice', () => {
  const s = parseAjSchool(html);
  assert.deepEqual(s.roomOnly, { price: 4000, tax: 'excluded' });
  assert.deepEqual(s.breakfast, { price: 4500, tax: 'excluded' });
  assert.deepEqual([s.closedYear, s.reopens], [2026, '2027-02']);
  assert.deepEqual(s.courses.map(c => [c.key, c.price]), [['private', 69000], ['1-day', 25000], ['3-day', 69000], ['7-day', 145000]]);
  assert.deepEqual([s.wetsuit, s.viewBath, s.parking, s.beachfront, s.kawagoe], [3000, 500, 500, true, true]);
  assert.equal(ajSchoolClosed(s, TODAY), true);
  assert.equal(ajSchoolClosed(s, '2027-02-01'), false);
});

test('airjunk: two undated stay slots, on request, closure in the text until Feb 2027', async () => {
  const slots = await fetchAjSlots(TODAY);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability]), [
    ['stay|room-only', null, null, 4000, 'JPY', 'per_night', 'person', 'on_request'],
    ['stay|breakfast', null, null, 4500, 'JPY', 'per_night', 'person', 'on_request'],
  ]);
  assert.match(slots[0].availabilityText!, /素泊まり 4000円\(税別\).*tax excluded.*2026 bookings are closed until February 2027/);
  const later = buildAjSlots(parseAjSchool(html), '2027-03-01');
  assert.doesNotMatch(later[0].availabilityText!, /closed/);
});

test('airjunk: parser throws when the beachfront facility disappears', () => {
  assert.throws(() => parseAirjunkContent('<body><p>素泊まり 4000円（税別）</p></body>', TODAY), /beachfront facility/);
});

test('airjunk: content', () => {
  const c = parseAirjunkContent(html, TODAY);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.country, c.region, c.spot, c.durationDays, c.kiteLessons, c.mealPlan, c.sourceUrl],
    ['accommodation', 'Japan', 'Tokoname, Aichi', 'Sakai Beach', null, true, 'breakfast optional', 'http://airjunk.jp/kiteschool.html']);
  assert.match(c.summary, /JPY 4,000 room only or JPY 4,500 with breakfast per night \(tax excluded\)/);
  assert.match(c.summary, /1 day JPY 25,000, 3 days JPY 69,000, 7 days JPY 145,000 \(tax included, gear included\)/);
  assert.match(c.summary, /2026 bookings are closed and reopen in February 2027; the stay is not mentioned as closed/);
  assert.ok(!/[–—]/.test(c.summary));
  assert.ok(c.optionalServices.some(s => /^1-day course.*JPY 25,000.*school bookings for 2026 closed, reopening February 2027/.test(s)));
  // no closure wording once February 2027 has come
  assert.doesNotMatch(parseAirjunkContent(html, '2027-02-10').summary, /closed/);
  assert.equal(c.imageUrls[0], 'http://airjunk.jp/kb1.jpg');
  assert.ok(c.imageUrls.includes('http://airjunk.jp/sakairobi1.jpg'));
  assert.ok(!c.imageUrls.some(u => /mori|LINE|button|DVD|liquid-force|tona-|okada|\.png$|\.gif$/i.test(u)));
});

test('airjunk: adapter fetchContent through the fixture', async () => {
  const c = await airjunkTokoname.fetchContent({ note: () => {}, incomplete: () => {} });
  assert.equal(contentProblem(c), null);
});

test('airjunk: image filter stops at the customer-voice section', () => {
  const h = '<img src="a.jpg"><img src="moriLINE1.jpg"><img src="b.png"><p>お客様の声</p><img src="okada1.jpg">';
  assert.deepEqual(ajImages(h), ['http://airjunk.jp/a.jpg']);
});
