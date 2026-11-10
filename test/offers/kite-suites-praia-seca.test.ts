// Kite Suites (Praia Seca, Araruama): replays the home, /acomodacoes/ and /servicos/ of the rebuilt site, recorded
// 2026-11-10 with OFFERS_RECORD_DIR (the old Locaweb build broke the cron on 2026-11-09 and 2026-11-10).
// Content only: one undated "Suítes a partir de R$ 418,00" line, WhatsApp request only -> [] with a note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteSuitesPraiaSeca, ksAddress, ksVisiblePrices, parseKsRooms, parseKsServices,
} from '../../src/offers/adapters/kite-suites-praia-seca.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-suites-praia-seca');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const rooms = read('kitesuites.com.br_acomodacoes_.');
const IMG = 'https://kitesuites.com.br/assets/';

test('kite-suites: three suites with facts, the shared Arubinha/Coroinha gallery and the Lagoa gallery', () => {
  const r = parseKsRooms(rooms);
  assert.deepEqual(r.map(x => [x.name, x.sizeM2, x.maxGuests, x.beds, x.images.length]), [
    ['Suite Arubinha', 17, 3, 'queen bed or two single beds, plus one single bed', 6],
    ['Suite Coroinha', 17, 3, 'queen bed or two single beds, plus one single bed', 6],
    ['Suite Lagoa', null, null, null, 4],
  ]);
  assert.deepEqual(r[0].images, r[1].images, 'the page says the photos show both suites');
  assert.ok(r[2].images.every(u => /suite-lagoa-/.test(u)));
  assert.deepEqual(r[0].amenities, ['Breakfast', 'Minibar', 'Air conditioning', 'TV', 'Wi-Fi']);
  assert.deepEqual(r[2].amenities, ['Breakfast']);
  assert.ok(r.every(x => x.images.every(u => u.startsWith(IMG))));
  assert.deepEqual(parseKsRooms('<main><h1>Acomodações</h1></main>'), [], 'no cards: fetchSlots throws');
});

test('kite-suites: services with their photos, address', () => {
  const s = parseKsServices(read('kitesuites.com.br_servicos_.'));
  assert.deepEqual(s.map(x => x.name), ['Piscina aquecida', 'Restaurante', 'Vestiários', 'Guardaria de equipamentos', 'Yoga',
    'Canoa havaiana', 'Caiaque e stand up paddle', 'Day use para kitesurf']);
  assert.equal(s[7].image, `${IMG}kitesurf-frente-05.jpg`);
  assert.equal(ksAddress(read('kitesuites.com.br_.')), 'Av. Praia dos Nobres, 741, Praia Seca, Araruama - RJ');
});

test('kite-suites: the undated "from" amount is noted, slots stay [] (price on request)', async () => {
  assert.deepEqual(ksVisiblePrices(rooms), ['R$ 418,00.']);
  const slots = await kiteSuitesPraiaSeca.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, ['prices appeared on /acomodacoes (R$ 418,00.): extend the adapter']);
});

test('kite-suites: content', async () => {
  const c = await kiteSuitesPraiaSeca.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Suites');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Araruama, Rio de Janeiro');
  assert.equal(c.spot, 'Praia Seca, Araruama');
  assert.equal(c.spotCoords, undefined); // no map on the site
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.deepEqual(c.rooms.map(r => [r.name, r.description]), [
    ['Suite Arubinha', '17 m2, lagoon view, up to 3 guests, queen bed or two single beds, plus one single bed'],
    ['Suite Coroinha', '17 m2, lagoon view, up to 3 guests, queen bed or two single beds, plus one single bed'],
    ['Suite Lagoa', 'private suite, layout and capacity on request'],
  ]);
  assert.match(c.summary, /with 3 suites: Suite Arubinha, Suite Coroinha, Suite Lagoa\./);
  assert.match(c.summary, /heated pool/);
  assert.match(c.summary, /partner school Wind Hunter Kite Center/);
  assert.match(c.summary, /confirmed on request/);
  assert.doesNotMatch(c.summary, /[–—]/, 'no en/em dashes');
  assert.ok(c.optionalServices.includes('Kite day use with shore support for rigging, launch and landing'));
  assert.equal(c.imageUrls.length, 12);
  assert.equal(c.imageUrls[0], `${IMG}kitesurf-frente-05.jpg`, 'kite photo first');
  assert.equal(new Set(c.imageUrls).size, 12);
  assert.ok(!c.imageUrls.some(u => /vestiarios|caiaque/.test(u)), 'illustrative service photos stay out');
  assert.equal(c.bookingUrl, 'https://wa.me/5522999886066');
  assert.equal(c.sourceUrl, 'https://kitesuites.com.br/acomodacoes/');
  assert.match(c.sourceText ?? '', /address: Av\. Praia dos Nobres, 741/);
  assert.match(c.sourceText ?? '', /Suítes a partir de R\$ 418,00\./);
  assert.equal(kiteSuitesPraiaSeca.instantBooking, false);
  assert.equal(kiteSuitesPraiaSeca.liveAvailability, undefined);
  assert.deepEqual(kiteSuitesPraiaSeca.disciplines, ['kitesurf']);
});
