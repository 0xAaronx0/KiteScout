// ---------------------------------------------------------------------------
// Observation pipeline (replaces "LLM judges a text diff", audit 2026-10-12).
//
// A provider page whose listing FACTS changed (cruise-state.ts factsKey) is read
// into structured per-offer state, by an adapter (src/cruise-adapters/) or, for
// everything else, one LLM call. The state is compared with the DB and becomes a
// proposal that lives as a hidden cruise_changes row (significant=false,
// details.status='observed'). The SAME proposal seen again ≥ MIN_AGE_HOURS later
// is applied automatically, unless a rule is violated → /changes review.
//
// cruise_changes.details for rows written here:
//   kind        offer_state | unlisted | new_product | site_lost | offer_gone
//   status      observed (hidden) → auto_applied | rerun_done (rule review) |
//               pending (new product / site lost / gone) | superseded
//   fingerprint, proposal.set, changes[{field,before,after}], violations[],
//   first_seen_at, last_seen_at, sightings, flips, source, authoritative
//   applied     { at, offer_id, slug, changes } (auto_applied; `changes revert <id>` undoes it)
// Free text is never written; only STATE_FIELDS (cruise-state.ts).
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL, EXTRACTION_MODEL } from '../lib/anthropic.js';
import { withRetry } from '../lib/retry.js';
import { sanitizeDeep, htmlToText, collapse } from '../lib/content.js';
import { fetchPageConditional } from '../lib/fetchPage.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import {
  OFFER_ROW_COLUMNS, STATE_FIELDS, normUrl, proposeUpdate, siteLossSignal, titleMatches,
  type ObservedState, type OfferRow, type Proposal, type Departure,
} from './cruise-state.js';

export const MIN_AGE_HOURS = 20;
const STALE_DAYS = 7;          // an observation not re-sighted for this long is dropped
const UNLISTED_SIGHTINGS = 3;  // "offer gone": ≥ 3 sightings over ≥ 7 days
const UNLISTED_DAYS = 7;
export const GONE_FAILURES = 7; // source page 404/410 on ≥ 7 consecutive daily checks

export interface ProviderRef { id: string; name: string | null; root_domain: string; website_url: string | null }

export interface ObserveCtx {
  today: string;
  now: Date;
  minAgeHours: number;
  dryRun: boolean;
  /** collected for the run report */
  events: Array<{ provider: string; url: string; kind: string; summary: string }>;
}
export function newCtx(over: Partial<ObserveCtx> = {}): ObserveCtx {
  const now = over.now ?? new Date();
  return { today: now.toISOString().slice(0, 10), now, minAgeHours: MIN_AGE_HOURS, dryRun: false, events: [], ...over };
}

type Details = Record<string, unknown> & {
  kind?: string; status?: string; fingerprint?: string; first_seen_at?: string; last_seen_at?: string;
  sightings?: number; flips?: number; offer_id?: string; authoritative?: boolean;
};
interface ChangeRow { id: string; url: string | null; details: Details; change_type: string | null; detected_at: string }

const hoursSince = (iso: string | undefined, now: Date): number => (iso ? (now.getTime() - Date.parse(iso)) / 3600_000 : Infinity);

// --- page reading ----------------------------------------------------------------------------

/** Readable text of a page: direct fetch first, Tavily for JS/bot-protected pages. */
export async function fetchReadable(url: string): Promise<{ text: string | null; httpStatus?: number }> {
  const r = await fetchPageConditional(url);
  if (r.status === 'ok' && r.html) {
    const t = htmlToText(r.html);
    if (t.length >= 200) return { text: t };
  }
  if (r.httpStatus === 404 || r.httpStatus === 410) return { text: null, httpStatus: r.httpStatus };
  const t = await tavilyExtract(url);
  if (t && collapse(t).length >= 200) return { text: collapse(t) };
  return { text: null, httpStatus: r.httpStatus };
}

const PROMPT = `You read one web page of a kite-cruise provider and report the CURRENT bookable facts for the offers listed by the user. Respond with STRICT JSON only:
{
  "offers": [{
    "slug": "<slug from the list>",
    "listed": true | false,
    "departures": [{"start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" | null, "price": <number> | null, "currency": "EUR" | "USD" | … | null, "status": "available" | "few_spots" | "sold_out" | "waitlist" | "closed" | null}] | null,
    "price_pp": {"amount": <number>, "currency": "…"} | null,
    "price_charter": {"amount": <number>, "currency": "…", "days": <number> | null} | null,
    "duration_days": <number> | null,
    "season_start_month": 1-12 | null,
    "season_end_month": 1-12 | null,
    "season_text": "<the season in English, e.g. 'April-October'>" | null
  }],
  "other_products": [{"name": "…", "dates": "…" | null, "price": "…" | null}]
}

Rules:
- Report only what the page STATES. Never estimate, never convert currencies: keep the page's own currency.
- "offers": one entry per listed slug the page covers. Offers marked OWN PAGE: if this page no longer presents that offer at all (discontinued, replaced by something else, empty), return {"slug": "…", "listed": false} for it.
- "departures": the FULL set of concrete dated departures the page shows for that offer, including sold-out ones (with status). null when the page shows no concrete dates for it. A date without a year only when the year is unambiguous.
- "price_pp": the cheapest price per PERSON for the WHOLE trip in a shared/double cabin. A price for a cabin of 2 → divide by 2. Per-night/per-day prices → multiply only when the trip length is explicit, else null. Never deposits, add-ons, single supplements, or a sum of separately listed components (base boat €1450 + lessons €700 → 1450).
- "price_charter": the cheapest WHOLE-BOAT/private-charter price and the number of days it covers.
- "duration_days": days of the trip (7 nights = 8 days) when stated.
- "other_products": multi-day kite/wing trips where the guests LIVE ON BOARD (kite cruise, liveaboard, kite safari on a yacht or catamaran) presented on this page that are NONE of the listed offers (a new trip, destination or boat). NOT land-based camps, kite schools, lessons, accommodation, road trips or downwinders without living aboard; not dive/yoga/fishing-only trips; not extra departures of a listed offer; not products whose dates are all in the past. The same product in two languages counts once. [] if none.
Respond ONLY with the JSON object.`;

interface LlmOffer {
  slug?: unknown; listed?: unknown; departures?: unknown; price_pp?: unknown; price_charter?: unknown;
  duration_days?: unknown; season_start_month?: unknown; season_end_month?: unknown; season_text?: unknown;
}
export interface PageRead { states: Map<string, ObservedState>; others: Array<{ name: string; dates: string | null; price: string | null }> }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseLlmRead(text: string, slugs: Set<string>): PageRead | null {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  let j: { offers?: LlmOffer[]; other_products?: unknown[] };
  try { j = JSON.parse(t.slice(s, e + 1)); } catch { return null; }
  const states = new Map<string, ObservedState>();
  for (const o of Array.isArray(j.offers) ? j.offers : []) {
    const slug = str(o.slug);
    if (!slug || !slugs.has(slug)) continue;
    const pp = o.price_pp as Record<string, unknown> | null;
    const ch = o.price_charter as Record<string, unknown> | null;
    states.set(slug, {
      listed: typeof o.listed === 'boolean' ? o.listed : null,
      departures: Array.isArray(o.departures) ? (o.departures as Departure[]) : null,
      pricePP: pp && num(pp.amount) && str(pp.currency) ? { amount: num(pp.amount)!, currency: str(pp.currency)! } : null,
      priceCharter: ch && num(ch.amount) && str(ch.currency) ? { amount: num(ch.amount)!, currency: str(ch.currency)!, days: num(ch.days) } : null,
      durationDays: num(o.duration_days),
      seasonStartMonth: num(o.season_start_month),
      seasonEndMonth: num(o.season_end_month),
      seasonText: str(o.season_text),
    });
  }
  const others = (Array.isArray(j.other_products) ? j.other_products : [])
    .map(p => p as Record<string, unknown>)
    .filter(p => str(p.name))
    .map(p => ({ name: str(p.name)!, dates: str(p.dates), price: str(p.price) }));
  return { states, others };
}

/** One LLM read of a page. `ownSlugs` = offers whose source page this is (full authority). */
async function llmRead(url: string, text: string, offers: OfferRow[], ownSlugs: Set<string>): Promise<PageRead | null> {
  const list = offers.map(o => `- slug: "${o.slug}", title: "${o.title}"${ownSlugs.has(o.slug) ? ' (OWN PAGE)' : ''}`).join('\n');
  const msg = await withRetry(() => anthropic.messages.create({
    // a page that is no offer's own page is only read for NEW products → cheaper model
    model: ownSlugs.size > 0 ? ANALYSIS_MODEL : EXTRACTION_MODEL,
    max_tokens: 4000,
    temperature: 0,
    system: [{ type: 'text', text: PROMPT }],
    messages: [{ role: 'user', content: `Page: ${url}\nToday: ${new Date().toISOString().slice(0, 10)}\n\nOffers:\n${list || '(none yet)'}\n\nPage text:\n${text.slice(0, 60000)}` }],
  }));
  const out = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return parseLlmRead(out, new Set(offers.map(o => o.slug)));
}

// --- DB helpers ------------------------------------------------------------------------------

async function providerOffers(providerId: string): Promise<OfferRow[]> {
  const { data, error } = await supabase.from('cruise_offers').select(OFFER_ROW_COLUMNS).eq('cruise_provider_id', providerId);
  // A failed read must never look like "provider has no offers".
  if (error) throw new Error(`cruise_offers read failed: ${error.message}`);
  return (data ?? []) as unknown as OfferRow[];
}

async function rowsOfKind(providerId: string, kind: string): Promise<ChangeRow[]> {
  const { data, error } = await supabase.from('cruise_changes')
    .select('id, url, details, change_type, detected_at')
    .eq('cruise_provider_id', providerId)
    .filter('details->>kind', 'eq', kind);
  if (error) throw new Error(`cruise_changes read failed: ${error.message}`);
  return (data ?? []) as ChangeRow[];
}

async function insertRow(row: Record<string, unknown>, ctx: ObserveCtx): Promise<void> {
  if (ctx.dryRun) return;
  const { error } = await supabase.from('cruise_changes').insert(sanitizeDeep(row));
  if (error) throw new Error(`cruise_changes insert failed: ${error.message}`);
}
async function updateRow(id: string, patch: Record<string, unknown>, ctx: ObserveCtx): Promise<void> {
  if (ctx.dryRun) return;
  const { error } = await supabase.from('cruise_changes').update(sanitizeDeep(patch)).eq('id', id);
  if (error) throw new Error(`cruise_changes update failed: ${error.message}`);
}

function note(ctx: ObserveCtx, provider: ProviderRef, url: string, kind: string, summary: string): void {
  ctx.events.push({ provider: provider.name ?? provider.root_domain, url, kind, summary });
  console.log(`  ${kind.padEnd(13)} ${provider.root_domain} · ${summary}`);
}

// --- offer state machine -----------------------------------------------------------------------

/**
 * Feed one structured observation per offer into the state machine.
 * `authoritative` offers only (own page / adapter) — other pages never propose offer data.
 */
export async function observeOffers(
  provider: ProviderRef,
  url: string,
  source: string,
  observed: Array<{ offer: OfferRow; state: ObservedState }>,
  ctx: ObserveCtx,
  datesMode?: 'replace' | 'merge',
): Promise<void> {
  if (observed.length === 0) return;
  const stateRows = await rowsOfKind(provider.id, 'offer_state');
  const unlistedRows = await rowsOfKind(provider.id, 'unlisted');

  for (const { offer, state } of observed) {
    const mine = (rows: ChangeRow[]) => rows.filter(r => r.details.offer_id === offer.id);

    // ── "offer gone" path: the offer's own page no longer presents it ──
    const openUnlisted = mine(unlistedRows).find(r => r.details.status === 'observed');
    if (state.listed === false) {
      await sightUnlisted(provider, url, offer, openUnlisted, mine(unlistedRows), source, ctx);
      continue;
    }
    if (openUnlisted) await updateRow(openUnlisted.id, { details: { ...openUnlisted.details, status: 'superseded', closed_reason: 'wieder gelistet', closed_at: ctx.now.toISOString() } }, ctx);

    // ── listing facts ──
    const proposal = proposeUpdate(offer, state, { authoritative: true, today: ctx.today, datesMode });
    const rows = mine(stateRows);
    const open = rows.find(r => r.details.status === 'observed');

    if (!proposal) {
      if (open) await updateRow(open.id, { details: { ...open.details, status: 'superseded', closed_reason: 'DB stimmt mit der Seite überein', closed_at: ctx.now.toISOString() } }, ctx);
      continue;
    }
    // Already decided by a human (dismissed) or waiting for one: don't nag again.
    const decided = rows.find(r => r.details.fingerprint === proposal.fingerprint && ['dismissed', 'rerun_done', 'pending', 'applied'].includes(String(r.details.status)));
    if (decided) {
      if (open) await updateRow(open.id, { details: { ...open.details, status: 'superseded', closed_reason: `gleicher Vorschlag bereits ${decided.details.status}`, closed_at: ctx.now.toISOString() } }, ctx);
      continue;
    }

    if (open && open.details.fingerprint === proposal.fingerprint) {
      const sightings = (open.details.sightings ?? 1) + 1;
      const details: Details = { ...open.details, sightings, last_seen_at: ctx.now.toISOString(), source };
      if (hoursSince(open.details.first_seen_at, ctx.now) >= ctx.minAgeHours) {
        await finalize(provider, url, offer, proposal, open.id, details, ctx);
      } else {
        await updateRow(open.id, { details }, ctx);
      }
      continue;
    }

    const base = {
      kind: 'offer_state', status: 'observed', offer_id: offer.id, slug: offer.slug, title: offer.title, source,
      authoritative: true, fingerprint: proposal.fingerprint, proposal: { set: proposal.set },
      changes: proposal.changes, violations: proposal.violations,
      ignored: proposal.ignored,
      first_seen_at: ctx.now.toISOString(), last_seen_at: ctx.now.toISOString(), sightings: 1,
    };
    if (open) {
      // A different proposal than last time: restart the clock (flip-flop protection).
      await updateRow(open.id, { summary: proposal.summary, change_type: proposal.changeType, url, details: { ...base, flips: (open.details.flips ?? 0) + 1 } }, ctx);
      note(ctx, provider, url, 'observed', `${offer.slug}: ${proposal.summary} (geändert ggü. letzter Beobachtung)`);
    } else {
      await insertRow({
        cruise_provider_id: provider.id, url, change_type: proposal.changeType, summary: proposal.summary,
        significant: false, seen: true, details: { ...base, flips: 0 },
      }, ctx);
      note(ctx, provider, url, 'observed', `${offer.slug}: ${proposal.summary}`);
    }
  }
}

/** Second identical sighting: apply (rules pass) or hand to the review queue. */
async function finalize(
  provider: ProviderRef, url: string, offer: OfferRow, proposal: Proposal, rowId: string, details: Details, ctx: ObserveCtx,
): Promise<void> {
  if (proposal.violations.length > 0) {
    await updateRow(rowId, {
      significant: true, seen: false,
      summary: `⚠ ${proposal.summary} (Prüfregel: ${proposal.violations.join('; ')})`,
      details: {
        ...details, status: 'rerun_done', escalated_at: ctx.now.toISOString(),
        // Same shape as a /changes re-run → the existing diff view + "Approve" button apply it.
        rerun: {
          at: ctx.now.toISOString(), mode: 'surgical',
          review: { changed: [{ slug: offer.slug, current_slug: offer.slug, title: offer.title, fields: proposal.changes }], added: [], removed: [], unchanged: 0 },
          updates: [{ slug: offer.slug, title: offer.title, set: proposal.set }],
        },
      },
    }, ctx);
    note(ctx, provider, url, 'review', `${offer.slug}: ${proposal.summary} · ${proposal.violations.join('; ')}`);
    return;
  }

  // Re-read the row: a manual edit since the observation must win.
  const { data: fresh, error } = await supabase.from('cruise_offers').select(OFFER_ROW_COLUMNS).eq('id', offer.id).single();
  if (error || !fresh) { console.error(`  apply skipped (${offer.slug}): ${error?.message ?? 'offer gone'}`); return; }
  const drifted = proposal.changes.some(c => JSON.stringify((fresh as unknown as Record<string, unknown>)[c.field] ?? null) !== JSON.stringify(c.before ?? null));
  if (drifted) {
    await updateRow(rowId, { details: { ...details, status: 'superseded', closed_reason: 'DB hat sich seit der Beobachtung geändert', closed_at: ctx.now.toISOString() } }, ctx);
    return;
  }

  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(proposal.set)) if ((STATE_FIELDS as readonly string[]).includes(k)) patch[k] = v;
  if (!ctx.dryRun) {
    const { error: upErr } = await supabase.from('cruise_offers').update(sanitizeDeep(patch)).eq('id', offer.id);
    if (upErr) { console.error(`  apply failed (${offer.slug}): ${upErr.message}`); return; }
  }
  await updateRow(rowId, {
    significant: true, seen: true, summary: proposal.summary,
    details: {
      ...details, status: 'auto_applied',
      applied: { at: ctx.now.toISOString(), offer_id: offer.id, slug: offer.slug, title: offer.title, changes: proposal.changes },
    },
  }, ctx);
  note(ctx, provider, url, 'auto_applied', `${offer.slug}: ${proposal.summary}`);
}

async function sightUnlisted(
  provider: ProviderRef, url: string, offer: OfferRow, open: ChangeRow | undefined, all: ChangeRow[], source: string, ctx: ObserveCtx,
): Promise<void> {
  if (all.some(r => ['pending', 'rerun_done', 'dismissed'].includes(String(r.details.status)))) return; // already with a human
  const nowIso = ctx.now.toISOString();
  if (!open) {
    await insertRow({
      cruise_provider_id: provider.id, url, change_type: 'removed_offer', summary: `„${offer.title}" nicht mehr auf der eigenen Seite`,
      significant: false, seen: true,
      details: { kind: 'unlisted', status: 'observed', offer_id: offer.id, slug: offer.slug, title: offer.title, source, first_seen_at: nowIso, last_seen_at: nowIso, sightings: 1 },
    }, ctx);
    note(ctx, provider, url, 'observed', `${offer.slug}: nicht mehr gelistet (1. Sichtung)`);
    return;
  }
  const sightings = (open.details.sightings ?? 1) + 1;
  const details: Details = { ...open.details, sightings, last_seen_at: nowIso };
  if (sightings >= UNLISTED_SIGHTINGS && hoursSince(open.details.first_seen_at, ctx.now) >= UNLISTED_DAYS * 24) {
    await escalateGone(provider, url, [offer], open.id, details, `„${offer.title}" seit ${UNLISTED_DAYS}+ Tagen nicht mehr auf der eigenen Seite (${sightings} Checks)`, ctx);
  } else {
    await updateRow(open.id, { details }, ctx);
  }
}

async function escalateGone(
  provider: ProviderRef, url: string, offers: OfferRow[], rowId: string | null, details: Details, summary: string, ctx: ObserveCtx,
): Promise<void> {
  const payload = {
    significant: true, seen: false, change_type: 'removed_offer', summary,
    details: {
      ...details, status: 'rerun_done', escalated_at: ctx.now.toISOString(),
      // re-run shape → the diff view lists the offers with the existing 🗑 remove button
      rerun: { at: ctx.now.toISOString(), mode: 'gone', review: { changed: [], added: [], removed: offers.map(o => ({ title: o.title, slug: o.slug })), unchanged: 0 } },
    },
  };
  if (rowId) await updateRow(rowId, payload, ctx);
  else await insertRow({ cruise_provider_id: provider.id, url, ...payload }, ctx);
  note(ctx, provider, url, 'review', summary);
}

/** Source page answers 404/410 (monitor failure path). */
export async function recordSourceGone(
  provider: ProviderRef, url: string, httpStatus: number, consecutiveFailures: number, ctx: ObserveCtx,
): Promise<void> {
  if (consecutiveFailures < GONE_FAILURES) return;
  const offers = (await providerOffers(provider.id)).filter(o => normUrl(o.source_url) === normUrl(url));
  if (offers.length === 0) return;
  const rows = await rowsOfKind(provider.id, 'offer_gone');
  if (rows.some(r => normUrl(r.url) === normUrl(url) && r.details.status !== 'superseded')) return; // once per page
  const nowIso = ctx.now.toISOString();
  await escalateGone(provider, url, offers, null,
    { kind: 'offer_gone', http_status: httpStatus, failures: consecutiveFailures, first_seen_at: nowIso, last_seen_at: nowIso },
    `Quellseite antwortet HTTP ${httpStatus} seit ${consecutiveFailures} Checks: ${offers.map(o => `„${o.title}"`).join(', ')}`, ctx);
}

// --- new products --------------------------------------------------------------------------------

const productKey = (name: string): string =>
  name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 1).sort().join('-');

export async function observeNewProducts(
  provider: ProviderRef, url: string, products: PageRead['others'], offers: OfferRow[], ctx: ObserveCtx,
): Promise<void> {
  const fresh = products.filter(p => !offers.some(o => titleMatches(p.name, o.title)));
  if (fresh.length === 0) return;
  const rows = await rowsOfKind(provider.id, 'new_product');
  for (const p of fresh) {
    const key = productKey(p.name);
    if (!key) continue;
    const prior = rows.find(r => r.details.fingerprint === key || titleMatches(String(r.details.name ?? ''), p.name));
    const nowIso = ctx.now.toISOString();
    const summary = `Neues Produkt: ${p.name}${p.dates ? ` · ${p.dates}` : ''}${p.price ? ` · ${p.price}` : ''}`;
    if (!prior) {
      await insertRow({
        cruise_provider_id: provider.id, url, change_type: 'new_offer', summary, significant: false, seen: true,
        details: { kind: 'new_product', status: 'observed', fingerprint: key, name: p.name, dates: p.dates, price: p.price, first_seen_at: nowIso, last_seen_at: nowIso, sightings: 1 },
      }, ctx);
      note(ctx, provider, url, 'observed', summary);
      continue;
    }
    if (prior.details.status !== 'observed') continue; // already with a human / dismissed
    const sightings = (prior.details.sightings ?? 1) + 1;
    const details: Details = { ...prior.details, sightings, last_seen_at: nowIso };
    if (hoursSince(prior.details.first_seen_at, ctx.now) >= ctx.minAgeHours) {
      await updateRow(prior.id, { significant: true, seen: false, summary, details: { ...details, status: 'pending', escalated_at: nowIso } }, ctx);
      note(ctx, provider, url, 'review', summary);
    } else {
      await updateRow(prior.id, { details }, ctx);
    }
  }
}

// --- site loss ------------------------------------------------------------------------------------

/** Homepage reading: hijack/parking/unrelated content → hide the provider after 2 sightings. */
export async function observeSiteLoss(provider: ProviderRef, url: string, text: string, ctx: ObserveCtx): Promise<boolean> {
  const signal = siteLossSignal(text);
  const rows = await rowsOfKind(provider.id, 'site_lost');
  const open = rows.find(r => r.details.status === 'observed');
  const nowIso = ctx.now.toISOString();
  if (!signal) {
    if (open) await updateRow(open.id, { details: { ...open.details, status: 'superseded', closed_reason: 'Seite wieder normal', closed_at: nowIso } }, ctx);
    return false;
  }
  if (rows.some(r => ['pending', 'dismissed'].includes(String(r.details.status)))) return true; // already handled
  if (!open) {
    await insertRow({
      cruise_provider_id: provider.id, url, change_type: 'site_lost', summary: `Website verloren? ${signal}`, significant: false, seen: true,
      details: { kind: 'site_lost', status: 'observed', signal, first_seen_at: nowIso, last_seen_at: nowIso, sightings: 1 },
    }, ctx);
    note(ctx, provider, url, 'observed', `Website verloren? ${signal}`);
    return true;
  }
  const details: Details = { ...open.details, sightings: (open.details.sightings ?? 1) + 1, last_seen_at: nowIso, signal };
  if (hoursSince(open.details.first_seen_at, ctx.now) < ctx.minAgeHours) { await updateRow(open.id, { details }, ctx); return true; }

  // Confirmed: hide the provider (app view filters status dead) and alert.
  const { data: prov, error } = await supabase.from('cruise_providers').select('status, notes').eq('id', provider.id).single();
  if (error || !prov) { console.error(`  site-loss hide skipped: ${error?.message}`); return true; }
  const prevStatus = (prov.status as string | null) ?? 'new';
  if (!ctx.dryRun && prevStatus !== 'dead') {
    const stamp = `${ctx.today}: auto-hidden by monitor (${signal}). Restore on /changes.`;
    const { error: hideErr } = await supabase.from('cruise_providers')
      .update({ status: 'dead', notes: [prov.notes, stamp].filter(Boolean).join('\n') }).eq('id', provider.id);
    if (hideErr) { console.error(`  site-loss hide failed: ${hideErr.message}`); return true; }
  }
  await updateRow(open.id, {
    significant: true, seen: false, summary: `🚨 Website verloren, Anbieter ausgeblendet: ${signal}`,
    details: { ...details, status: 'pending', escalated_at: nowIso, hidden: { prev_status: prevStatus, at: nowIso } },
  }, ctx);
  note(ctx, provider, url, 'hidden', signal);
  return true;
}

// --- page entry point --------------------------------------------------------------------------

/** Read one changed page with the LLM and feed offers + new products into the state machine. */
export async function observePage(provider: ProviderRef, url: string, text: string, ctx: ObserveCtx): Promise<void> {
  const offers = await providerOffers(provider.id);
  const own = offers.filter(o => normUrl(o.source_url) === normUrl(url));
  const read = await llmRead(url, text, offers, new Set(own.map(o => o.slug)));
  if (!read) { console.error(`  LLM read failed: ${url}`); return; }
  // Only an offer's OWN page may propose its data (a homepage teaser never overrides it).
  // An LLM read never REMOVES upcoming departures ('merge'): dates rendered by JS, collapsed
  // sections or a thin Tavily text look exactly like a removal. Only adapters may remove.
  await observeOffers(provider, url, 'llm', own.filter(o => read.states.has(o.slug)).map(o => ({ offer: o, state: read.states.get(o.slug)! })), ctx, 'merge');
  await observeNewProducts(provider, url, read.others, offers, ctx);
}

/** Adapter entry point: deterministic states keyed by offer source URL (+ optional title hint). */
export async function observeAdapterStates(
  provider: ProviderRef,
  source: string,
  items: Array<{ sourceUrl: string; titleHint?: RegExp; state: ObservedState }>,
  ctx: ObserveCtx,
  datesMode?: 'replace' | 'merge',
): Promise<{ matched: number; unmatched: string[] }> {
  const offers = await providerOffers(provider.id);
  const byUrl = new Map<string, Array<{ offer: OfferRow; state: ObservedState }>>();
  const unmatched: string[] = [];
  let matched = 0;
  for (const it of items) {
    const cands = offers.filter(o => normUrl(o.source_url) === normUrl(it.sourceUrl) && (!it.titleHint || it.titleHint.test(o.title)));
    if (cands.length !== 1) { unmatched.push(`${it.sourceUrl} (${cands.length} offers)`); continue; }
    (byUrl.get(it.sourceUrl) ?? byUrl.set(it.sourceUrl, []).get(it.sourceUrl)!).push({ offer: cands[0], state: it.state });
    matched++;
  }
  for (const [url, observed] of byUrl) await observeOffers(provider, url, source, observed, ctx, datesMode);
  return { matched, unmatched };
}

// --- confirm phase (daily, after the sweep) ---------------------------------------------------

/**
 * Open observations need a 2nd sighting even when their page did not change again:
 * re-read every page with an open observation that was not seen in this run.
 * `skipUrl` = pages an adapter reads (the adapter phase confirms those).
 */
export async function confirmOpenObservations(ctx: ObserveCtx, skipUrl: (url: string) => boolean): Promise<void> {
  const { data, error } = await supabase.from('cruise_changes')
    .select('id, url, details, change_type, detected_at, cruise_provider_id, cruise_providers!inner(id, name, root_domain, website_url, status)')
    .filter('details->>status', 'eq', 'observed');
  if (error) throw new Error(`open observations read failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<ChangeRow & { cruise_providers: ProviderRef & { status: string | null } }>;
  console.log(`\nConfirm phase: ${rows.length} open observation(s)`);

  const byUrl = new Map<string, typeof rows>();
  for (const r of rows) {
    const prov = r.cruise_providers;
    if (['dead', 'duplicate'].includes(String(prov.status))) {
      await updateRow(r.id, { details: { ...r.details, status: 'superseded', closed_reason: `Anbieter ${prov.status}`, closed_at: ctx.now.toISOString() } }, ctx);
      continue;
    }
    if (hoursSince(r.details.last_seen_at, ctx.now) > STALE_DAYS * 24) {
      await updateRow(r.id, { details: { ...r.details, status: 'superseded', closed_reason: `seit ${STALE_DAYS} Tagen nicht mehr bestätigt`, closed_at: ctx.now.toISOString() } }, ctx);
      continue;
    }
    if (hoursSince(r.details.last_seen_at, ctx.now) < 6) continue; // already seen in this run
    if (!r.url || skipUrl(r.url)) continue;
    (byUrl.get(r.url) ?? byUrl.set(r.url, []).get(r.url)!).push(r);
  }

  for (const [url, group] of byUrl) {
    const provider = group[0].cruise_providers;
    try {
      const { text } = await fetchReadable(url);
      if (!text) { console.log(`  confirm: ${url} unreadable, retry tomorrow`); continue; }
      if (group.some(r => r.details.kind === 'site_lost')) await observeSiteLoss(provider, url, text, ctx);
      if (group.some(r => r.details.kind !== 'site_lost')) await observePage(provider, url, text, ctx);
    } catch (err) {
      console.error(`  confirm failed for ${url}: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
  }
}

// --- manual entry points (CLI) ------------------------------------------------------------------

async function providerByDomain(domain: string): Promise<(ProviderRef & { status: string | null }) | null> {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const { data, error } = await supabase.from('cruise_providers')
    .select('id, name, root_domain, website_url, status').eq('root_domain', d).maybeSingle();
  if (error) throw new Error(`provider read failed: ${error.message}`);
  return (data as (ProviderRef & { status: string | null }) | null) ?? null;
}

/** Observe one page now (same path as a changed page in the sweep). */
export async function observeUrl(url: string, ctx: ObserveCtx): Promise<void> {
  const { isAdapterUrl } = await import('../cruise-adapters/registry.js');
  if (isAdapterUrl(url)) { console.log(`${url} is read by an adapter → pnpm cli cruise-adapters run`); return; }
  const provider = await providerByDomain(new URL(url).hostname);
  if (!provider) { console.error(`no cruise provider for ${url}`); return; }
  const { text, httpStatus } = await fetchReadable(url);
  if (!text) { console.error(`unreadable (${httpStatus ?? 'error'}): ${url}`); return; }
  const isHome = normUrl(url) === normUrl(provider.website_url ?? `https://${provider.root_domain}`);
  if (isHome && await observeSiteLoss(provider, url, text, ctx)) return;
  await observePage(provider, url, text, ctx);
}

/** Observe every source page (+ homepage) of one provider: replaces old text-diff queue entries. */
export async function observeBackfill(domain: string, ctx: ObserveCtx): Promise<void> {
  const { isAdapterUrl } = await import('../cruise-adapters/registry.js');
  const provider = await providerByDomain(domain);
  if (!provider) { console.error(`no cruise provider ${domain}`); return; }
  if (['dead', 'duplicate'].includes(String(provider.status))) { console.log(`${domain} is ${provider.status}: skipped`); return; }
  const home = provider.website_url ?? `https://${provider.root_domain}`;
  const offers = await providerOffers(provider.id);
  const urls = [...new Set([home, ...offers.map(o => o.source_url).filter((u): u is string => !!u)].map(u => u.replace(/\/+$/, '')))];
  console.log(`${domain}: ${offers.length} offer(s), ${urls.length} page(s)`);
  for (const url of urls) {
    if (isAdapterUrl(url)) { console.log(`  adapter page: ${url}`); continue; }
    try { await observeUrl(url, ctx); }
    catch (err) { console.error(`  ${url}: ${err instanceof Error ? err.message.slice(0, 160) : err}`); }
  }
}

// --- revert -------------------------------------------------------------------------------------

/** Undo an auto-applied observation: write the logged "before" values back. */
export async function revertChange(changeId: string): Promise<void> {
  const { data: row, error } = await supabase.from('cruise_changes').select('id, details').eq('id', changeId).single();
  if (error || !row) throw new Error(`change ${changeId} not found: ${error?.message ?? ''}`);
  const d = row.details as Details & { applied?: { offer_id: string; slug: string; changes: Array<{ field: string; before: unknown }> } };
  if (d.status !== 'auto_applied' || !d.applied) throw new Error(`change ${changeId} is not an auto-applied observation (status ${d.status})`);
  const patch: Record<string, unknown> = {};
  for (const c of d.applied.changes) if ((STATE_FIELDS as readonly string[]).includes(c.field)) patch[c.field] = c.before ?? null;
  const { error: upErr } = await supabase.from('cruise_offers').update(sanitizeDeep(patch)).eq('id', d.applied.offer_id);
  if (upErr) throw new Error(`revert failed: ${upErr.message}`);
  const { error: chErr } = await supabase.from('cruise_changes')
    .update({ details: { ...d, status: 'dismissed', reverted_at: new Date().toISOString() } }).eq('id', changeId);
  if (chErr) throw new Error(`offer reverted, but change row update failed: ${chErr.message}`);
  console.log(`✓ reverted ${d.applied.slug}: ${Object.keys(patch).join(', ')}`);
}
