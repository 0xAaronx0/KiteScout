// ---------------------------------------------------------------------------
// Structured listing state of a cruise offer + the rules that turn an
// observation of a provider page into a DB proposal (pure, no I/O).
//
// The monitor used to diff page TEXT and let an LLM judge "significant"; that
// flooded /changes with layout/testimonial/countdown noise and Tavily render
// flip-flops (audit 2026-10-12: 392 open, ~4 real cases). Now we observe the
// volatile listing FACTS (departures, prices in original currency, duration,
// season months), compare them to the DB and propose a patch:
//   - no difference            → nothing is recorded
//   - difference, rules pass   → auto-applied after a 2nd identical sighting
//   - a rule is violated       → /changes review (the only manual path)
// Free text (title, summary, vessel, season wording) is never written here.
// ---------------------------------------------------------------------------
import { createHash } from 'node:crypto';

export type DepartureStatus = 'available' | 'few_spots' | 'sold_out' | 'waitlist' | 'closed' | 'on_request';
const STATUSES: readonly DepartureStatus[] = ['available', 'few_spots', 'sold_out', 'waitlist', 'closed', 'on_request'];

export interface Departure {
  start_date: string;
  end_date: string | null;
  price: number | null;
  currency: string | null;
  status: DepartureStatus | null;
}

export interface Money { amount: number; currency: string }

/** What a page (adapter or LLM read) states about one offer. null = not stated → never blanks a field. */
export interface ObservedState {
  /** false = the offer's own page no longer presents it; null = unknown */
  listed: boolean | null;
  departures: Departure[] | null;
  /** cheapest per-person price for the whole trip (shared/double cabin) */
  pricePP: Money | null;
  /** cheapest whole-boat price and the number of days it covers */
  priceCharter: (Money & { days: number | null }) | null;
  durationDays: number | null;
  seasonStartMonth: number | null;
  seasonEndMonth: number | null;
  seasonText: string | null;
}

/** The cruise_offers columns this module reads and may write. */
export interface OfferRow {
  id: string;
  slug: string;
  title: string;
  source_url: string | null;
  dates: unknown;
  price_pp_cabin: number | null;
  price_pp_cabin_currency: string | null;
  price_charter_week: number | null;
  price_charter_week_currency: string | null;
  price_from_eur: number | null;
  currency: string | null;
  duration_days: number | null;
  season_start_month: number | null;
  season_end_month: number | null;
  season_text: string | null;
}
export const OFFER_ROW_COLUMNS =
  'id, slug, title, source_url, dates, price_pp_cabin, price_pp_cabin_currency, price_charter_week, ' +
  'price_charter_week_currency, price_from_eur, currency, duration_days, season_start_month, season_end_month, season_text';

/** Every column a proposal may set (hard whitelist, mirrored in web/app/api/changes/resolve). */
export const STATE_FIELDS = [
  'dates', 'price_pp_cabin', 'price_pp_cabin_currency', 'price_charter_week', 'price_charter_week_currency',
  'price_from_eur', 'duration_days', 'season_start_month', 'season_end_month', 'season_text',
] as const;

export interface FieldChange { field: string; before: unknown; after: unknown }

export interface Proposal {
  set: Record<string, unknown>;
  changes: FieldChange[];
  /** rule violations → manual review instead of auto-apply */
  violations: string[];
  /** observed values dropped as implausible (extraction errors, never written, never reviewed) */
  ignored: string[];
  fingerprint: string;
  changeType: 'price_change' | 'dates_change';
  summary: string;
}

// FX is ONLY used for plausibility gates; stored prices stay in their original currency
// (Aaron 2026-07-10). Same table as the price backfill (src/_price-derive.ts) plus a few.
const FX_GATE: Record<string, number> = { EUR: 1, USD: 0.86, GBP: 1.17, AED: 0.23, CHF: 1.06, BRL: 0.16, ZAR: 0.05 };
const eurEq = (m: Money): number | null => (FX_GATE[m.currency] ? m.amount * FX_GATE[m.currency] : null);

const MAX_PRICE_JUMP = 0.4;
const PP_RANGE: [number, number] = [200, 8000];
const CHARTER_RANGE: [number, number] = [2000, 120000];

// --- normalization ------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function normStatus(s: unknown): DepartureStatus | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((STATUSES as readonly string[]).includes(t)) return t as DepartureStatus;
  if (/sold_?out|ausgebucht|booked_out|full|esaurit|complet|agotad/.test(t)) return 'sold_out';
  if (/wait|warte/.test(t)) return 'waitlist';
  if (/few|limited|last|letzte/.test(t)) return 'few_spots';
  if (/closed|cancel|geschlossen/.test(t)) return 'closed';
  if (/request|anfrage/.test(t)) return 'on_request';
  if (/avail|open|frei|verfügbar|bookable/.test(t)) return 'available';
  return null;
}

export function normCurrency(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  const t = c.trim().toUpperCase();
  if (t === '€') return 'EUR';
  if (t === '$') return 'USD';
  if (t === '£') return 'GBP';
  return /^[A-Z]{3}$/.test(t) ? t : null;
}

/**
 * Clean departures: valid ISO dates, start ≤ end, within [today-2y, today+3y],
 * known status, deduped by start|end, sorted.
 */
export function cleanDepartures(raw: unknown, today: string): Departure[] {
  if (!Array.isArray(raw)) return [];
  const lo = addDaysIso(today, -730);
  const hi = addDaysIso(today, 1100);
  const out = new Map<string, Departure>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const start = typeof o.start_date === 'string' && ISO.test(o.start_date) ? o.start_date : null;
    if (!start || start < lo || start > hi) continue;
    let end = typeof o.end_date === 'string' && ISO.test(o.end_date) ? o.end_date : null;
    if (end && end < start) end = null;
    const price = typeof o.price === 'number' && o.price > 0 ? Math.round(o.price) : null;
    const dep: Departure = { start_date: start, end_date: end, price, currency: price ? normCurrency(o.currency) : null, status: normStatus(o.status) };
    out.set(`${start}|${end ?? ''}`, dep);
  }
  return [...out.values()].sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));
}

const isFuture = (d: Departure, today: string): boolean => (d.end_date ?? d.start_date) >= today;
/**
 * The week charter price to show: the provider's quote, never a re-scaled one (Aaron 2026-10-28; until then
 * 8-day / 7-night trips were scaled x7/8 and a USD 12,500 6-day quote showed as 14,583).
 * A trip of 6 to 8 days (or no length) IS the week; a day rate x 7; any other length gives no week price.
 */
export function charterWeek(amount: number, days: number | null | undefined): number | null {
  if (!(amount > 0)) return null;
  if (!days || (days >= 6 && days <= 8)) return Math.round(amount);
  if (days === 1) return Math.round(amount * 7);
  return null;
}

/**
 * Departures worth storing on a fresh write: cleaned (no all-null or year-less rows) and not yet over.
 * null when none are left (the app shows "dates on request" either way).
 */
export function upcomingDepartures(raw: unknown, today: string): Departure[] | null {
  const deps = cleanDepartures(raw, today).filter(d => isFuture(d, today));
  return deps.length ? deps : null;
}
/** Canonical key of the UPCOMING departures (past ones never count as a change). */
function futureKey(deps: Departure[], today: string): string {
  return JSON.stringify(deps.filter(d => isFuture(d, today)).map(d => [d.start_date, d.end_date, d.price, d.currency, d.status]));
}

// --- proposal ---------------------------------------------------------------------------

function jumpTooBig(before: number | null, after: number): boolean {
  // boundary exclusive: a jump of exactly 40 % already goes to review
  return before !== null && before > 0 && Math.abs(after - before) / before >= MAX_PRICE_JUMP;
}

/**
 * Compare an observation with the DB row and propose a patch (or null = nothing to do).
 * `authoritative`: the observation comes from the offer's OWN page (or an adapter) - it may
 * replace the departure set and set prices/duration/season. A non-authoritative page (a
 * homepage teaser) may only ADD upcoming departures or update their status/price
 * (`datesMode: 'merge'`, also usable by an authoritative source that shows part of the schedule).
 */
export function proposeUpdate(
  offer: OfferRow,
  obs: ObservedState,
  opts: { authoritative: boolean; today: string; datesMode?: 'replace' | 'merge' },
): Proposal | null {
  const { today, authoritative } = opts;
  // 'merge' = the source shows only part of the schedule (e.g. the season on sale): add/update, never remove
  const datesMode = opts.datesMode ?? (authoritative ? 'replace' : 'merge');
  const set: Record<string, unknown> = {};
  const changes: FieldChange[] = [];
  const violations: string[] = [];
  const ignored: string[] = [];
  const put = (field: string, before: unknown, after: unknown): void => {
    set[field] = after;
    changes.push({ field, before, after });
  };
  const unput = (field: string): void => {
    delete set[field];
    const i = changes.findIndex(c => c.field === field);
    if (i >= 0) changes.splice(i, 1);
  };

  // ── departures ──
  const dbDeps = cleanDepartures(offer.dates, today);
  const obsDeps = obs.departures ? cleanDepartures(obs.departures, today) : [];
  if (obsDeps.length > 0) {
    const byStart = new Map(dbDeps.map(d => [d.start_date, d]));
    let next: Departure[];
    if (datesMode === 'replace') {
      // Full replacement, but a value the page leaves out never blanks a stored one.
      next = obsDeps.map(d => {
        const prev = byStart.get(d.start_date);
        return {
          ...d,
          end_date: d.end_date ?? prev?.end_date ?? null,
          price: d.price ?? prev?.price ?? null,
          currency: d.price ? d.currency : prev?.currency ?? null,
          status: d.status ?? prev?.status ?? null,
        };
      });
    } else {
      const merged = new Map(dbDeps.map(d => [d.start_date, { ...d }]));
      for (const d of obsDeps) {
        if (!isFuture(d, today)) continue;
        const prev = merged.get(d.start_date);
        if (!prev) { merged.set(d.start_date, d); continue; }
        if (d.status) prev.status = d.status;
        if (d.price) { prev.price = d.price; prev.currency = d.currency; }
        if (d.end_date && !prev.end_date) prev.end_date = d.end_date;
      }
      next = [...merged.values()].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    }
    if (futureKey(next, today) !== futureKey(dbDeps, today)) {
      const dbFuture = dbDeps.filter(d => isFuture(d, today)).length;
      const nextFuture = next.filter(d => isFuture(d, today)).length;
      if (dbFuture > 0 && nextFuture === 0) violations.push('entfernt alle kommenden Abfahrten');
      put('dates', offer.dates ?? null, next);
    }
  }

  if (authoritative) {
    // ── price per person (original currency; FX only for the gates) ──
    const pp = obs.pricePP;
    if (pp && pp.amount > 0) {
      const cur = normCurrency(pp.currency);
      const amount = Math.round(pp.amount);
      const eq = cur ? eurEq({ amount, currency: cur }) : null;
      // An implausible value is an extraction error (per-night price, deposit, component): drop it.
      const implausible = eq !== null && (eq < PP_RANGE[0] || eq > PP_RANGE[1]);
      if (implausible) ignored.push(`Preis p.P. ${amount} ${cur} unplausibel`);
      if (cur && !implausible && (amount !== offer.price_pp_cabin || cur !== offer.price_pp_cabin_currency)) {
        if (eq === null) violations.push(`Währung ${cur} unbekannt (Plausibilität nicht prüfbar)`);
        if (offer.price_pp_cabin_currency && cur !== offer.price_pp_cabin_currency) violations.push(`Währung p.P. ${offer.price_pp_cabin_currency} → ${cur}`);
        else if (jumpTooBig(offer.price_pp_cabin, amount)) violations.push(`Preis p.P. ${offer.price_pp_cabin} → ${amount} ${cur} (≥ ${MAX_PRICE_JUMP * 100} %)`);
        if (amount !== offer.price_pp_cabin) put('price_pp_cabin', offer.price_pp_cabin, amount);
        if (cur !== offer.price_pp_cabin_currency) put('price_pp_cabin_currency', offer.price_pp_cabin_currency, cur);
        // price_from_eur (budget filter) only follows when no conversion is needed.
        if (cur === 'EUR' && amount !== offer.price_from_eur) put('price_from_eur', offer.price_from_eur, amount);
      }
    }

    // ── whole-boat charter: the quoted week price (charterWeek) ──
    const ch = obs.priceCharter;
    const weekly = ch && ch.amount > 0 ? charterWeek(ch.amount, ch.days ?? obs.durationDays ?? offer.duration_days) : null;
    if (ch && weekly !== null) {
      const cur = normCurrency(ch.currency);
      const eq = cur ? eurEq({ amount: weekly, currency: cur }) : null;
      const implausible = eq !== null && (eq < CHARTER_RANGE[0] || eq > CHARTER_RANGE[1]);
      if (implausible) ignored.push(`Charter/Woche ${weekly} ${cur} unplausibel`);
      if (cur && !implausible && (weekly !== offer.price_charter_week || cur !== offer.price_charter_week_currency)) {
        if (eq === null) violations.push(`Währung ${cur} unbekannt (Plausibilität nicht prüfbar)`);
        if (offer.price_charter_week_currency && cur !== offer.price_charter_week_currency) violations.push(`Währung Charter ${offer.price_charter_week_currency} → ${cur}`);
        else if (jumpTooBig(offer.price_charter_week, weekly)) violations.push(`Charter/Woche ${offer.price_charter_week} → ${weekly} ${cur} (≥ ${MAX_PRICE_JUMP * 100} %)`);
        if (weekly !== offer.price_charter_week) put('price_charter_week', offer.price_charter_week, weekly);
        if (cur !== offer.price_charter_week_currency) put('price_charter_week_currency', offer.price_charter_week_currency, cur);
      }
    }

    // Cross gate: a whole boat can't cost less than ~1.5 cabin places.
    const ppAfter = (set.price_pp_cabin ?? offer.price_pp_cabin) as number | null;
    const ppCur = (set.price_pp_cabin_currency ?? offer.price_pp_cabin_currency) as string | null;
    const chAfter = (set.price_charter_week ?? offer.price_charter_week) as number | null;
    const chCur = (set.price_charter_week_currency ?? offer.price_charter_week_currency) as string | null;
    if (('price_pp_cabin' in set || 'price_charter_week' in set) && ppAfter && ppCur && chAfter && chCur) {
      const a = eurEq({ amount: ppAfter, currency: ppCur });
      const b = eurEq({ amount: chAfter, currency: chCur });
      if (a !== null && b !== null && b < 1.5 * a) {
        // like the price backfill: a freshly read charter value that contradicts p.p. is the weaker one
        if ('price_charter_week' in set) {
          ignored.push(`Charter/Woche ${chAfter} ${chCur} < 1,5 × Preis p.P.`);
          unput('price_charter_week'); unput('price_charter_week_currency');
        } else violations.push('Charter/Woche < 1,5 × Preis p.P.');
      }
    }

    // ── duration: ±1 day is the nights-vs-days ambiguity ("7 nights" = 7 or 8 days), never a change ──
    const dur = obs.durationDays;
    const durBefore = offer.duration_days;
    if (dur && Number.isInteger(dur) && dur >= 1 && dur <= 60 && (durBefore === null || Math.abs(dur - durBefore) >= 2)) {
      if (durBefore && Math.abs(dur - durBefore) > Math.max(2, durBefore * 0.5)) violations.push(`Dauer ${durBefore} → ${dur} Tage`);
      put('duration_days', durBefore, dur);
    }

    // ── season: fill a gap only. Months are an interpretation ("Spring and Autumn" → 3 or 9),
    //    re-reads would flip them; the real schedule lives in the departures. ──
    const sm = obs.seasonStartMonth, em = obs.seasonEndMonth;
    const okMonth = (m: number | null): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= 12;
    if (okMonth(sm) && okMonth(em) && offer.season_start_month === null && offer.season_end_month === null) {
      if (sm !== offer.season_start_month) put('season_start_month', offer.season_start_month, sm);
      if (em !== offer.season_end_month) put('season_end_month', offer.season_end_month, em);
      if (obs.seasonText && obs.seasonText !== offer.season_text) put('season_text', offer.season_text, obs.seasonText);
    }
  }

  if (changes.length === 0) return null;
  const priceTouched = changes.some(c => c.field.startsWith('price'));
  return {
    set,
    changes,
    violations,
    ignored,
    fingerprint: fingerprint(set),
    changeType: priceTouched ? 'price_change' : 'dates_change',
    summary: summarize(changes, today),
  };
}

/** Stable short hash of a proposal's target values (key order independent). */
export function fingerprint(set: Record<string, unknown>): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  return createHash('sha1').update(JSON.stringify(canon(set))).digest('hex').slice(0, 16);
}

function summarize(changes: FieldChange[], today: string): string {
  const parts: string[] = [];
  for (const c of changes) {
    if (c.field === 'dates') {
      const before = cleanDepartures(c.before, today).filter(d => isFuture(d, today));
      const after = (c.after as Departure[]).filter(d => isFuture(d, today));
      const b = new Map(before.map(d => [d.start_date, d]));
      const a = new Map(after.map(d => [d.start_date, d]));
      const added = after.filter(d => !b.has(d.start_date)).length;
      const removed = before.filter(d => !a.has(d.start_date)).length;
      const restatus = after.filter(d => b.has(d.start_date) && (b.get(d.start_date)!.status !== d.status || b.get(d.start_date)!.price !== d.price)).length;
      const bits = [added && `+${added}`, removed && `-${removed}`, restatus && `${restatus} geändert`].filter(Boolean);
      parts.push(`Abfahrten ${bits.join(', ') || 'aktualisiert'}`);
    } else if (c.field === 'price_pp_cabin') parts.push(`p.P. ${c.before ?? '-'} → ${c.after}`);
    else if (c.field === 'price_charter_week') parts.push(`Charter/Woche ${c.before ?? '-'} → ${c.after}`);
    else if (c.field === 'duration_days') parts.push(`Dauer ${c.before ?? '-'} → ${c.after} Tage`);
    else if (c.field === 'season_start_month') parts.push('Saison');
  }
  return parts.join(' · ') || 'Listing-Daten aktualisiert';
}

// --- cheap pre-filter: did the listing FACTS on the page change? -------------------------
// The page hash changes on every testimonial, countdown or render variant. Only when the
// set of price/date/availability tokens changes is an (LLM) read of the page worth it.
const MONTHS =
  'jan(?:uary|uar|vier)?|feb(?:ruary|ruar|braio|rero)?|mar(?:ch|s|zo)?|märz|apr(?:il|ile)?|may|mai|mag(?:gio)?|mayo|jun(?:e|i|io)?|juin|giu(?:gno)?|jul(?:y|i|io)?|juil(?:let)?|lug(?:lio)?|aug(?:ust)?|ago(?:sto)?|août|sep(?:t|tember|tembre|tiembre)?|set(?:tembre)?|oct(?:ober|obre|ubre)?|okt(?:ober)?|ott(?:obre)?|nov(?:ember|embre|iembre)?|dec(?:ember|embre)?|dez(?:ember)?|dic(?:embre|iembre)?|déc(?:embre)?';
const FACT_RES: RegExp[] = [
  /(?:€|eur|usd|us\$|\$|£|gbp|chf|aed|brl|zar)\s?\d[\d.,']*/gi,
  /\d[\d.,']*\s?(?:€|eur\b|usd\b|\$|£|gbp\b|chf\b|aed\b|brl\b|zar\b)/gi,
  /\b\d{1,2}\s?[./]\s?\d{1,2}\s?[./]\s?(?:20)?\d{2}\b/g,
  /\b20\d{2}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th|\\.)?\\s?(?:-|–|bis|to)?\\s?(?:\\d{1,2}\\.?\\s)?(?:${MONTHS})\\.?\\b`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\.?\\s\\d{1,2}\\b`, 'gi'),
  /\b20[2-3]\d\b/g,
  /\b(?:sold[\s-]?out|ausgebucht|waitlist|warteliste|few spots|last spots?|letzte plätze|fully booked|esaurito|complet|agotado|\d{1,3}\s?%\s?(?:booked|gebucht))\b/gi,
];
export function factsKey(text: string): string {
  const t = text.toLowerCase();
  const tokens = new Set<string>();
  for (const re of FACT_RES) for (const m of t.matchAll(re)) tokens.add(m[0].replace(/\s+/g, ' ').trim());
  return [...tokens].sort().join('|');
}

// --- site loss --------------------------------------------------------------------------------
const HIJACK_RE =
  /\b(?:situs slot|slot online|slot gacor|judi online|togel|casino online|online casino|sportsbook|bandar|domain (?:is )?for sale|buy this domain|this domain (?:may be|is) for sale|domain has expired|domain expired|parked (?:free|domain)|hugedomains|sedo(?:parking)?)\b/i;
const TRADE_RE = /kite|kiting|wing ?foil|kajt|кайт|sail|segel|yacht|catamaran|katamaran|boat|cruise|safari|liveaboard/i;

/** Signal that the provider's site no longer belongs to the provider (hijack / parking / unrelated). */
export function siteLossSignal(text: string): string | null {
  const m = text.match(HIJACK_RE);
  if (m) return `Domain-Übernahme/Parking-Seite ("${m[0]}")`;
  if (!TRADE_RE.test(text)) return 'kein Kite-/Segel-Bezug mehr auf der Startseite';
  return null;
}

// --- misc ---------------------------------------------------------------------------------
export const normUrl = (u: string | null | undefined): string =>
  (u ?? '').replace(/^http:/, 'https:').replace(/:\/\/www\./, '://').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

/** Loose title match (token overlap) used to tell a NEW product from a re-titled known one. */
export function titleMatches(a: string, b: string): boolean {
  const toks = (s: string) => new Set(
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !['kite', 'cruise', 'safari', 'the', 'and', 'with', 'trip', 'week', 'tour'].includes(w)),
  );
  const ta = toks(a), tb = toks(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size) >= 0.5;
}
