// cruise is_active migration (Aaron 2026-10-30): replays the view chain in PGlite up to the live state
// (20261029120000_offer_audience_note) and checks that the hide switch only adds `and c.is_active` to the cruise
// view: same columns, options, owner and grants; the package view is untouched; a hidden row leaves the view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(dir).find(f => f.endsWith(suffix))!, dir), 'utf8');
const fixture = readFileSync(new URL('../fixtures/offer-cards-schema.sql', import.meta.url), 'utf8');
const chain = ['_offer_disciplines.sql', '_retain_coarse_package_slot_windows.sql', '_offer_season_months.sql',
  '_views_require_image.sql'].map(file);
const audienceNote = file('_offer_audience_note.sql');
const migration = file('_cruise_offer_is_active.sql');

const columns = async (db: PGlite, view: string) => (await db.query<{ c: string }>(
  `select a.attname || ':' || format_type(a.atttypid, a.atttypmod) c from pg_attribute a
    where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`, [view])).rows.map(r => r.c);
const meta = async (db: PGlite, view: string) => (await db.query(
  `select relowner, relacl, reloptions from pg_class where oid = $1::regclass`, [view])).rows;
const viewdef = async (db: PGlite, view: string) =>
  (await db.query<{ d: string }>(`select pg_get_viewdef('${view}'::regclass, true) d`)).rows[0].d;
const hasColumn = async (db: PGlite) =>
  (await db.query("select 1 from pg_attribute where attrelid = 'cruise_offers'::regclass and attname = 'is_active'")).rows.length > 0;

/** fixture + the chain up to 20261028120000 (the state before audience_note) */
async function preAudienceState(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(fixture);
  for (const sql of chain) await db.exec(sql);
  return db;
}
/** the live state this migration expects (20261029120000 applied on top) */
async function liveState(): Promise<PGlite> {
  const db = await preAudienceState();
  await db.exec(audienceNote);
  return db;
}
const IMG = `'[{"path": "a/0.webp"}]'`;

test('adds only the is_active filter: columns, options, owner, grants and the package view stay; idempotent', async () => {
  const db = await liveState();
  try {
    await db.exec('alter view app_cruise_offer_cards set (security_barrier=true)'); // extra options survive
    const before = {
      cruiseCols: await columns(db, 'app_cruise_offer_cards'), cruiseMeta: await meta(db, 'app_cruise_offer_cards'),
      packageDef: await viewdef(db, 'app_package_cards'), packageMeta: await meta(db, 'app_package_cards'),
    };
    assert.equal(before.cruiseCols.length, 75);
    assert.deepEqual(before.cruiseCols.slice(-2), ['audience_note:text', 'season_months:smallint[]']);
    await db.exec(migration);
    const def = await viewdef(db, 'app_cruise_offer_cards');
    assert.match(def, /c\.is_active/);
    await db.exec(migration); // second run: guard accepts the new definition, nothing changes
    assert.equal(await viewdef(db, 'app_cruise_offer_cards'), def);
    assert.deepEqual(await columns(db, 'app_cruise_offer_cards'), before.cruiseCols);
    assert.deepEqual(await meta(db, 'app_cruise_offer_cards'), before.cruiseMeta);
    assert.equal(await viewdef(db, 'app_package_cards'), before.packageDef);
    assert.deepEqual(await meta(db, 'app_package_cards'), before.packageMeta);
    const col = (await db.query<{ t: string; nn: boolean; d: string }>(`select format_type(atttypid, atttypmod) t,
      attnotnull nn, pg_get_expr(adbin, adrelid) d from pg_attribute
      left join pg_attrdef on adrelid = attrelid and adnum = attnum
      where attrelid = 'cruise_offers'::regclass and attname = 'is_active'`)).rows;
    assert.deepEqual(col, [{ t: 'boolean', nn: true, d: 'true' }]);
    assert.equal((await db.query("select count(*)::int n from pg_class where relname like 'active_%_cards'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('existing rows stay visible (default true); is_active=false hides a row and true brings it back', async () => {
  const db = await liveState();
  try {
    await db.exec(`insert into cruise_providers (id, status) values ('00000000-0000-4000-8000-0000000000a1', 'new');
      insert into cruise_offers (id, cruise_provider_id, title, images) values
        ('583f2391-7bd4-4554-a7dc-d1925ba88424', '00000000-0000-4000-8000-0000000000a1', 'BVI', ${IMG}),
        ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'Antigua', ${IMG});`);
    await db.exec(migration);
    const titles = async () => (await db.query<{ title: string }>('select title from app_cruise_offer_cards order by title')).rows.map(r => r.title);
    assert.deepEqual(await titles(), ['Antigua', 'BVI']);
    await db.exec("update cruise_offers set is_active = false where id = '583f2391-7bd4-4554-a7dc-d1925ba88424'");
    assert.deepEqual(await titles(), ['Antigua']);
    assert.equal((await db.query('select count(*)::int n from cruise_offers')).rows[0].n, 2, 'row kept in the table');
    await db.exec("update cruise_offers set is_active = true where id = '583f2391-7bd4-4554-a7dc-d1925ba88424'");
    assert.deepEqual(await titles(), ['Antigua', 'BVI']);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from app_cruise_offer_cards'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

for (const [name, setup, error] of [
  // the base temp view already needs audience_note, so the abort comes before the guard; same rollback
  ['run before audience_note (out of order)', preAudienceState, /audience_note does not exist/],
  ['cruise view gained a column elsewhere', async () => {
    const db = await liveState();
    const def = (await viewdef(db, 'app_cruise_offer_cards')).trim().replace(/;$/, '');
    await db.exec(`create or replace view app_cruise_offer_cards with (security_invoker=true) as
      select v.*, 'x'::text as other_repo_col from (${def}) v`);
    return db;
  }, /drift/],
  ['security_invoker off', async () => {
    const db = await liveState();
    await db.exec('alter view app_cruise_offer_cards set (security_invoker=false)');
    return db;
  }, /drift/],
] as const) test(`drift aborts and changes nothing: ${name}`, async () => {
  const db = await setup();
  try {
    const before = await viewdef(db, 'app_cruise_offer_cards');
    await assert.rejects(db.exec(migration), error);
    await db.exec('rollback');
    assert.equal(await viewdef(db, 'app_cruise_offer_cards'), before);
    assert.equal(await hasColumn(db), false, 'ALTER TABLE rolled back too');
  } finally { await db.close(); }
});
