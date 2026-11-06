// offer_sources.kind takes 'course' (cron 2026-11-05): the 5 course adapters never got a row, so their history stayed
// empty, prevFailed was unknown and every one-off timeout of theirs turned the slots cron red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { adapters } from '../../src/offers/registry.js';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(dir).find(f => f.endsWith(suffix))!, dir), 'utf8');
const fixture = readFileSync(new URL('../fixtures/offer-cards-schema.sql', import.meta.url), 'utf8');
const insert = (db: PGlite, key: string, kind: string, method = 'price_table') => db.query(
  `insert into public.offer_sources (key, name, kind, slot_method, url) values ($1, 'A', $2, $3, 'https://a.example/')`, [key, kind, method]);

test('the original CHECK rejects course, the migration allows it, safe to re-run, every registered adapter fits', async () => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    await db.exec(file('_offer_slots.sql').match(/CREATE TABLE public\.offer_sources \([\s\S]*?\n\);/)![0]);
    await insert(db, 'old-camp', 'camp');
    await assert.rejects(insert(db, 'old-course', 'course'), /offer_sources_kind_check/);

    const migration = file('_offer_sources_course.sql');
    await db.exec(migration);
    await db.exec(migration);

    await insert(db, 'new-course', 'course');
    await assert.rejects(insert(db, 'new-junk', 'cruise'), /offer_sources_kind_check/);
    await assert.rejects(insert(db, 'new-junk', 'camp', 'guess'), /offer_sources_slot_method_check/);
    const checks = await db.query<{ n: number }>(`select count(*)::int n from pg_constraint
      where conrelid = 'public.offer_sources'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'`);
    assert.equal(checks.rows[0].n, 1);

    assert.ok(adapters.some(a => a.kind === 'course'));
    for (const a of adapters) await insert(db, `adapter:${a.key}`, a.kind, a.slotMethod);
  } finally { await db.close(); }
});
