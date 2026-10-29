// ---------------------------------------------------------------------------
// Preview loops for hero videos (`pnpm cli video-loops`).
//
// For every cruise_offers / package_offers row with a hero_video_url: if the
// public bucket has no loops/<key>.mp4 yet, download the video (ours or the
// provider's), cut a muted 5 s loop at 208x160 plus a still frame
// (src/lib/video-loops.ts) and upload both. Never touches a table row.
// Idempotent: existing loops are skipped. --dry-run only counts.
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
import { supabase } from '../lib/supabase.js';
import { CRUISE_VIDEO_BUCKET } from '../lib/videos.js';
import { LOOP_FOLDER, loopArgs, loopPathsFor, stillArgs } from '../lib/video-loops.js';

const execFileP = promisify(execFile);
const MAX_SOURCE_MB = 200;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface VideoLoopStats {
  videos: number;
  alreadyLooped: number;
  missing: number;
  written: number;
  failed: number;
  failures: string[];
}

/** Distinct hero video URLs of both offer tables (error-checked reads). */
async function heroVideoUrls(): Promise<string[]> {
  const urls = new Set<string>();
  for (const table of ['cruise_offers', 'package_offers']) {
    const { data, error } = await supabase.from(table).select('hero_video_url').not('hero_video_url', 'is', null);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data ?? []) if (typeof row.hero_video_url === 'string' && /^https:\/\//.test(row.hero_video_url)) urls.add(row.hero_video_url.trim());
  }
  return [...urls];
}

async function existingLoops(): Promise<Set<string>> {
  const names = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(CRUISE_VIDEO_BUCKET).list(LOOP_FOLDER, { limit: 1000, offset });
    if (error) throw new Error(`list ${LOOP_FOLDER}: ${error.message}`);
    for (const item of data ?? []) names.add(item.name);
    if (!data || data.length < 1000) return names;
  }
}

async function makeLoop(url: string): Promise<void> {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary unavailable');
  const { video, still } = loopPathsFor(url);
  const dir = await mkdtemp(join(tmpdir(), 'kitescout-loop-'));
  try {
    const inFile = join(dir, 'in.mp4'), loopFile = join(dir, 'loop.mp4'), stillFile = join(dir, 'still.jpg');
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'video/*,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(600_000) });
    if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
    const len = Number.parseInt(res.headers.get('content-length') ?? '0', 10);
    if (len > MAX_SOURCE_MB * 1048576) throw new Error(`source too large (${Math.round(len / 1048576)} MB)`);
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(inFile));
    // Start 1 s in (title cards, fades); a very short video starts at 0.
    try { await execFileP(ffmpegPath, loopArgs(inFile, loopFile), { timeout: 180_000 }); }
    catch { await execFileP(ffmpegPath, loopArgs(inFile, loopFile, 0), { timeout: 180_000 }); }
    try { await execFileP(ffmpegPath, stillArgs(inFile, stillFile), { timeout: 60_000 }); }
    catch { await execFileP(ffmpegPath, stillArgs(inFile, stillFile, 0), { timeout: 60_000 }); }
    if ((await stat(loopFile)).size < 2_000) throw new Error('loop suspiciously small');
    // Still first: the product shows it as the poster while the loop loads.
    for (const [path, file, contentType] of [[still, stillFile, 'image/jpeg'], [video, loopFile, 'video/mp4']] as const) {
      const { error } = await supabase.storage.from(CRUISE_VIDEO_BUCKET)
        .upload(path, await readFile(file), { contentType, upsert: true, cacheControl: '31536000' });
      if (error) throw new Error(`upload ${path}: ${error.message}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runVideoLoops(opts: { dryRun?: boolean; limit?: number } = {}): Promise<VideoLoopStats> {
  const urls = await heroVideoUrls(), have = await existingLoops();
  const missing = urls.filter(url => { const { key } = loopPathsFor(url); return !have.has(`${key}.mp4`) || !have.has(`${key}.jpg`); });
  const stats: VideoLoopStats = { videos: urls.length, alreadyLooped: urls.length - missing.length, missing: missing.length, written: 0, failed: 0, failures: [] };
  if (opts.dryRun) return stats;
  for (const url of missing.slice(0, opts.limit ?? missing.length)) {
    try { await makeLoop(url); stats.written++; console.log(`  loop ${loopPathsFor(url).key}  ${url.slice(0, 90)}`); }
    catch (e) { stats.failed++; stats.failures.push(`${url.slice(0, 90)}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return stats;
}
