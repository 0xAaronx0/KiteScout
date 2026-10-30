// operator reviews migration (Aaron 2026-10-30): replays the view chain in PGlite up to the live state
// (20261030120000_cruise_offer_is_active) and checks that providers gain the cruise_providers review columns and the
// package view swaps only its constant NULL TripAdvisor / Google / checked-at columns for the operator's values:
// same 81 columns (names, order, types), options, owner and grants; the cruise view is untouched.
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
const cruiseIsActive = file('_cruise_offer_is_active.sql');
const migration = file('_operator_reviews.sql');

const columns = async (db: PGlite, view: string) => (await db.query<{ c: string }>(
  `select a.attname || ':' || format_type(a.atttypid, a.atttypmod) c from pg_attribute a
    where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`, [view])).rows.map(r => r.c);
const meta = async (db: PGlite, view: string) => (await db.query(
  `select relowner, relacl, reloptions from pg_class where oid = $1::regclass`, [view])).rows;
const viewdef = async (db: PGlite, view: string) =>
  (await db.query<{ d: string }>(`select pg_get_viewdef('${view}'::regclass, true) d`)).rows[0].d;

/** fixture + the chain up to audience_note (the state before 20261030120000) */
async function preIsActiveState(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(fixture);
  for (const sql of chain) await db.exec(sql);
  await db.exec(audienceNote);
  return db;
}
/** the live state this migration expects (20261030120000 applied on top) */
async function liveState(): Promise<PGlite> {
  const db = await preIsActiveState();
  await db.exec(cruiseIsActive);
  return db;
}
const IMG = `'[{"path": "a/0.webp"}]'`;

test('package view keeps its 81-column contract, options, owner and grants; cruise view untouched; idempotent', async () => {
  const db = await liveState();
  try {
    await db.exec('alter view app_package_cards set (security_barrier=true)'); // extra options survive
    const before = { cols: await columns(db, 'app_package_cards'), meta: await meta(db, 'app_package_cards'),
      cruiseDef: await viewdef(db, 'app_cruise_offer_cards'), cruiseMeta: await meta(db, 'app_cruise_offer_cards') };
    assert.equal(before.cols.length, 81);
    assert.deepEqual(before.cols.slice(-1), ['season_months:smallint[]']);
    await db.exec(migration);
    const def = await viewdef(db, 'app_package_cards');
    for (const column of ['o.tripadvisor_url', 'o.tripadvisor_rating::numeric', 'o.tripadvisor_review_count', 'o.reviews_checked_at',
      'o.google_url', 'o.google_rating::numeric', 'o.google_review_count']) assert.ok(def.includes(column), column);
    assert.match(def, /p\.source_url AS provider_bstoked_url/);
    assert.match(def, /p\.bstoked_rating AS provider_avg_rating/);
    await db.exec(migration); // second run: the guard accepts the new definition, nothing changes
    assert.equal(await viewdef(db, 'app_package_cards'), def);
    assert.deepEqual(await columns(db, 'app_package_cards'), before.cols);
    assert.deepEqual(await meta(db, 'app_package_cards'), before.meta);
    assert.equal(await viewdef(db, 'app_cruise_offer_cards'), before.cruiseDef);
    assert.deepEqual(await meta(db, 'app_cruise_offer_cards'), before.cruiseMeta);
    const added = (await db.query<{ c: string }>(`select attname || ':' || format_type(atttypid, atttypmod) c from pg_attribute
      where attrelid = 'providers'::regclass and attname like any (array['%rating%','%review%','%_url'])
      order by attname`)).rows.map(r => r.c);
    assert.deepEqual(added, ['avg_rating:numeric(2,1)', 'bstoked_rating:numeric(2,1)', 'bstoked_review_count:integer', 'bstoked_url:text',
      'contact_form_url:text', 'google_rating:numeric(2,1)', 'google_review_count:integer', 'google_url:text', 'review_match_notes:text', 'reviews_checked_at:timestamp with time zone',
      'tripadvisor_rating:numeric(2,1)', 'tripadvisor_review_count:integer', 'tripadvisor_url:text', 'website_url:text']);
  } finally { await db.close(); }
});

test("an operator's Google and TripAdvisor values reach its package rows; others stay NULL", async () => {
  const db = await liveState();
  try {
    await db.exec(migration);
    await db.exec(`insert into providers (id, name, status, google_url, google_rating, google_review_count, tripadvisor_url, tripadvisor_review_count, reviews_checked_at)
      values ('00000000-0000-4000-8000-0000000000b1', 'Op', 'new', 'https://www.google.com/maps/place/Op/@1,2,17z', 4.7, 248, 'https://www.tripadvisor.com/x', 72, '2026-10-30T10:00:00Z');
      insert into package_offers (id, operator_id, is_active, title, images, package_type) values
        ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', true, 'Rated', ${IMG}, 'accommodation'),
        ('00000000-0000-4000-8000-0000000000d2', null, true, 'Plain', ${IMG}, 'camp');`);
    const rows = (await db.query<Record<string, unknown>>(`select title, provider_google_url, provider_google_rating::text r,
      provider_google_review_count, provider_tripadvisor_review_count, provider_reviews_checked_at is not null checked
      from app_package_cards order by title`)).rows;
    assert.deepEqual(rows, [
      { title: 'Plain', provider_google_url: null, r: null, provider_google_review_count: null, provider_tripadvisor_review_count: null, checked: false },
      { title: 'Rated', provider_google_url: 'https://www.google.com/maps/place/Op/@1,2,17z', r: '4.7', provider_google_review_count: 248,
        provider_tripadvisor_review_count: 72, checked: true },
    ]);
  } finally { await db.close(); }
});

for (const [name, setup] of [
  ['package view gained a column elsewhere', async () => {
    const db = await liveState();
    const def = (await viewdef(db, 'app_package_cards')).trim().replace(/;$/, '');
    await db.exec(`create or replace view app_package_cards with (security_invoker=true) as
      select v.*, 'x'::text as other_repo_col from (${def}) v`);
    return db;
  }],
  ['security_invoker off', async () => {
    const db = await liveState();
    await db.exec('alter view app_package_cards set (security_invoker=false)');
    return db;
  }],
] as const) test(`drift aborts and changes nothing: ${name}`, async () => {
  const db = await setup();
  try {
    const before = await viewdef(db, 'app_package_cards');
    await assert.rejects(db.exec(migration), /drift/);
    await db.exec('rollback');
    assert.equal(await viewdef(db, 'app_package_cards'), before);
    assert.equal((await db.query("select 1 from pg_attribute where attrelid = 'providers'::regclass and attname = 'google_url'")).rows.length, 0,
      'the column additions roll back with the transaction');
  } finally { await db.close(); }
});
