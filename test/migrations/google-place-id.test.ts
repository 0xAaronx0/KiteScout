// google_place_id migration (Aaron 2026-10-31, KCS#607 option 1): additive columns on cruise_providers and providers,
// a format check, no view touched, safe to re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(dir).find(f => f.endsWith(suffix))!, dir), 'utf8');
const fixture = readFileSync(new URL('../fixtures/offer-cards-schema.sql', import.meta.url), 'utf8');
const migration = file('_google_place_id.sql');
const cols = async (db: PGlite, table: string) => (await db.query<{ c: string }>(
  `select column_name || ':' || data_type c from information_schema.columns where table_schema = 'public' and table_name = $1
    and column_name like 'google_place%' order by column_name`, [table])).rows.map(r => r.c);

test('adds google_place_id and google_place_matched_at to both provider tables, idempotent, no view change', async () => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    const views = async () => (await db.query<{ v: string }>(`select viewname || ':' || md5(definition) v from pg_views where schemaname = 'public' order by 1`)).rows;
    const before = await views();
    await db.exec(migration);
    await db.exec(migration);
    for (const table of ['cruise_providers', 'providers']) {
      assert.deepEqual(await cols(db, table), ['google_place_id:text', 'google_place_matched_at:timestamp with time zone'], table);
    }
    assert.deepEqual(await views(), before);
    // Format check: a place ID, never a URL or a rating.
    await db.exec(`insert into public.providers (id, name) values ('00000000-0000-4000-8000-000000000001', 'Op')`);
    await db.exec(`update public.providers set google_place_id = 'ChIJN1t_tDeuEmsRUsoyG83frY4'`);
    await assert.rejects(db.exec(`update public.providers set google_place_id = 'https://maps.google.com/x'`));
    await assert.rejects(db.exec(`update public.providers set google_place_id = '4.7'`));
  } finally { await db.close(); }
});
