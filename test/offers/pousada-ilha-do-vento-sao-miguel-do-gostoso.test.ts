// Pousada Ilha do Vento (São Miguel do Gostoso, RN): replays ilhadovento.com.br (/, /stay/,
// /kitesurf-windsurf-wingfoil/) recorded 2026-10-12 (scripts except JSON-LD, styles and SVGs trimmed).
// Slots = the published "A partir de R$.." room prices (the HSystem engine is not read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pousadaIlhaDoVentoSaoMiguelDoGostoso, buildIdvSlots, idvCoords, idvJsonLd, parseIdvRooms,
} from '../../src/offers/adapters/pousada-ilha-do-vento-sao-miguel-do-gostoso.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/pousada-ilha-do-vento-sao-miguel-do-gostoso');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const stay = read('ilhadovento.com.br_stay_.');
const home = read('ilhadovento.com.br_.');

test('ilha do vento: room cards of /stay/', () => {
  const rooms = parseIdvRooms(stay);
  assert.deepEqual(rooms.map(r => [r.name, r.fromPrice]), [
    ['Suite Luxo – Lua de Mel', 420], ['Suite Master', 360], ['Suite Jardim', 320], ['Apartamento Master Familia', 370],
  ]);
  assert.deepEqual(rooms[0].facts.slice(0, 2), ['35 m2', '3 Hospedes']);
  assert.ok(rooms.every(r => r.photos.length > 0 && r.photos.every(u => !/-\d+x\d+\./.test(u))));
});

test('ilha do vento: slots = one undated "from" price per room type, BRL per room per night', async () => {
  const slots = await pousadaIlhaDoVentoSaoMiguelDoGostoso.fetchSlots(ctx);
  assert.deepEqual(slots, buildIdvSlots(parseIdvRooms(stay)));
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price]), [
    ['suite-luxo-lua-de-mel', 420], ['suite-master', 360], ['suite-jardim', 320], ['apartamento-master-familia', 370],
  ]);
  assert.ok(slots.every(s => s.currency === 'BRL' && s.priceUnit === 'per_night' && s.priceBasis === 'room'
    && s.availability === 'unknown' && s.startDate === null && s.endDate === null));
});

test('ilha do vento: JSON-LD (unquoted type attribute) says per night and names kite surfer rooms', () => {
  const ld = idvJsonLd(home);
  const list = ld.find(o => o['@type'] === 'ItemList') as { itemListElement: Array<{ item: { name: string; offers: { priceSpecification: { unitText: string } } } }> };
  assert.deepEqual(list.itemListElement.map(e => e.item.name), ['Family Room', 'Honeymoon Suite', 'Kite Surfer Room']);
  assert.ok(list.itemListElement.every(e => e.item.offers.priceSpecification.unitText === 'per night'));
  assert.deepEqual(idvCoords(home), { lat: -5.1256863, lng: -35.6233104 });
});

test('ilha do vento: content', async () => {
  const c = await pousadaIlhaDoVentoSaoMiguelDoGostoso.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Pousada Ilha do Vento');
  assert.deepEqual([c.country, c.region, c.spot], ['Brazil', 'São Miguel do Gostoso, Rio Grande do Norte', 'São Miguel do Gostoso']);
  assert.deepEqual(c.spotCoords, { lat: -5.1256863, lng: -35.6233104 });
  assert.match(c.summary, /with 12 apartments/);
  assert.match(c.summary, /Escola Gostoso kite school \(5 minutes on foot\)/);
  assert.match(c.summary, /September to March as the best wind months/);
  assert.match(c.summary, /start at R\$320 per night/);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate']);
  assert.equal(c.rooms.length, 4);
  assert.ok(c.rooms[0].features.includes('Up to 3 guests'));
  assert.equal(c.imageUrls.length, 29);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://ilhadovento.com.br/wp-content/uploads/') && !/-\d+x\d+\./.test(u)));
  assert.equal(pousadaIlhaDoVentoSaoMiguelDoGostoso.confidence, 'medium');
});
