// `pnpm cli bookable-months [--dry-run]`
// Daily: the months (1-12) each app-visible offer is known to be bookable -> offer_bookable_months, the compact
// input for the month filter on the KCS travel map (MartinMarzi/KiteCruiseScout#316).
//   - season: season_start_month..season_end_month, wrapping over the year end
//   - dates:  every month touched by a future dated slot that is still open (KCS buildAvailableDates rules), plus
//             the remaining months of a month/season window that has not ended (KCS buildDateWindowLabels)
//   - the season counts even when a package calendar has no open slot right now (Aaron 2026-10-28: otherwise such
//     offers are "unknown" and shown in every month; the KCS card still says "no selectable departures")
//   - season_months (package_offers / cruise_offers, set by season-extract) wins over start/end: several windows
// No row = unknown; the map keeps such offers visible. Rows of offers that left the views are deleted.
const UNAVAILABLE = new Set(['cancelled', 'canceled', 'closed', 'sold out', 'sold_out', 'unavailable', 'waitlist']);

export type OfferDates = { season_start_month?: number | null; season_end_month?: number | null; season_months?: number[] | null; dates?: unknown };
export type BookableMonths = { months: number[]; basis: 'season' | 'dates' | 'season+dates' } | null;

function parseDay(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function openSlotMonths(dates: unknown, today: number): Set<number> {
  const months = new Set<number>();
  if (!Array.isArray(dates)) return months;
  for (const slot of dates) {
    if (!slot || typeof slot !== 'object') continue;
    const { status, spots_left: spots, start_date, end_date, date_precision: precision } = slot as Record<string, unknown>;
    if (typeof status === 'string' && UNAVAILABLE.has(status.trim().toLowerCase())) continue;
    const left = typeof spots === 'number' ? spots : typeof spots === 'string' && /^-?\d+$/.test(spots.trim()) ? Number(spots) : undefined;
    if (left !== undefined && left <= 0) continue;
    const start = parseDay(start_date);
    if (!start) continue;
    let end = parseDay(end_date) ?? start;
    let from = start;
    if (precision === 'month' || precision === 'season') {
      // A coarse window is an operating window, not a departure (KCS buildDateWindowLabels): it stays listed until
      // its last month has passed, even after its first day. Months already behind us are not claimed for next year.
      end = parseDay(end_date) as Date;
      if (!end || end < start) continue;
      if (precision === 'month' && (start.getUTCFullYear() !== end.getUTCFullYear() || start.getUTCMonth() !== end.getUTCMonth())) continue;
      if (Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1) <= today) continue;
      const thisMonth = new Date(Date.UTC(new Date(today).getUTCFullYear(), new Date(today).getUTCMonth(), 1));
      if (from < thisMonth) from = thisMonth;
    } else if (start.getTime() < today) continue; // a started departure is gone (KCS buildAvailableDates)
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    for (let guard = 0; cursor <= end && guard < 24; guard += 1) {
      months.add(cursor.getUTCMonth() + 1);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return months;
}

function seasonMonths(start?: number | null, end?: number | null, list?: number[] | null): Set<number> {
  const months = new Set<number>();
  const valid = (list ?? []).filter(m => Number.isInteger(m) && m >= 1 && m <= 12);
  if (valid.length) return new Set(valid);
  const first = start ?? null, last = end ?? start ?? null;
  if (!first || !last || first < 1 || first > 12 || last < 1 || last > 12) return months;
  for (let month = first, guard = 0; guard < 12; guard += 1) {
    months.add(month);
    if (month === last) break;
    month = month === 12 ? 1 : month + 1;
  }
  return months;
}

export function bookableMonths(row: OfferDates, isPackage: boolean, today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())): BookableMonths {
  const fromDates = openSlotMonths(row.dates, today);
  const fromSeason = seasonMonths(row.season_start_month, row.season_end_month, row.season_months);
  const months = [...new Set([...fromSeason, ...fromDates])].sort((a, b) => a - b);
  if (!months.length) return null;
  return { months, basis: fromSeason.size && fromDates.size ? 'season+dates' : fromDates.size ? 'dates' : 'season' };
}

// The client loads lazily so the pure month rules stay testable without database credentials.
const db = async () => (await import('../lib/supabase.js')).supabase;

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const supabase = await db();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** season_months from the table (season-extract); the views carry none, and a stored set wins over start/end. */
export function withTableSeason<T extends OfferDates>(row: T, months?: number[] | null): T {
  return months?.length ? { ...row, season_months: months } : row;
}

/** season_months of both offer tables (migration 20261028130000); empty, with a warning, while it is not applied. */
async function tableSeasons(): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const table of ['cruise_offers', 'package_offers']) {
    try {
      const rows = await selectAll<{ id: string; season_months: number[] | null }>(table, 'id,season_months');
      for (const r of rows) if (r.season_months?.length) out.set(`${table}:${r.id}`, r.season_months);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/season_months/.test(msg)) throw err;
      console.warn(`${table} has no season_months yet (migration 20261028130000): ${msg}`);
    }
  }
  return out;
}

export async function runBookableMonths({ dryRun = false } = {}) {
  type Row = OfferDates & { offer_id: string };
  const seasons = await tableSeasons();
  const sources = [['cruise_offers', 'app_cruise_offer_cards'], ['package_offers', 'app_package_cards']] as const;
  const rows: Array<{ catalog_source: string; offer_id: string; months: number[]; basis: string; computed_at: string }> = [];
  let offers = 0;
  const computedAt = new Date().toISOString();
  for (const [source, view] of sources) {
    const viewRows = await selectAll<Row>(view, 'offer_id,season_start_month,season_end_month,dates');
    offers += viewRows.length;
    for (const row of viewRows) {
      const result = bookableMonths(withTableSeason(row, seasons.get(`${source}:${row.offer_id}`)), source === 'package_offers');
      if (result) rows.push({ catalog_source: source, offer_id: row.offer_id, ...result, computed_at: computedAt });
    }
  }
  const byBasis = rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.basis]: (acc[row.basis] ?? 0) + 1 }), {});
  if (dryRun) return { offers, known: rows.length, byBasis, written: 0, deleted: 0 };
  const supabase = await db();

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('offer_bookable_months').upsert(rows.slice(i, i + 500), { onConflict: 'catalog_source,offer_id' });
    if (error) throw new Error(`offer_bookable_months upsert: ${error.message}`);
  }
  // Offers that left the views or lost every known month fall back to "unknown".
  const keep = new Set(rows.map(row => `${row.catalog_source}:${row.offer_id}`));
  const existing = await selectAll<{ catalog_source: string; offer_id: string }>('offer_bookable_months', 'catalog_source,offer_id');
  const stale = existing.filter(row => !keep.has(`${row.catalog_source}:${row.offer_id}`));
  for (const row of stale) {
    const { error } = await supabase.from('offer_bookable_months').delete().eq('catalog_source', row.catalog_source).eq('offer_id', row.offer_id);
    if (error) throw new Error(`offer_bookable_months delete: ${error.message}`);
  }
  return { offers, known: rows.length, byBasis, written: rows.length, deleted: stale.length };
}
