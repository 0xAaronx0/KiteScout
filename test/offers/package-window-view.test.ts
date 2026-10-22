import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const directory = new URL('../../supabase/migrations/', import.meta.url);
const filename = readdirSync(directory).find(f => f.endsWith('_retain_coarse_package_slot_windows.sql'))!;
const migration = readFileSync(new URL(filename, directory), 'utf8');
const fixture = readFileSync(new URL('../fixtures/package-window-schema.sql', import.meta.url), 'utf8');
const id = '00000000-0000-4000-8000-000000000001';
const metadata = `select c.relowner, c.relacl, c.reloptions,
 (select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod) order by a.attnum)
  from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns
 from pg_class c where c.oid='app_package_cards'::regclass`;
const today = '2027-03-16';
const at = (sql: string, date: string) => sql.replace(/\bcurrent_date\b/g, `date '${date}'`);

// Boundary matrix covers exact/legacy, coarse windows, malformed bounds, calendar changes and infinity.
const cases: Array<[string | null, string | null, string | null, string, boolean]> = [
  ["month", "2027-03-01", "2027-03-31", "2027-03-16", true],
  ["month", "2027-03-01", "2027-03-31", "2027-03-31", true],
  ["month", "2027-03-01", "2027-03-31", "2027-04-01", false],
  ["month", "2027-03-04", "2027-03-05", "2027-03-16", true],
  ["season", "2026-11-01", "2027-04-01", "2027-03-16", true],
  ["season", "2026-11-01", "2027-04-01", "2027-04-30", true],
  ["season", "2026-11-01", "2027-04-01", "2027-05-01", false],
  ["season", "2027-11-01", "2028-04-01", "2027-03-16", true],
  ["day", "2027-03-15", "2027-03-20", "2027-03-16", false],
  ["day", "2027-03-16", null, "2027-03-16", true],
  ["day", "2027-03-17", null, "2027-03-16", true],
  [null, "2027-03-15", null, "2027-03-16", false],
  [null, "2027-03-17", null, "2027-03-16", true],
  ["month", "2027-03-31", "2027-04-01", "2027-03-16", false],
  ["season", "2027-04-01", "2027-03-01", "2027-03-16", false],
  ["month", "2027-03-01", null, "2027-03-16", false],
  ["season", null, "2027-04-01", "2027-03-16", false],
  ["unknown", "2027-03-17", "2027-03-31", "2027-03-16", false],
  ["month", "2028-02-01", "2028-02-01", "2028-02-29", true],
  ["month", "2028-02-01", "2028-02-01", "2028-03-01", false],
  ["month", "2027-12-01", "2027-12-01", "2027-12-31", true],
  ["month", "2027-12-01", "2027-12-01", "2028-01-01", false],
  ["day", "infinity", null, "2027-03-16", false],
  ["season", "2027-03-01", "infinity", "2027-03-16", false],
  ["month", "300000-03-01", "300000-03-31", "2027-03-16", false],
  ["season", "2027-03-01", "300000-03-31", "2027-03-16", false],
  ["day", "300000-03-01", null, "2027-03-16", false],
  ["month", "10000-03-01", "10000-03-31", "2027-03-16", false],
  ["month", "9999-12-01", "9999-12-31", "9999-12-31", true],
  ["month", "0001-03-01 BC", "0001-03-31 BC", "2027-03-16", false],
];


test('complete replacement keeps view contract, service access, JSON and calendar boundaries', async () => {
  const db = new PGlite();
  try {
    await db.exec(at(fixture, today));
    await db.exec(`alter view app_package_cards set (security_barrier=true);
      insert into package_offers (id, package_type, is_active, title, rooms, disciplines)
      values ('${id}', 'camp', true, 'Synthetic camp', '[{"name":"Twin"}]', '{kitesurf}');`);
    const before = (await db.query(metadata)).rows;
    const tablesBefore = (await db.query('select relname,relrowsecurity,relacl from pg_class where relname in (\'offer_slots\',\'package_offers\',\'providers\') order by relname')).rows;
    await db.exec(at(migration, today));
    assert.deepEqual((await db.query(metadata)).rows, before);
    assert.deepEqual((await db.query('select relname,relrowsecurity,relacl from pg_class where relname in (\'offer_slots\',\'package_offers\',\'providers\') order by relname')).rows, tablesBefore);
    for (const zone of ['UTC', 'Pacific/Honolulu', 'Europe/Ljubljana']) {
      await db.query("select set_config('TimeZone',$1,false)", [zone]);
      for (const [precision, start, end, date, retained] of cases) {
        // Rebuild the original view and apply the entire migration with a deterministic current date.
        await db.exec(at(fixture.slice(fixture.indexOf('CREATE OR REPLACE VIEW')), date));
        await db.exec(at(migration, date));
        await db.exec('delete from offer_slots');
        await db.query(`insert into offer_slots(package_offer_id,active,start_date,end_date,date_precision,
          availability,unit,price,currency,price_unit,price_basis,spots_left,price_valid_until)
          values($1,true,$2,$3,$4,'on_request','Twin',1250,'EUR','package','person',4,'2027-03-01')`, [id,start,end,precision]);
        const card = (await db.query<{ dates: unknown[] | null; rooms: unknown; disciplines: string[] }>('select * from app_package_cards')).rows[0];
        assert.equal(Boolean(card.dates?.length), retained, `${zone} ${precision} ${start} ${end} ${date}`);
        assert.deepEqual(card.rooms, [{ name: 'Twin' }]);
        assert.deepEqual(card.disciplines, ['kitesurf']);
        if (retained) assert.deepEqual(card.dates![0], { start_date: start, end_date: end,
          date_precision: precision, status:'on_request', unit:'Twin', price:1250, currency:'EUR',
          price_unit:'package', price_basis:'person', spots_left:4, price_valid_until:'2027-03-01' });
      }
    }
    // Status/capacity stay source data, never silently promoted to bookable inventory.
    await db.exec(at(fixture.slice(fixture.indexOf('CREATE OR REPLACE VIEW')), today));
    await db.exec(at(migration, today));
    await db.exec('delete from offer_slots');
    for (const [active, type, slotId, expected] of [[false,'camp',id,0],[true,'course',id,0],
      [true,'accommodation',id,0],[true,'camp','00000000-0000-4000-8000-000000000002',0],[true,'tour',id,1]] as const) {
      await db.query('update package_offers set package_type=$1',[type]);
      await db.exec('delete from offer_slots');
      await db.query(`insert into offer_slots(package_offer_id,active,start_date,end_date,date_precision,availability,spots_left)
        values($1,$2,'2026-11-01','2027-04-01','season','sold_out',0)`,[slotId,active]);
      const dates = (await db.query<{ dates: Array<{status:string; spots_left:number}> | null }>('select dates from app_package_cards')).rows[0].dates;
      assert.equal(dates?.length ?? 0, expected);
      if (expected) assert.deepEqual([dates![0].status, dates![0].spots_left],['sold_out',0]);
    }
    await db.exec('set role service_role');
    assert.equal((await db.query('select * from app_package_cards')).rows.length,1);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from app_package_cards'), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select * from app_package_cards'), /permission denied/);
  } finally { await db.close(); }
});

for (const drift of [
  'alter view app_package_cards set (security_invoker=false)',
  "create or replace view app_package_cards as select *, 'new'::text as unexpected from kcs_original",
]) test(`drift aborts atomically: ${drift}`, async () => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    // A separate baseline view lets the test introduce a future definition without dependency cycles.
    await db.exec('create view kcs_original as '+fixture.split('WITH (security_invoker = true) AS\n')[1].split('GRANT SELECT')[0]);
    await db.exec(drift);
    const before = (await db.query(metadata)).rows;
    const definition = (await db.query("select pg_get_viewdef('app_package_cards'::regclass) d")).rows;
    await assert.rejects(db.exec(migration), /drift/);
    await db.exec('rollback');
    assert.deepEqual((await db.query(metadata)).rows,before);
    assert.deepEqual((await db.query("select pg_get_viewdef('app_package_cards'::regclass) d")).rows,definition);
    assert.equal((await db.query("select to_regclass('pg_temp.kcs_345_expected_package_cards') t")).rows[0].t,null);
  } finally { await db.close(); }
});
