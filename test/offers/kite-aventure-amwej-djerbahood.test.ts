// Kite Aventure - AMWEJ Kite Camp (Djerbahood, Djerba): replays /sejours.html and /kitesurf.html of kiteaventure.com
// recorded 2026-10-14 (scripts and styles trimmed). Aaron 2026-10-14: listed with price on request; the printed
// (c) 2024 prices stay in the room features, never slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  kiteAventureAmwejDjerbahood as adapter, kaLines, parseKaCamp, parseKaCourses, parseKaStay,
} from '../../src/offers/adapters/kite-aventure-amwej-djerbahood.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/kite-aventure-amwej-djerbahood');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => notes.push(t), incomplete: () => {} };
const stays = read('kiteaventure.com_sejours.html.');
const kitesurf = read('kiteaventure.com_kitesurf.html.');

test('kite-aventure: AMWEJ block of /sejours.html', () => {
  const c = parseKaCamp(stays)!;
  assert.deepEqual([c.rooms, c.maxGuests, c.priceText, c.fromPerNight], [4, 10, 'À partir de 15€/nuit', 15]);
  assert.deepEqual(c.roomNames, ['Guebliya Chambre Double', 'Charguiya Chambre Double']);
  assert.deepEqual(c.photos, ['https://kiteaventure.com/images/Amwej-kite-camp.jpeg', 'https://kiteaventure.com/images/Amwej-kite-camp-yoga.jpeg']);
  assert.match(c.text[0], /situé au cœur de DjerbaHood/);
  assert.equal(parseKaCamp('<html></html>'), null);
});

test('kite-aventure: all-inclusive stay + courses of /kitesurf.html', () => {
  const lines = kaLines(kitesurf);
  const s = parseKaStay(lines)!;
  assert.deepEqual([s.week1, s.week2, s.days3_1, s.days3_2], [675, 990, 310, 490]);
  assert.deepEqual(s.includes, ['transfert aeroport', 'transfert de/vers le club', 'petit déjeuné', "tour de l'ile", 'stand up paddle et kayaks']);
  assert.deepEqual(parseKaCourses(lines).map(c => [c.name, c.duration, c.price]), [
    ['Stage Découverte', '3 heures', 'Prix: 80€'],
    ['Stage Initiation', '6 heures', 'Prix : 210 €'],
    ['Stage Autonome', '12 heures', 'Prix : 400 €'],
    ['Stage Perfectionnement', '1 heure', 'Avec équipement: 50 €; Sans équipement : 35 €'],
  ]);
});

test('kite-aventure: price on request -> [] and no notes while the footer reads 2024', async () => {
  const slots = await adapter.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(notes, []);
  assert.equal(adapter.confidence, 'low');
});

test('kite-aventure: content', async () => {
  const c = await adapter.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'AMWEJ Kite Camp (Kite Aventure)');
  assert.deepEqual([c.country, c.region, c.spot, c.durationDays], ['Tunisia', 'Djerba, Medenine', 'Erriadh (Djerbahood), Djerba', null]);
  assert.equal(c.spotCoords, undefined, 'the site only pins the club, not the camp');
  assert.match(c.summary, /4 suites for up to 10 guests in Djerbahood/);
  assert.match(c.summary, /Plage Soug El Guebli, Aghir, with IKO-certified instructors/);
  assert.match(c.summary, /the prices on the site date from 2024/);
  const f = c.rooms[0].features;
  assert.ok(f.includes('Rooms from EUR 15 per night (printed on the site, © 2024)'));
  assert.ok(f.includes('All-inclusive stay, 1 week: EUR 675 for 1 person, EUR 990 for 2 persons (printed on the site, © 2024)'));
  assert.ok(f.includes('Room: Guebliya (double room)'));
  assert.ok(c.optionalServices.includes('Kitesurf beginner course (6 h): EUR 210 (printed on the site, © 2024)'));
  assert.deepEqual(c.imageUrls.length, 3);
  assert.ok(!/[–—]/.test(c.summary + f.join(' ') + c.optionalServices.join(' ')), 'no en/em dashes');
});
