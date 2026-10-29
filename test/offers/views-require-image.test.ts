// 20261028120000_views_require_image (Aaron 2026-10-26: never show a listing without at least one image).
// Builds both app views at their live definitions in PGlite (package view: fixture + 20261021191245; cruise view:
// live column types + 20261021120000), then checks the migration: rows without images disappear, everything else is
// unchanged (columns, options, other rows), a second run is a no-op, and a drifted view aborts the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const mig = (suffix: string) => readFileSync(new URL(readdirSync(dir).find(f => f.endsWith(suffix))!, dir), 'utf8');
const packageSchema = readFileSync(new URL('../fixtures/package-window-schema.sql', import.meta.url), 'utf8');
const cruiseSchema = readFileSync(new URL('../fixtures/views-require-image-cruise-schema.sql', import.meta.url), 'utf8');
const migration = mig('_views_require_image.sql');

const meta = (view: string) => `select c.reloptions,
  (select jsonb_agg(jsonb_build_array(a.attname, a.atttypid, a.atttypmod) order by a.attnum)
     from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) cols
  from pg_class c where c.oid = 'public.${view}'::regclass`;

async function setup(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(packageSchema);
  await db.exec(mig('_retain_coarse_package_slot_windows.sql'));   // live app_package_cards since 2026-10-22
  await db.exec(cruiseSchema);                                       // live app_cruise_offer_cards since 2026-10-21
  const pkg = (id: number, images: string | null) => `insert into package_offers (id, package_type, is_active, title, images, disciplines)
    values ('00000000-0000-4000-8000-00000000000${id}', 'camp', true, 'p${id}', ${images === null ? 'null' : `'${images}'`}, '{kitesurf}');`;
  await db.exec([pkg(1, '[{"path":"a.webp"}]'), pkg(2, '[]'), pkg(3, null), pkg(4, '{"path":"x"}')].join('\n'));
  const cru = (id: number, images: string | null) => `insert into cruise_offers (id, title, images, is_reseller, disciplines)
    values ('10000000-0000-4000-8000-00000000000${id}', 'c${id}', ${images === null ? 'null' : `'${images}'`}, false, '{kitesurf}');`;
  await db.exec([cru(1, '[{"path":"a.webp"},{"path":"b.webp"}]'), cru(2, '[]'), cru(3, null)].join('\n'));
  return db;
}
const titles = async (db: PGlite, view: string) => (await db.query<{ title: string }>(`select title from ${view} order by title`)).rows.map(r => r.title);

test('views keep only rows with at least one image; columns and options unchanged; second run is a no-op', async () => {
  const db = await setup();
  try {
    assert.deepEqual(await titles(db, 'app_package_cards'), ['p1', 'p2', 'p3', 'p4']);
    assert.deepEqual(await titles(db, 'app_cruise_offer_cards'), ['c1', 'c2', 'c3']);
    const before = [(await db.query(meta('app_package_cards'))).rows, (await db.query(meta('app_cruise_offer_cards'))).rows];

    await db.exec(migration);
    assert.deepEqual(await titles(db, 'app_package_cards'), ['p1'], 'empty array, NULL and a non-array object are hidden');
    assert.deepEqual(await titles(db, 'app_cruise_offer_cards'), ['c1']);
    const after = [(await db.query(meta('app_package_cards'))).rows, (await db.query(meta('app_cruise_offer_cards'))).rows];
    assert.deepEqual(after, before, 'same columns (name, type, order) and the same view options (security_invoker)');

    await db.exec(migration);                                         // idempotent: the guard sees the target and skips
    assert.deepEqual(await titles(db, 'app_package_cards'), ['p1']);
    assert.deepEqual(await titles(db, 'app_cruise_offer_cards'), ['c1']);
  } finally { await db.close(); }
});

test('a drifted live view aborts the whole migration', async () => {
  const db = await setup();
  try {
    await db.exec(`create or replace view public.app_cruise_offer_cards with (security_invoker = true) as
      select * from (${(await db.query<{ d: string }>(`select pg_get_viewdef('public.app_cruise_offer_cards'::regclass, true) d`)).rows[0].d.replace(/;\s*$/, '')}) v where v.title <> 'c3'`);
    await assert.rejects(db.exec(migration), /drift/);
    await db.exec('rollback');                                        // what the SQL editor does with a failed script
    // nothing was applied: the package view is untouched too
    assert.deepEqual(await titles(db, 'app_package_cards'), ['p1', 'p2', 'p3', 'p4']);
  } finally { await db.close(); }
});
