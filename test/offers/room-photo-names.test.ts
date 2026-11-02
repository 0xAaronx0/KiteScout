// Room photos by file name (Aaron 2026-11-02): reviewed [room, file name] patterns per adapter hand gallery photos to
// the rooms that bring none of their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_PHOTO_FILES, withNamedRoomPhotos } from '../../src/offers/room-photo-names.js';
import { adapters } from '../../src/offers/registry.js';
import type { OfferContent } from '../../src/offers/types.js';

const content = (o: Partial<OfferContent>): OfferContent => ({
  kind: 'accommodation', title: 'T', summary: 'S', continent: null, country: 'X', region: null, spot: null,
  itinerarySpots: [], durationDays: null, skillLevels: [], kiteLessons: null, equipmentRental: null, beginnerFriendly: null,
  includedServices: [], optionalServices: [], accommodation: null, mealPlan: null, languages: [], rooms: [],
  imageUrls: [], heroVideoUrl: null, sourceUrl: 'https://a.example/', bookingUrl: null, sourceText: null, ...o,
});
const room = (name: string, imageUrls?: string[]) => ({ name, description: null, features: [], ...(imageUrls ? { imageUrls } : {}) });

test('withNamedRoomPhotos: gallery files naming a room go to that room, in gallery order; others stay without', () => {
  const gallery = ['Kitchen-1-hor.jpg', 'Pixel_3.jpg', 'Agrumi_1.jpg', 'Pixel-Bathroom-1.jpg', 'Mixed_Dorm_7.jpg', 'hostel-sunset.jpg']
    .map(f => `https://k.example/wp-content/uploads/${f}`);
  const c = withNamedRoomPhotos('kite-hostel-stagnone-marsala', content({
    imageUrls: gallery,
    rooms: [room('Private double room (Pixel)'), room('Private single room (Agrumi)'), room('Mixed dorm'), room('Girls dorm')],
  }));
  assert.deepEqual(c.rooms.map(r => r.imageUrls?.map(u => u.split('/').pop())), [
    ['Pixel_3.jpg', 'Pixel-Bathroom-1.jpg'], ['Agrumi_1.jpg'], ['Mixed_Dorm_7.jpg'], undefined,
  ]);
  assert.deepEqual(c.imageUrls, gallery, 'the gallery itself is untouched');
});

test('withNamedRoomPhotos: accents and "+" in file names are read as a person reads them', () => {
  const c = withNamedRoomPhotos('kite-nomade-arraial-do-cabo', content({
    imageUrls: ['https://n.example/bangalo-lua-1-scaled.jpg', 'https://n.example/suites45e6-5-scaled.jpg'],
    rooms: [room('Bangalô Lua'), room('Suítes 4, 5 e 6')],
  }));
  assert.deepEqual(c.rooms.map(r => r.imageUrls?.length), [1, 1]);
  const f = withNamedRoomPhotos('wind-sports-fiji-nananu-i-ra', content({
    imageUrls: ['https://f.example/Bure+1-2.jpg', 'https://f.example/View+Mango+Top+-10.jpg', 'https://f.example/Top+Mango+Villa+-1.jpg'],
    rooms: [room('Beachfront bure'), room('Shared seaview Mango Lodge')],
  }));
  assert.deepEqual(f.rooms.map(r => r.imageUrls?.map(u => u.split('/').pop())), [['Bure+1-2.jpg'], ['Top+Mango+Villa+-1.jpg']]);
});

test('withNamedRoomPhotos: a room with own photos and an adapter without a list are left alone', () => {
  const own = ['https://k.example/own.jpg'];
  const c = withNamedRoomPhotos('kite-hostel-stagnone-marsala', content({
    imageUrls: ['https://k.example/Pixel_3.jpg'], rooms: [room('Private double room (Pixel)', own)],
  }));
  assert.deepEqual(c.rooms[0].imageUrls, own);
  const other = content({ imageUrls: ['https://k.example/Pixel_3.jpg'], rooms: [room('Private double room (Pixel)')] });
  assert.equal(withNamedRoomPhotos('no-such-adapter', other), other);
});

test('ROOM_PHOTO_FILES: every key is a registered accommodation adapter', () => {
  for (const key of Object.keys(ROOM_PHOTO_FILES)) {
    const a = adapters.find(x => x.key === key);
    assert.ok(a, `${key} is not a registered adapter`);
    assert.equal(a.kind, 'accommodation', key);
  }
});
