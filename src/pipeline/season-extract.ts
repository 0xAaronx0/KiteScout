// `pnpm cli season-extract [--types cruise,camp,tour,course,accommodation] [--limit n] [--fetch] [--recheck] [--out <dir>]`
// `pnpm cli season-extract apply --from <plan.json> [--only|--exclude|--approve id,..] [--include-wind] [--update] [--dry-run] [--revert]`
//
// Season months for offers the KCS map month filter does not know yet (no offer_bookable_months row), read
// from the provider's OWN page text (stored source_text, optionally a fresh fetch of source_url; never
// aggregators). Plan approved by Aaron 2026-10-28 ("1+2 starten"):
//   - cruises, camps, tours, courses: the stated season -> season_start_month..season_end_month
//   - accommodation: only an explicit "open all year" (1..12) or explicit opening/closing months
//   - never inferred from slot samples; several season windows (two wind seasons) are allowed
//     (Aaron 2026-10-28) and stored as a month set
// Every proposal carries an evidence quote that must appear verbatim in the page text; low confidence or
// a quote we cannot find = no write. The run only writes a plan + review table; `apply` writes live, and
// only into a season that is still empty (cruise start/end or season_months, package season_months).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type OfferType = 'cruise' | 'camp' | 'tour' | 'course' | 'accommodation';
/** What the page's statement is about; only the first two (and wind_season for cruises) are a season we write. */
export const BASES = ['year_round', 'operating_period', 'wind_season', 'price_seasons', 'dated_departures', 'other_facility', 'none'] as const;
export type Basis = typeof BASES[number];

/** What the LLM reports for one page. */
export interface SeasonExtraction {
  basis: Basis;
  open_months: number[];
  closed_months: number[];
  evidence_quote: string | null;
  confidence: 'high' | 'medium' | 'low';
  note: string | null;
}

export type Decision =
  | { write: true; months: number[]; kind: 'year_round' | 'range' | 'closed_months' | 'wind_season' | 'split_season' | 'region_inferred' | 'page_wind' | 'page_region' }
  | { write: false; reason: 'unknown' | 'low_confidence' | 'quote_not_found' | 'non_contiguous' | 'wind_only' | 'price_only' | 'dates_only' | 'other_facility' | 'conflict'; months: number[] };

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const okMonth = (m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= 12;
const monthSet = (list: unknown): number[] => (Array.isArray(list) ? [...new Set(list.filter(okMonth))].sort((a, b) => a - b) : []);

/** Lowercase, unify dashes/quotes, collapse whitespace: the quote check must survive page-text formatting. */
export function normalizeForQuote(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The evidence quote must stand in the page text (min. 8 chars, so "May" alone never counts). */
export function quoteInText(quote: string | null, text: string): boolean {
  if (!quote) return false;
  const q = normalizeForQuote(quote).replace(/^[."'\s]+|[."'\s]+$/g, '');
  if (q.length < 8) return false;
  return normalizeForQuote(text).includes(q);
}

/** A month set as one block on the circular year (wrapping Dec -> Jan allowed), or null when it is not one block. */
export function contiguousRange(months: number[]): { start: number; end: number } | null {
  const set = new Set(months);
  if (set.size === 0) return null;
  if (set.size === 12) return { start: 1, end: 12 };
  const starts = ALL.filter(m => set.has(m) && !set.has(m === 1 ? 12 : m - 1));
  if (starts.length !== 1) return null;
  let end = starts[0];
  while (set.has(end === 12 ? 1 : end + 1)) end = end === 12 ? 1 : end + 1;
  return { start: starts[0], end };
}

export function contiguousMonths(start: number, end: number): number[] {
  const out: number[] = [];
  for (let m = start, guard = 0; guard < 12; guard += 1) {
    out.push(m);
    if (m === end) break;
    m = m === 12 ? 1 : m + 1;
  }
  return out.sort((a, b) => a - b);
}

/**
 * The write rule. Written: an explicit year-round statement or an explicit operating/opening period of THIS
 * offer (or explicit closing months). Cruises keep the existing cruise convention (the stated kite/best season,
 * extract-cruise-offers SEASON rule), so a wind season counts there only. Price-season tables, past or single
 * dated departures, other facilities (school, restaurant, pool) and wind windows of camps/tours/accommodation
 * are reported for Aaron, never written: a wrong partial season hides an offer on the map.
 */
export function decideSeason(type: OfferType, x: SeasonExtraction, text: string): Decision {
  const open = x.basis === 'year_round' ? ALL : monthSet(x.open_months);
  const closed = monthSet(x.closed_months);
  const months = open.length ? open : closed.length ? ALL.filter(m => !closed.includes(m)) : [];
  if (x.basis === 'none' || months.length === 0) return { write: false, reason: 'unknown', months: [] };
  if (open.length && closed.length && open.some(m => closed.includes(m))) return { write: false, reason: 'conflict', months };
  if (x.basis === 'price_seasons') return { write: false, reason: 'price_only', months };
  if (x.basis === 'dated_departures') return { write: false, reason: 'dates_only', months };
  if (x.basis === 'other_facility') return { write: false, reason: 'other_facility', months };
  if (x.basis === 'wind_season' && type !== 'cruise') return { write: false, reason: 'wind_only', months };
  if (x.confidence === 'low') return { write: false, reason: 'low_confidence', months };
  if (!quoteInText(x.evidence_quote, text)) return { write: false, reason: 'quote_not_found', months };
  // Several windows are fine (two wind seasons, Aaron 2026-10-28): stored as a month set (season_months).
  const kind = months.length === 12 ? 'year_round' : !contiguousRange(months) ? 'split_season' : x.basis === 'wind_season' ? 'wind_season' : !open.length ? 'closed_months' : 'range';
  return { write: true, months, kind };
}

/**
 * Season columns for a cruise (re-)extraction upsert: what came back empty is left out of the row, so a
 * re-extraction (`pnpm cli cruise-offers`) never wipes a season set earlier (e.g. by season-extract).
 */
export function seasonUpsertColumns(text: string | null, start: number | null, end: number | null): Record<string, string | number | null> {
  return {
    ...(text != null ? { season_text: text } : {}),
    ...(start != null || end != null ? { season_start_month: start, season_end_month: end } : {}),
  };
}

const KEYWORDS = /season|saison|temporada|stagione|seizoen|year[- ]round|all[- ]year|whole year|open (?:from|daily|all)|closed|closing|reopen|ganzj[aä]hr|geöffnet|geschlossen|ouvert|fermé|abierto|cerrado|aperto|chiuso|january|february|march|april|\bmay\b|june|july|august|september|october|november|december|\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|janvier|février|avril|juin|juillet|août|septembre|octobre|novembre|décembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|januar|februar|märz|juni|juli|oktober|dezember/gi;

/** The page head plus windows around season/month words, capped: keeps the prompt short on long pages. */
export function seasonWindows(text: string, budget = 9000): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= budget) return t;
  const spans: Array<[number, number]> = [[0, 1500]];
  for (const m of t.matchAll(KEYWORDS)) spans.push([Math.max(0, m.index! - 350), Math.min(t.length, m.index! + 350)]);
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  let out = '';
  for (const [a, b] of merged) {
    const piece = t.slice(a, b);
    if (out.length + piece.length + 5 > budget) break;
    out += (out ? ' ... ' : '') + piece;
  }
  return out;
}

const PROMPT = `You read text from a kitesurf travel provider's OWN website about ONE offer (at one location) and report WHEN that offer runs / that place is open. Respond with STRICT JSON only:
{
  "basis": "year_round" | "operating_period" | "wind_season" | "price_seasons" | "dated_departures" | "other_facility" | "none",
  "open_months": [1-12, ...],
  "closed_months": [1-12, ...],
  "evidence_quote": "<the exact sentence or phrase from the text, copied character for character>" | null,
  "confidence": "high" | "medium" | "low",
  "note": "<short remark>" | null
}

Pick the ONE basis that best describes the strongest statement about THIS offer:
- "year_round": the text explicitly says THIS offer/place is open, bookable or running all year ("open all year", "year-round", "ganzjährig geöffnet", "365 days"). Not: "beautiful all year", "wind all year", price bands that happen to cover 12 months.
- "operating_period": the text explicitly says THIS offer/place operates, is open, or is bookable only in a period, or is closed in some months ("open 25 March to 18 October", "season: June 1st to end of September", "the camp runs June-September", "closed from 1 October", "open each winter from November 15 to March 15"). A campsite/hotel opening period counts.
- "wind_season": only when the wind / kite conditions are best ("best wind May-September", "kite season November to April" with no statement that the place closes outside it).
- "price_seasons": only price or rate periods (low / mid / high season prices, rate tables by month).
- "dated_departures": only specific dated trips, camp weeks or events (e.g. "14-17 May 2026", "Du 10 mars au 20 mars 2026").
- "other_facility": the months are about something else than THIS offer: a restaurant, pool, shuttle, phone hours, another destination or another product of the provider.
- "none": nothing about months.

open_months: every month the statement covers for THIS offer (April to October -> [4,5,6,7,8,9,10]; November to March -> [11,12,1,2,3]; year_round -> []). Do not fill gaps: two separate seasons ("Dec-Feb and Jun-Sep") -> list exactly those months and say "two seasons" in note.
closed_months: months the text explicitly says THIS offer/place is closed.
evidence_quote: verbatim from the text (any language), short (one sentence), containing the months or the year-round statement.
confidence: "low" when the statement is vague, might be about another product/location/facility, or you are unsure it applies to THIS offer.
Respond ONLY with the JSON object.`;

export function parseExtraction(raw: string): SeasonExtraction | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    return {
      basis: BASES.includes(o.basis as Basis) ? (o.basis as Basis) : 'none',
      open_months: monthSet(o.open_months),
      closed_months: monthSet(o.closed_months),
      evidence_quote: typeof o.evidence_quote === 'string' && o.evidence_quote.trim() ? o.evidence_quote.trim() : null,
      confidence: o.confidence === 'high' || o.confidence === 'medium' ? o.confidence : 'low',
      note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Runner (database + LLM + network): plan only, nothing written live.
// ---------------------------------------------------------------------------------------------------------

export interface PlanRow {
  catalog_source: 'cruise_offers' | 'package_offers';
  offer_id: string;
  type: OfferType;
  title: string;
  provider: string;
  source_url: string | null;
  text_source: 'stored' | 'fetched';
  extraction: SeasonExtraction | null;
  decision: Decision;
  /** --recheck: the months season-extract wrote last time (season_evidence.months), to diff against. */
  previous?: number[] | null;
  /** season-region: where the wind came from (stored in season_evidence). */
  wind_source?: string | null;
  /** season-region: the page's own months behind a page_region cut (kept in season_evidence across re-runs). */
  page_months?: number[] | null;
  /** Why a hand-approved row has these months (stored in season_evidence.note). */
  note?: string | null;
  /** season-region: storm-season cut (zone, removed months, months kept because an explicit offer runs then). */
  storm?: { zone: string; removed: number[]; kept: number[] } | null;
  error?: string;
}

/** What `apply` stores next to the months, so a later --recheck knows what it wrote and from where. */
export interface SeasonEvidence { source: 'season-extract'; months: number[]; quote: string | null; url: string | null; basis: string; checked_at: string; page_months?: number[]; wind_source?: string; storm?: { zone: string; removed: number[]; kept: number[] }; note?: string }

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

// Original provider sites only (memory original-sites-only): never read a season from an aggregator.
const AGGREGATORS = /(?:^|\.)(?:bstoked\.net|booksurfcamps\.com|kiteworldwide\.com|kayak\.[a-z.]+|airbnb\.[a-z.]+|booking\.com|tripadvisor\.[a-z.]+|expedia\.[a-z.]+|hostelworld\.com|tripaneer\.com)$/i;
export const isOwnSite = (url: string | null): boolean => {
  if (!url) return false;
  try { return !AGGREGATORS.test(new URL(url).hostname); } catch { return false; }
};

async function extractOne(title: string, provider: string, type: OfferType, text: string): Promise<SeasonExtraction | null> {
  const { anthropic, ANALYSIS_MODEL } = await import('../lib/anthropic.js');
  const { withRetry } = await import('../lib/retry.js');
  const msg = await withRetry(() => anthropic.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 600,
    system: PROMPT,
    messages: [{ role: 'user', content: `Offer: "${title}" (${type}) by ${provider}\n\nTEXT:\n${seasonWindows(text)}` }],
  }));
  return parseExtraction(msg.content.map(b => (b.type === 'text' ? b.text : '')).join(''));
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const NOTHING: Decision = { write: false, reason: 'unknown', months: [] };

/**
 * Default: offers without known months. --recheck (planned twice a year, Aaron 2026-10-28: opening periods and
 * event dates change, a new place may open earlier in later years): every offer whose season season-extract
 * wrote (season_evidence), read again from a FRESH page; the plan carries the previous months to diff against.
 */
export async function runSeasonExtract(opts: { types: OfferType[]; limit?: number; fetch?: boolean; recheck?: boolean; outDir: string }) {
  type ViewRow = { offer_id: string; title: string; provider_name: string | null; provider_root_domain: string | null; source_url: string | null; provider_trip_types?: string[] | null };
  const known = new Set((await selectAll<{ offer_id: string }>('offer_bookable_months', 'offer_id')).map(r => r.offer_id));
  const cruiseView = await selectAll<ViewRow>('app_cruise_offer_cards', 'offer_id,title,provider_name,provider_root_domain,source_url');
  const packageView = await selectAll<ViewRow>('app_package_cards', 'offer_id,title,provider_name,provider_root_domain,source_url,provider_trip_types');
  type TextRow = { id: string; source_text: string | null; season_evidence?: SeasonEvidence | null };
  const cols = opts.recheck ? 'id,source_text,season_evidence' : 'id,source_text';
  const cruiseRows = await selectAll<TextRow>('cruise_offers', cols);
  const packageRows = await selectAll<TextRow>('package_offers', cols);
  const cruiseText = new Map(cruiseRows.map(r => [r.id, r.source_text ?? '']));
  const packageText = new Map(packageRows.map(r => [r.id, r.source_text ?? '']));
  // Climate-derived seasons and Aaron's hand corrections (approved:manual) are not re-read from the page; a page season
  // cut by the climate (page_region) is compared on its page months.
  const previous = new Map([...cruiseRows, ...packageRows]
    .filter(r => r.season_evidence?.months?.length && !['region_inferred', 'approved:region_inferred', 'approved:manual'].includes(r.season_evidence.basis))
    .map(r => [r.id, r.season_evidence!.page_months ?? r.season_evidence!.months]));

  const todo = [
    ...cruiseView.map(r => ({ r, source: 'cruise_offers' as const, type: 'cruise' as OfferType, text: cruiseText.get(r.offer_id) ?? '' })),
    ...packageView.map(r => ({ r, source: 'package_offers' as const, type: (r.provider_trip_types?.[0] ?? 'accommodation') as OfferType, text: packageText.get(r.offer_id) ?? '' })),
  ].filter(x => (opts.recheck ? previous.has(x.r.offer_id) : !known.has(x.r.offer_id)) && opts.types.includes(x.type)).slice(0, opts.limit ?? Infinity);
  console.log(`${todo.length} offers ${opts.recheck ? 'with a season from season-extract (recheck)' : 'without known months'} (${opts.types.join(', ')})`);

  const fetchReadable = opts.fetch || opts.recheck ? (await import('./observe.js')).fetchReadable : null;
  const rows: PlanRow[] = [];
  await pool(todo, 6, async ({ r, source, type, text }) => {
    const base = { catalog_source: source, offer_id: r.offer_id, type, title: r.title, provider: r.provider_name ?? r.provider_root_domain ?? '?', source_url: r.source_url };
    try {
      // A recheck reads the live page first: the stored text is what we read last time.
      if (opts.recheck && fetchReadable && isOwnSite(r.source_url)) {
        const page = await fetchReadable(r.source_url!);
        if (page.text && page.text.length >= 200) {
          const fx = await extractOne(r.title, base.provider, type, page.text);
          if (fx) { rows.push({ ...base, text_source: 'fetched', extraction: fx, decision: decideSeason(type, fx, page.text), previous: previous.get(r.offer_id) ?? null }); return; }
        }
      }
      let x = text.length >= 100 && isOwnSite(r.source_url) ? await extractOne(r.title, base.provider, type, text) : null;
      let decision = x ? decideSeason(type, x, text) : NOTHING;
      let textSource: PlanRow['text_source'] = 'stored';
      // Fresh read of the provider's own page only when the stored text gave nothing usable.
      if (fetchReadable && !decision.write && (decision.reason === 'unknown' || decision.reason === 'quote_not_found') && isOwnSite(r.source_url)) {
        const page = await fetchReadable(r.source_url!);
        if (page.text && page.text.length >= 200) {
          const fx = await extractOne(r.title, base.provider, type, page.text);
          const fd = fx ? decideSeason(type, fx, page.text) : null;
          if (fx && fd && (fd.write || fx.basis !== 'none')) { x = fx; decision = fd; textSource = 'fetched'; }
        }
      }
      rows.push({ ...base, text_source: textSource, extraction: x, decision, ...(opts.recheck ? { previous: previous.get(r.offer_id) ?? null } : {}) });
    } catch (err) {
      rows.push({ ...base, text_source: 'stored', extraction: null, decision: NOTHING, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
    if (rows.length % 25 === 0) console.log(`  ${rows.length}/${todo.length}`);
  });
  rows.sort((a, b) => a.type.localeCompare(b.type) || a.provider.localeCompare(b.provider) || a.title.localeCompare(b.title));

  mkdirSync(opts.outDir, { recursive: true });
  const planPath = join(opts.outDir, 'season-plan.json');
  writeFileSync(planPath, JSON.stringify({ created_at: new Date().toISOString(), rows }, null, 1));
  const reviewPath = join(opts.outDir, 'season-review.md');
  writeFileSync(reviewPath, reviewMarkdown(rows));
  return { planPath, reviewPath, summary: summarize(rows), errors: rows.filter(r => r.error).length };
}

const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthsLabel(months: number[]): string {
  if (months.length === 12) return 'all year';
  const r = contiguousRange(months);
  return r ? `${MON[r.start]}-${MON[r.end]}` : months.map(m => MON[m]).join(', ');
}

export function summarize(rows: PlanRow[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const key = r.decision.write ? `write:${r.decision.kind}` : r.decision.reason;
    (out[r.type] ??= {})[key] = (out[r.type][key] ?? 0) + 1;
  }
  return out;
}

function reviewMarkdown(rows: PlanRow[]): string {
  const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  const table = (list: PlanRow[], status: (r: PlanRow) => string) => [
    '| # | Type | Provider | Offer | Proposed | Status | Quote | Source | offer_id |',
    '|---|---|---|---|---|---|---|---|---|',
    ...list.map((r, i) => `| ${i + 1} | ${r.type} | ${cell(r.provider)} | ${cell(r.title)} | ${r.decision.months.length ? monthsLabel(r.decision.months) : '-'} | ${status(r)} | ${cell(r.extraction?.evidence_quote)}${r.extraction?.note ? ` _(${cell(r.extraction.note)})_` : ''} | ${r.source_url ? `[${r.text_source}](${r.source_url})` : r.text_source} | \`${r.offer_id.slice(0, 8)}\` |`),
  ].join('\n');
  const sameMonths = (a?: number[] | null, b?: number[] | null) => JSON.stringify([...(a ?? [])].sort((x, y) => x - y)) === JSON.stringify([...(b ?? [])].sort((x, y) => x - y));
  const rechecked = rows.filter(r => r.previous);
  const changed = rechecked.filter(r => r.decision.write && !sameMonths(r.decision.months, r.previous));
  const lost = rechecked.filter(r => !r.decision.write);
  const recheckPart = rechecked.length ? [
    `## Recheck: changed season (${changed.length}) - \`apply --update\` after review`, '',
    table(changed, r => `was ${monthsLabel(r.previous ?? [])}`), '',
    `## Recheck: season no longer supported by the page (${lost.length}) - not changed automatically`, '',
    table(lost, r => (r.decision.write ? '' : `${r.decision.reason}, was ${monthsLabel(r.previous ?? [])}`)), '',
    `Confirmed unchanged: ${rechecked.length - changed.length - lost.length}.`, '',
  ] : [];
  const write = rows.filter(r => r.decision.write && !r.previous);
  const review = rows.filter(r => !r.decision.write && r.decision.reason !== 'unknown');
  return [
    `# Season extraction review (${new Date().toISOString().slice(0, 10)})`,
    '',
    'Offers without a known month on the KCS map (no offer_bookable_months row). Source: the provider\'s own page text.',
    'Nothing is written live yet. "Proposed to write" goes live only after Aaron\'s OK; the others stay unknown unless Aaron decides otherwise.',
    '',
    ...recheckPart,
    '## Summary',
    '',
    ...Object.entries(summarize(rows)).map(([t, c]) => `- **${t}**: ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ')}`),
    '',
    `## Proposed to write (${write.length})`,
    '',
    table(write, r => (r.decision.write ? r.decision.kind : '')),
    '',
    `## Not written, for Aaron's eye (${review.length})`,
    '',
    'wind_only = only the best-wind window is stated (not a cruise); price_only = only price/rate periods; dates_only = only dated departures/events (often past); other_facility = months of a school, restaurant, pool, another product; quote_not_found / low_confidence / conflict = the evidence did not hold.',
    '',
    table(review, r => (r.decision.write ? '' : r.decision.reason)),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// Apply: writes only approved rows, only into still-empty months. --revert clears exactly what we set.
// ---------------------------------------------------------------------------------------------------------

export interface ApplyOpts { only?: string[]; exclude?: string[]; includeWind?: boolean; approve?: string[] }

/**
 * Rows to write: every decision.write row, plus rows Aaron approved one by one (--approve id,..: e.g. tours whose
 * season comes from their dated trips, 2026-10-28) and, on request, wind-only windows.
 */
export function selectForApply(rows: PlanRow[], opts: ApplyOpts) {
  const match = (id: string, list?: string[]) => !!list?.some(p => p && id.startsWith(p));
  return rows.flatMap(r => {
    if (match(r.offer_id, opts.exclude)) return [];
    if (opts.only?.length && !match(r.offer_id, opts.only)) return [];
    const months = r.decision.months;
    if (!months.length) return [];
    if (r.decision.write) return [{ row: r, months }];
    const reason = r.decision.reason as string;
    if (match(r.offer_id, opts.approve) || (opts.includeWind && reason === 'wind_only')) return [{ row: r, months }];
    return [];
  });
}

const sorted = (m: number[]) => [...new Set(m)].sort((a, b) => a - b);
const sameSet = (a: number[], b: number[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** The months currently stored on an offer row: season_months wins, else the start/end window, else none. */
export function storedMonths(row: { season_start_month?: number | null; season_end_month?: number | null; season_months?: number[] | null }): number[] {
  if (row.season_months?.length) return sorted(row.season_months);
  if (row.season_start_month && row.season_end_month) return contiguousMonths(row.season_start_month, row.season_end_month);
  return [];
}

/**
 * The full season representation one pick writes (other representation cleared). A cruise with one window keeps
 * season_start/end_month (the app's existing season fields); a split cruise season and every package season go
 * to season_months. An empty month list clears the season (used by --revert).
 */
export function seasonPatch(source: PlanRow['catalog_source'], months: number[]): Record<string, number | number[] | null> {
  if (source === 'package_offers') return { season_months: months.length ? sorted(months) : null };
  const range = months.length ? contiguousRange(months) : null;
  if (!months.length) return { season_start_month: null, season_end_month: null, season_months: null };
  return range ? { season_start_month: range.start, season_end_month: range.end, season_months: null } : { season_start_month: null, season_end_month: null, season_months: sorted(months) };
}

/**
 * Writes the picks. Default: only into an empty season. --update (after a --recheck): only where the stored
 * months still equal what season-extract wrote last time, so a hand correction is never overwritten.
 * --revert: clears the season where it still equals the plan's months. Every write is guarded against a change
 * between read and write (filters on the values just read) and stores season_evidence.
 */
export async function applySeasonPlan(opts: ApplyOpts & { from: string; dryRun?: boolean; revert?: boolean; update?: boolean }) {
  const plan = JSON.parse(readFileSync(opts.from, 'utf8')) as { created_at?: string; rows: PlanRow[] };
  const picks = selectForApply(plan.rows, opts).filter(p => (opts.update ? !!p.row.previous && !sameSet(p.months, p.row.previous) : true));
  const supabase = await db();
  for (const table of ['cruise_offers', 'package_offers'] as const) {
    if (!picks.some(p => p.row.catalog_source === table)) continue;
    const { error } = await supabase.from(table).select('season_months,season_evidence').limit(1);
    if (error) throw new Error(`${table}.season_months/season_evidence missing, run migration 20261028130000_offer_season_months.sql first (${error.message})`);
  }
  const today = new Date().toISOString().slice(0, 10);
  let written = 0, skipped = 0;
  for (const { row, months } of picks) {
    const cols = row.catalog_source === 'cruise_offers' ? ['season_start_month', 'season_end_month', 'season_months'] : ['season_months'];
    const { data: cur, error: readErr } = await supabase.from(row.catalog_source).select(cols.join(',')).eq('id', row.offer_id).maybeSingle();
    if (readErr) throw new Error(`${row.catalog_source} ${row.offer_id}: ${readErr.message}`);
    if (!cur) { skipped++; continue; }
    const now = cur as unknown as Record<string, number | number[] | null>;
    const have = storedMonths(now);
    const hit = opts.revert ? sameSet(have, months) : opts.update ? sameSet(have, row.previous ?? []) : have.length === 0;
    if (!hit) { skipped++; continue; }
    if (opts.dryRun) { written++; continue; }
    const evidence: SeasonEvidence | null = opts.revert ? null : {
      source: 'season-extract', months: sorted(months), quote: row.extraction?.evidence_quote ?? null, url: row.source_url,
      basis: row.decision.write ? row.decision.kind : `approved:${row.decision.reason}`, checked_at: today,
      ...(row.decision.write && row.decision.kind === 'page_region' && (row.page_months ?? row.previous) ? { page_months: sorted((row.page_months ?? row.previous)!) } : {}),
      ...(row.storm?.removed.length ? { storm: row.storm } : {}),
      ...(row.note ? { note: row.note } : {}),
      ...(row.wind_source ? { wind_source: row.wind_source } : {}),
    };
    let q = supabase.from(row.catalog_source).update({ ...seasonPatch(row.catalog_source, opts.revert ? [] : months), season_evidence: evidence }).eq('id', row.offer_id);
    for (const k of cols) {
      const v = now[k];
      q = v == null ? q.is(k, null) : Array.isArray(v) ? q.filter(k, 'eq', `{${v.join(',')}}`) : q.eq(k, v);
    }
    const { data, error } = await q.select('id');
    if (error) throw new Error(`${row.catalog_source} ${row.offer_id}: ${error.message}`);
    if (data?.length) written++; else skipped++;
  }
  return { selected: picks.length, written, skipped };
}
