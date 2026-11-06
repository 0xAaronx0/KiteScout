// A failed offer_sources write cannot land in offer_sources.history, so the run log is the only place that shows it
// (cron 2026-11-05: the 5 course adapters failed this write silently, for weeks).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runAdapters } from '../../src/offers/ingest.js';
import { supabase } from '../../src/lib/supabase.js';
import type { OfferAdapter } from '../../src/offers/types.js';

const adapter = {
  key: 'broken-course', name: 'Broken course', kind: 'course', slotMethod: 'price_table', url: 'https://a.example/',
  fetchContent: async () => { throw new Error('ETIMEDOUT'); },
} as unknown as OfferAdapter;
const message = 'new row for relation "offer_sources" violates check constraint "offer_sources_kind_check"';

/** any query reads empty; only the offer_sources upsert fails */
const chain = (): unknown => new Proxy(() => {}, {
  get: (_, prop) => prop === 'then' ? (done: (v: unknown) => void) => done({ data: null, error: null }) : chain,
});

test('runAdapters prints a failed offer_sources write with the database message', async t => {
  const tables: string[] = [];
  t.mock.method(supabase, 'from', ((table: string) => {
    tables.push(table);
    return new Proxy({}, { get: (_, prop) => prop === 'upsert' ? async () => ({ error: { message } }) : chain });
  }) as never);
  const log = t.mock.method(console, 'log', () => {});
  const [r] = await runAdapters([adapter], { mode: 'full' });
  const lines = log.mock.calls.map(c => String(c.arguments[0]));
  mock.restoreAll();
  assert.ok(tables.includes('offer_sources'));
  assert.equal(r.status, 'error');
  assert.ok(lines.includes(`    offer_sources write failed: ${message}`), lines.join('\n'));
});
