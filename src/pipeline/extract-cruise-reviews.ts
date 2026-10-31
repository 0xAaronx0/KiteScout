import pLimit from 'p-limit';
import { parse } from 'node-html-parser';
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { search as tavilySearch, extract as tavilyExtract } from '../lib/tavily.js';
import { fetchPageConditional } from '../lib/fetchPage.js';
import { htmlToText, collapse } from '../lib/content.js';
import { withRetry } from '../lib/retry.js';
import { renderPageEx, closeRenderer } from '../lib/render.js';
import { averageRating, operatorReviewPatch, SOURCE_COLUMNS, type OperatorReviewResult } from './operator-review-patch.js';
export type { OperatorReviewResult } from './operator-review-patch.js';

const CONCURRENCY = 3;

interface ReviewSource {
  key: 'tripadvisor' | 'bstoked';
  label: string;
  hostMatch: (host: string) => boolean;
}

const SOURCES: ReviewSource[] = [
  {
    key: 'tripadvisor',
    label: 'TripAdvisor',
    hostMatch: h => /(^|\.)tripadvisor\.[a-z.]+$/i.test(h),
  },
  {
    key: 'bstoked',
    label: 'bstoked',
    hostMatch: h => /(^|\.)bstoked\.net$/i.test(h),
  },
];

interface VerifyResult {
  is_same_operator: boolean;
  confidence: 'high' | 'medium' | 'low';
  rating: number | null;
  review_count: number | null;
  evidence: string | null;
}

interface SourceMatch {
  url: string;
  rating: number | null;
  review_count: number | null;
  evidence: string;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
interface PageContent {
  html: string | null;
  text: string;
}

async function fetchContent(url: string): Promise<PageContent | null> {
  const res = await fetchPageConditional(url);
  if (res.status === 'ok' && res.html) {
    const text = htmlToText(res.html);
    if (text.length > 120) return { html: res.html, text };
  }
  const md = await tavilyExtract(url);
  if (md) return { html: null, text: collapse(md) };
  return null;
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

/** Outbound links from the operator's own page matching a predicate on the absolute URL. */
function findSelfLinkBy(html: string, baseUrl: string, match: (abs: string) => boolean): string | null {
  const root = parse(html);
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).href; } catch { continue; }
    if (match(abs)) return abs.split('#')[0];
  }
  return null;
}

function findSelfLink(html: string, baseUrl: string, source: ReviewSource): string | null {
  return findSelfLinkBy(html, baseUrl, abs => {
    const host = hostOf(abs);
    return !!host && source.hostMatch(host);
  });
}

/**
 * Best search hit on the review host, over several query shapes (a single
 * "<name> kite cruise …" query missed most listings). Listing-style
 * TripAdvisor URLs (Attraction/Hotel Review, Profile) outrank forum posts.
 */
async function searchCandidates(
  name: string,
  country: string | null,
  source: ReviewSource,
): Promise<Array<{ url: string; snippet: string | null }>> {
  const queries = [
    `${name} ${source.label}`,
    `${name} ${country ?? ''} ${source.label} reviews`.replace(/\s+/g, ' '),
    `${name} kite cruise ${source.label} reviews`,
  ];
  const hits: Array<{ url: string; snippet: string | null }> = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const results = await tavilySearch(q, 8, []);
    for (const r of results) {
      const host = hostOf(r.url);
      const url = r.url.split('#')[0];
      if (host && source.hostMatch(host) && !seen.has(url)) {
        seen.add(url);
        hits.push({ url, snippet: r.content ?? null });
      }
    }
    if (hits.length >= 3) break; // enough candidates to verify against
  }
  if (!hits.length) return [];

  // Rank: listing-style pages first; among them, prefer those mentioning the
  // provider's country (search often surfaces same-named businesses elsewhere —
  // e.g. "Golden Dolphin" boat trips on Zakynthos vs the Hurghada operator).
  const isListing = (u: string) => /(Attraction_Review|Hotel_Review|Restaurant_Review|Profile\/|AttractionProductReview)/i.test(u);
  const countryToken = (country ?? '').toLowerCase();
  const score = (h: { url: string; snippet: string | null }) =>
    (isListing(h.url) ? 10 : 0) +
    (countryToken && (`${h.url} ${h.snippet ?? ''}`.toLowerCase().includes(countryToken)) ? 5 : 0);
  return hits.sort((a, b) => score(b) - score(a)).slice(0, 3);
}

// Google: no collection (Aaron 2026-10-31, KCS#607 "607 b"). Google Maps pages are not fetched and no Google
// rating, count or link is written; a stored google_url stays as it is.

// ---------------------------------------------------------------------------
// Claude verification — same operator? + rating/count from the listing text
// ---------------------------------------------------------------------------
async function verifyMatch(
  source: { label: string },
  provider: { name: string; root_domain: string; country: string | null },
  listingText: string,
): Promise<VerifyResult | null> {
  const prompt = `Decide whether this ${source.label} listing is for the SAME kite-cruise operator we have on file, and extract its review stats.

Our operator:
- name: ${provider.name}
- website domain: ${provider.root_domain}
- primary country: ${provider.country ?? 'unknown'}

${source.label} listing content:
"""
${listingText.slice(0, 6000)}
"""

Be strict: only say is_same_operator=true if the business name AND location clearly match (review sites list many similarly-named sailing/charter businesses — a same-named business in a DIFFERENT region is NOT a match). Abbreviated or stylised forms of the same name (e.g. "GDolphin" for "Golden Dolphin") DO count when the location fits. Extract the star rating and number of reviews if shown.

Respond with ONLY this JSON:
{"is_same_operator": true|false, "confidence": "high"|"medium"|"low", "rating": number|null, "review_count": number|null, "evidence": "one short sentence"}`;

  let text: string;
  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: ANALYSIS_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    );
    text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  } catch {
    return null;
  }

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const p = JSON.parse(json);
    return {
      is_same_operator: p.is_same_operator === true,
      confidence: ['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'low',
      rating: typeof p.rating === 'number' ? Math.round(p.rating * 10) / 10 : null,
      review_count: typeof p.review_count === 'number' ? Math.round(p.review_count) : null,
      evidence: typeof p.evidence === 'string' ? p.evidence : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Match a single source for a provider
// ---------------------------------------------------------------------------
async function matchSource(
  source: ReviewSource,
  provider: { name: string; root_domain: string; country: string | null },
  ownPages: Array<{ url: string; html: string | null }>,
): Promise<SourceMatch | null> {
  // Signal 1: the operator's own site links to the listing (strongest, self-claimed).
  let selfLink: string | null = null;
  for (const p of ownPages) {
    selfLink = p.html ? findSelfLink(p.html, p.url, source) : null;
    if (selfLink) break;
  }
  // Signal 2: search hits on the review host — same-named businesses elsewhere
  // are common, so each candidate is verified and the first that passes wins.
  const candidates: Array<{ url: string; snippet: string | null }> = selfLink
    ? [{ url: selfLink, snippet: null }]
    : await searchCandidates(provider.name, provider.country, source);

  for (const cand of candidates) {
    // Listing content: direct fetch → headless render (TripAdvisor blocks plain
    // fetch AND Tavily) → search snippet (often carries name + rating already).
    let page = await fetchContent(cand.url);
    if (!page) {
      const rendered = await renderPageEx(cand.url);
      if (rendered) {
        const text = htmlToText(rendered.html);
        if (text.length > 120) page = { html: rendered.html, text };
      }
    }
    if (!page && cand.snippet && cand.snippet.length > 60) {
      page = { html: null, text: cand.snippet };
    }

    // Domain corroboration: the listing references the operator's own domain.
    const domainPresent =
      !!page && new RegExp(provider.root_domain.replace(/[.]/g, '\\.'), 'i').test(page.text);
    const corroborated = !!selfLink || domainPresent;

    const verify = page ? await verifyMatch(source, provider, page.text) : null;

    // Acceptance: corroborated (self-link / domain on the listing), or a
    // high-confidence name+location match. Requiring domain corroboration for
    // TripAdvisor dropped most genuine listings (TA pages rarely expose the
    // operator's website in extractable text) — the strict verify prompt plus
    // an "uncorroborated" note is the better trade-off.
    const accept = corroborated || (verify?.is_same_operator === true && verify.confidence === 'high');
    if (!accept) continue;
    // Even when corroborated, never store if Claude actively says it's a different operator.
    if (verify && !verify.is_same_operator && !selfLink) continue;

    const why = [
      selfLink ? 'operator site links to listing' : null,
      domainPresent ? 'listing references operator domain' : null,
      !corroborated ? 'uncorroborated high-confidence name+location match' : null,
      verify?.evidence ?? null,
    ].filter(Boolean).join('; ');

    return {
      url: cand.url,
      rating: verify?.rating ?? null,
      review_count: verify?.review_count ?? null,
      evidence: `${source.label}: ${why || 'matched'}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Combined average rating (unweighted mean of the sources that exist —
// review counts are too patchy for weighting). Column added by migration
// 20260709000000; recompute is probe-gated so older DBs keep working.
// ---------------------------------------------------------------------------
let avgRatingColumn: boolean | null = null;
async function hasAvgRatingColumn(): Promise<boolean> {
  if (avgRatingColumn === null) {
    const probe = await supabase.from('cruise_providers').select('avg_rating').limit(1);
    avgRatingColumn = !probe.error;
    if (!avgRatingColumn) console.warn('⚠ avg_rating column missing — run migration 20260709000000 to enable combined ratings.');
  }
  return avgRatingColumn;
}

export async function recomputeAvgRating(providerId: string): Promise<number | null> {
  if (!(await hasAvgRatingColumn())) return null;
  const { data: row, error } = await supabase
    .from('cruise_providers')
    .select('google_rating, tripadvisor_rating, bstoked_rating')
    .eq('id', providerId)
    .single();
  if (error || !row) return null;
  const avg = averageRating(row);
  await supabase.from('cruise_providers').update({ avg_rating: avg }).eq('id', providerId);
  return avg;
}

/** Backfill/refresh avg_rating for every active provider (no fetching, no LLM). */
export async function recomputeAllAvgRatings(): Promise<void> {
  if (!(await hasAvgRatingColumn())) return;
  const { data: providers, error } = await supabase
    .from('cruise_providers')
    .select('id, root_domain')
    .in('status', ['new', 'verified']);
  if (error) throw error;
  let withAvg = 0;
  for (const p of providers ?? []) {
    const avg = await recomputeAvgRating(p.id as string);
    if (avg !== null) withAvg++;
  }
  console.log(`avg_rating recomputed for ${providers?.length ?? 0} providers (${withAvg} with at least one rating).`);
}

// ---------------------------------------------------------------------------
// Process one provider
// ---------------------------------------------------------------------------
type ReviewTarget = { id: string; name: string | null; root_domain: string; website_url: string | null; primary_country: string | null };

// Finds review links and ratings for one operator without writing anything; extraUrls are stored own pages
// (contact/about/review) worth checking for self-links. Shared by the cruise writer and the operator dry run.
async function collectReviews(
  cp: ReviewTarget,
  opts: { sources: ReviewSource[] },
  storedPageUrls: string[],
): Promise<{ patch: Record<string, unknown>; notes: string[]; found: number }> {
  const homeUrl = cp.website_url ?? `https://${cp.root_domain}`;
  const provider = {
    name: cp.name ?? cp.root_domain,
    root_domain: cp.root_domain.replace(/^www\./, ''),
    country: cp.primary_country,
  };

  // The operator's own pages, for self-link discovery: homepage + the stored
  // contact/about/review-ish pages. Footers with review badges are often
  // JS-rendered (Wix) — render the homepage when static HTML shows no review link.
  const ownPages: Array<{ url: string; html: string | null }> = [];
  const home = await fetchPageConditional(homeUrl);
  ownPages.push({ url: homeUrl, html: home.status === 'ok' ? home.html ?? null : null });
  const extraUrls = storedPageUrls
    .filter(u => /contact|kontakt|about|uber|ueber|review|bewertung|testimonial|impressum|imprint/i.test(u))
    .slice(0, 4);
  for (const u of extraUrls) {
    const r = await fetchPageConditional(u);
    if (r.status === 'ok' && r.html) ownPages.push({ url: u, html: r.html });
  }
  const staticJoined = ownPages.map(p => p.html ?? '').join(' ');
  if (!/tripadvisor/i.test(staticJoined)) {
    const rendered = await renderPageEx(homeUrl);
    if (rendered) ownPages.unshift({ url: rendered.url, html: rendered.html });
  }

  const patch: Record<string, unknown> = { reviews_checked_at: new Date().toISOString() };
  const notes: string[] = [];
  let found = 0;

  for (const source of opts.sources) {
    const match = await matchSource(source, provider, ownPages);
    if (!match) continue;
    found++;
    notes.push(match.evidence);
    if (source.key === 'tripadvisor') {
      patch.tripadvisor_url = match.url;
      patch.tripadvisor_rating = match.rating;
      patch.tripadvisor_review_count = match.review_count;
    } else {
      patch.bstoked_url = match.url;
      patch.bstoked_rating = match.rating;
      patch.bstoked_review_count = match.review_count;
    }
  }

  return { patch, notes, found };
}

async function processProvider(cp: ReviewTarget, opts: { sources: ReviewSource[] }): Promise<number> {
  const { data: pgs } = await supabase.from('provider_pages').select('url').eq('cruise_provider_id', cp.id);
  const { patch, notes, found } = await collectReviews(cp, opts, (pgs ?? []).map(r => r.url as string));
  if (notes.length > 0) {
    // Merge with notes from other sources' earlier runs: keep segments of
    // sources this run did NOT cover, replace the ones it did.
    const { data: cur } = await supabase.from('cruise_providers').select('review_match_notes').eq('id', cp.id).single();
    const covered = opts.sources.map(s => s.label);
    const kept = ((cur?.review_match_notes as string | null) ?? '')
      .split(' | ')
      .filter(seg => seg.trim() && !covered.some(label => seg.trim().toLowerCase().startsWith(label.toLowerCase() + ':')));
    patch.review_match_notes = [...kept, ...notes].join(' | ');
  }

  const { error } = await supabase.from('cruise_providers').update(patch).eq('id', cp.id);
  if (error) console.error(`\n  DB error for ${cp.root_domain}:`, error.message);
  await recomputeAvgRating(cp.id);
  return found;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runExtractCruiseReviews(
  opts: { all?: boolean; domain?: string; limit?: number; only?: string } = {},
): Promise<{
  providers: number;
  matched: number;
}> {
  let query = supabase
    .from('cruise_providers')
    .select('id, name, root_domain, website_url, primary_country')
    .in('status', ['new', 'verified']);
  if (opts.domain) query = query.eq('root_domain', opts.domain);
  else if (!opts.all) query = query.is('reviews_checked_at', null);
  if (opts.limit) query = query.limit(opts.limit);

  const { data: providers, error } = await query;
  if (error) throw error;
  if (!providers || providers.length === 0) {
    console.log('No cruise providers to check (use --all to re-check already-checked ones).');
    return { providers: 0, matched: 0 };
  }

  // Which sources this run covers (--only tripadvisor,bstoked); Google is never collected (KCS#607).
  const only = (opts.only ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const wants = (k: string) => only.length === 0 || only.includes(k);
  const sources = SOURCES.filter(s => wants(s.key));

  console.log(`Checking review links for ${providers.length} cruise providers… (sources: ${sources.map(s => s.key).join(', ')})`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let totalMatched = 0;

  await Promise.all(
    providers.map(cp =>
      limit(async () => {
        try {
          totalMatched += await processProvider(cp, { sources });
        } catch (err) {
          console.error(`\n  Failed ${cp.root_domain}:`, err instanceof Error ? err.message : err);
        }
        done++;
        process.stdout.write(`\r  ${done}/${providers.length} providers  (${totalMatched} review links)`);
      }),
    ),
  );

  console.log();
  await closeRenderer();
  return { providers: providers.length, matched: totalMatched };
}

// ---------------------------------------------------------------------------
// Package operators (stays, camps, tours): dry run only
// ---------------------------------------------------------------------------
// Aaron 2026-10-30: the review search ran for cruise providers only; the 292 operators behind the package
// listings were never checked. This collects the same matches for them WITHOUT writing: the package view
// still has no review columns for operators (a migration comes first), and Aaron reviews the list first.
export async function runOperatorReviewsDryRun(
  opts: { domain?: string; limit?: number; only?: string; unchecked?: boolean } = {},
): Promise<OperatorReviewResult[]> {
  const { data: offers, error: offerError } = await supabase.from('package_offers')
    .select('operator_id,title').eq('is_active', true).not('operator_id', 'is', null);
  if (offerError) throw offerError;
  const listings = new Map<string, string[]>();
  for (const o of offers ?? []) listings.set(o.operator_id as string, [...(listings.get(o.operator_id as string) ?? []), o.title as string]);
  const ids = [...listings.keys()];
  const operators: ReviewTarget[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    let query = supabase.from('providers').select('id, name, root_domain, website_url, primary_country, status')
      .in('id', ids.slice(i, i + 100)).not('status', 'in', '(dead,duplicate)');
    if (opts.domain) query = query.eq('root_domain', opts.domain);
    // --new: only operators never checked (new listings); checked ones keep their reviewed values.
    if (opts.unchecked) query = query.is('reviews_checked_at', null);
    const { data, error } = await query;
    if (error) throw error;
    operators.push(...(data ?? []));
  }
  operators.sort((a, b) => a.root_domain.localeCompare(b.root_domain));
  const picked = opts.limit ? operators.slice(0, opts.limit) : operators;
  const only = (opts.only ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const wants = (k: string) => only.length === 0 || only.includes(k);
  const sources = SOURCES.filter(s => wants(s.key));
  console.log(`Dry run: review links for ${picked.length} package operators (sources: ${sources.map(s => s.key).join(', ')}); nothing is written.`);

  const limit = pLimit(CONCURRENCY);
  const results: OperatorReviewResult[] = [];
  let done = 0;
  await Promise.all(picked.map(op => limit(async () => {
    const base = { operatorId: op.id, name: op.name, domain: op.root_domain, country: op.primary_country, listings: listings.get(op.id) ?? [] };
    try {
      const { patch, notes, found } = await collectReviews(op, { sources }, []);
      const { reviews_checked_at: _checked, ...links } = patch;
      results.push({ ...base, found, links, notes });
    } catch (err) {
      results.push({ ...base, found: 0, links: {}, notes: [], error: err instanceof Error ? err.message : String(err) });
    }
    done++;
    process.stdout.write(`\r  ${done}/${picked.length} operators`);
  })));
  console.log();
  await closeRenderer();
  return results.sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Writes reviewed dry-run results to public.providers (needs migration 20261030140000_operator_reviews). */
export async function applyOperatorReviews(results: OperatorReviewResult[], opts: { skip?: string[] } = {}): Promise<{ written: number; withLinks: number; dropped: string[] }> {
  const probe = await supabase.from('providers').select('google_url').limit(1);
  if (probe.error) throw new Error(`providers has no review columns (run migration 20261030140000_operator_reviews first): ${probe.error.message}`);
  const skip = new Set(opts.skip ?? []);
  const checkedAt = new Date().toISOString();
  let written = 0, withLinks = 0; const dropped: string[] = [];
  for (const result of results) {
    if (result.error) continue;
    const patch = operatorReviewPatch(result, skip, checkedAt);
    for (const src of Object.keys(SOURCE_COLUMNS)) if (result.links[`${src}_url`] && !patch[`${src}_url`]) dropped.push(`${result.domain}:${src}`);
    const { error } = await supabase.from('providers').update(patch).eq('id', result.operatorId);
    if (error) throw new Error(`providers update failed for ${result.domain}: ${error.message}`);
    written++;
    if (Object.keys(SOURCE_COLUMNS).some(src => patch[`${src}_url`])) withLinks++;
  }
  return { written, withLinks, dropped };
}
