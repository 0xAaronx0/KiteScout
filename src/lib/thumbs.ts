// ---------------------------------------------------------------------------
// Gallery thumbnails for stored offer images.
//
// The product's gallery strip shows 80x70 tiles; loading the full 1280 px WebP
// (25-100 KB) for each tile wastes bandwidth. Every stored image therefore gets
// a small WebP next to it (`<name>.thumb.webp`, 160x140 = 2x the tile, cover
// crop) in the same private bucket, referenced by `thumb_path` in the image's
// JSON object. The product tolerates extra keys, so `thumb_path` is additive.
//
// A thumbnail is a nice-to-have: any failure returns null and the image is
// kept without `thumb_path` (never dropped, never failed).
//
// Kept free of the Supabase client so it is testable without env; callers pass
// the uploader.
// ---------------------------------------------------------------------------

import sharp from 'sharp';

export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 140;
export const THUMB_QUALITY = 60;

/** `.../3.webp` -> `.../3.thumb.webp`; a path without extension gets `.thumb.webp` appended. */
export function thumbPathFor(path: string): string {
  if (/\.thumb\.webp$/i.test(path)) return path;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const base = dot > slash + 1 ? path.slice(0, dot) : path;
  return `${base}.thumb.webp`;
}

/** 160x140 WebP cover crop (centre, like the tile's object-fit: cover). Throws on unreadable input. */
export async function renderThumb(src: Buffer): Promise<Buffer> {
  return sharp(src)
    .rotate()
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'centre' })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}

export type ThumbUploader = (path: string, buf: Buffer) => Promise<{ error: { message: string } | null }>;

/**
 * Render + upload the thumbnail for the image stored at `imagePath`.
 * Returns the thumb path, or null on ANY failure (logged, never thrown).
 */
export async function createThumb(src: Buffer, imagePath: string, upload: ThumbUploader): Promise<string | null> {
  const tp = thumbPathFor(imagePath);
  if (tp === imagePath) return null; // never overwrite an original that already looks like a thumb
  try {
    const thumb = await renderThumb(src);
    const { error } = await upload(tp, thumb);
    if (error) {
      console.warn(`  thumbnail upload failed (${tp}): ${error.message}`);
      return null;
    }
    return tp;
  } catch (e) {
    console.warn(`  thumbnail failed (${tp}): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** The image with `thumb_path` set, or unchanged (no `thumb_path` key) when there is none. */
export function withThumbPath<T extends object>(img: T, thumbPath: string | null): T & { thumb_path?: string } {
  return thumbPath ? { ...img, thumb_path: thumbPath } : img;
}

type ImageEntry = { path?: unknown; thumb_path?: unknown } & Record<string, unknown>;

/**
 * Add `thumb_path` from `thumbs` (image path -> thumb path) to the entries that
 * lack one. Order, length and every other key stay exactly as in `current`;
 * entries that already have a `thumb_path` are left alone.
 */
export function mergeThumbPaths<T extends ImageEntry>(
  current: readonly T[],
  thumbs: ReadonlyMap<string, string>,
): { images: T[]; added: number } {
  let added = 0;
  const images = current.map(img => {
    if (!img || typeof img !== 'object') return img;
    if (typeof img.path !== 'string' || img.thumb_path) return img;
    const tp = thumbs.get(img.path);
    if (!tp) return img;
    added++;
    return { ...img, thumb_path: tp };
  });
  return { images, added };
}

/** Entries that still need a thumbnail: a string `path` and no `thumb_path`. */
export function needsThumb(img: unknown): img is { path: string } {
  if (!img || typeof img !== 'object') return false;
  const o = img as ImageEntry;
  return typeof o.path === 'string' && o.path.length > 0 && !o.thumb_path;
}
