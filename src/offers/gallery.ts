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
//   planGallery     candidates mixed round-robin (one photo per room type, the spot, the general list, then the
//                   second photos ...), stock / AI / floor-plan files left out, one reserve group per room type and
//                   one for the spot (a labelled seat in the vision batch, see src/lib/images.ts visionBatch)
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
  /** candidate URLs for curateAndStoreImages, mixed so every room type and the spot sit inside the download window */
  candidates: string[];
  /** one group per room type with photos, plus the spot */
  reserve: ReserveGroup[];
  /** URLs left out as stock / AI / floor plan */
  dropped: string[];
}

/**
 * Round-robin over the sources: round k takes the k-th photo of every room type (in rooms[] order), the k-th spot photo
 * and the k-th general candidate. Without room or spot photos the order is the adapter's own (only the filter applies).
 */
export function planGallery(c: OfferContent): GalleryPlan {
  const dropped: string[] = [];
  const keep = (urls: string[] | undefined) => (urls ?? []).filter(u => {
    if (!isNotOwnPhoto(u)) return true;
    if (!dropped.includes(u)) dropped.push(u);
    return false;
  });
  const general = keep(c.imageUrls);
  const rooms = c.rooms.map(r => ({ name: r.name, urls: keep(r.imageUrls) }));
  const spot = keep(c.spotImageUrls);
  const sources = [...rooms.map(r => r.urls), spot, general].filter(l => l.length > 0);

  const seen = new Set<string>();
  const candidates: string[] = [];
  const add = (u: string) => {
    const id = imageIdentity(u);
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(u);
  };
  const longest = Math.max(0, ...sources.map(l => l.length));
  for (let k = 0; k < longest; k++) for (const list of sources) if (k < list.length) add(list[k]);

  const reserve: ReserveGroup[] = [
    ...rooms.filter(r => r.urls.length > 0).map(r => ({ label: `room type "${r.name}"`, urls: r.urls })),
    ...(spot.length > 0 ? [{ label: 'the kite spot or people kiting there', urls: spot }] : []),
  ];
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
