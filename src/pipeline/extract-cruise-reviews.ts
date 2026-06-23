import pLimit from 'p-limit';
import { parse } from 'node-html-parser';
import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';
import { search as tavilySearch, extract as tavilyExtract } from '../lib/tavily.js';
import { fetchPageConditional } from '../lib/fetchPage.js';
import { htmlToText, collapse } from '../lib/content.js';
import { withRetry } from '../lib/retry.js';

const CONCURRENCY = 3;

interface ReviewSource {
  key: 'tripadvisor' | 'bstoked';
  label: string;
  hostMatch: (host: string) => boolean;
  /** TripAdvisor is generic → only ever accept a domain-corroborated match. */
  requireDomainCorroboration: boolean;
}

const SOURCES: ReviewSource[] = [
  {
    key: 'tripadvisor',
    label: 'TripAdvisor',
    hostMatch: h => /(^|\.)tripadvisor\.[a-z.]+$/i.test(h),
    requireDomainCorroboration: true,
  },
  {
    key: 'bstoked',
    label: 'bstoked',
    hostMatch: h => /(^|\.)bstoked\.net$/i.test(h),
    requireDomainCorroboration: false, // kite-specific directory → name match also acceptable
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

/** Outbound links from the operator's own page to a given review host. */
function findSelfLink(html: string, baseUrl: string, source: ReviewSource): string | null {
  const root = parse(html);
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).href; } catch { continue; }
    const host = hostOf(abs);
    if (host && source.hostMatch(host)) return abs.split('#')[0];
  }
  return null;
}

/** First search hit on the review host. */
async function searchCandidate(name: string, source: ReviewSource): Promise<string | null> {
  const results = await tavilySearch(`${name} kite cruise ${source.label} reviews`, 8, []);
  for (const r of results) {
    const host = hostOf(r.url);
    if (host && source.hostMatch(host)) return r.url.split('#')[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claude verification — same operator? + rating/count from the listing text
// ---------------------------------------------------------------------------
async function verifyMatch(
  source: ReviewSource,
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

Be strict: only say is_same_operator=true if the business name AND location clearly match (TripAdvisor has many similarly-named sailing/charter businesses). Extract the star rating and number of reviews if shown.

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
  homeHtml: string | null,
  homeUrl: string,
): Promise<SourceMatch | null> {
  // Signal 1: the operator's own site links to the listing (strongest, self-claimed).
  const selfLink = homeHtml ? findSelfLink(homeHtml, homeUrl, source) : null;
  // Signal 2: a search hit on the review host.
  const candidate = selfLink ?? (await searchCandidate(provider.name, source));
  if (!candidate) return null;

  const page = await fetchContent(candidate);
  // Domain corroboration: the listing references the operator's own domain.
  const domainPresent =
    !!page && new RegExp(provider.root_domain.replace(/[.]/g, '\\.'), 'i').test(page.text);
  const corroborated = !!selfLink || domainPresent;

  const verify = page ? await verifyMatch(source, provider, page.text) : null;

  // Acceptance:
  //  - TripAdvisor: ONLY when domain-corroborated (self-link or domain on the page).
  //  - bstoked: corroborated, or a high-confidence exact-name match (kite-specific site).
  const accept = source.requireDomainCorroboration
    ? corroborated
    : corroborated || (verify?.is_same_operator === true && verify.confidence === 'high');

  if (!accept) return null;
  // Even when corroborated, never store if Claude actively says it's a different operator.
  if (verify && !verify.is_same_operator && !selfLink) return null;

  const why = [
    selfLink ? 'operator site links to listing' : null,
    domainPresent ? 'listing references operator domain' : null,
    verify?.evidence ?? null,
  ].filter(Boolean).join('; ');

  return {
    url: candidate,
    rating: verify?.rating ?? null,
    review_count: verify?.review_count ?? null,
    evidence: `${source.label}: ${why || 'matched'}`,
  };
}

// ---------------------------------------------------------------------------
// Process one provider
// ---------------------------------------------------------------------------
async function processProvider(cp: {
  id: string;
  name: string | null;
  root_domain: string;
  website_url: string | null;
  primary_country: string | null;
}): Promise<number> {
  const homeUrl = cp.website_url ?? `https://${cp.root_domain}`;
  const provider = {
    name: cp.name ?? cp.root_domain,
    root_domain: cp.root_domain.replace(/^www\./, ''),
    country: cp.primary_country,
  };

  const home = await fetchPageConditional(homeUrl);
  const homeHtml = home.status === 'ok' ? home.html ?? null : null;

  const patch: Record<string, unknown> = { reviews_checked_at: new Date().toISOString() };
  const notes: string[] = [];
  let found = 0;

  for (const source of SOURCES) {
    const match = await matchSource(source, provider, homeHtml, homeUrl);
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

  if (notes.length > 0) patch.review_match_notes = notes.join(' | ');

  const { error } = await supabase.from('cruise_providers').update(patch).eq('id', cp.id);
  if (error) console.error(`\n  DB error for ${cp.root_domain}:`, error.message);
  return found;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runExtractCruiseReviews(opts: { all?: boolean } = {}): Promise<{
  providers: number;
  matched: number;
}> {
  let query = supabase
    .from('cruise_providers')
    .select('id, name, root_domain, website_url, primary_country')
    .in('status', ['new', 'verified']);
  if (!opts.all) query = query.is('reviews_checked_at', null);

  const { data: providers, error } = await query;
  if (error) throw error;
  if (!providers || providers.length === 0) {
    console.log('No cruise providers to check (use --all to re-check already-checked ones).');
    return { providers: 0, matched: 0 };
  }

  console.log(`Checking review links for ${providers.length} cruise providers…`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let totalMatched = 0;

  await Promise.all(
    providers.map(cp =>
      limit(async () => {
        try {
          totalMatched += await processProvider(cp);
        } catch (err) {
          console.error(`\n  Failed ${cp.root_domain}:`, err instanceof Error ? err.message : err);
        }
        done++;
        process.stdout.write(`\r  ${done}/${providers.length} providers  (${totalMatched} review links)`);
      }),
    ),
  );

  console.log();
  return { providers: providers.length, matched: totalMatched };
}
