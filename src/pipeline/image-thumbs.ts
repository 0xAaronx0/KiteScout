// ---------------------------------------------------------------------------
// Backfill gallery thumbnails (`pnpm cli images-thumbs`).
//
// For every entry in cruise_offers.images / package_offers.images without a
// `thumb_path`: download the stored original from the private bucket, write
// `<name>.thumb.webp` next to it, then add ONLY `thumb_path` to the row's
// images JSON. The row is re-read right before the write and merged by `path`,
// so a concurrent media apply is not clobbered: no reorder, no dropped
// entries, no other key touched. Idempotent (entries with a thumb are skipped).
//
// --dry-run reads only: no bucket upload, no DB update, just counts.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase.js';
import { CRUISE_IMAGE_BUCKET, uploadThumbToBucket } from '../lib/images.js';
import { createThumb, mergeThumbPaths, needsThumb } from '../lib/thumbs.js';

const TABLES = { cruise: 'cruise_offers', package: 'package_offers' } as const;
type TableKey = keyof typeof TABLES;
const PAGE = 500;

export interface ThumbTableStats {
  table: string;
  rows: number;
  rowsWithImages: number;
  rowsNeedingThumbs: number;
  images: number;
  alreadyThumbed: number;
  missing: number;
  /** entries without a usable string `path` (never thumbed) */
  noPath: number;
  /** rows processed (limited by --limit); 0 on a dry run */
  processedRows: number;
  thumbsWritten: number;
  thumbsFailed: number;
  rowsUpdated: number;
}

type Row = { id: string; images: unknown };

async function readAllRows(table: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('id, images').order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function downloadOriginal(path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(CRUISE_IMAGE_BUCKET).download(path);
  if (error || !data) {
    console.warn(`  download failed (${path}): ${error?.message ?? 'no data'}`);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

async function backfillTable(key: TableKey, opts: { dryRun: boolean; limit?: number }): Promise<ThumbTableStats> {
  const table = TABLES[key];
  const rows = await readAllRows(table);
  const s: ThumbTableStats = {
    table, rows: rows.length, rowsWithImages: 0, rowsNeedingThumbs: 0, images: 0, alreadyThumbed: 0,
    missing: 0, noPath: 0, processedRows: 0, thumbsWritten: 0, thumbsFailed: 0, rowsUpdated: 0,
  };
  const todo: Row[] = [];
  for (const r of rows) {
    const imgs = Array.isArray(r.images) ? r.images : [];
    if (imgs.length === 0) continue;
    s.rowsWithImages++;
    let rowMissing = 0;
    for (const img of imgs) {
      s.images++;
      if (img && typeof img === 'object' && (img as { thumb_path?: unknown }).thumb_path) s.alreadyThumbed++;
      else if (needsThumb(img)) rowMissing++;
      else s.noPath++;
    }
    s.missing += rowMissing;
    if (rowMissing > 0) { s.rowsNeedingThumbs++; todo.push(r); }
  }
  if (opts.dryRun) return s;

  const batch = opts.limit && opts.limit > 0 ? todo.slice(0, opts.limit) : todo;
  for (const r of batch) {
    s.processedRows++;
    const thumbs = new Map<string, string>();
    const paths = [...new Set((r.images as unknown[]).filter(needsThumb).map(i => i.path))];
    for (const path of paths) {
      const buf = await downloadOriginal(path);
      const tp = buf ? await createThumb(buf, path, uploadThumbToBucket) : null;
      if (tp) { thumbs.set(path, tp); s.thumbsWritten++; } else s.thumbsFailed++;
    }
    if (thumbs.size === 0) continue;

    // re-read right before writing: a media apply may have replaced the images meanwhile
    const { data: fresh, error: rErr } = await supabase.from(table).select('images').eq('id', r.id).single();
    if (rErr) { console.error(`  ✗ ${table} ${r.id}: re-read failed: ${rErr.message}`); continue; }
    const current = Array.isArray(fresh?.images) ? (fresh.images as Record<string, unknown>[]) : [];
    const { images, added } = mergeThumbPaths(current, thumbs);
    if (added === 0) continue;
    const { error: uErr } = await supabase.from(table).update({ images }).eq('id', r.id);
    if (uErr) { console.error(`  ✗ ${table} ${r.id}: update failed: ${uErr.message}`); continue; }
    s.rowsUpdated++;
    console.log(`  ✓ ${table} ${r.id}: +${added} thumb_path`);
  }
  return s;
}

export async function runImageThumbs(opts: { dryRun: boolean; limit?: number; table?: TableKey }): Promise<ThumbTableStats[]> {
  const keys: TableKey[] = opts.table ? [opts.table] : ['cruise', 'package'];
  const out: ThumbTableStats[] = [];
  for (const k of keys) out.push(await backfillTable(k, opts));
  return out;
}

export function isThumbTable(v: string | undefined): v is TableKey {
  return v === 'cruise' || v === 'package';
}
