// Kite Nômade (Pernambuca, Arraial do Cabo): replays the home, /bangalo/, /school/ and the theme CSS recorded
// 2026-10-26 (scripts, styles and the Trustindex review widget trimmed, the CSS developer credit redacted).
// Content only: the site prints no price and the Foco engine is not readable without Origin -> [].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteNomadeArraialDoCabo, knCoords, knCssPhotos, knFocoWidget, knImages, knRoomFacts, knUnits, knVisiblePrices,
  parseKnAmenities, parseKnCourses, parseKnRooms,
} from '../../src/offers/adapters/kite-nomade-arraial-do-cabo.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-nomade-arraial-do-cabo');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const rooms = read('kitenomade.com.br_bangalo_.');
const css = read('kitenomade.com.br_wp-content_themes_kitenomade_css_desktop.css.');

test('kite-nomade: six room blocks with texts and slider photos', () => {
  const r = parseKnRooms(rooms);
  assert.deepEqual(r.map(x => [x.name, x.images.length]), [
    ['Bangalô Reserva', 5], ['Bangalô Lua', 3], ['Bangalô Lagoa', 2], ['Bangalô Garden', 5],
    ['Suítes 1, 2 e 3', 2], ['Suítes 4, 5 e 6', 5],
  ]);
  assert.match(r[0].text, /acomoda até 3 pessoas\. ?Quarto com cama queen \+ cama de solteiro, não possui cozinha\./);
  assert.equal(r[0].images[0], 'https://kitenomade.com.br/wp-content/uploads/2024/03/bangalo-reserva-3-scaled.jpg');
  assert.deepEqual(r.map(x => knUnits(x.name)), [1, 1, 1, 1, 3, 3]);
});

test('kite-nomade: room facts in English', () => {
  const r = parseKnRooms(rooms);
  assert.deepEqual(knRoomFacts(r[0]), {
    description: 'upper floor, lagoon and nature reserve view, up to 3 guests, queen bed + single bed, no kitchen',
    features: ['Lagoon and nature reserve view'], maxGuests: 3,
  });
  assert.equal(knRoomFacts(r[1]).description, 'upper floor, lagoon and nature reserve view, up to 4 guests, kitchen');
  assert.equal(knRoomFacts(r[3]).description, 'ground floor, garden view, king bed + king single bed, kitchen');
  assert.equal(knRoomFacts(r[5]).description, '3 units, upper floor, lagoon and nature reserve view, up to 2 guests, queen or king bed, or two single beds');
});

test('kite-nomade: amenities, courses, map pin, booking widget', () => {
  assert.deepEqual(parseKnAmenities(rooms), [
    'Cama de casal', 'Ar-condicionado Split', 'TV LED', 'Banheiro com ducha quente',
    'Frigobar para guardar seu mantimento', 'Cooktop, Forno elétrico e Micro-Ondas',
  ]);
  const c = parseKnCourses(read('kitenomade.com.br_school_.'));
  assert.deepEqual(c.map(x => x.name), ['Iniciante', 'Regular', 'Intermediário', 'Avançado']);
  assert.match(c[0].text, /módulo de 10 horas/);
  assert.deepEqual(knCoords(read('kitenomade.com.br_.')), { lat: -22.9154, lng: -42.2695 });
  assert.equal(knFocoWidget(rooms), '4924');
});

test('kite-nomade: photos = lagoon kiting + grounds from the CSS, then rooms round-robin', () => {
  assert.deepEqual(knCssPhotos(css), [
    'https://kitenomade.com.br/wp-content/uploads/2024/04/IMG_1885-1_Easy-Resize.com_.jpg',
    'https://kitenomade.com.br/wp-content/uploads/2024/04/kitenomade-espaco-site.png',
  ]);
  const imgs = knImages(css, parseKnRooms(rooms));
  assert.equal(imgs.length, 12);
  assert.equal(imgs[2], 'https://kitenomade.com.br/wp-content/uploads/2024/03/bangalo-reserva-3-scaled.jpg');
  assert.equal(imgs[7], 'https://kitenomade.com.br/wp-content/uploads/2024/03/suites45e6-5-scaled.jpg');
  assert.ok(imgs.every(u => !/imagem-home|banner|onda/.test(u)), 'no stock/theme banners');
});

test('kite-nomade: no price on the site -> [] (price on request)', async () => {
  assert.deepEqual(knVisiblePrices(rooms), []);
  const slots = await kiteNomadeArraialDoCabo.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(knVisiblePrices('<main><h3>Bangalô Lua</h3><p>a partir de R$ 450 a diária</p></main>'), ['R$ 450']);
  assert.equal(knFocoWidget('<div class="motor-reserva"></div>'), null);
});

test('kite-nomade: content', async () => {
  const c = await kiteNomadeArraialDoCabo.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Kite Nômade');
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.country, 'Brazil');
  assert.equal(c.region, 'Arraial do Cabo, Rio de Janeiro');
  assert.equal(c.spot, 'Lagoa de Araruama, Arraial do Cabo');
  assert.deepEqual(c.spotCoords, { lat: -22.9154, lng: -42.2695 });
  assert.equal(c.mealPlan, 'breakfast');
  assert.equal(c.kiteLessons, true);
  assert.equal(c.beginnerFriendly, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'intermediate', 'advanced']);
  assert.match(c.summary, /with 4 bungalows and 6 suites\./);
  assert.match(c.summary, /a 10-hour beginner course, an 8-hour course/);
  assert.match(c.summary, /price on request/);
  assert.doesNotMatch(c.summary, /IKO|children/, 'the IKO/kids block is an HTML comment on /school/');
  assert.doesNotMatch(c.summary, /[–—]/, 'no en/em dashes');
  assert.equal(c.rooms.length, 6);
  assert.equal(c.optionalServices.filter(s => /price on request/.test(s)).length, 4);
  assert.equal(c.imageUrls.length, 12);
  assert.equal(c.bookingUrl, 'https://kitenomade.soufoco.com.br/');
  assert.doesNotMatch(c.sourceText ?? '', /<!DOCTYPE|Trustindex/);
  assert.equal(kiteNomadeArraialDoCabo.instantBooking, false);
  assert.equal(kiteNomadeArraialDoCabo.liveAvailability, undefined);
  assert.deepEqual(kiteNomadeArraialDoCabo.disciplines, ['kitesurf']);
});
