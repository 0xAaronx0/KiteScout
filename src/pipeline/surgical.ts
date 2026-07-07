// ---------------------------------------------------------------------------
// Surgical dates/pricing updates for monitored provider changes.
//
// Most provider-website changes are just new departures or prices. Instead of
// a full re-extraction (title/slug churn, image re-curation, risk of clobbering
// manual DB edits), this updates ONLY the volatile fields of the offers whose
// source page changed:
//
//   dates · pricing · price_from_eur · currency ·
//   season_text · season_start_month · season_end_month
//
// Everything else (title, slug, images, spots, country, summary, …) is never
// touched, so it is safe to run WITHOUT manual approval. Non-surgical changes
// (new offers, removed offers, content rewrites) stay `pending` for the
// /changes approval queue.
//
// Status model (no DDL available): cruise_changes.details.status =
//   pending | auto_applied | approved | applied | dismissed
// plus details.surgical { note, updates, resolved_at } written here.
// ---------------------------------------------------------------------------

import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { supabase } from '../lib/supabase.js';
import { withRetry } from '../lib/retry.js';
import { sanitizeDeep } from '../lib/content.js';
import { fetchPage } from './extract-cruise-offers.js';

export interface SurgicalOutcome {
  status: 'auto_applied' | 'pending' | 'failed';
  note: string;
  updates: Array<{ slug: string; fields: string[] }>;
}

// The only columns this module is allowed to write.
const SURGICAL_FIELDS = [
  'dates', 'pricing', 'price_from_eur', 'currency',
  'season_text', 'season_start_month', 'season_end_month',
] as const;

const PROMPT = `You are updating a kite-cruise database because a provider's web page changed. Extract ONLY concrete departure dates and pricing information from the page text, for the offers listed by the user.

Respond with a JSON array — one object per offer slug that this page actually covers:
{
  "slug": "<offer slug from the list>",
  "dates": [{"start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" | null, "price": <number> | null, "currency": "EUR" | "USD" | …, "status": "available" | "sold_out" | "few_spots"}] | null,
  "pricing": {"per_person": <number> | null, "per_cabin": <number> | null, "whole_boat": <number> | null, "currency": "…", "raw": "<short verbatim price text>"} | null,
  "price_from_eur": <cheapest per-person price converted to EUR at a rough market rate, integer> | null,
  "currency": "<currency the provider quotes in>" | null,
  "season_text": "<season as stated>" | null,
  "season_start_month": 1-12 | null,
  "season_end_month": 1-12 | null
}

Rules:
- Extract only what the page STATES — never invent or estimate beyond currency conversion.
- "dates" is the FULL replacement set of concrete departures currently on the page (a departure that disappeared from the page must not be included). If the page lists no concrete dated departures, use null (not []).
- Dates without a year: infer the year only when unambiguous (e.g. month clearly in the upcoming season); otherwise omit that departure.
- If the page covers none of the listed offers, respond with [].
Respond ONLY with the JSON array.`;

const normUrl = (u: string | null | undefined): string =>
  (u ?? '').replace(/^http:/, 'https:').replace(/:\/\/www\./, '://').replace(/\/+$/, '').toLowerCase();

type DateRow = { start_date?: unknown; end_date?: unknown; price?: unknown; currency?: unknown; status?: unknown };

// Canonicalize for comparison (sorted, known keys only) so key order / noise
// never counts as a change.
function canonDates(raw: unknown): string {
  if (!Array.isArray(raw)) return 'null';
  const rows = raw
    .filter((d): d is DateRow => !!d && typeof d === 'object')
    .map(d => ({
      start_date: typeof d.start_date === 'string' ? d.start_date : null,
      end_date: typeof d.end_date === 'string' ? d.end_date : null,
      price: typeof d.price === 'number' ? d.price : null,
      currency: typeof d.currency === 'string' ? d.currency : null,
      status: typeof d.status === 'string' ? d.status : null,
    }))
    .filter(d => d.start_date)
    .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1));
  return JSON.stringify(rows);
}

function canonPricing(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'null';
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  // `raw` text is display-only and re-worded between extractions — exclude it.
  return JSON.stringify({
    per_person: num(r.per_person), per_cabin: num(r.per_cabin),
    whole_boat: num(r.whole_boat), currency: typeof r.currency === 'string' ? r.currency : null,
  });
}

function parseArray(text: string): Array<Record<string, unknown>> {
  const t = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(arr) ? arr.filter(x => x && typeof x === 'object') : [];
  } catch { return []; }
}

/**
 * Try to surgically update the offers whose source page is `url`.
 * Reads the page once, asks the model for dates/pricing per offer, and writes
 * only genuinely-changed volatile fields. Never touches identity/content fields.
 */
export async function surgicalDatesPriceUpdate(
  cruiseProviderId: string,
  url: string,
): Promise<SurgicalOutcome> {
  const { data: offers, error: offersErr } = await supabase
    .from('cruise_offers')
    .select('id, slug, title, source_url, dates, pricing, price_from_eur, currency, season_text, season_start_month, season_end_month')
    .eq('cruise_provider_id', cruiseProviderId);
  // A failed read must not masquerade as "provider has no offers".
  if (offersErr) return { status: 'failed', note: `offers query failed: ${offersErr.message}`, updates: [] };

  // Prefer the offers extracted FROM this page; when none match (e.g. the change
  // was detected on the homepage while offers live on subpages), fall back to all
  // of the provider's offers — the model only returns the ones the page covers.
  let matched = (offers ?? []).filter(o => normUrl(o.source_url) === normUrl(url));
  if (matched.length === 0) matched = offers ?? [];
  if (matched.length === 0) {
    return { status: 'pending', note: 'provider has no offers — needs review', updates: [] };
  }

  const page = await fetchPage(url);
  if (!page || page.text.length < 200) {
    return { status: 'pending', note: 'page fetch failed or too thin — needs review', updates: [] };
  }

  let text: string;
  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: ANALYSIS_MODEL,
        max_tokens: 4000,
        system: [{ type: 'text', text: PROMPT }],
        messages: [{
          role: 'user',
          content:
            `Offers whose source page this is:\n` +
            matched.map(o => `- slug: "${o.slug}", title: "${o.title}"`).join('\n') +
            `\n\nPage text:\n${page.text.slice(0, 60000)}`,
        }],
      }),
    );
    text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch (err) {
    return { status: 'failed', note: `extraction error: ${err instanceof Error ? err.message.slice(0, 150) : err}`, updates: [] };
  }

  const extracted = parseArray(text);
  if (extracted.length === 0) {
    return { status: 'pending', note: 'no dates/pricing extracted from the page — needs review', updates: [] };
  }

  const bySlug = new Map(matched.map(o => [o.slug as string, o]));
  const updates: Array<{ slug: string; fields: string[] }> = [];

  for (const ex of extracted) {
    const offer = bySlug.get(String(ex.slug ?? ''));
    if (!offer) continue;

    const patch: Record<string, unknown> = {};
    const fields: string[] = [];

    // dates: full replacement, but only when the page actually lists departures
    // (never null-out existing data because a page stopped being explicit).
    if (Array.isArray(ex.dates) && canonDates(ex.dates) !== canonDates(offer.dates)) {
      patch.dates = ex.dates; fields.push('dates');
    }
    if (ex.pricing && typeof ex.pricing === 'object' && canonPricing(ex.pricing) !== canonPricing(offer.pricing)) {
      patch.pricing = ex.pricing; fields.push('pricing');
    }
    const price = typeof ex.price_from_eur === 'number' ? Math.round(ex.price_from_eur) : null;
    if (price && price > 100 && price < 100000 && price !== offer.price_from_eur) {
      patch.price_from_eur = price; fields.push('price_from_eur');
    }
    if (typeof ex.currency === 'string' && ex.currency && ex.currency !== offer.currency) {
      patch.currency = ex.currency; fields.push('currency');
    }
    if (typeof ex.season_text === 'string' && ex.season_text && ex.season_text !== offer.season_text) {
      patch.season_text = ex.season_text; fields.push('season_text');
    }
    for (const f of ['season_start_month', 'season_end_month'] as const) {
      const v = ex[f];
      if (typeof v === 'number' && v >= 1 && v <= 12 && v !== offer[f]) { patch[f] = v; fields.push(f); }
    }

    // Hard guarantee: nothing outside the surgical field set is ever written.
    for (const k of Object.keys(patch)) {
      if (!(SURGICAL_FIELDS as readonly string[]).includes(k)) delete patch[k];
    }
    if (fields.length === 0) continue;

    const { error } = await supabase.from('cruise_offers').update(sanitizeDeep(patch)).eq('id', offer.id);
    if (error) return { status: 'failed', note: `DB update failed for ${offer.slug}: ${error.message}`, updates };
    updates.push({ slug: offer.slug as string, fields });
  }

  if (updates.length === 0) {
    return { status: 'auto_applied', note: 'checked — DB already up to date (no field changes)', updates };
  }
  return {
    status: 'auto_applied',
    note: `updated ${updates.map(u => `${u.slug} [${u.fields.join(', ')}]`).join('; ')}`,
    updates,
  };
}

/**
 * Run the surgical updater for one cruise_changes row and persist the outcome
 * into its details JSONB (details.status + details.surgical).
 */
export async function applySurgicalToChange(changeId: string): Promise<SurgicalOutcome> {
  const { data: change, error } = await supabase
    .from('cruise_changes')
    .select('id, cruise_provider_id, url, change_type, details')
    .eq('id', changeId)
    .single();
  if (error || !change) return { status: 'failed', note: `change row not found: ${error?.message}`, updates: [] };

  const outcome = await surgicalDatesPriceUpdate(change.cruise_provider_id as string, change.url as string);

  const details = { ...((change.details as Record<string, unknown>) ?? {}) };
  details.status = outcome.status === 'failed' ? 'pending' : outcome.status;
  details.surgical = { note: outcome.note, updates: outcome.updates, resolved_at: new Date().toISOString() };
  await supabase.from('cruise_changes').update({ details: sanitizeDeep(details) }).eq('id', changeId);

  return outcome;
}
