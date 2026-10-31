// Trip length of a cruise in days (Aaron 2026-10-31): days = nights + 1. Providers sell a Saturday-to-Saturday week
// (7 nights) as "8 days" or "one week"; KCS shows duration_days - 1 nights and reads 8 days as "1 week".
// The extraction prompt, the full re-extraction diff and the read-only audit share this rule.

export const DURATION_RULE =
  "trip length in days = nights + 1: '7 nights', 'Saturday to Saturday', 'one week' or a price per week = 8; " +
  "'7 days / 6 nights' = 7; a bare 'N-day' with no nights stated = N; null if the page states no length";

// Aaron 2026-10-31: the data stores nights (duration_nights), the unambiguous number providers state.
export const NIGHTS_RULE =
  "nights of the trip as the page states them: a Saturday-to-Saturday week or 'one week' = 7; '8 days / 7 nights' = 7; " +
  "null if the page states no nights";

/** Nights as stored: an integer 0..60, else null. */
export function cleanNights(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 60 ? n : null;
}

/** ±1 day is the nights-vs-days ambiguity ("7 days" vs "7 nights = 8 days"), never a change (as in cruise-state.ts). */
export function sameTripDuration(before: number | null, after: number | null): boolean {
  if (before === after) return true;
  return before !== null && after !== null && Math.abs(before - after) <= 1;
}

export interface DurationEvidence {
  durationDays: number | null;
  dates: unknown;
  /** title, summary, price note, pricing.raw, source_text: stored texts only (the audit fetches nothing). */
  texts: Array<string | null | undefined>;
}
export interface DurationProposal {
  /** Proposed duration_days (= nights + 1), or null when the stored data names no nights. */
  days: number | null;
  /** Proposed duration_nights, or null. */
  nights: number | null;
  basis: 'departures' | 'nights' | 'days-and-nights' | 'week' | 'none';
  note: string;
}

const NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14 };
const num = (raw: string): number => NUMBER[raw.toLowerCase()] ?? Number(raw);
const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)';
const NIGHTS = new RegExp(`\\b${N}[\\s-]*(?:nights?|n[äa]chte|nuits?|notti|noches)\\b`, 'gi');
const DAYS_AND_NIGHTS = new RegExp(`\\b${N}[\\s-]*days?\\s*(?:/|and|&|,)\\s*${N}[\\s-]*nights?\\b`, 'gi');
// "1 Woche vor dem Trip" (a reminder a week before) is no trip length.
const WEEK = /(?:\b(?:one|1)[\s-]*(?:week|woche)\b|\bweek-long\b|\bper week\b|\/\s*week\b|\bsaturday\s+to\s+saturday\b|\bsamstag\s+bis\s+samstag\b)(?!\s*(?:vor|before|prior)\b)/i;

function departureNights(dates: unknown): number[] {
  if (!Array.isArray(dates)) return [];
  const nights: number[] = [];
  for (const d of dates as Array<{ start_date?: unknown; end_date?: unknown }>) {
    if (typeof d?.start_date !== 'string' || typeof d?.end_date !== 'string') continue;
    const start = Date.parse(`${d.start_date}T00:00:00Z`), end = Date.parse(`${d.end_date}T00:00:00Z`);
    const n = Math.round((end - start) / 86_400_000);
    if (Number.isFinite(n) && n > 0 && n <= 30) nights.push(n);
  }
  return nights;
}
function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null, most = 0;
  for (const [v, c] of counts) if (c > most) { best = v; most = c; }
  return best;
}

/** Proposal from stored data only, strongest evidence first: departure spans, "N days / M nights", "N nights", week wording. */
export function proposeTripDuration(e: DurationEvidence): DurationProposal {
  const spans = departureNights(e.dates);
  const span = mostCommon(spans);
  if (span !== null) return { days: span + 1, nights: span, basis: 'departures', note: `${spans.length} departure(s), mostly ${span} nights` };
  const text = e.texts.filter((t): t is string => typeof t === 'string' && t.length > 0).join(' \n ');
  const pairs = [...text.matchAll(DAYS_AND_NIGHTS)].map(m => num(m[2]));
  const pair = mostCommon(pairs);
  if (pair !== null) return { days: pair + 1, nights: pair, basis: 'days-and-nights', note: `"N days / ${pair} nights" stated` };
  const nights = mostCommon([...text.matchAll(NIGHTS)].map(m => num(m[1])).filter(n => n >= 2 && n <= 21));
  if (nights !== null) return { days: nights + 1, nights, basis: 'nights', note: `${nights} nights stated` };
  if (WEEK.test(text)) return { days: 8, nights: 7, basis: 'week', note: 'week wording, nights not stated (week rule: 7 nights)' };
  return { days: null, nights: null, basis: 'none', note: 'no nights in the stored data' };
}
