/**
 * Pure rules of the QS inbox (src/pipeline/qs-inbox.ts): which monitor/adapter states become a case.
 * No DB access here, so the thresholds are unit-tested (test/pipeline/qs-rules.test.ts).
 * Policy and the autonomous decision rules: docs/qs-inbox.md.
 */

const DAY_MS = 86_400_000;

/** Change rows that wait for a human decision (everything else is machine state or done). */
export const OPEN_CHANGE_STATUSES = ['pending', 'rerun_done'] as const;

/** An adapter source that has not succeeded for this many days is a case. */
export const SOURCE_FAIL_DAYS = 3;
/** Departures that ended within this window and nothing upcoming = the next season is probably out. */
export const EXPIRED_WINDOW_DAYS = 120;
/** A watched page failing this often without an open change row (homepages, non-404 errors). */
export const WATCH_FAIL_CHECKS = 3;

export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY_MS) : null;
}

export interface SlotHistoryEntry { at?: string; slots?: number; bookable?: number; error?: string }

/**
 * Why an adapter source needs a look, or null.
 * - no success for SOURCE_FAIL_DAYS (or never)
 * - the latest run reports bookable 0 while one of the 5 runs before had bookable slots
 *   (a rebuilt booking widget reads as "no slots"; the slot guard keeps the old ones, which then go stale)
 */
export function sourceProblem(
  src: { active: boolean; last_ok_at: string | null; last_error: string | null; history: SlotHistoryEntry[] | null },
  now: Date,
): string | null {
  if (!src.active) return null;
  const okDays = daysSince(src.last_ok_at, now);
  if (okDays === null) return `noch nie erfolgreich${src.last_error ? `: ${src.last_error}` : ''}`;
  if (okDays >= SOURCE_FAIL_DAYS) return `seit ${okDays} Tagen kein erfolgreicher Lauf${src.last_error ? `: ${src.last_error}` : ''}`;
  const h = src.history ?? [];
  if (h.length >= 2 && h[0].bookable === 0 && h.slice(1, 6).some(e => (e.bookable ?? 0) > 0)) {
    return `buchbare Termine auf 0 gefallen (vorher ${h.slice(1, 6).find(e => (e.bookable ?? 0) > 0)?.bookable})${h[0].error ? `: ${h[0].error}` : ''}`;
  }
  return null;
}

interface Dep { start_date?: unknown; end_date?: unknown }
const iso = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Last departure date when ALL stored departures are past and the latest one ended within
 * EXPIRED_WINDOW_DAYS (the provider has likely published the next season), else null.
 * Offers that never had dates are not a case: "on request" is a legitimate state.
 */
export function recentlyExpired(dates: unknown, today: string): string | null {
  if (!Array.isArray(dates) || dates.length === 0) return null;
  let last: string | null = null;
  for (const d of dates as Dep[]) {
    const end = iso(d?.end_date) ?? iso(d?.start_date);
    if (!end) continue;
    if (end >= today) return null;
    if (!last || end > last) last = end;
  }
  if (!last) return null;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / DAY_MS;
  return age <= EXPIRED_WINDOW_DAYS ? last : null;
}

const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|wa\.me|whatsapp\.com|linktr\.ee|tiktok\.com|youtube\.com)$/;
const hostOf = (u: string | null | undefined): string | null => {
  try { return u ? new URL(u).hostname.toLowerCase().replace(/^www\./, '') : null; } catch { return null; }
};

/**
 * Does the listing have a website of its own? Not when its source page sits on another domain
 * (a bstoked listing, a marketplace) or the provider only has a social profile (Aaron 2026-10-30,
 * e.g. the Philippines catamaran: Instagram + bstoked). Such listings are never hidden without
 * Aaron's explicit OK, even when no site can be found.
 */
export function hasOwnSite(sourceUrl: string | null | undefined, rootDomain: string | null | undefined, websiteUrl?: string | null): boolean {
  const src = hostOf(sourceUrl);
  const root = (rootDomain ?? '').toLowerCase().replace(/^www\./, '');
  if (!src || !root || SOCIAL.test(src) || !(src === root || src.endsWith(`.${root}`))) return false;
  const web = hostOf(websiteUrl);
  return !(web && SOCIAL.test(web));
}

export const normUrl =(u: string | null | undefined): string =>
  (u ?? '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');

export const liveLink = (table: 'cruise_offers' | 'package_offers', id: string): string =>
  `https://kitescout.bstoked.net/offers/${table}/${id}`;
