// Kite Tribe (El Gouna): replays the lessons + contact pages recorded 2026-10-12 and the three photo pages
// (/, /about-us/why-kite-tribe/, /about-us/el-gouna/) recorded 2026-10-21.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitetribeElGouna, buildKtSlots, parseKtContact, parseKtCourses } from '../../src/offers/adapters/kitetribe-el-gouna.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kitetribe-el-gouna');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const lessons = read('www.kitetribe.org_lessons_kitesurfing_.');
const contact = read('www.kitetribe.org_contact-us_.');

test('kitetribe: 10 course price cards (group / private)', () => {
  const cs = parseKtCourses(lessons);
  assert.deepEqual(cs.map(c => [c.kind, c.name, c.hours, c.price, c.currency]), [
    ['Group', 'Basic Beginner - 8h', 8, 395, 'EUR'], ['Group', 'Full Beginner - 12h', 12, 540, 'EUR'],
    ['Private', 'Basic Beginner - 8h', 8, 585, 'EUR'], ['Private', 'Full Beginner - 12h', 12, 780, 'EUR'],
    ['Group', '3 hour Refresher', 3, 175, 'EUR'], ['Group', '6 hour Refresher', 6, 315, 'EUR'], ['Group', '9 hour Refresher', 9, 445, 'EUR'],
    ['Private', '3 hour Refresher', 3, 255, 'EUR'], ['Private', '6 hour Refresher', 6, 465, 'EUR'], ['Private', '9 hour Refresher', 9, 645, 'EUR'],
  ]);
  assert.equal(cs[0].students, '2-3 students per instructor');
  assert.equal(cs[2].students, '1 student per instructor');
});

test('kitetribe: slots = one per card, EUR per student, on request, no dates', async () => {
  const slots = await kitetribeElGouna.fetchSlots(ctx);
  assert.deepEqual(slots, buildKtSlots(parseKtCourses(lessons)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.equal(ok.length, 10);
  const priv = ok.find(s => s.key === 'private-basic-beginner-8h')!;
  assert.equal(priv.unit, 'Private course: Basic Beginner - 8h (1 student per instructor)');
  assert.equal(priv.price, 585);
  assert.equal(priv.occupancy, 1);
  assert.equal(ok.find(s => s.key === 'group-3-hour-refresher')!.occupancy, null);
  assert.ok(ok.every(s => s.currency === 'EUR' && s.priceUnit === 'package' && s.priceBasis === 'person'
    && s.availability === 'on_request' && s.startDate === null && s.endDate === null));
});

test('kitetribe: contact page', () => {
  assert.deepEqual(parseKtContact(contact), { location: 'Kitepower, El Gouna, Egypt', email: 'info@kitetribe.org', phone: '+201220172192' });
});

test('kitetribe: content', async () => {
  const c = await kitetribeElGouna.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'course');
  assert.equal(c.title, 'Kite Tribe - Kitesurfing Lessons in El Gouna');
  assert.equal(c.country, 'Egypt');
  assert.equal(c.spot, 'El Gouna');
  assert.equal(c.durationDays, null);
  assert.match(c.summary, /Kitepower station/);
  assert.match(c.summary, /from EUR 175 \(group\) and EUR 255 \(private\) per student/);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.equal(c.equipmentRental, true);
  assert.ok(c.includedServices.includes('IKO licence after successful completion (beginner courses)'));
  assert.ok(c.imageUrls.length >= 12, `only ${c.imageUrls.length} photo candidates`);
  const up = 'https://www.kitetribe.org/wp-content/uploads/';
  for (const f of ['2025/03/kitesurfing-lessons.jpg', '2025/04/el-gouna-kitepower-station.jpg', '2025/04/el-gouna-kitepower-kite-launch.jpg',
    '2025/03/Kitesurfing_privatecoaching.jpg', '2025/03/Tony-teaching-on-the-beach.jpg', '2024/03/Kite-Tribe_student-learn-jumping.png',
    '2025/03/Kitesurfing_beginnercourse.jpg', '2025/03/kitesurfing-lesson-splashes.jpg', '2025/03/Kitetribe_beach_life.jpg']) {
    assert.ok(c.imageUrls.includes(up + f), `missing ${f}`);
  }
  // no other products (safari boat, camps, girls trip, wing foil), skill icons, headshots, weather chart, chrome
  assert.ok(c.imageUrls.every(u => !/logo|safari|trustindex|\.svg|girlstrip|zodiac|grouptravel|wing-?foil|Kite_beginner|Kite_advanced|Ursi\.|testimonial|weather-chart/i.test(u)));
});
