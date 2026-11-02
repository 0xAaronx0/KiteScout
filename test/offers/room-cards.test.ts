// Room photos from room cards (Aaron 2026-11-02): a room's own card on the provider page hands it its pictures; a
// block that names several rooms hands nobody anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_CARD_PAGES, roomCardImages, withCardRoomPhotos } from '../../src/offers/room-cards.js';
import { adapters } from '../../src/offers/registry.js';
import type { OfferContent } from '../../src/offers/types.js';

const content = (o: Partial<OfferContent>): OfferContent => ({
  kind: 'accommodation', title: 'T', summary: 'S', continent: null, country: 'X', region: null, spot: null,
  itinerarySpots: [], durationDays: null, skillLevels: [], kiteLessons: null, equipmentRental: null, beginnerFriendly: null,
  includedServices: [], optionalServices: [], accommodation: null, mealPlan: null, languages: [], rooms: [],
  imageUrls: [], heroVideoUrl: null, sourceUrl: 'https://h.example/rooms/', bookingUrl: null, sourceText: null, ...o,
});
const room = (name: string, imageUrls?: string[]) => ({ name, description: null, features: [], ...(imageUrls ? { imageUrls } : {}) });

const PAGE = `<html><body>
  <div class="hero"><img src="/hero.jpg"><h1>Our rooms</h1></div>
  <div class="card"><img src="/wp-content/uploads/garden-1-570x432.jpg"><img src="/img/flags/en.png"><img src="data:image/gif;base64,R0">
    <h3>Garden Suite</h3><p>Two guests</p></div>
  <div class="card"><img srcset="/sea-480.jpg 480w, /sea-1600.jpg 1600w" src="/sea-480.jpg"><h3>Sea View Room</h3></div>
  <section><img src="/both.jpg"><h3>Dorm</h3><h3>Loft</h3></section>
</body></html>`;

test('roomCardImages: own card pictures (CDN original, largest srcset), flags and data URIs out, shared blocks give nothing', () => {
  const m = roomCardImages(PAGE, 'https://h.example/rooms/', ['Garden Suite', 'Sea View Room', 'Dorm', 'Loft', 'Penthouse']);
  assert.deepEqual(Object.fromEntries(m), {
    'Garden Suite': ['https://h.example/wp-content/uploads/garden-1.jpg'],
    'Sea View Room': ['https://h.example/sea-1600.jpg'],
  });
});

test('withCardRoomPhotos: listed stays only, skipped rooms and rooms with own photos untouched, a failed page changes nothing', async () => {
  const key = 'kite-buen-hombre-eco-lodge';
  const page = `<div><img src="/loft.jpg"><h2>Beach Lofts</h2></div><div><img src="/sunset.jpg"><h2>The Palace</h2></div><div><img src="/b.jpg"><h2>Beach Bungalows</h2></div>`;
  const c = content({ rooms: [room('Beach Lofts'), room('The Palace'), room('Beach Bungalows', ['https://h.example/own.jpg'])] });
  const out = await withCardRoomPhotos(key, c, async () => page);
  assert.deepEqual(out.rooms.map(r => r.imageUrls), [['https://h.example/loft.jpg'], undefined, ['https://h.example/own.jpg']]);
  assert.deepEqual(await withCardRoomPhotos(key, c, async () => { throw new Error('down'); }), c);
  let fetched = false;
  assert.equal(await withCardRoomPhotos('no-such-adapter', c, async () => { fetched = true; return page; }), c);
  assert.equal(fetched, false, 'an unlisted stay makes no request');
});

test('withCardRoomPhotos: a room with its own page takes that page\'s pictures, the source page is not read when cards: false', async () => {
  const pages: Record<string, string> = {
    'https://h.example/seas-the-breeze-i-orp5b5e665x': '<main><img src="/i-front.jpg"><img src="/i-living.jpg"></main>',
    'https://h.example/seas-the-breeze-ii-orp5b5e666x': '<main><img src="/ii-front.jpg"></main>',
  };
  const asked: string[] = [];
  const c = content({ sourceUrl: 'https://h.example/sounds-searious-orp5b66becx', rooms: [room('Seas the Breeze I'), room('Seas the Breeze II')] });
  const out = await withCardRoomPhotos('hatteras-island-vacation-rentals-avon', c, async url => { asked.push(url); if (!pages[url]) throw new Error('404'); return pages[url]; });
  assert.deepEqual(out.rooms.map(r => r.imageUrls), [['https://h.example/i-front.jpg', 'https://h.example/i-living.jpg'], ['https://h.example/ii-front.jpg']]);
  assert.deepEqual(asked, Object.keys(pages));
});

test('ROOM_CARD_PAGES: every key is a registered accommodation adapter', () => {
  for (const key of Object.keys(ROOM_CARD_PAGES)) {
    const a = adapters.find(x => x.key === key);
    assert.ok(a, `${key} is not a registered adapter`);
    assert.equal(a.kind, 'accommodation', key);
  }
});
