// Gallery helper (Aaron 2026-10-31): every room type and the spot inside the download window, one vision seat each,
// stock / AI / floor-plan files left out, rooms linked to their first stored photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNotOwnPhoto, linkRoomImages, planGallery } from '../../src/offers/gallery.js';
import { visionBatch } from '../../src/lib/images.js';
import type { OfferContent } from '../../src/offers/types.js';

const content = (o: Partial<OfferContent>): OfferContent => ({
  kind: 'accommodation', title: 'T', summary: 'S', continent: null, country: 'X', region: null, spot: null,
  itinerarySpots: [], durationDays: null, skillLevels: [], kiteLessons: null, equipmentRental: null, beginnerFriendly: null,
  includedServices: [], optionalServices: [], accommodation: null, mealPlan: null, languages: [], rooms: [],
  imageUrls: [], heroVideoUrl: null, sourceUrl: 'https://a.example/', bookingUrl: null, sourceText: null, ...o,
});
const img = (n: string) => `https://a.example/img/${n}.jpg`;

test('isNotOwnPhoto: stock, AI renderings and floor plans by file name, real photos pass', () => {
  for (const u of [
    'https://www.campingplatz-strandgut.de/images/Start/AdobeStock_650338957.jpeg',
    'https://www.campingplatz-strandgut.de/images/Alternative%20Unterkunfte/Strandgut-Kajueten/ChatGPT%20Image%2019.%20Feb.%202026%2015_40_10%201.png',
    'https://images.squarespace-cdn.com/content/v1/x/ChatGPT%2BImage%2BJan%2B29%252C%2B2026%252C%2B02_25_02%2BPM.png?format=1500w',
    'https://www.aquaventana.com/media/grant-durr-x1y2z3-unsplash.jpg',
    'https://static.wixstatic.com/media/abc/Image%20by%20Jared%20Rice.jpg',
    'https://www.wulfener-hals.de/files/bilder/Surfschule/Firefly%2020250110101353-2.jpg',
    'https://www.wulfener-hals.de/files/bilder/Unterk%C3%BCnfte/Duenenpark/Seeadler/gruindriss%20seeadler%202016.jpg',
    'https://kitemarina.pl/files/gallery/12/rzut_parter.jpg',
    'https://x.example/wp-content/uploads/plano-fluvia.jpg',
    'https://x.example/pexels-sergk1-15204578.jpg',
    'https://www.campingplatz-loissin.de/wp-content/uploads/kitesurfing-4549432_1280.jpg',
    'https://x.example/tho-ge-kite-surfing-7244337_1920-1024x683.jpg',
  ]) assert.ok(isNotOwnPhoto(u), u);
  for (const u of [
    'https://www.campingplatz-strandgut.de/images/Alternative%20Unterkunfte/Tiny%20Wave/k-IMG_0156.jpg',
    'https://x.example/vista-dalle-camere.jpg', // Italian "dalle", not DALL-E
    'https://x.example/logos-beach-village-studio.jpg',
    'https://x.example/kitesurf-stagnone-01.jpg',
    'https://x.example/planet-surf.jpg',
    'https://x.example/IMG_20210616_112959.jpg',
    'https://x.example/beach-2024_1280.jpg',
  ]) assert.ok(!isNotOwnPhoto(u), u);
});

test('planGallery: round-robin, rooms first in each round, then spot, then the general list; duplicates once', () => {
  const c = content({
    imageUrls: [img('home1'), img('a1'), img('home2'), img('home3')],
    rooms: [
      { name: 'A', description: null, features: [], imageUrls: [img('a1'), img('a2'), img('a3')] },
      { name: 'B', description: null, features: [], imageUrls: [img('b1')] },
      { name: 'C', description: null, features: [] },
    ],
    spotImageUrls: [img('kite1'), img('kite2')],
  });
  const p = planGallery(c);
  assert.deepEqual(p.candidates, [
    img('a1'), img('b1'), img('kite1'), img('home1'), // round 0 (home's a1 is the room's photo, kept once)
    img('a2'), img('kite2'), // round 1: general[1] = a1 already in
    img('a3'), img('home2'), // round 2
    img('home3'),
  ]);
  assert.deepEqual(p.reserve.map(g => g.label), ['room type "A"', 'room type "B"', 'the kite spot or people kiting there']);
  assert.deepEqual(p.dropped, []);
});

test('planGallery: without room or spot photos the adapter order stays, only the filter applies', () => {
  const p = planGallery(content({ imageUrls: [img('x'), img('AdobeStock_1'), img('y')] }));
  assert.deepEqual(p.candidates, [img('x'), img('y')]);
  assert.deepEqual(p.reserve, []);
  assert.deepEqual(p.dropped, [img('AdobeStock_1')]);
});

test('planGallery: Strandgut shape (26 Tiny House photos first) now puts all four units inside the first 24', () => {
  const tiny = Array.from({ length: 26 }, (_, i) => img(`tiny-${i}`));
  const c = content({
    imageUrls: [...tiny, img('kaj-1'), img('koje-1')],
    rooms: [
      { name: 'Tiny House', description: null, features: [], imageUrls: tiny },
      { name: 'Kajüte', description: null, features: [], imageUrls: [img('kaj-1'), img('kaj-2')] },
      { name: 'Koje', description: null, features: [], imageUrls: [img('koje-1')] },
      { name: 'Sandbank2Go', description: null, features: [], imageUrls: [img('sand-1'), img('sand-2')] },
    ],
  });
  const first24 = planGallery(c).candidates.slice(0, 24);
  for (const unit of ['tiny-0', 'kaj-1', 'koje-1', 'sand-1']) assert.ok(first24.includes(img(unit)), unit);
});

test('visionBatch: unchanged without groups (largest first, 10); with groups one labelled seat each, then the largest', () => {
  const imgs = Array.from({ length: 14 }, (_, i) => ({ sourceUrl: img(`p${i}`), width: 1000 + i * 10, height: 700 }));
  const plain = visionBatch(imgs);
  assert.equal(plain.length, 10);
  assert.equal(plain[0].img.sourceUrl, img('p13'));
  assert.ok(plain.every(b => b.label === null));

  const groups = [{ label: 'room type "A"', urls: [img('p0'), img('p1')] }, { label: 'room type "B"', urls: [img('p0'), img('p2')] }];
  const b = visionBatch(imgs, groups);
  assert.deepEqual(b.slice(0, 2).map(x => [x.img.sourceUrl, x.label]), [[img('p0'), 'room type "A"'], [img('p2'), 'room type "B"']]);
  assert.equal(b.length, 10); // max(10, 2 + 4)
  assert.equal(b[2].img.sourceUrl, img('p13'));
  assert.equal(new Set(b.map(x => x.img)).size, b.length);

  const many = Array.from({ length: 25 }, (_, i) => ({ label: `room type "${i}"`, urls: [img(`q${i}`)] }));
  const big = Array.from({ length: 30 }, (_, i) => ({ sourceUrl: img(`q${i}`), width: 800, height: 600 }));
  assert.equal(visionBatch(big, many).length, 20); // hard cap
});

test('linkRoomImages: first stored own photo per room (CDN size variants match), others untouched', () => {
  const c = content({
    rooms: [
      { name: 'A', description: null, features: [], imageUrls: ['https://static.wixstatic.com/media/aa~mv2.jpg/v1/fill/w_300,h_200/a.jpg', img('a2')] },
      { name: 'B', description: null, features: [], imageUrls: [img('b1')] },
      { name: 'C', description: null, features: [] },
    ],
  });
  const rooms = [{ name: 'A', image_sort: null }, { name: 'B', image_sort: null }, { name: 'C', image_sort: null }];
  const stored = [
    { source_url: img('home'), sort: 0 },
    { source_url: img('a2'), sort: 1 },
    { source_url: 'https://static.wixstatic.com/media/aa~mv2.jpg', sort: 3 },
  ];
  assert.deepEqual(linkRoomImages(rooms, c, stored).map(r => r.image_sort), [1, null, null]);
  assert.deepEqual(linkRoomImages(rooms, c, []).map(r => r.image_sort), [null, null, null]);
});
