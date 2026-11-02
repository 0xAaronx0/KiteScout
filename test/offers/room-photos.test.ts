// Room photos on the room (Aaron 2026-11-02): own photos per room type, capped, stored below the listing's folder,
// carried over by room name when an ingest runs without --room-photos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { keepRoomPhotos, roomPhotoPlan, storeRoomPhotos, withRoomPhotos, type RoomPhoto } from '../../src/offers/room-photos.js';
import { roomPhotoStats } from '../../src/offers/ingest.js';
import type { OfferContent } from '../../src/offers/types.js';

const content = (o: Partial<OfferContent>): OfferContent => ({
  kind: 'accommodation', title: 'T', summary: 'S', continent: null, country: 'X', region: null, spot: null,
  itinerarySpots: [], durationDays: null, skillLevels: [], kiteLessons: null, equipmentRental: null, beginnerFriendly: null,
  includedServices: [], optionalServices: [], accommodation: null, mealPlan: null, languages: [], rooms: [],
  imageUrls: [], heroVideoUrl: null, sourceUrl: 'https://a.example/', bookingUrl: null, sourceText: null, ...o,
});
const img = (n: string) => `https://a.example/img/${n}.jpg`;
const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#4a8' } }).jpeg().toBuffer();

test('roomPhotoPlan: own photos per room, stock / AI / plans out, CDN size variants once, capped at 3, empty rooms absent', () => {
  const c = content({
    rooms: [
      { name: 'Suite', description: null, features: [], imageUrls: [
        'https://static.wixstatic.com/media/aa~mv2.jpg/v1/fill/w_300,h_200/a.jpg', 'https://static.wixstatic.com/media/aa~mv2.jpg',
        img('AdobeStock_99'), img('s2'), img('s3'), img('s4'),
      ] },
      { name: 'Dorm', description: null, features: [] },
      { name: 'Loft', description: null, features: [], imageUrls: [img('grundriss-loft')] },
    ],
  });
  const plan = roomPhotoPlan(c);
  assert.deepEqual(plan.map(r => r.name), ['Suite']);
  assert.equal(plan[0].urls.length, 3);
  assert.deepEqual(plan[0].urls.slice(1), [img('s2'), img('s3')]);
});

test('storeRoomPhotos: paths below the listing folder, small files and failed downloads skipped, room slugs unique', async () => {
  const big = await jpeg(900, 600), small = await jpeg(300, 200);
  const files: Record<string, Buffer> = { [img('a1')]: small, [img('a2')]: big, [img('b1')]: big };
  const c = content({
    rooms: [
      { name: 'Sea view', description: null, features: [], imageUrls: [img('a1'), img('a2'), img('gone')] },
      { name: 'Sea-View', description: null, features: [], imageUrls: [img('b1')] },
      { name: 'Garden', description: null, features: [], imageUrls: [img('a1')] },
    ],
  });
  const stored: string[] = [];
  const photos = await storeRoomPhotos(c, 'packages/accommodation/t-site-x',
    async (buf, sourceUrl, path) => { stored.push(path); return { path, source_url: sourceUrl, width: 900, height: 600, bytes: buf.byteLength }; },
    async url => files[url] ?? null);
  assert.deepEqual(stored, ['packages/accommodation/t-site-x/rooms/sea-view/0.webp', 'packages/accommodation/t-site-x/rooms/sea-view-2/0.webp']);
  assert.deepEqual([...photos.keys()], ['Sea view', 'Sea-View']);
  assert.equal(photos.get('Sea view')![0].source_url, img('a2'));
  const stats = roomPhotoStats(c, photos);
  assert.deepEqual({ ...stats, bytes: stats.bytes > 0 }, { rooms: 3, withPhoto: 2, photos: 2, bytes: true });
});

test('keepRoomPhotos: a run without --room-photos keeps the stored photos by room name; renamed rooms lose theirs', () => {
  const p: RoomPhoto = { path: 'x/rooms/a/0.webp', thumb_path: 'x/rooms/a/0.thumb.webp', source_url: img('a'), width: 1, height: 1, bytes: 1 };
  const previous = [{ name: 'A', photos: [p] }, { name: 'Old name', photos: [p] }, { name: 'C', photos: [] }];
  const rooms = [{ name: 'A', image_sort: 2 }, { name: 'B', image_sort: null }, { name: 'C', image_sort: null }];
  assert.deepEqual(keepRoomPhotos(rooms, previous), [{ name: 'A', image_sort: 2, photos: [p] }, { name: 'B', image_sort: null }, { name: 'C', image_sort: null }]);
  assert.deepEqual(keepRoomPhotos(rooms, null), rooms);
  assert.deepEqual(withRoomPhotos(rooms, new Map([['B', [p]]])).map(r => r.photos?.length ?? 0), [0, 1, 0]);
});
