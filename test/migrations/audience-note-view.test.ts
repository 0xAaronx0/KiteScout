// audience_note migration (Aaron 2026-10-29): replays the view chain in PGlite and checks that both product views
// keep the live column contract and only gain `audience_note`, then `season_months`, as the last two columns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(dir).find(f => f.endsWith(suffix))!, dir), 'utf8');
const fixture = readFileSync(new URL('../fixtures/offer-cards-schema.sql', import.meta.url), 'utf8');
const disciplines = file('_offer_disciplines.sql');
const windows = file('_retain_coarse_package_slot_windows.sql');
const seasonMonths = file('_offer_season_months.sql');
const migration = file('_offer_audience_note.sql');

// live column contract (name:type, PostgREST OpenAPI 2026-10-29); the first 72 columns are shared by both views
const SHARED = [
  'offer_id:uuid', 'title:text', 'slug:text', 'source_url:text', 'continent:text', 'country:text', 'region:text',
  'countries:text[]', 'departure_port:text', 'itinerary_spots:jsonb', 'vessel_name:text', 'vessel_type:text',
  'booking_modes:text[]', 'beginner_friendly:boolean', 'kite_lessons:boolean', 'equipment_rental:boolean',
  'season_text:text', 'duration_days:integer', 'pricing:jsonb', 'price_from_eur:integer', 'currency:text',
  'summary:text', 'images:jsonb', 'extraction_confidence:text', 'manually_verified:boolean', 'is_reseller:boolean',
  'operated_by:text', 'updated_at:timestamp with time zone', 'provider_id:uuid', 'provider_name:text',
  'provider_root_domain:text', 'provider_website_url:text', 'provider_contact_email:text',
  'provider_contact_form_url:text', 'provider_languages:text[]', 'provider_trip_types:text[]',
  'provider_passenger_capacity:integer', 'provider_cabin_count:integer',
  'provider_verified_at:timestamp with time zone', 'provider_last_verified_at:timestamp with time zone',
  'skill_levels:text[]', 'included_services:text[]', 'optional_services:text[]', 'comfort_level:text',
  'suitable_for_non_kiters:boolean', 'family_friendly:boolean', 'accommodation:text', 'meal_plan:text',
  'capacity_guests:integer', 'offer_cabin_count:integer', 'offer_price_confidence:text',
  'season_start_month:smallint', 'season_end_month:smallint', 'dates:jsonb', 'provider_bstoked_url:text',
  'provider_bstoked_rating:numeric', 'provider_bstoked_review_count:integer', 'provider_tripadvisor_url:text',
  'provider_tripadvisor_rating:numeric', 'provider_tripadvisor_review_count:integer',
  'provider_reviews_checked_at:timestamp with time zone', 'hero_video_url:text', 'provider_google_url:text',
  'provider_google_rating:numeric', 'provider_google_review_count:integer', 'provider_avg_rating:numeric',
  'price_pp_cabin:integer', 'price_pp_cabin_currency:text', 'price_charter_week:integer',
  'price_charter_week_currency:text', 'price_basis_note:text', 'rooms:jsonb',
];
const LIVE_CRUISE = [...SHARED, 'disciplines:text[]'];
const LIVE_PACKAGE = [
  ...SHARED,
  'package_type:text', 'price_unit:text', 'operator_id:uuid', 'live_availability:boolean',
  'availability_checked_at:timestamp with time zone', 'instant_booking:boolean', 'disciplines:text[]',
];

// appended by the migration, in this order (season_months is SMALLINT[] on both tables, live 2026-10-29)
const APPENDED = ['audience_note:text', 'season_months:smallint[]'];

const columns = async (db: PGlite, view: string) => (await db.query<{ c: string }>(
  `select a.attname || ':' || format_type(a.atttypid, a.atttypmod) c from pg_attribute a
    where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`, [view])).rows.map(r => r.c);
const meta = async (db: PGlite, view: string) => (await db.query(
  `select relowner, relacl, reloptions from pg_class where oid = $1::regclass`, [view])).rows;

/** fixture + the live chain: disciplines (both views), the coarse-window package view, season_months columns */
async function liveState(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(fixture);
  await db.exec(disciplines);
  await db.exec(windows);
  await db.exec(seasonMonths);
  return db;
}

test('replayed chain matches the live column lists (baseline)', async () => {
  const db = await liveState();
  try {
    assert.deepEqual(await columns(db, 'app_cruise_offer_cards'), LIVE_CRUISE);
    assert.deepEqual(await columns(db, 'app_package_cards'), LIVE_PACKAGE);
  } finally { await db.close(); }
});

test('migration appends audience_note + season_months last, keeps everything else, and is idempotent', async () => {
  const db = await liveState();
  try {
    await db.exec('alter view app_package_cards set (security_barrier=true)'); // extra options survive
    const cruiseBefore = await meta(db, 'app_cruise_offer_cards');
    const packageBefore = await meta(db, 'app_package_cards');
    await db.exec(migration);
    const cruiseDef = (await db.query<{ d: string }>("select pg_get_viewdef('app_cruise_offer_cards'::regclass, true) d")).rows[0].d;
    const packageDef = (await db.query<{ d: string }>("select pg_get_viewdef('app_package_cards'::regclass, true) d")).rows[0].d;
    await db.exec(migration); // second run: guard accepts the new definition, nothing changes
    for (const [view, live, before, def] of [
      ['app_cruise_offer_cards', LIVE_CRUISE, cruiseBefore, cruiseDef],
      ['app_package_cards', LIVE_PACKAGE, packageBefore, packageDef],
    ] as const) {
      assert.deepEqual(await columns(db, view), [...live, ...APPENDED], view);
      assert.deepEqual(await meta(db, view), before, `${view} owner/acl/options`);
      assert.equal((await db.query<{ d: string }>(`select pg_get_viewdef('${view}'::regclass, true) d`)).rows[0].d, def);
    }
    for (const t of ['cruise_offers', 'package_offers']) {
      const col = (await db.query<{ t: string; n: boolean }>(`select format_type(atttypid, atttypmod) t, not attnotnull n
        from pg_attribute where attrelid = '${t}'::regclass and attname = 'audience_note'`)).rows;
      assert.deepEqual(col, [{ t: 'text', n: true }], t);
    }
    // temp helper views are gone
    assert.equal((await db.query("select count(*)::int n from pg_class where relname like 'audience_%_cards'")).rows[0].n, 0);

    // the note flows through both views; NULL stays NULL
    await db.exec(`insert into cruise_providers (id, status) values ('00000000-0000-4000-8000-0000000000a1', 'new');
      insert into cruise_offers (id, cruise_provider_id, title, audience_note, season_months) values
        ('7f1a5f7c-798e-4e92-b564-dff1110b2fa2', '00000000-0000-4000-8000-0000000000a1', 'Red Sea (RU)', 'Russian-language trip', '{3,4,10,11}'),
        ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a1', 'Red Sea', null, null);
      insert into package_offers (id, is_active, package_type, title, audience_note, season_months)
        values ('00000000-0000-4000-8000-0000000000b1', true, 'camp', 'Camp', 'German-language camp', '{4,5,6,7,8,9,10}');`);
    assert.deepEqual((await db.query('select title, audience_note, season_months from app_cruise_offer_cards order by title')).rows,
      [{ title: 'Red Sea', audience_note: null, season_months: null },
       { title: 'Red Sea (RU)', audience_note: 'Russian-language trip', season_months: [3, 4, 10, 11] }]);
    assert.deepEqual((await db.query('select audience_note, season_months from app_package_cards')).rows,
      [{ audience_note: 'German-language camp', season_months: [4, 5, 6, 7, 8, 9, 10] }]);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from app_cruise_offer_cards'), /permission denied/);
    await db.exec('reset role');
  } finally { await db.close(); }
});

const appendColumn = async (db: PGlite) => {
  // the other repo appended a column (CREATE OR REPLACE keeps the old columns first)
  const def = (await db.query<{ d: string }>("select pg_get_viewdef('app_cruise_offer_cards'::regclass, true) d")).rows[0].d;
  await db.exec(`create or replace view app_cruise_offer_cards with (security_invoker=true) as
    select v.*, 'x'::text as other_repo_col from (${def.trim().replace(/;$/, '')}) v`);
  assert.deepEqual(await columns(db, 'app_cruise_offer_cards'), [...LIVE_CRUISE, 'other_repo_col:text']);
};
for (const [name, drift] of [
  ['cruise view gained a column elsewhere', appendColumn],
  ['package view expression changed', (db: PGlite) => db.exec('alter view app_package_cards rename column summary to summary_x')],
  ['security_invoker off', (db: PGlite) => db.exec('alter view app_cruise_offer_cards set (security_invoker=false)')],
] as const) test(`drift aborts and changes nothing: ${name}`, async () => {
  const db = await liveState();
  try {
    await drift(db);
    const before = [await columns(db, 'app_cruise_offer_cards'), await columns(db, 'app_package_cards')];
    await assert.rejects(db.exec(migration), /drift/);
    await db.exec('rollback');
    assert.deepEqual([await columns(db, 'app_cruise_offer_cards'), await columns(db, 'app_package_cards')], before);
    const col = await db.query("select 1 from pg_attribute where attname = 'audience_note' and attrelid in ('cruise_offers'::regclass, 'package_offers'::regclass)");
    assert.equal(col.rows.length, 0, 'ALTER TABLE rolled back too');
    assert.equal((await columns(db, 'app_package_cards')).includes('season_months:smallint[]'), false);
  } finally { await db.close(); }
});
