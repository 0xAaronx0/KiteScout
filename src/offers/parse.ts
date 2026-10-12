// ---------------------------------------------------------------------------
// Shared parsing helpers for offer adapters: text, JSON-LD, prices, dates, images.
// Adapters stay thin: fetch → pick the right block → these helpers → Slot/OfferContent.
// ---------------------------------------------------------------------------
import { parse, type HTMLElement } from 'node-html-parser';
import { htmlToText, collapse } from '../lib/content.js';
import { discoverImageUrls } from '../lib/images.js';

export { parse, htmlToText, collapse };
export type { HTMLElement };

/** Decode entities once and collapse whitespace. */
export function clean(s: string | null | undefined): string {
  if (!s) return '';
  return collapse(parse(`<p>${s}</p>`).text);
}

// --- JSON-LD ---------------------------------------------------------------------
/** Every JSON-LD object on the page, flattened (@graph and arrays), lenient about trailing commas. */
export function jsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let raw = m[1].trim().replace(/,\s*([}\]])/g, '$1');
    if (!raw.startsWith('[') && /}\s*{/.test(raw)) raw = `[${raw.replace(/}\s*{/g, '},{')}]`;
    try {
      const v = JSON.parse(raw);
      const walk = (x: unknown): void => {
        if (Array.isArray(x)) x.forEach(walk);
        else if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>;
          if (Array.isArray(o['@graph'])) (o['@graph'] as unknown[]).forEach(walk);
          out.push(o);
        }
      };
      walk(v);
    } catch { /* broken block: skip */ }
  }
  return out;
}

export function ldOfType(html: string, type: string): Array<Record<string, unknown>> {
  const t = type.toLowerCase();
  return jsonLd(html).filter(o => {
    const ty = o['@type'];
    const list = Array.isArray(ty) ? ty : [ty];
    return list.some(x => typeof x === 'string' && x.toLowerCase().includes(t));
  });
}

export function meta(html: string, prop: string): string | null {
  const root = parse(html);
  const el = root.querySelector(`meta[property="${prop}"]`) ?? root.querySelector(`meta[name="${prop}"]`);
  return el?.getAttribute('content')?.trim() || null;
}

// --- prices ----------------------------------------------------------------------
const CURRENCY_SIGNS: Array<[RegExp, string]> = [
  [/R\$/, 'BRL'], [/A\$|AUD/, 'AUD'], [/US\$|USD/, 'USD'], [/€|EUR\b|euro/i, 'EUR'],
  [/£|GBP/, 'GBP'], [/CHF/, 'CHF'], [/OMR/, 'OMR'], [/COP/, 'COP'], [/PHP|₱/, 'PHP'],
  [/INR|₹/, 'INR'], [/THB|฿/, 'THB'], [/MXN/, 'MXN'], [/\$/, 'USD'],
];

export function detectCurrency(text: string): string | null {
  for (const [re, iso] of CURRENCY_SIGNS) if (re.test(text)) return iso;
  return null;
}

/**
 * Parse an amount like "1,899", "1.899,00", "€ 1,695", "2.195 USD", "R$570".
 * Thousands separators are inferred: a separator followed by exactly 3 digits at the end
 * of a group is a thousands separator; otherwise it is the decimal mark.
 */
export function parseAmount(text: string): number | null {
  const m = text.replace(/\s/g, '').match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0].replace(/[.,]$/, '');
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep >= 0) {
    const decimals = s.length - lastSep - 1;
    if (decimals === 3) s = s.replace(/[.,]/g, '');                 // 1.899 / 1,899
    else s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1); // 1.899,00
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** All "currency + amount" occurrences in a text, in order. */
export function findPrices(text: string): Array<{ amount: number; currency: string; raw: string }> {
  const out: Array<{ amount: number; currency: string; raw: string }> = [];
  const re = /(R\$|A\$|US\$|€|£|\$|EUR|USD|GBP|AUD|CHF|OMR|BRL)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(€|EUR|USD|GBP|AUD|CHF|BRL|euros?)\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const amount = parseAmount(m[2] ?? m[3] ?? '');
    const currency = detectCurrency(m[1] ?? m[4] ?? '');
    if (amount !== null && currency) out.push({ amount, currency, raw });
  }
  return out;
}

// --- dates -----------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januar: 1, janeiro: 1, enero: 1,
  feb: 2, february: 2, februar: 2, fevereiro: 2, febrero: 2,
  mar: 3, march: 3, märz: 3, maerz: 3, marco: 3, março: 3, marzo: 3,
  apr: 4, april: 4, abril: 4,
  may: 5, mai: 5, maio: 5, mayo: 5,
  jun: 6, june: 6, juni: 6, junho: 6, junio: 6,
  jul: 7, july: 7, juli: 7, julho: 7, julio: 7,
  aug: 8, august: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, setembro: 9, septiembre: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, outubro: 10, octubre: 10,
  nov: 11, november: 11, novembro: 11, noviembre: 11,
  dec: 12, december: 12, dez: 12, dezember: 12, dezembro: 12, diciembre: 12,
};

export function monthOf(word: string): number | null {
  return MONTHS[word.toLowerCase().replace(/\.$/, '')] ?? null;
}

export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "26 Oct 2026", "Oct 26, 2026", "26.10.2026", "2026-10-26" → YYYY-MM-DD (year required). */
export function parseDate(text: string): string | null {
  const t = text.trim();
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\.?\s+([A-Za-zäç]+)\.?,?\s+(\d{4})/);
  if (m && monthOf(m[2])) return iso(+m[3], monthOf(m[2])!, +m[1]);
  m = t.match(/([A-Za-zäç]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && monthOf(m[1])) return iso(+m[3], monthOf(m[1])!, +m[2]);
  return null;
}

/**
 * Date ranges like "Oct 17-24", "14-21 Nov 2026", "Oct 31-Nov 7", "29 Dec 2026 - 20 Jan 2027",
 * "17.10.-24.10.2026". `fallbackYear` fills ranges without a year; an end before the start rolls
 * the end into the next year.
 */
export function parseRange(text: string, fallbackYear?: number): { start: string; end: string } | null {
  const t = text.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const yearIn = t.match(/\b(20\d{2})\b/g);
  const y = yearIn ? +yearIn[yearIn.length - 1] : fallbackYear;
  if (!y) return null;
  const roll = (s: string, e: string) => (e < s ? { start: s, end: iso(+e.slice(0, 4) + 1, +e.slice(5, 7), +e.slice(8, 10)) } : { start: s, end: e });

  let m = t.match(/(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?\s?-\s?(\d{1,2})\.(\d{1,2})\.(\d{4})?/);
  if (m) return roll(iso(m[3] ? +m[3] : y, +m[2], +m[1]), iso(m[6] ? +m[6] : y, +m[5], +m[4]));
  // 29 Dec 2026 - 20 Jan 2027 / 31 Oct - 7 Nov 2026
  m = t.match(/(\d{1,2})\s([A-Za-z]+)\.?(?:\s(\d{4}))?\s?-\s?(\d{1,2})\s([A-Za-z]+)\.?(?:\s(\d{4}))?/);
  if (m && monthOf(m[2]) && monthOf(m[5])) {
    return roll(iso(m[3] ? +m[3] : y, monthOf(m[2])!, +m[1]), iso(m[6] ? +m[6] : y, monthOf(m[5])!, +m[4]));
  }
  // Oct 31 - Nov 7 (, 2026)
  m = t.match(/([A-Za-z]+)\.?\s(\d{1,2})\s?-\s?([A-Za-z]+)\.?\s(\d{1,2})/);
  if (m && monthOf(m[1]) && monthOf(m[3])) return roll(iso(y, monthOf(m[1])!, +m[2]), iso(y, monthOf(m[3])!, +m[4]));
  // 14-21 Nov (2026)
  m = t.match(/(\d{1,2})\s?-\s?(\d{1,2})\s([A-Za-z]+)/);
  if (m && monthOf(m[3])) return roll(iso(y, monthOf(m[3])!, +m[1]), iso(y, monthOf(m[3])!, +m[2]));
  // Oct 17-24 (, 2026); "Oct 31-07" ends in the next month
  m = t.match(/([A-Za-z]+)\.?\s(\d{1,2})\s?-\s?(\d{1,2})/);
  if (m && monthOf(m[1])) {
    const mo = monthOf(m[1])!;
    if (+m[3] >= +m[2]) return { start: iso(y, mo, +m[2]), end: iso(y, mo, +m[3]) };
    return { start: iso(y, mo, +m[2]), end: mo === 12 ? iso(y + 1, 1, +m[3]) : iso(y, mo + 1, +m[3]) };
  }
  return null;
}

/** Days between two ISO dates, inclusive of both ends (14 Nov - 21 Nov = 8 days / 7 nights). */
export function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}

export function todayIso(): string { return new Date().toISOString().slice(0, 10); }

// --- availability words ------------------------------------------------------------
/** Map provider wording to our enum; returns null when the text says nothing. */
export function availabilityFromText(text: string): import('./types.js').Availability | null {
  const t = text.toLowerCase();
  if (/sold[\s-]?out|fully booked|ausgebucht|esgotad|agotad|complet\b|no (more )?(spots|places) (left|available)/.test(t)) return 'sold_out';
  if (/wait[\s-]?list|warteliste/.test(t)) return 'waitlist';
  // not a bare "limited": "Spots are limited" is generic sales copy, not a shortage signal
  if (/(\d+|one|two|three|few|last)\s+(spot|place|seat|room|bed)s?\s+(left|remaining)|only (\d+|one|two|three|a few) (spot|place|seat|room|bed)s?|almost (full|sold)|limited (availability|spots left|places left)|nur noch/.test(t)) return 'limited';
  if (/spots? available|places? available|available|open for booking|book now|bookable|verfügbar/.test(t)) return 'available';
  if (/on request|auf anfrage|contact us|enquire|inquire/.test(t)) return 'on_request';
  return null;
}

export function spotsLeftFromText(text: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const m = text.toLowerCase().match(/(\d+|one|two|three|four|five)\s+(?:spot|place|seat|room|bed)s?\s+(?:left|remaining)/);
  if (!m) return null;
  return words[m[1]] ?? Number(m[1]);
}

// --- images ------------------------------------------------------------------------
/** og:image first, then content images of the page (junk-filtered, CDN-upscaled). */
export function imageCandidates(html: string, baseUrl: string, anchorText?: string | null, max = 40): string[] {
  const og = meta(html, 'og:image');
  const rest = discoverImageUrls(html, baseUrl, anchorText ?? null, max);
  const out: string[] = [];
  for (const u of [og ? new URL(og, baseUrl).toString() : null, ...rest]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out.slice(0, max);
}

// --- runs of equal days ----------------------------------------------------------------
/**
 * Group consecutive calendar days with the same state into runs (price bands whose limits sit
 * exactly where the provider changes price or availability, not at month ends). `days` must be
 * sorted; a gap in the dates also ends a run.
 */
export function runsOf<T extends { date: string }>(days: T[], state: (d: T) => string): Array<{ start: string; end: string; first: T; days: T[] }> {
  const out: Array<{ start: string; end: string; first: T; days: T[] }> = [];
  for (const d of days) {
    const last = out[out.length - 1];
    const next = last ? new Date(Date.parse(last.end) + 86400000).toISOString().slice(0, 10) : null;
    if (last && next === d.date && state(last.first) === state(d)) { last.end = d.date; last.days.push(d); }
    else out.push({ start: d.date, end: d.date, first: d, days: [d] });
  }
  return out;
}
