// Panama Kite Center (Punta Chame): replays the bstoked.net partials of listing 7593 recorded 2026-10-12
// (bstoked snapshot, Aaron's exception 2026-10-12; the own site blocks our bot and is never fetched).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  panamaKiteCenterPuntaChame, parseBstGallery, parseBstLanguages, parseBstRooms, parseBstServices, parseBstVideos,
} from '../../src/offers/adapters/panama-kite-center-punta-chame.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/panama-kite-center-punta-chame');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('pkc: room cards from the accommodations partial', () => {
  const rooms = parseBstRooms(read('bstoked.net_listings_accommodations_id_7593'));
  assert.deepEqual(rooms.map(r => [r.name, r.type, r.photos.length]), [['Studio with Ocean views', 'Bungalow', 5], ['Glamping', 'Tent', 5]]);
  assert.equal(rooms[0].paragraphs[0], 'Our newly remodeled studios are located right behind the launching area.');
  assert.deepEqual(rooms[1].notes, ['Walking distance to spot']);
  assert.ok(rooms[0].photos.every(u => /^https:\/\/bstoked\.azureedge\.net\/ac-1522-[A-Za-z0-9]+\.(jpe?g|JPG)\?width=1920$/.test(u)));
});

test('pkc: services, gallery, videos, languages', () => {
  const s = parseBstServices(read('bstoked.net_listings_services_id_7593'));
  assert.deepEqual(Object.keys(s), ['Optional-services']);
  assert.equal(s['Optional-services'].length, 8); // "Advanced Lessons" is listed twice by the host
  assert.ok(s['Optional-services'].includes('Hydrofoil Lessons'));
  const g = parseBstGallery(read('bstoked.net_listings_images_id_7593'));
  assert.ok(g.length >= 20);
  assert.equal(g[0], 'https://bstoked.azureedge.net/l-7593-N7OsttQQhau78FicMQMDLZRXl29ORuQc.jpg?width=1920');
  assert.deepEqual(parseBstVideos(read('bstoked.net_listings_videos_id_7593')).map(v => v.youtubeId), ['7mKSS7bjJ1Y', '8vfj8yyFS80']);
  assert.deepEqual(parseBstLanguages(read('bstoked.net_listings_languages_id_7593')), ['de', 'en', 'es', 'pt']);
});

test('pkc: no slots (price on request), no request', async () => {
  const before = requestsSoFar();
  const slots = await panamaKiteCenterPuntaChame.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.ok(notes.some(n => /price on request/.test(n)));
});

test('pkc: content', async () => {
  const c = await panamaKiteCenterPuntaChame.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Panama Kite Center');
  assert.equal(c.country, 'Panama');
  assert.equal(c.spot, 'Punta Chame');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.sourceUrl, 'https://www.panamakitecenter.com/');
  assert.ok(!/bstoked/.test(c.sourceUrl));
  assert.match(c.summary, /teaching to IKO and VDWS standards/);
  assert.match(c.summary, /beginner, advanced and hydrofoil lessons with radio headsets and video analysis/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Studio with Ocean views', 'Glamping']);
  assert.equal(c.kiteLessons, true);
  assert.equal(c.equipmentRental, true);
  assert.deepEqual(c.skillLevels, ['beginner', 'advanced']);
  assert.ok(c.imageUrls.length >= 30);
  assert.ok(c.imageUrls.every(u => u.startsWith('https://bstoked.azureedge.net/')));
  assert.equal(panamaKiteCenterPuntaChame.confidence, 'low');
});
