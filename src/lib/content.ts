import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Content normalization + hashing for change detection.
//
// The goal: two fetches of the same unchanged page must produce the same hash,
// while a genuine content edit (new offer, changed price) must produce a
// different one. We therefore strip markup and dynamic noise aggressively.
// ---------------------------------------------------------------------------

/** Strip HTML down to readable visible text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse whitespace; used to clean Tavily markdown into a readable line. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Strip characters Postgres text/jsonb cannot store. NUL (U+0000) raises
 * "unsupported Unicode escape sequence" on insert; other C0 control chars are
 * also unstorable. Tab/newline/carriage-return are kept. Valid UTF-8 (incl.
 * emoji surrogate pairs) is left intact. Built via char codes to avoid embedding
 * control-character literals in source.
 */
export function sanitizeForPg(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue; // drop C0 controls except \t \n \r
    out += text[i];
  }
  return out;
}

/**
 * Recursively apply sanitizeForPg to every string in a value (objects, arrays,
 * nested) so an entire DB row — including jsonb columns like images (EXIF-derived
 * rights strings are often NUL-terminated), pricing, dates, itinerary_spots — is
 * safe to upsert. Non-strings pass through unchanged.
 */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizeForPg(value) as T;
  if (Array.isArray(value)) return value.map(v => sanitizeDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v);
    return out as T;
  }
  return value;
}

/**
 * Normalize readable text for hashing only: lowercase, collapse whitespace,
 * and remove obviously dynamic tokens that would otherwise cause false-positive
 * change detection (CSRF/session nonces, cache-busting query strings, ISO
 * timestamps, "X people viewing now" style counters).
 */
export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[0-9a-f]{16,}\b/g, '')                       // long hex nonces
    .replace(/\?[a-z0-9_=&.%-]{8,}/gi, '')                   // cache-buster query strings
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}[:.\d]*z?/g, '')  // ISO timestamps
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentHash(readable: string): string {
  return createHash('sha256').update(normalizeForHash(readable)).digest('hex');
}
