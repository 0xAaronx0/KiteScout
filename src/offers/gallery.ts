// ---------------------------------------------------------------------------
// Gallery planning for offer adapters (Aaron 2026-10-31, a preference, not a rule): if the provider's own site has
// photos per room type, the gallery should show every room type and link each room to its photo; and ideally both the
// accommodation and the spot / people kiting. Never photos from elsewhere: only what the adapter read on the
// provider's own site.
//
// Why a shared helper (docs/room-photo-audit-2026-10-31.md): adapters collect candidates page by page, the curation
// downloads only the first 24 and the vision step sees only the 10 largest, so the first room page used to fill the
// whole gallery (Strandgut: 24 of 24 downloads from the Tiny House page).
//
//   planGallery     candidates for the curation, stock / AI / floor-plan files left out. Since 2026-11-02 a room's
//                   photos live on the room (src/offers/room-photos.ts, Aaron: "not necessarily in the gallery too"),
//                   so the gallery takes only each room type's FIRST photo, and the spot comes first (Aaron 2026-11-02:
//                   "mind. 3 spotfotos ... auch bei unterkünften mit sehr vielen zimmern"): spot 1, general 1, spot 2
//                   and 3, then one photo per room type, then general and spot alternating. MIN_SPOT_PHOTOS reserve
//                   groups give the spot that many labelled seats in the vision batch (src/lib/images.ts visionBatch);
//                   the model may still reject a weak one. Photos of a room that shows the spot itself
//                   (ContentRoom.showsSpot, the Nordsee glamping dome at the kite zone) join the spot pool.
//                   This order only decides what is downloaded and shown to the vision step; for stays the stored
//                   gallery opens with the house from outside, else a room, the spot third (VisionBrief.heroOrder).
//   linkRoomImages  rooms[].image_sort = sort of the room's first stored photo (null when none was kept)
// ---------------------------------------------------------------------------
import { imageIdentity, type ReserveGroup, type StoredImage } from '../lib/images.js';
import type { OfferContent } from './types.js';

/**
 * File names that are not the provider's own photo of the place, even on its own domain: stock libraries, AI renderings
 * and floor plans (seen 2026-10-31: AdobeStock_* on Strandgut and Hvide Sande, "ChatGPT Image ..." on Panama Kite House
 * and Strandgut, Adobe "Firefly ..." on Wulfener Hals, *-unsplash.jpg on Aqua Ventana, "gruindriss" / rzut_ plans).
 */
export const NOT_OWN_PHOTO_RE = new RegExp([
  // stock libraries (file-name markers; foreign stock hosts are flagged separately in lib/images extractImageRights)
  'adobe[\\s_-]?stock', 'shutterstock', 'istock(?:photo)?[\\s_-]', 'gettyimages', 'depositphotos', 'dreamstime', '(?<![a-z])123rf',
  '[\\s_-]unsplash(?![a-z])', '(?<![a-z])unsplash[\\s_-]', '(?<![a-z])pexels[\\s_-]', '(?<![a-z])pixabay', '(?<![a-z])freepik',
  '^image by [a-z]+ [a-z]+', // Wix stock library file names ("Image by Jared Rice.jpg")
  '-\\d{6,8}_(?:640|960|1280|1920)(?:-\\d+x\\d+)?\\.(?:jpe?g|png|webp)$', // Pixabay download names ("kitesurfing-4549432_1280.jpg")
  // AI renderings
  'chat\\s?gpt[\\s_-]*image', '(?<![a-z])dall[\\s_·-]e(?![a-z])', 'midjourney', '(?<![a-z])firefly(?![a-z])', 'stable[\\s_-]?diffusion', '(?<![a-z])ai[\\s_-]generated',
  // floor plans and site maps
  'grundriss', 'gruindriss', 'floor[\\s_-]?plan', '(?<![a-z])plano[\\s_-]', '(?<![a-z])rzut[\\s_-]', 'lageplan', 'platzplan', '(?<![a-z])site[\\s_-]?plan',
].join('|'), 'i');

/** file name of an image URL as a person reads it ("ChatGPT%2BImage%2BJan" -> "ChatGPT Image Jan") */
function fileName(url: string): string {
  let path: string;
  try { path = new URL(url).pathname; } catch { path = url.split('?')[0]; }
  let name = path.split('/').filter(Boolean).pop() ?? '';
  for (let i = 0; i < 2; i++) {
    try { name = decodeURIComponent(name); } catch { break; }
  }
  return name.replace(/\+/g, ' ').trim();
}

export function isNotOwnPhoto(url: string): boolean {
  return NOT_OWN_PHOTO_RE.test(fileName(url));
}

export interface GalleryPlan {
  /** candidate URLs for curateAndStoreImages, ordered so the spot and every room type sit inside the download window */
  candidates: string[];
  /** MIN_SPOT_PHOTOS seats for the spot (room types get no reserved seat since 2026-11-02, see the header) */
  reserve: ReserveGroup[];
  /** URLs left out as stock / AI / floor plan */
  dropped: string[];
}

/** Aaron 2026-11-02: at least this many spot photos in the gallery when the site has good ones, however many rooms. */
export const MIN_SPOT_PHOTOS = 3;
export const SPOT_LABEL = 'the kite spot or people kiting there';

/** [a0, b0, c0, a1, b1, ...] */
function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  for (let k = 0; k < Math.max(0, ...lists.map(l => l.length)); k++) for (const l of lists) if (k < l.length) out.push(l[k]);
  return out;
}

/**
 * The spot first, then one photo per room type, then the rest: spot 1, general 1, spot 2..MIN_SPOT_PHOTOS, the first
 * photo of every room type (rooms[] order), then general and spot alternating. Without room or spot photos the order
 * is the adapter's own (only the filter applies).
 */
export function planGallery(c: OfferContent): GalleryPlan {
  const dropped: string[] = [];
  const keep = (urls: string[] | undefined) => (urls ?? []).filter(u => {
    if (!isNotOwnPhoto(u)) return true;
    if (!dropped.includes(u)) dropped.push(u);
    return false;
  });
  const general = keep(c.imageUrls);
  const rooms = c.rooms.map(r => ({ urls: keep(r.imageUrls), showsSpot: !!r.showsSpot }));
  // own spot photos, interleaved with the photos of rooms that show the spot themselves
  const spot = interleave([keep(c.spotImageUrls), ...rooms.filter(r => r.showsSpot).map(r => r.urls)]);

  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (u: string | undefined) => {
    if (!u) return;
    const id = imageIdentity(u);
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(u);
  };
  add(spot[0]);
  add(general[0]);
  for (let i = 1; i < MIN_SPOT_PHOTOS; i++) add(spot[i]);
  for (const r of rooms) add(r.urls[0]);
  for (let g = 1, s = MIN_SPOT_PHOTOS; g < general.length || s < spot.length; g++, s++) {
    add(general[g]);
    add(spot[s]);
  }

  const seats = Math.min(MIN_SPOT_PHOTOS, new Set(spot.map(imageIdentity)).size);
  const reserve: ReserveGroup[] = Array.from({ length: seats }, () => ({ label: SPOT_LABEL, urls: spot }));
  return { candidates, reserve, dropped };
}

/**
 * Sets image_sort on the stored rooms: the sort of the first stored image that is one of the room's own photos
 * (same identity as in the curation, so CDN size variants match). Rooms without own photos keep their value.
 */
export function linkRoomImages<R extends { name: string; image_sort: number | null }>(
  rooms: R[],
  c: OfferContent,
  images: Array<Pick<StoredImage, 'source_url' | 'sort'>>,
): R[] {
  const byId = new Map<string, number>();
  for (const img of [...images].sort((a, b) => a.sort - b.sort)) {
    const id = imageIdentity(img.source_url);
    if (!byId.has(id)) byId.set(id, img.sort);
  }
  return rooms.map(r => {
    const own = c.rooms.find(x => x.name === r.name)?.imageUrls ?? [];
    if (own.length === 0) return r;
    const sorts = own.map(u => byId.get(imageIdentity(u))).filter((s): s is number => s !== undefined);
    return { ...r, image_sort: sorts.length ? Math.min(...sorts) : null };
  });
}
