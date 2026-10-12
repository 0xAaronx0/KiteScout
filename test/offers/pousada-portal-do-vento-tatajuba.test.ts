// Pousada Portal do Vento (Tatajuba): replays pousada-tatajuba.com + Guesty listing pages recorded 2026-10-12
// (script/style bodies trimmed; the parser reads only HTML and meta tags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pousadaPortalDoVentoTatajuba, buildPdvSlots, parseGuestyListingMeta, parsePdvRoomTexts, parsePdvUnits, pdvCurrency, PDV_LISTINGS,
} from '../../src/offers/adapters/pousada-portal-do-vento-tatajuba.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-portal-do-vento-tatajuba');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const home = read('pousada-tatajuba.com_en_.');
const acc = read('pousada-tatajuba.com_en_accommodation_.');

test('portal-do-vento: currency typo "RBL" maps to BRL, unknown signs stay null', () => {
  assert.equal(pdvCurrency('From 800 RBL per night'), 'BRL');
  assert.equal(pdvCurrency('R$ 800'), 'BRL');
  assert.equal(pdvCurrency('From 800 per night'), null);
});

test('portal-do-vento: unit teaser cards on /en/', () => {
  assert.deepEqual(parsePdvUnits(home).map(u => [u.name, u.listingId, u.price, u.currency, u.from]), [
    ['Palafita Sea View', '64b96b7e346c0f0028f3928c', 800, 'BRL', true],
    ['Kitehouse', '64b96cd8965a550029cae640', 700, 'BRL', true],
    ['Bungalow', '64b96e8a897be7003f48ee8c', 600, 'BRL', true],
  ]);
  assert.deepEqual(parsePdvUnits(home).map(u => u.listingId), PDV_LISTINGS);
});

test('portal-do-vento: accommodation texts', () => {
  const texts = parsePdvRoomTexts(acc);
  assert.deepEqual(texts.map(t => t.name), ['Bungalow', 'Palafita', 'Kitehouse']);
  assert.match(texts[1].text, /four meters above the ground/);
});

test('portal-do-vento: Guesty listing metadata', () => {
  const m = parseGuestyListingMeta(PDV_LISTINGS[0], read('tatajuba-portal-do-vento.guestybookings.com_en_properties_64b96b7e346c0f0028f3928c'));
  assert.equal(m.title, 'Palafita Sea View');
  assert.match(m.description, /^The pousada is about 100 m from the beach and has a pool, restaurant and chill-out areas\./);
  assert.equal(m.images.length, 4);
  assert.ok(m.images.every(u => u.startsWith('https://assets.guesty.com/image/upload/')));
});

test('portal-do-vento: slots = one "From" price per unit type, BRL per night, no dates', async () => {
  const slots = await pousadaPortalDoVentoTatajuba.fetchSlots(ctx);
  assert.deepEqual(slots, buildPdvSlots(parsePdvUnits(home)));
  const { ok, problems } = checkSlots(slots);
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.unit, s.price, s.currency]), [
    ['palafita-sea-view', 'Palafita Sea View', 800, 'BRL'], ['kitehouse', 'Kitehouse', 700, 'BRL'], ['bungalow', 'Bungalow', 600, 'BRL'],
  ]);
  assert.ok(slots.every(s => s.priceUnit === 'per_night' && s.priceBasis === 'room' && s.availability === 'unknown'
    && s.startDate === null && s.endDate === null && s.occupancy === null));
});

test('portal-do-vento: content', async () => {
  const c = await pousadaPortalDoVentoTatajuba.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada Portal do Vento');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Ceará');
  assert.equal(c.spot, 'Tatajuba');
  assert.equal(c.spotCoords, undefined);
  assert.match(c.summary, /about 100 m from the beach, with a pool, a restaurant and chill-out areas/);
  assert.match(c.summary, /BRL 600 \(bungalow\), BRL 700 \(kitehouse\), BRL 800 \(palafita sea view\)/);
  assert.doesNotMatch(c.summary, /Casa de Praia|Paraíba/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Palafita Sea View', 'Kitehouse', 'Bungalow']);
  assert.ok(c.rooms[1].features.includes('Shared bathroom'));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.length <= 30);
  assert.ok(c.imageUrls.every(u => !/\.svg|favicon|logo|pattern/i.test(u)));
  assert.ok(c.imageUrls[0].startsWith('https://pousada-tatajuba.com/wp-content/uploads/'));
  assert.equal(c.bookingUrl, 'https://tatajuba-portal-do-vento.guestybookings.com/en/properties');
});
