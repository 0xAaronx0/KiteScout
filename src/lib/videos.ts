// ---------------------------------------------------------------------------
// Hero-video pipeline: mirror provider-hosted MP4s into our own storage,
// streaming-optimized.
//
// Provider videos are routinely 25–130 MB with the MP4 moov atom at the END —
// the browser must download most of the file before playback starts, which is
// why hero videos "hang" on a still frame. processAndStoreVideo():
//
//   download → ffmpeg (H.264 720p, CRF 27, audio stripped — playback is muted
//   anyway, capped at 40 s for the loop, `-movflags +faststart` so the moov
//   atom leads and playback starts instantly) → upload to the PUBLIC
//   `cruise-videos` bucket → stable public URL for cruise_offers.hero_video_url.
//
// Typical result: 2–6 MB. Uses the ffmpeg-static binary (works locally + CI).
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpegPath from 'ffmpeg-static';
import { supabase } from './supabase.js';

const execFileP = promisify(execFile);

export const CRUISE_VIDEO_BUCKET = 'cruise-videos';
const MAX_SOURCE_MB = 400;   // refuse absurd downloads
const MAX_CLIP_SECONDS = 40; // hero loop length
const MAX_OUTPUT_MB = 10;    // hard cap — anything above gets trimmed shorter
const TARGET_WIDTH = 1280;   // ~720p for 16:9

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let bucketEnsured = false;
async function ensureVideoBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { data } = await supabase.storage.getBucket(CRUISE_VIDEO_BUCKET);
  if (!data) {
    // PUBLIC on purpose: hero_video_url is consumed as a plain URL by the app —
    // no signing round-trip, and the content is the operators' own marketing.
    const { error } = await supabase.storage.createBucket(CRUISE_VIDEO_BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketEnsured = true;
}

export interface StoredVideo {
  publicUrl: string;
  bytes: number;
  sourceUrl: string;
}

/**
 * Download a provider video, transcode it into a small faststart hero clip and
 * upload it to the public cruise-videos bucket. Returns null on any failure —
 * callers keep the original remote URL as fallback.
 */
export async function processAndStoreVideo(sourceUrl: string, path: string): Promise<StoredVideo | null> {
  if (!ffmpegPath) {
    console.error('  [video] ffmpeg-static binary unavailable — keeping remote URL');
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), 'kitescout-video-'));
  const inFile = join(dir, 'in.mp4');
  const outFile = join(dir, 'out.mp4');
  try {
    // 1. Download (streamed to disk — sources can be >100 MB).
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': UA, Accept: 'video/*,*/*;q=0.8' },
      redirect: 'follow',
      // 20 min: provider servers can be extremely slow but steady — abakiting
      // served 26.9 MB at ~45 KB/s (~10 min), which the old 5-min cap aborted.
      signal: AbortSignal.timeout(1_200_000),
    });
    if (!res.ok || !res.body) {
      console.error(`  [video] download failed (${res.status}): ${sourceUrl.slice(0, 80)}`);
      return null;
    }
    const len = parseInt(res.headers.get('content-length') ?? '0', 10);
    if (len > MAX_SOURCE_MB * 1048576) {
      console.error(`  [video] source too large (${Math.round(len / 1048576)} MB): ${sourceUrl.slice(0, 80)}`);
      return null;
    }
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(inFile));

    // 2. Transcode: 720p H.264, muted, capped loop, moov atom up front.
    const transcode = (seconds: number, crf: number) =>
      execFileP(ffmpegPath!, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', inFile,
        '-t', String(seconds),
        '-vf', `scale='min(${TARGET_WIDTH},iw)':-2`,
        '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-an',
        '-movflags', '+faststart',
        outFile,
      ], { timeout: 300_000 });

    await transcode(MAX_CLIP_SECONDS, 27);
    let size = (await stat(outFile)).size;

    // Hard 10 MB cap: high-motion clips can exceed it at 40 s — trim the clip
    // shorter (proportionally to the overshoot) instead of degrading quality.
    if (size > MAX_OUTPUT_MB * 1048576) {
      const shorter = Math.max(8, Math.floor(MAX_CLIP_SECONDS * (MAX_OUTPUT_MB / (size / 1048576)) * 0.9));
      console.log(`  [video] ${Math.round(size / 1048576 * 10) / 10} MB > ${MAX_OUTPUT_MB} MB cap — trimming to ${shorter}s`);
      await transcode(shorter, 28);
      size = (await stat(outFile)).size;
    }

    const out = await readFile(outFile);
    if (size < 50_000) {
      console.error(`  [video] transcode produced a suspiciously small file (${size} B) — keeping remote URL`);
      return null;
    }

    // 3. Upload to the public bucket.
    await ensureVideoBucket();
    const { error } = await supabase.storage
      .from(CRUISE_VIDEO_BUCKET)
      .upload(path, out, { contentType: 'video/mp4', upsert: true, cacheControl: '31536000' });
    if (error) {
      console.error(`  [video] upload failed (${path}): ${error.message}`);
      return null;
    }
    // 4. Poster still (frame at ~0.5 s) stored next to the video as
    //    <path minus .mp4>-poster.jpg. The app derives this URL and uses it as
    //    the <video poster>, so playback starts on an IDENTICAL frame instead
    //    of flashing an unrelated hero photo (Aaron 2026-07-10). Best-effort —
    //    a poster failure never fails the video.
    try {
      const posterFile = join(dir, 'poster.jpg');
      await execFileP(ffmpegPath!, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', '0.5', '-i', outFile,
        '-frames:v', '1', '-q:v', '3',
        posterFile,
      ], { timeout: 60_000 });
      const posterPath = path.replace(/\.mp4$/i, '-poster.jpg');
      const { error: pErr } = await supabase.storage
        .from(CRUISE_VIDEO_BUCKET)
        .upload(posterPath, await readFile(posterFile), { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' });
      if (pErr) console.error(`  [video] poster upload failed (${posterPath}): ${pErr.message}`);
    } catch (err) {
      console.error(`  [video] poster extraction failed: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
    }

    const { data } = supabase.storage.from(CRUISE_VIDEO_BUCKET).getPublicUrl(path);
    return { publicUrl: data.publicUrl, bytes: size, sourceUrl };
  } catch (err) {
    console.error(`  [video] ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* */ });
  }
}
