// Last published fallback from the stored slots (Aaron 2026-11-10): Wind Sports Fiji fell to "Price on request" on
// the 2026-11-08 cron once its 2026-04-04..2026-11-07 season was over (the adapter filters on today, 2 stored slots, so
// EMPTY_GUARD did not trip). A clean run without a price keeps the stored one as last published; a slot still ahead,
// a season older than 12 months or a partial run do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAdapter, storedPastSlots, summarizePrice } from '../../src/offers/ingest.js';
import { supabase } from '../../src/lib/supabase.js';
import type { FetchContext, OfferAdapter, Slot } from '../../src/offers/types.js';

const TODAY = '2026-11-10';
// live offer_slots of site:wind-sports-fiji-nananu-i-ra, read 2026-11-10
const row = (key: string, unit: string, price: number | null, start = '2026-04-04', end: string | null = '2026-11-07') => ({
  slot_key: key, start_date: start, end_date: end, unit, price, currency: 'AUD', price_unit: 'package', price_basis: 'person',
  occupancy: null, availability: 'on_request', availability_text: null, spots_left: null, date_precision: 'day', package_nights: null, active: true,
});
const FIJI = [
  row('beachfront-bures|2026', 'Beachfront bure - all-inclusive week (Saturday to Saturday)', 3595),
  row('shared-seaview-mango-lodges|2026', 'Shared seaview Mango Lodge - all-inclusive week (Saturday to Saturday)', 2595),
];
const FIJI_NOTE = 'From AUD 2,595 p.p. (last published price, 2026 dates are over, new dates not published yet: Shared seaview Mango Lodge - all-inclusive week (Saturday to Saturday), 2026-04-04; as of 2026-11-10)';

test('storedPastSlots + summarizePrice: the Fiji season that is over gives AUD 2,595 as last published', () => {
  const past = storedPastSlots('accommodation', FIJI, TODAY);
  assert.equal(past.length, 2);
  const p = summarizePrice('accommodation', [], TODAY, past);
  assert.equal(p.raw, 'From AUD 2,595 p.p.');
  assert.equal(p.note, FIJI_NOTE);
});

test('storedPastSlots: nothing while a priced slot is ahead, for a season over 12 months ago, or without priced dated slots', () => {
  assert.deepEqual(storedPastSlots('accommodation', [...FIJI, row('x|2027', 'X', 1999, '2027-04-03', '2027-11-06')], TODAY), []);
  // a camp is over once it has started; one starting today is still ahead
  assert.deepEqual(storedPastSlots('camp', [row('c', 'Camp', 900, TODAY, '2026-11-17')], TODAY), []);
  assert.equal(storedPastSlots('camp', [row('c', 'Camp', 900, '2026-11-09', '2026-11-16')], TODAY).length, 1);
  // 12 months: ended 2025-11-10 still counts, 2025-11-09 does not
  assert.equal(storedPastSlots('accommodation', [row('a', 'A', 100, '2025-04-01', '2025-11-10')], TODAY).length, 1);
  assert.deepEqual(storedPastSlots('accommodation', [row('a', 'A', 100, '2025-04-01', '2025-11-09')], TODAY), []);
  assert.deepEqual(storedPastSlots('accommodation', [row('a', 'A', null)], TODAY), []);
  assert.deepEqual(storedPastSlots('accommodation', [row('a', 'A', 100, null as unknown as string, null)], TODAY), [], 'undated counts as ahead');
  assert.deepEqual(storedPastSlots('accommodation', [], TODAY), []);
  // pricing.slots entries (slotJson shape) read the same
  const json = { key: 'k', start_date: '2026-04-04', end_date: '2026-11-07', unit: 'U', price: 50, currency: 'EUR', price_unit: 'per_night', price_basis: 'room', status: 'available' };
  assert.equal(storedPastSlots('accommodation', [json], TODAY)[0].availability, 'available');
});

// --- runAdapter, slots mode, against a fake supabase --------------------------------------
interface Write { table: string; op: string; payload: unknown }
function fakeSupabase(t: import('node:test').TestContext, offerSlots: Array<Record<string, unknown>>) {
  const writes: Write[] = [];
  const offer = { id: 'offer-1', images: [], rooms: null, itinerary_spots: [], price_basis_note: 'From AUD 2,595 p.p. (cheapest bookable: Shared seaview Mango Lodge; as of 2026-11-07)',
    pricing: { raw: 'From AUD 2,595 p.p.', slots: [], slots_total: 0 } };
  t.mock.method(supabase, 'from', ((table: string) => {
    let op = 'select', payload: unknown = null, head = false;
    const result = () => {
      if (op !== 'select') { writes.push({ table, op, payload }); return { data: { id: table === 'providers' ? 'op-1' : 'offer-1' }, error: null }; }
      if (table === 'package_offers') return { data: offer, error: null };
      if (table === 'offer_slots') return head ? { count: offerSlots.filter(r => r.active).length, error: null } : { data: offerSlots.filter(r => r.active), error: null };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (_c: string, o?: { head?: boolean }) => { if (o?.head) head = true; return b; },
      update: (p: unknown) => { op = 'update'; payload = p; return b; },
      upsert: (p: unknown) => { op = 'upsert'; payload = p; return b; },
      insert: (p: unknown) => { op = 'insert'; payload = p; return b; },
      then: (done: (v: unknown) => void) => done(result()),
    };
    for (const m of ['eq', 'in', 'limit', 'order', 'maybeSingle', 'single']) b[m] = () => b;
    return b;
  }) as never);
  return writes;
}
const adapter = (fetchSlots: (ctx: FetchContext) => Promise<Slot[]>) => ({
  key: 'wind-sports-fiji-nananu-i-ra', name: 'Wind Sports Fiji', kind: 'accommodation', slotMethod: 'price_table', url: 'https://f.example/',
  operator: { name: 'Wind Sports Fiji', rootDomain: 'f.example', websiteUrl: 'https://f.example/' },
  fetchContent: async () => { throw new Error('not in a slots run'); }, fetchSlots,
}) as unknown as OfferAdapter;
const offerUpdate = (writes: Write[]) => writes.find(w => w.table === 'package_offers' && w.op === 'update')?.payload as Record<string, unknown>;

async function run(t: import('node:test').TestContext, slots: Array<Record<string, unknown>>, fetchSlots: (ctx: FetchContext) => Promise<Slot[]> = async () => []) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(`${TODAY}T05:00:00Z`) });
  const writes = fakeSupabase(t, slots);
  const rep = await runAdapter(adapter(fetchSlots), { mode: 'slots' });
  return { rep, writes, update: offerUpdate(writes) };
}

test('runAdapter: a clean empty run on the Fiji slots keeps AUD 2,595 as last published, slots stay active', async t => {
  const { rep, writes, update } = await run(t, FIJI);
  assert.equal(rep.status, 'ok', rep.error);
  assert.equal(update.price_pp_cabin, 2595);
  assert.equal(update.price_pp_cabin_currency, 'AUD');
  assert.equal(update.price_basis_note, FIJI_NOTE);
  assert.deepEqual((update.pricing as { slots: unknown[] }).slots, [], 'pricing.slots stays future-only');
  assert.ok(rep.notes.some(n => n.startsWith('kept the last published price from 2 stored slot(s)')), rep.notes.join('\n'));
  assert.ok(!writes.some(w => w.table === 'offer_slots'), 'no slot row is written or retracted');
});

test('runAdapter: a stored slot still ahead or a season over 12 months ago stays "Price on request"', async t => {
  // two rows: three would trip EMPTY_GUARD, which keeps the stock for its own reason
  const ahead = await run(t, [FIJI[1], row('x|2027', 'X', 1999, '2027-04-03', '2027-11-06')]);
  assert.equal(ahead.update.price_basis_note, 'Price on request');
  assert.equal(ahead.update.price_pp_cabin, null);
  t.mock.restoreAll(); t.mock.timers.reset();
  const old = await run(t, [row('a|2025', 'A', 2400, '2025-04-05', '2025-11-08')]);
  assert.equal(old.update.price_basis_note, 'Price on request');
  assert.equal(old.update.price_pp_cabin, null);
});

test('runAdapter: a partial run without a price leaves the stored price alone', async t => {
  const { rep, update } = await run(t, FIJI, async ctx => { ctx.incomplete('one page timed out'); return []; });
  assert.equal(rep.status, 'ok', rep.error);
  for (const k of ['price_pp_cabin', 'price_basis_note', 'pricing', 'currency', 'price_unit']) assert.ok(!(k in update), `${k} written`);
});

test('runAdapter: a run with a future priced slot prices it as before, no fallback', async t => {
  const fresh: Slot = { key: 'shared|2027', startDate: '2027-04-03', endDate: '2027-11-06', unit: 'Shared seaview Mango Lodge', price: 2695, currency: 'AUD',
    priceUnit: 'package', priceBasis: 'person', occupancy: null, availability: 'on_request', availabilityText: null, spotsLeft: null };
  const { rep, update } = await run(t, FIJI, async () => [fresh]);
  assert.equal(update.price_pp_cabin, 2695);
  assert.match(update.price_basis_note as string, /\(cheapest bookable: Shared seaview Mango Lodge, 2027-04-03; as of 2026-11-10\)$/);
  assert.ok(!rep.notes.some(n => n.startsWith('kept the last published price')));
});
