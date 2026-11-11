// Clears the Google numbers the old review jobs scraped from Google Maps (KCS#607, Aaron 2026-10-31: collection
// stopped in c449ac8, the stored values are cleared in a separate step with a backup).
//
// Per row of cruise_providers and providers:
//   google_rating, google_review_count  -> null
//   avg_rating                          -> on rows with a Google number: mean of the Tripadvisor and bSTOKED ratings
//                                          (averageRating), so no Google number stays inside it; a stale average on
//                                          a row without Google numbers is only counted (stale_avg_untouched)
//   review_match_notes                  -> "Google: ..." segments removed (the verifier's notes on the Maps listing;
//                                          --keep-notes leaves them)
// Kept: google_url, google_place_id, google_place_matched_at (KCS fetches the rating live by place ID).
//
//   pnpm cli google-scrape-cleanup                                     dry run: counts only, writes nothing
//   pnpm cli google-scrape-cleanup --apply --backup <file.json>        backup first (outside the repo), then write
//   pnpm cli google-scrape-cleanup --restore <file.json> [--apply]     put the backed-up values back (dry run without --apply)
//
// Every write is guarded: a row is only changed while it still holds the values the backup recorded (apply) or the
// values the apply wrote (restore); a row someone changed in between is skipped and reported.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { supabase as SupabaseClient } from '../lib/supabase.js';
import { averageRating } from './operator-review-patch.js';

export const TABLES = ['cruise_providers', 'providers'] as const;
export type CleanupTable = typeof TABLES[number];
/** Columns the cleanup may change; the backup holds all of them for every affected row. */
export const CLEANED_COLUMNS = ['google_rating', 'google_review_count', 'avg_rating', 'review_match_notes'] as const;
export type CleanedColumn = typeof CLEANED_COLUMNS[number];
/** Read with every row and kept in the backup for reference, never written. */
export const REFERENCE_COLUMNS = ['root_domain', 'status', 'google_url', 'google_place_id', 'tripadvisor_rating', 'bstoked_rating'] as const;

export type ProviderRow = Record<string, unknown> & { id: string };
export type ColumnValues = Partial<Record<CleanedColumn, unknown>>;
export type BackupRow = { table: CleanupTable; id: string; before: Record<CleanedColumn, unknown>; after: ColumnValues;
  reference: Record<string, unknown> };
export type Backup = { kind: 'google-scrape-cleanup-backup'; version: 1; created_at: string; supabase_host: string;
  options: { notes: boolean }; rows: BackupRow[] };

const present = (v: unknown) => v !== null && v !== undefined;
const asNumber = (v: unknown) => (present(v) && Number.isFinite(Number(v)) ? Number(v) : null);
const hasGoogleNumber = (row: Record<string, unknown>) => present(row.google_rating) || present(row.google_review_count);
/** An average that matches none of the present Tripadvisor/bSTOKED ratings on a row without Google numbers (reported, never written). */
export const staleAverageWithoutGoogle = (row: Record<string, unknown>) => !hasGoogleNumber(row) && asNumber(row.avg_rating) !== averageRating(row);

/** review_match_notes without its "Google: ..." segments; null when nothing else is left. */
export function stripGoogleNotes(notes: unknown): string | null {
  if (typeof notes !== 'string') return null;
  const kept = notes.split(' | ').filter(seg => seg.trim() && !/^google:/i.test(seg.trim()));
  return kept.length ? kept.join(' | ') : null;
}

/** The columns one row changes (only those that differ), or null when the row is already clean. */
export function cleanupPatch(row: Record<string, unknown>, opts: { notes: boolean }): ColumnValues | null {
  const patch: ColumnValues = {};
  if (present(row.google_rating)) patch.google_rating = null;
  if (present(row.google_review_count)) patch.google_review_count = null;
  // Only an average next to a Google number can hold one; a stale average elsewhere is not this cleanup's business.
  const avg = averageRating(row);
  if (hasGoogleNumber(row) && asNumber(row.avg_rating) !== avg) patch.avg_rating = avg;
  if (opts.notes) {
    const notes = stripGoogleNotes(row.review_match_notes);
    if ((row.review_match_notes ?? null) !== notes) patch.review_match_notes = notes;
  }
  return Object.keys(patch).length ? patch : null;
}

export function backupRow(table: CleanupTable, row: ProviderRow, after: ColumnValues): BackupRow {
  return {
    table, id: row.id, after,
    before: Object.fromEntries(CLEANED_COLUMNS.map(c => [c, row[c] ?? null])) as Record<CleanedColumn, unknown>,
    reference: Object.fromEntries(REFERENCE_COLUMNS.map(c => [c, row[c] ?? null])),
  };
}

export type Summary = { table: CleanupTable; rows: number; affected: number; google_rating: number; google_review_count: number;
  avg_rating: number; review_match_notes: number; stale_avg_untouched: number };

/** Counts per table and column for the dry run and the report. */
export function summarize(table: CleanupTable, rows: Record<string, unknown>[], planned: BackupRow[]): Summary {
  const mine = planned.filter(p => p.table === table);
  const changes = (c: CleanedColumn) => mine.filter(p => c in p.after).length;
  return {
    table, rows: rows.length, affected: mine.length,
    google_rating: changes('google_rating'), google_review_count: changes('google_review_count'),
    avg_rating: changes('avg_rating'), review_match_notes: changes('review_match_notes'),
    stale_avg_untouched: rows.filter(staleAverageWithoutGoogle).length,
  };
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The backup holds operator rows: it must never land inside the (public) repo, and never overwrite a file. */
export function assertBackupPath(path: string, repoRoot = REPO_ROOT): string {
  const abs = resolve(path), root = resolve(repoRoot);
  if (abs.toLowerCase() === root.toLowerCase() || abs.toLowerCase().startsWith(root.toLowerCase() + sep))
    throw new Error(`backup path ${abs} is inside the repo; use ~/kitescout-backups/`);
  if (!abs.endsWith('.json')) throw new Error('backup path must end in .json');
  if (existsSync(abs)) throw new Error(`backup ${abs} exists already; pick a new name (no overwrite)`);
  return abs;
}

export function parseBackup(text: string): Backup {
  const b = JSON.parse(text) as Backup;
  if (b?.kind !== 'google-scrape-cleanup-backup' || b.version !== 1 || !Array.isArray(b.rows)) throw new Error('not a google-scrape-cleanup backup (v1)');
  for (const r of b.rows) {
    if (!(TABLES as readonly string[]).includes(r?.table) || typeof r.id !== 'string' || !r.before || !r.after)
      throw new Error(`malformed backup row ${JSON.stringify(r).slice(0, 120)}`);
    for (const c of Object.keys(r.after)) if (!(CLEANED_COLUMNS as readonly string[]).includes(c)) throw new Error(`backup row ${r.id}: column ${c} is not restorable`);
  }
  return b;
}

/** Restore patch for one backup row: the before-values of exactly the columns the apply changed. */
export function restorePatch(r: BackupRow): ColumnValues {
  return Object.fromEntries(Object.keys(r.after).map(c => [c, r.before[c as CleanedColumn] ?? null]));
}

/** True when the live row holds `expected` in every column of `cols` (numbers compared as numbers). */
export function holds(row: Record<string, unknown> | undefined, expected: Record<string, unknown>, cols: string[]): boolean {
  if (!row) return false;
  return cols.every(c => {
    const a = row[c] ?? null, b = expected[c] ?? null;
    if (a === null || b === null) return a === b;
    return typeof a === 'string' && typeof b === 'string' && c === 'review_match_notes' ? a === b : asNumber(a) === asNumber(b);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Database side
// ---------------------------------------------------------------------------------------------------------------
type Db = typeof SupabaseClient;
const SELECT = ['id', ...CLEANED_COLUMNS, ...REFERENCE_COLUMNS].join(', ');

async function readAll(db: Db, table: CleanupTable): Promise<ProviderRow[]> {
  const out: ProviderRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(SELECT).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as unknown as ProviderRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Live plan: every row that changes, with its full before-values. */
export async function planCleanup(db: Db, opts: { notes: boolean }) {
  const planned: BackupRow[] = [];
  const summaries: Summary[] = [];
  for (const table of TABLES) {
    const rows = await readAll(db, table);
    for (const row of rows) {
      const after = cleanupPatch(row, opts);
      if (after) planned.push(backupRow(table, row, after));
    }
    summaries.push(summarize(table, rows, planned));
  }
  return { planned, summaries };
}

type Filterable = { eq(column: string, value: unknown): Filterable; is(column: string, value: null): Filterable;
  select(columns: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };

async function writeRows(db: Db, rows: BackupRow[], mode: 'apply' | 'restore') {
  let written = 0; const skipped: string[] = [];
  for (const r of rows) {
    const cols = Object.keys(r.after);
    const patch = mode === 'apply' ? r.after : restorePatch(r);
    const expected: Record<string, unknown> = mode === 'apply' ? r.before : r.after;
    // Only change a row that still holds `expected` in every column the patch touches.
    let q = db.from(r.table).update(patch).eq('id', r.id) as unknown as Filterable;
    for (const c of cols) q = present(expected[c]) ? q.eq(c, expected[c]) : q.is(c, null);
    const { data, error } = await q.select('id');
    if (error) throw new Error(`${r.table} ${r.id}: ${error.message} (${written} rows written before this error)`);
    if ((data ?? []).length === 1) written++; else skipped.push(`${r.table}:${r.id}`);
  }
  return { written, skipped };
}

function writeBackupFile(abs: string, backup: Backup) {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
  const fd = openSync(abs, 'r'); fsyncSync(fd); closeSync(fd);
  const back = parseBackup(readFileSync(abs, 'utf8'));
  if (back.rows.length !== backup.rows.length) throw new Error(`backup re-read has ${back.rows.length} rows, expected ${backup.rows.length}`);
}

export async function runGoogleScrapeCleanup(db: Db, opts: { apply: boolean; backup?: string; notes: boolean; supabaseHost: string }) {
  // Check the backup path before reading anything, so a bad path never leaves a half-done run.
  const abs = opts.apply ? assertBackupPath(opts.backup ?? (() => { throw new Error('--apply needs --backup <file.json> (outside the repo, e.g. ~/kitescout-backups/)'); })()) : null;
  const { planned, summaries } = await planCleanup(db, opts);
  if (!abs) return { planned, summaries, written: 0, skipped: [] as string[], backupPath: null as string | null };
  writeBackupFile(abs, { kind: 'google-scrape-cleanup-backup', version: 1, created_at: new Date().toISOString(),
    supabase_host: opts.supabaseHost, options: { notes: opts.notes }, rows: planned });
  const { written, skipped } = await writeRows(db, planned, 'apply');
  return { planned, summaries, written, skipped, backupPath: abs };
}

export async function runGoogleScrapeRestore(db: Db, opts: { file: string; apply: boolean; supabaseHost: string }) {
  const backup = parseBackup(readFileSync(opts.file, 'utf8'));
  if (backup.supabase_host !== opts.supabaseHost) throw new Error(`backup was taken on ${backup.supabase_host}, this is ${opts.supabaseHost}`);
  const live = new Map<string, ProviderRow>();
  for (const table of TABLES) for (const row of await readAll(db, table)) live.set(`${table}:${row.id}`, row);
  const restorable = backup.rows.filter(r => holds(live.get(`${r.table}:${r.id}`), r.after, Object.keys(r.after))).length;
  if (!opts.apply) return { rows: backup.rows.length, restorable, written: 0, skipped: [] as string[] };
  const { written, skipped } = await writeRows(db, backup.rows, 'restore');
  return { rows: backup.rows.length, restorable, written, skipped };
}

/** Read-only check after an apply: Google numbers left per table, and rows the cleanup would still change. */
export async function verifyCleanup(db: Db, opts: { notes: boolean }) {
  const out: Record<string, { google_rating: number; google_review_count: number; still_to_clean: number }> = {};
  for (const table of TABLES) {
    const rows = await readAll(db, table);
    out[table] = {
      google_rating: rows.filter(r => present(r.google_rating)).length,
      google_review_count: rows.filter(r => present(r.google_review_count)).length,
      still_to_clean: rows.filter(r => cleanupPatch(r, opts)).length,
    };
  }
  return out;
}
