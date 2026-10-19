// UCPA Kitesurf spécial débutant, Hurghada (+ the shared UCPA parser): replays the two product pages and their
// booking-calendar JSON recorded 2026-10-19. The calendar fixtures are compacted to the fields parseUcpaCalendar
// reads (UCPA repeats a language block in every row).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UCPA_HURGHADA, buildUcpaSlots, fetchUcpaSlots, parseUcpaCalendar, parseUcpaPage, ucpaAvailability, ucpaKitesurfDebutantHurghada,
} from '../../src/offers/adapters/ucpa-kitesurf-debutant-hurghada.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/ucpa-kitesurf-debutant-hurghada');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (part: string) => readFileSync(join(DIR, files.find(f => f.includes(part))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('ucpa page: booking calendar URL, JSON-LD currency, inclusions, hotel, pin, own photos only', () => {
  const p = parseUcpaPage(read('1856-kitesurf-special-debutant'), ['hurghada']);
  assert.equal(p.apiUrl, 'https://www.ucpa.com/api/product/product_1694433321_15cb3a51-509a-11ee-a078-e3d013033c74?agency=1-1-1&baseUrl=&showParticipants=true&locale=fr&workspace=speedboat');
  assert.deepEqual([p.currency, p.ldPrice, p.sku], ['EUR', 980, 'PAAEGOV10']);
  assert.equal(p.accommodationName, 'Hotel Bellagio');
  assert.match(p.included[0], /7 nuits en chambre de 2 à 3 personnes/);
  assert.ok(p.included.includes('La pension complète'));
  assert.ok(p.options.some(o => /chambre single/.test(o)));
  assert.deepEqual(p.coords, { lat: 27.271985, lng: 33.800632 });
  assert.match(p.brief!, /^Sur un spot où vous avez pied/);
  assert.ok(p.images.length >= 20);
  assert.ok(p.images.every(u => u.startsWith('https://media.ucpa.com/image/upload/f_auto/t_UCPA/UCPA-SPORT-NATURE/International/')));
  assert.ok(!p.images.some(u => /kalpitiya/.test(u)), 'another centre\'s photo leaked in');
});

test('ucpa calendar: land-only rows, sold out / few places / promotion', () => {
  const cal = parseUcpaCalendar(read('product_1694433321'));
  assert.equal(cal.departures.length, 51);
  assert.equal(cal.duplicates, 0);
  assert.equal(cal.lowestWithFlights, 1260);
  const [first, second] = cal.departures;
  assert.deepEqual([first.date, first.nights, first.price, first.status], ['2026-10-24', 7, 1040, 'Départ garanti']);
  assert.deepEqual(ucpaAvailability(first), { availability: 'available', spotsLeft: null });
  assert.deepEqual(ucpaAvailability(second), { availability: 'sold_out', spotsLeft: 0 });
  const nov14 = cal.departures.find(d => d.date === '2026-11-14')!;
  assert.deepEqual(ucpaAvailability(nov14), { availability: 'limited', spotsLeft: 1 });
  assert.deepEqual([cal.departures.at(-1)!.date, Math.min(...cal.departures.map(d => d.price)), Math.max(...cal.departures.map(d => d.price))], ['2027-10-23', 980, 1250]);
});

test('ucpa slots: two units, past departures dropped, valid', async () => {
  const notes: string[] = [];
  const slots = await fetchUcpaSlots(UCPA_HURGHADA, '2026-10-19', { note: t => notes.push(t), incomplete: t => notes.push(`INCOMPLETE ${t}`) });
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(slots.filter(s => s.key.startsWith('debutant|')).length, 51);
  assert.equal(slots.filter(s => s.key.startsWith('coaching|')).length, 51);
  assert.deepEqual(notes, []);
  const s = slots[0];
  assert.deepEqual([s.key, s.startDate, s.endDate, s.price, s.currency, s.priceUnit, s.priceBasis, s.availability, s.packageNights],
    ['debutant|2026-10-24', '2026-10-24', '2026-10-31', 1040, 'EUR', 'package', 'person', 'available', 7]);
  assert.match(s.availabilityText!, /Départ garanti - EUR 1040 per person, 7 nights land only/);
  const coaching = slots.find(x => x.key === 'coaching|2026-11-21')!;
  assert.deepEqual([coaching.price, coaching.unit], [950, 'Kitesurf coaching perfectionnement (water start mastered)']);
  // a later "today" drops the departures that have started
  const cal = parseUcpaCalendar(read('product_1694433321'));
  const later = buildUcpaSlots(UCPA_HURGHADA.units[0], cal, 'EUR', '2027-09-01');
  assert.deepEqual(later.map(x => x.startDate), ['2027-09-04', '2027-09-11', '2027-09-18', '2027-09-25', '2027-10-02', '2027-10-09', '2027-10-16', '2027-10-23']);
});

test('ucpa hurghada: adapter flags and content', async () => {
  const a = ucpaKitesurfDebutantHurghada;
  assert.deepEqual([a.key, a.kind, a.slotMethod, a.liveAvailability, a.instantBooking, a.operator.rootDomain], ['ucpa-kitesurf-debutant-hurghada', 'camp', 'booking_engine', true, true, 'ucpa.com']);
  const c = await a.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.deepEqual([c.kind, c.durationDays, c.country, c.region, c.spot, c.mealPlan], ['camp', 8, 'Egypt', 'Red Sea', 'Hurghada', 'full_board']);
  assert.match(c.summary, /7 nights in a shared room for 2-3 at the Hotel Bellagio/);
  assert.ok(c.imageUrls.length >= 20);
  assert.match(c.sourceText!, /inclus: L'hébergement 7 nuits/);
});
