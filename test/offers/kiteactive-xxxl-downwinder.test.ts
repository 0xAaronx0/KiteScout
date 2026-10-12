// KiteActive XXXL downwinder: replays fixtures recorded 2026-10-09 (WP page + booking-app trip JSON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  kiteactiveXxxlDownwinder, parseKiteactiveSlots, parseKiteactivePageVariants, kiteactiveTripSlug, type KaTripData,
} from '../../src/offers/adapters/kiteactive-xxxl-downwinder.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

// the fetch layer reads this per request, so setting it before the first adapter call is enough
const DIR = join(import.meta.dirname, '../fixtures/offers/kiteactive-xxxl-downwinder');
process.env.OFFERS_FIXTURE_DIR = DIR;

const ctx = () => { const notes: string[] = []; return { notes, note: (t: string) => notes.push(t), incomplete: (r: string) => notes.push(`INCOMPLETE ${r}`) }; };
const file = (prefix: string) => readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith(prefix))!), 'utf8');

test('kiteactive: slots from the booking-app JSON', async () => {
  const c = ctx();
  const slots = await kiteactiveXxxlDownwinder.fetchSlots(c);
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 3);
  const xxxl = slots.find(s => s.key === 'xxxl|2026-10-26')!;
  assert.equal(xxxl.price, 3599);
  assert.equal(xxxl.currency, 'EUR');
  assert.equal(xxxl.endDate, '2026-11-13');
  assert.equal(xxxl.priceBasis, 'person');
  assert.equal(xxxl.availability, 'available');
  assert.equal(xxxl.availabilityText, '6 spots left');
  assert.equal(xxxl.spotsLeft, 6);
  assert.deepEqual(slots.map(s => [s.unit, s.startDate, s.endDate, s.price]), [
    ['XXXL', '2026-10-26', '2026-11-13', 3599],
    ['Xplore', '2026-10-26', '2026-11-05', 1799],
    ['Adventure', '2026-11-05', '2026-11-13', 1899],
  ]);
  assert.ok(c.notes.some(n => /page says XXXL 23 days, booking app 19 days/.test(n)));
});

test('kiteactive: availability follows capacity.remaining', () => {
  const data = JSON.parse(file('vfrzgbipxdtlkprfgigj')) as KaTripData;
  const few = parseKiteactiveSlots({ ...data, capacity: { total: 6, booked: 4, remaining: 2 } });
  assert.ok(few.every(s => s.availability === 'limited' && s.spotsLeft === 2));
  const none = parseKiteactiveSlots({ ...data, capacity: { total: 6, booked: 6, remaining: 0 } });
  assert.ok(none.every(s => s.availability === 'sold_out' && s.availabilityText === 'Sold out'));
  const unknown = parseKiteactiveSlots({ ...data, capacity: null });
  assert.ok(unknown.every(s => s.availability === 'unknown'));
});

test('kiteactive: page variants and trip slug', () => {
  const html = file('www.kiteactive.com');
  assert.equal(kiteactiveTripSlug(html), 'brazil-downwind-2026');
  const v = parseKiteactivePageVariants(html);
  assert.deepEqual(v.map(x => [x.name, x.days, x.starts]), [
    ['XXXL Downwinder in Brazil', 23, ['2026-10-26']],
    ['Delta Adventure', 9, ['2026-11-05']],
    ['Mega Adventure São Luís', 14, ['2026-11-05']],
    ['Kitefest Baleia', 11, ['2026-10-26']],
  ]);
});

test('kiteactive: content', async () => {
  const c = await kiteactiveXxxlDownwinder.fetchContent(ctx());
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'XXXL Adventure Downwinder Brazil');
  assert.equal(c.kind, 'tour');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.spot, 'Cumbuco');
  assert.equal(c.durationDays, 19);
  assert.deepEqual(c.itinerarySpots.map(s => s.name), ['Cumbuco', 'Taiba', 'Flecheiras', 'Baleia', 'Ilha de Guajiru', 'Jericoacoara', 'Tatajuba', 'Parnaíba Delta', 'Arpoador']);
  assert.ok(c.includedServices.includes('Breakfast'));
  assert.ok(c.optionalServices.some(s => s.startsWith('Gear Rental: EUR 450')));
  assert.equal(c.mealPlan, 'breakfast');
  assert.ok(c.imageUrls.length >= 25, `images ${c.imageUrls.length}`);
  assert.ok(c.imageUrls.every(u => !/payment|certified|greviews/.test(u)));
  assert.match(c.heroVideoUrl ?? '', /\.mp4$/);
  assert.equal(c.bookingUrl, 'https://app.kiteactive.com/trip/brazil-downwind-2026');
  assert.ok(!/Reviews from returning travelers/.test(c.sourceText ?? ''), 'reviews cut from sourceText');
  assert.ok(!/[—–]/.test(c.summary), 'summary has no em/en dashes');
});
