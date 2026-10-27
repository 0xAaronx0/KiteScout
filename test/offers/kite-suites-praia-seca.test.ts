// Kite Suites (Praia Seca, Araruama): replays the home, /acomodacoes and /servicos recorded 2026-10-26 with curl
// (Node cannot verify the site's ISRG Root YR chain, see the adapter header; scripts and styles trimmed).
// Content only: no price on the site, WhatsApp request only -> [].
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
const rooms = read('kitesuites.com.br_acomodacoes.');
const IMG = 'https://yata-apix-9ac0e6bf-5cdd-4930-9841-f65a94fe84fe.s3-object.locaweb.com.br/';

test('kite-suites: three suites with facts and galleries', () => {
  const r = parseKsRooms(rooms);
  assert.deepEqual(r.map(x => [x.name, x.sizeM2, x.maxGuests, x.beds, x.images.length]), [
    ['Suite Arubinha', 17, 3, 'queen bed or two single beds, plus one single bed', 6],
    ['Suite Coroinha', 17, 3, 'queen bed or two single beds, plus one single bed', 7],
    ['Suite Lagoa', null, 4, 'double bed + bunk bed', 5],
  ]);
  assert.deepEqual(r[0].amenities, ['Breakfast', 'Minibar', 'Air conditioning', 'TV', 'Wi-Fi']);
  assert.deepEqual(r[2].amenities, ['Breakfast', 'Minibar', 'Air conditioning', 'Wi-Fi']);
  assert.ok(r.every(x => x.images.every(u => u.startsWith(IMG) && u.endsWith('.jpg'))));
});

test('kite-suites: services with their photos, address', () => {
  const s = parseKsServices(read('kitesuites.com.br_servicos.'));
  assert.deepEqual(s.map(x => x.name), ['Gastronomia', 'Aulas de Kitesurf', 'Serviços de Praia', 'Passeios']);
  assert.match(s[1].text, /nossos instrutores certificados/);
  assert.equal(s[1].image, `${IMG}bf912733deca4f04b911846310b32913.jpg`);
  assert.equal(ksAddress(read('kitesuites.com.br_.')), 'Av. Praia dos Nobres, 741 - Sao Tome, Praia Seca - Araruama - RJ, 28970-000');
});

test('kite-suites: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(ksVisiblePrices(rooms), []);
  const slots = await kiteSuitesPraiaSeca.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(ksVisiblePrices('<section><h3>Suite Lagoa</h3><p>Diária R$ 380</p></section>'), ['R$ 380']);
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
    ['Suite Lagoa', 'ground floor, up to 4 guests, double bed + bunk bed, large bathroom'],
  ]);
  assert.match(c.summary, /with 3 suites: Suite Arubinha, Suite Coroinha, Suite Lagoa\./);
  assert.match(c.summary, /there is a pool/);
  assert.match(c.summary, /price on request/);
  assert.doesNotMatch(c.summary, /[–—]/, 'no en/em dashes');
  assert.equal(c.imageUrls.length, 12);
  assert.equal(c.imageUrls[0], `${IMG}bf912733deca4f04b911846310b32913.jpg`, 'kite lesson photo first');
  assert.equal(new Set(c.imageUrls).size, 12);
  assert.equal(c.bookingUrl, 'https://wa.me/5522999886066');
  assert.match(c.sourceText ?? '', /address: Av\. Praia dos Nobres, 741/);
  assert.equal(kiteSuitesPraiaSeca.instantBooking, false);
  assert.equal(kiteSuitesPraiaSeca.liveAvailability, undefined);
  assert.deepEqual(kiteSuitesPraiaSeca.disciplines, ['kitesurf']);
});
