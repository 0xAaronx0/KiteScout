// duration_nights migration (Aaron 2026-10-31): replays the view chain in PGlite up to the live state
// (20261030140000_operator_reviews) and checks that both product views keep every existing column (names, order,
// types), options, owner and grants and only gain duration_nights as the last column; the column add is empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(dir).find(f => f.endsWith(suffix))!, dir), 'utf8');
const fixture = readFileSync(new URL('../fixtures/offer-cards-schema.sql', import.meta.url), 'utf8');
const chain = ['_offer_disciplines.sql', '_retain_coarse_package_slot_windows.sql', '_offer_season_months.sql',
  '_views_require_image.sql', '_offer_audience_note.sql', '_cruise_offer_is_active.sql'].map(file);
const operatorReviews = file('_operator_reviews.sql');
const migration = file('_duration_nights.sql');
const VIEWS = ['app_cruise_offer_cards', 'app_package_cards'];

const columns = async (db: PGlite, view: string) => (await db.query<{ c: string }>(
  `select a.attname || ':' || format_type(a.atttypid, a.atttypmod) c from pg_attribute a
    where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`, [view])).rows.map(r => r.c);
const meta = async (db: PGlite, view: string) => (await db.query(
  `select relowner, relacl, reloptions from pg_class where oid = $1::regclass`, [view])).rows;
const viewdef = async (db: PGlite, view: string) =>
  (await db.query<{ d: string }>(`select pg_get_viewdef('${view}'::regclass, true) d`)).rows[0].d;
const hasColumn = async (db: PGlite, table: string) =>
  (await db.query(`select 1 from pg_attribute where attrelid = '${table}'::regclass and attname = 'duration_nights'`)).rows.length > 0;

/** fixture + the chain up to cruise_offer_is_active (the state before operator_reviews) */
async function preReviewsState(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(fixture);
  for (const sql of chain) await db.exec(sql);
  return db;
}
/** the live state this migration expects (20261030140000 applied on top) */
async function liveState(): Promise<PGlite> {
  const db = await preReviewsState();
  await db.exec(operatorReviews);
  return db;
}
const IMG = `'[{"path": "a/0.webp"}]'`;

test('both views keep every column, option, owner and grant and gain duration_nights last; idempotent', async () => {
  const db = await liveState();
  try {
    await db.exec('alter view app_cruise_offer_cards set (security_barrier=true)'); // extra options survive
    const before = Object.fromEntries(await Promise.all(VIEWS.map(async v => [v, { cols: await columns(db, v), meta: await meta(db, v) }])));
    assert.equal(before.app_cruise_offer_cards.cols.length, 75);
    assert.equal(before.app_package_cards.cols.length, 81);
    await db.exec(migration);
    const defs = await Promise.all(VIEWS.map(v => viewdef(db, v)));
    await db.exec(migration); // second run: guards accept the new definitions, nothing changes
    for (const [i, v] of VIEWS.entries()) {
      assert.equal(await viewdef(db, v), defs[i]);
      assert.deepEqual(await columns(db, v), [...before[v].cols, 'duration_nights:smallint']);
      assert.deepEqual(await meta(db, v), before[v].meta);
    }
    for (const table of ['cruise_offers', 'package_offers']) {
      const col = (await db.query<{ t: string; nn: boolean; d: string | null }>(`select format_type(atttypid, atttypmod) t,
        attnotnull nn, pg_get_expr(adbin, adrelid) d from pg_attribute left join pg_attrdef on adrelid = attrelid and adnum = attnum
        where attrelid = '${table}'::regclass and attname = 'duration_nights'`)).rows;
      assert.deepEqual(col, [{ t: 'smallint', nn: false, d: null }]);
    }
    assert.equal((await db.query("select count(*)::int n from pg_class where relname like 'nights_%_cards'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('rows keep their values, the views serve duration_nights, and the check rejects nonsense', async () => {
  const db = await liveState();
  try {
    await db.exec(`insert into cruise_providers (id, status) values ('00000000-0000-4000-8000-0000000000a1', 'new');
      insert into cruise_offers (id, cruise_provider_id, title, images, duration_days) values
        ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Red Sea week', ${IMG}, 8);`);
    await db.exec(migration);
    const row = async () => (await db.query<{ duration_days: number; duration_nights: number | null }>(
      'select duration_days, duration_nights from app_cruise_offer_cards')).rows;
    assert.deepEqual(await row(), [{ duration_days: 8, duration_nights: null }], 'no value is written by the migration');
    await db.exec("update cruise_offers set duration_nights = 7 where title = 'Red Sea week'");
    assert.deepEqual(await row(), [{ duration_days: 8, duration_nights: 7 }]);
    await assert.rejects(db.exec("update cruise_offers set duration_nights = -1"), /check constraint/);
    assert.equal((await db.query(`select count(*)::int n from pg_constraint where conrelid = 'package_offers'::regclass
      and pg_get_constraintdef(oid) like '%duration_nights%'`)).rows[0].n, 1);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from app_cruise_offer_cards'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

for (const [name, setup, error] of [
  // the base package temp view needs the operator review columns, so the abort comes before the guard; same rollback
  ['run before operator_reviews (out of order)', preReviewsState, /drift|does not exist/],
  ['cruise view gained a column elsewhere', async () => {
    const db = await liveState();
    const def = (await viewdef(db, 'app_cruise_offer_cards')).trim().replace(/;$/, '');
    await db.exec(`create or replace view app_cruise_offer_cards with (security_invoker=true) as
      select v.*, 'x'::text as other_repo_col from (${def}) v`);
    return db;
  }, /drift/],
  ['package view security_invoker off', async () => {
    const db = await liveState();
    await db.exec('alter view app_package_cards set (security_invoker=false)');
    return db;
  }, /drift/],
] as const) test(`drift aborts and changes nothing: ${name}`, async () => {
  const db = await setup();
  try {
    const before = await Promise.all(VIEWS.map(v => viewdef(db, v)));
    await assert.rejects(db.exec(migration), error);
    await db.exec('rollback');
    assert.deepEqual(await Promise.all(VIEWS.map(v => viewdef(db, v))), before);
    assert.equal(await hasColumn(db, 'cruise_offers'), false, 'ALTER TABLE rolled back too');
    assert.equal(await hasColumn(db, 'package_offers'), false, 'ALTER TABLE rolled back too');
  } finally { await db.close(); }
});
