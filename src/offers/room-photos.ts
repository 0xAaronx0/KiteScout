// ---------------------------------------------------------------------------
// Room photos (Aaron 2026-11-02): a room's own photos sit in the opened room as a preview that opens large, so they are
// stored per room (rooms[].photos) instead of competing for gallery seats. Only the provider's own photos of exactly
// that room type (ContentRoom.imageUrls, read by the adapter on the provider's site); no vision step, no LLM cost.
//
//   roomPhotoPlan     per room the first ROOM_PHOTO_CAP own photos (stock / AI / plans left out, duplicates once)
//   storeRoomPhotos   download (robots.txt honoured), size floor, WebP + thumbnail into the private bucket
//   keepRoomPhotos    an ingest without --room-photos carries the stored photos over by room name
// ---------------------------------------------------------------------------
import sharp from 'sharp';
import { downloadImage, imageIdentity, processAndStoreImage, slugify } from '../lib/images.js';
import { isNotOwnPhoto } from './gallery.js';
import type { OfferContent } from './types.js';

export const ROOM_PHOTO_CAP = 3;
/**
 * below the gallery floor (src/lib/images.ts 500 x 330): a room photo only opens in the room's own dialog, so a
 * provider's smaller room pictures still count (Aaron 2026-11-02: "für zimmerbilder ist das imho kein problem - nur
 * nicht in die gallerie"); smaller files than this are icons or thumbnails
 */
export const ROOM_PHOTO_MIN_WIDTH = 400;
export const ROOM_PHOTO_MIN_HEIGHT = 250;

export interface RoomPhoto {
  path: string;
  /** 160x140 WebP next to `path`; absent when it could not be made */
  thumb_path?: string;
  source_url: string;
  width: number;
  height: number;
  bytes: number;
}

export function roomPhotoPlan(c: OfferContent, cap = ROOM_PHOTO_CAP): Array<{ name: string; urls: string[] }> {
  return c.rooms.map(r => {
    const seen = new Set<string>();
    const urls = (r.imageUrls ?? []).filter(u => {
      const id = imageIdentity(u);
      if (isNotOwnPhoto(u) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return { name: r.name, urls: urls.slice(0, cap) };
  }).filter(r => r.urls.length > 0);
}

/** One downloaded photo as stored (or, in a dry run, as it would be stored); null when unusable. */
export type RoomPhotoStore = (buf: Buffer, sourceUrl: string, path: string) => Promise<RoomPhoto | null>;

export const uploadRoomPhoto: RoomPhotoStore = async (buf, sourceUrl, path) => {
  const s = await processAndStoreImage(buf, sourceUrl, path, 0);
  return s ? { path: s.path, ...(s.thumb_path ? { thumb_path: s.thumb_path } : {}), source_url: s.source_url, width: s.width, height: s.height, bytes: s.bytes } : null;
};

/** Dry run: the same WebP conversion as the upload, measured only. */
export const measureRoomPhoto: RoomPhotoStore = async (buf, sourceUrl, path) => {
  try {
    const out = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    const m = await sharp(out).metadata();
    return { path, source_url: sourceUrl, width: m.width ?? 0, height: m.height ?? 0, bytes: out.byteLength };
  } catch {
    return null;
  }
};

/** Stores each room's own photos under `<pathPrefix>/rooms/<room slug>/<n>.webp`; rooms without a usable photo are absent. */
export async function storeRoomPhotos(
  c: OfferContent,
  pathPrefix: string,
  store: RoomPhotoStore = uploadRoomPhoto,
  download: (url: string) => Promise<Buffer | null> = downloadImage,
): Promise<Map<string, RoomPhoto[]>> {
  const out = new Map<string, RoomPhoto[]>();
  const slugs = new Set<string>();
  for (const room of roomPhotoPlan(c)) {
    let slug = slugify(room.name) || 'room';
    for (let n = 2; slugs.has(slug); n++) slug = `${slugify(room.name) || 'room'}-${n}`;
    slugs.add(slug);
    const photos: RoomPhoto[] = [];
    for (const url of room.urls) {
      const buf = await download(url);
      if (!buf) continue;
      try {
        const m = await sharp(buf, { failOn: 'none' }).metadata();
        if ((m.width ?? 0) < ROOM_PHOTO_MIN_WIDTH || (m.height ?? 0) < ROOM_PHOTO_MIN_HEIGHT) continue;
      } catch { continue; }
      const p = await store(buf, url, `${pathPrefix}/rooms/${slug}/${photos.length}.webp`);
      if (p) photos.push(p);
    }
    if (photos.length) out.set(room.name, photos);
  }
  return out;
}

/** Sets rooms[].photos from a fresh store (by room name); rooms without photos get none. */
export function withRoomPhotos<R extends { name: string }>(rooms: R[], photos: Map<string, RoomPhoto[]>): Array<R & { photos?: RoomPhoto[] }> {
  return rooms.map(r => {
    const own = photos.get(r.name);
    return own ? { ...r, photos: own } : r;
  });
}

/** Carries the stored photos of the previous row over by room name (rooms are rebuilt on every full ingest). */
export function keepRoomPhotos<R extends { name: string }>(rooms: R[], previous: unknown): Array<R & { photos?: RoomPhoto[] }> {
  const byName = new Map<string, RoomPhoto[]>();
  for (const r of Array.isArray(previous) ? previous : []) {
    const p = r as { name?: unknown; photos?: unknown };
    if (typeof p.name === 'string' && Array.isArray(p.photos) && p.photos.length) byName.set(p.name, p.photos as RoomPhoto[]);
  }
  return withRoomPhotos(rooms, byName);
}
