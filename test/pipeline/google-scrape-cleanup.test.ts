import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBackupPath, backupRow, cleanupPatch, holds, parseBackup, restorePatch, stripGoogleNotes, summarize } from '../../src/pipeline/google-scrape-cleanup.js';

const googleRow = {
  id: 'a', root_domain: 'op.example', status: 'new', google_url: 'https://www.google.com/maps/place/Op/@1,2,17z', google_place_id: null,
  google_rating: 4.8, google_review_count: 120, tripadvisor_rating: 4.0, bstoked_rating: null, avg_rating: 4.4,
  review_match_notes: 'Google: Maps search match (high); name and website match | TripAdvisor: listing page matches',
};

test('a Google row loses its numbers, the Google part of its average and its Google note', () => {
  assert.deepEqual(cleanupPatch(googleRow, { notes: true }), {
    google_rating: null, google_review_count: null, avg_rating: 4.0, review_match_notes: 'TripAdvisor: listing page matches',
  });
  assert.deepEqual(cleanupPatch(googleRow, { notes: false }), { google_rating: null, google_review_count: null, avg_rating: 4.0 });
});

test('google_url and google_place_id are never part of a patch', () => {
  const patch = cleanupPatch({ ...googleRow, google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }, { notes: true })!;
  for (const col of ['google_url', 'google_place_id', 'google_place_matched_at', 'tripadvisor_rating', 'bstoked_rating'])
    assert.equal(col in patch, false, col);
});

test('a Google note on a row without Google numbers is still removed', () => {
  assert.deepEqual(cleanupPatch({ id: 'e', google_rating: null, google_review_count: null, tripadvisor_rating: null, bstoked_rating: null,
    avg_rating: null, review_match_notes: 'Google: operator site links to Google place' }, { notes: true }), { review_match_notes: null });
});

test('an average made only of Google becomes null; numeric strings compare as numbers', () => {
  assert.deepEqual(cleanupPatch({ id: 'b', google_rating: '4.5', google_review_count: null, tripadvisor_rating: null, bstoked_rating: null,
    avg_rating: '4.5', review_match_notes: null }, { notes: true }), { google_rating: null, avg_rating: null });
  // Already clean: a numeric string average equal to the Tripadvisor/bSTOKED mean is no change.
  assert.equal(cleanupPatch({ id: 'c', google_rating: null, google_review_count: null, tripadvisor_rating: '4.2', bstoked_rating: 4.6,
    avg_rating: '4.4', review_match_notes: 'bSTOKED: listing' }, { notes: true }), null);
});

test('a stale average on a row without Google numbers is counted, never written', () => {
  const stale = { id: 'd', google_rating: null, google_review_count: null, tripadvisor_rating: null, bstoked_rating: null,
    avg_rating: 5, review_match_notes: 'TripAdvisor: single review page' };
  assert.equal(cleanupPatch(stale, { notes: true }), null);
  assert.equal(summarize('cruise_providers', [stale, googleRow], []).stale_avg_untouched, 1);
});

test('note stripping keeps other sources, drops every Google segment, empty becomes null', () => {
  assert.equal(stripGoogleNotes('Google: a | bSTOKED: b | google: c'), 'bSTOKED: b');
  assert.equal(stripGoogleNotes('Google: operator site links to Google place'), null);
  assert.equal(stripGoogleNotes('TripAdvisor: mentions Google reviews'), 'TripAdvisor: mentions Google reviews');
  assert.equal(stripGoogleNotes(null), null);
});

test('backup rows hold every cleaned column before the change; restore puts back exactly the changed ones', () => {
  const after = cleanupPatch(googleRow, { notes: false })!;
  const row = backupRow('providers', googleRow, after);
  assert.deepEqual(row.before, { google_rating: 4.8, google_review_count: 120, avg_rating: 4.4, review_match_notes: googleRow.review_match_notes });
  assert.equal(row.reference.google_url, googleRow.google_url);
  assert.deepEqual(restorePatch(row), { google_rating: 4.8, google_review_count: 120, avg_rating: 4.4 });
  const s = summarize('providers', [googleRow], [row]);
  assert.deepEqual([s.rows, s.affected, s.google_rating, s.google_review_count, s.avg_rating, s.review_match_notes, s.stale_avg_untouched], [1, 1, 1, 1, 1, 0, 0]);
});

test('the write guard matches only a row that still holds the expected values', () => {
  const cols = ['google_rating', 'avg_rating', 'review_match_notes'];
  const expected = { google_rating: 4.8, avg_rating: 4.4, review_match_notes: 'x' };
  assert.equal(holds({ google_rating: '4.8', avg_rating: 4.4, review_match_notes: 'x' }, expected, cols), true);
  assert.equal(holds({ google_rating: null, avg_rating: 4.4, review_match_notes: 'x' }, expected, cols), false);
  assert.equal(holds({ google_rating: 4.8, avg_rating: 4.4, review_match_notes: 'y' }, expected, cols), false);
  assert.equal(holds(undefined, expected, cols), false);
});

test('the backup path must be outside the repo, a new .json file', () => {
  const repo = mkdtempSync(join(tmpdir(), 'repo-'));
  const outside = mkdtempSync(join(tmpdir(), 'backups-'));
  assert.throws(() => assertBackupPath(join(repo, 'b.json'), repo), /inside the repo/);
  assert.throws(() => assertBackupPath(join(repo.toUpperCase(), 'b.json'), repo), /inside the repo/);
  assert.throws(() => assertBackupPath(join(outside, 'b.txt'), repo), /\.json/);
  writeFileSync(join(outside, 'taken.json'), '{}');
  assert.throws(() => assertBackupPath(join(outside, 'taken.json'), repo), /exists already/);
  assert.equal(assertBackupPath(join(outside, 'new.json'), repo), join(outside, 'new.json'));
});

test('parseBackup accepts only this kind and only restorable columns', () => {
  const ok = { kind: 'google-scrape-cleanup-backup', version: 1, created_at: 'x', supabase_host: 'h', options: { notes: true },
    rows: [backupRow('cruise_providers', googleRow, { google_rating: null })] };
  assert.equal(parseBackup(JSON.stringify(ok)).rows.length, 1);
  assert.throws(() => parseBackup(JSON.stringify({ ...ok, kind: 'other' })), /not a google-scrape-cleanup backup/);
  assert.throws(() => parseBackup(JSON.stringify({ ...ok, rows: [{ ...ok.rows[0], after: { google_url: null } }] })), /not restorable/);
  assert.throws(() => parseBackup(JSON.stringify({ ...ok, rows: [{ ...ok.rows[0], table: 'package_offers' }] })), /malformed/);
});

// In-memory stand-in for the few supabase-js calls the cleanup makes (select/order/range, update/eq/is/select).
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const same = (a: unknown, b: unknown) => (a === null || b === null ? a === b : String(a) === String(b) || Number(a) === Number(b));
  return {
    from(table: string) {
      const rows = tables[table];
      return {
        select: () => ({ order: () => ({ range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1).map(r => ({ ...r })), error: null }) }) }),
        update(patch: Record<string, unknown>) {
          const conds: Array<[string, unknown]> = [];
          const q = {
            eq(c: string, v: unknown) { conds.push([c, v]); return q; },
            is(c: string, v: null) { conds.push([c, v]); return q; },
            async select() {
              const hit = rows.filter(r => conds.every(([c, v]) => same(r[c] ?? null, v)));
              for (const r of hit) Object.assign(r, patch);
              return { data: hit.map(r => ({ id: r.id })), error: null };
            },
          };
          return q;
        },
      };
    },
  };
}

test('apply writes the backup first, cleans every planned row; restore puts the values back and skips drifted rows', async () => {
  const { runGoogleScrapeCleanup, runGoogleScrapeRestore, verifyCleanup } = await import('../../src/pipeline/google-scrape-cleanup.js');
  const original = {
    cruise_providers: [{ ...googleRow, id: 'c1' }, { id: 'c2', root_domain: 'clean.example', status: 'new', google_url: null, google_place_id: null,
      google_rating: null, google_review_count: null, tripadvisor_rating: 4.2, bstoked_rating: null, avg_rating: 4.2, review_match_notes: null }],
    providers: [{ ...googleRow, id: 'p1', tripadvisor_rating: null, avg_rating: 4.8, review_match_notes: 'Google: operator site links to Google place' }],
  };
  const tables = structuredClone(original) as Record<string, Record<string, unknown>[]>;
  const db = fakeDb(tables) as never;
  const backup = join(mkdtempSync(join(tmpdir(), 'backups-')), 'google.json');

  const dry = await runGoogleScrapeCleanup(db, { apply: false, notes: true, supabaseHost: 'h' });
  assert.equal(dry.planned.length, 2);
  assert.deepEqual(tables, original, 'the dry run writes nothing');

  const r = await runGoogleScrapeCleanup(db, { apply: true, backup, notes: true, supabaseHost: 'h' });
  assert.deepEqual([r.written, r.skipped.length], [2, 0]);
  assert.equal(parseBackup((await import('node:fs')).readFileSync(backup, 'utf8')).rows.length, 2);
  assert.deepEqual(tables.providers[0], { ...original.providers[0], google_rating: null, google_review_count: null, avg_rating: null, review_match_notes: null });
  assert.equal(tables.cruise_providers[0].google_url, googleRow.google_url, 'google_url stays');
  assert.deepEqual(tables.cruise_providers[1], original.cruise_providers[1], 'a clean row is untouched');
  assert.deepEqual(await verifyCleanup(db, { notes: true }), {
    cruise_providers: { google_rating: 0, google_review_count: 0, still_to_clean: 0 },
    providers: { google_rating: 0, google_review_count: 0, still_to_clean: 0 },
  });
  await assert.rejects(runGoogleScrapeCleanup(db, { apply: true, backup, notes: true, supabaseHost: 'h' }), /exists already/);

  tables.providers[0].avg_rating = 3.9; // someone wrote this row after the cleanup
  await assert.rejects(runGoogleScrapeRestore(db, { file: backup, apply: true, supabaseHost: 'other' }), /backup was taken on h/);
  const dryRestore = await runGoogleScrapeRestore(db, { file: backup, apply: false, supabaseHost: 'h' });
  assert.deepEqual([dryRestore.rows, dryRestore.restorable, dryRestore.written], [2, 1, 0]);
  const restored = await runGoogleScrapeRestore(db, { file: backup, apply: true, supabaseHost: 'h' });
  assert.deepEqual([restored.written, restored.skipped], [1, ['providers:p1']]);
  assert.deepEqual(tables.cruise_providers, original.cruise_providers, 'cruise rows are back to the original values');
  assert.equal(tables.providers[0].avg_rating, 3.9, 'the drifted row is left alone');
});
