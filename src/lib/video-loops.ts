// ---------------------------------------------------------------------------
// Preview loops for hero videos (Aaron 2026-10-29: "5-Sekunden-Snippet ...
// 100 mal 50 Pixeln ... loopen").
//
// The map's offer list shows a 52x40 preview per row. A hero video there would
// cost 2-10 MB per row, so every hero video gets a muted 5 s loop at 208x160
// (2x the tile, cover crop, ~15-35 KB) plus a still frame (~5 KB) in the PUBLIC
// cruise-videos bucket:
//
//   loops/<key>.mp4   loops/<key>.jpg   with key = sha256(hero_video_url)[0..16]
//
// The key depends only on the video URL, so the product can derive both URLs
// without a schema change, and a replaced hero video gets a new loop. Callers
// treat a missing loop as "no preview" (the product falls back to its tile).
//
// Kept free of the Supabase client so it is testable without env.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const LOOP_FOLDER = 'loops';
export const LOOP_WIDTH = 208;
export const LOOP_HEIGHT = 160;
export const LOOP_SECONDS = 5;
export const LOOP_START_SECONDS = 1;

/** Stable 16-hex key for a hero video URL (the product computes the same). */
export function loopKeyFor(videoUrl: string): string {
  return createHash('sha256').update(videoUrl.trim()).digest('hex').slice(0, 16);
}

export function loopPathsFor(videoUrl: string): { key: string; video: string; still: string } {
  const key = loopKeyFor(videoUrl);
  return { key, video: `${LOOP_FOLDER}/${key}.mp4`, still: `${LOOP_FOLDER}/${key}.jpg` };
}

const cover = `scale=${LOOP_WIDTH}:${LOOP_HEIGHT}:force_original_aspect_ratio=increase,crop=${LOOP_WIDTH}:${LOOP_HEIGHT}`;

/** ffmpeg args for the muted 5 s loop (H.264 baseline, 15 fps, faststart so it starts at once). */
export function loopArgs(inFile: string, outFile: string, startSeconds = LOOP_START_SECONDS): string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(startSeconds), '-t', String(LOOP_SECONDS), '-i', inFile,
    '-an', '-vf', `${cover},fps=15`, '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-crf', '30',
    '-preset', 'veryfast', '-movflags', '+faststart', outFile];
}

/** ffmpeg args for the still frame shown before (or instead of) the loop. */
export function stillArgs(inFile: string, outFile: string, startSeconds = LOOP_START_SECONDS): string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(startSeconds), '-i', inFile, '-frames:v', '1', '-vf', cover, '-q:v', '5', outFile];
}
