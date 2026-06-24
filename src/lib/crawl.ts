// ---------------------------------------------------------------------------
// Sitemap-first bounded site crawler.
//
// discoverSiteUrls() returns the in-scope content URLs for a provider's site:
//   1. sitemap.xml (via robots.txt + common locations, following sitemap-index
//      nesting one level) — complete and cheap, and immune to JS-rendered nav;
//   2. a depth-limited BFS fallback when no usable sitemap exists.
//
// The result is filtered (same domain, no assets/traps), de-duplicated,
// prioritised (homepage + high-value pages first), and capped.
// ---------------------------------------------------------------------------

import { parse } from 'node-html-parser';
import { fetchPageConditional } from './fetchPage.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Non-content URLs to drop.
const ASSET_RE =
  /\.(jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|rar|gz|tgz|mp4|mov|webm|mp3|wav|woff2?|ttf|eot|avif|bmp|tiff?)(\?|#|$)/i;
const TRAP_RE =
  /(\/wp-json\/|\/wp-admin|\/wp-login|\/feed\/?$|\/tag\/|\/category\/|\/author\/|\/cart|\/checkout|\/my-account|[?&](utm_|replytocom=|add-to-cart=)|\/page\/\d|\/comment-page-)/i;

// Pages most likely to carry traveller-relevant info — ranked first, and the
// only ones worth a (paid) Tavily fallback when the static fetch is thin.
export const PAGE_VALUE_RE =
  /(pricing|price|rate|cost|fare|gallery|photo|destination|trip|cruise|safari|liveaboard|itinerary|boat|yacht|fleet|cabin|date|book|tour|package|about|contact|faq|review)/i;

function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href.replace(/\/$/, '');
  } catch {
    return u.replace(/\/$/, '');
  }
}

function sameDomain(u: string, rootDomain: string): boolean {
  try {
    return new URL(u).hostname.replace(/^www\./, '') === rootDomain;
  } catch {
    return false;
  }
}

function keepUrl(u: string, rootDomain: string): boolean {
  return sameDomain(u, rootDomain) && !ASSET_RE.test(u) && !TRAP_RE.test(u);
}

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].trim());
}

/** Collect URLs from sitemaps (robots.txt + common paths), following index nesting. */
async function getSitemapUrls(rootDomain: string): Promise<string[]> {
  const origins = [`https://www.${rootDomain}`, `https://${rootDomain}`];
  const queue: string[] = [];
  for (const o of origins) {
    const robots = await fetchRaw(`${o}/robots.txt`);
    if (robots) for (const m of robots.matchAll(/sitemap:\s*(\S+)/gi)) queue.push(m[1].trim());
    queue.push(`${o}/sitemap.xml`, `${o}/sitemap_index.xml`);
  }

  const urls = new Set<string>();
  const seen = new Set<string>();
  let fetches = 0;
  while (queue.length > 0 && fetches < 12) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await fetchRaw(sm);
    fetches++;
    if (!xml) continue;
    const locs = parseLocs(xml);
    if (/<sitemapindex/i.test(xml)) {
      for (const l of locs) if (!seen.has(l)) queue.push(l); // nested sitemaps
    } else {
      for (const l of locs) if (keepUrl(l, rootDomain)) urls.add(normalizeUrl(l));
    }
  }
  return [...urls];
}

/** Depth-limited breadth-first crawl, used only when no usable sitemap exists. */
async function bfsUrls(homeUrl: string, rootDomain: string, maxPages: number): Promise<string[]> {
  const found = new Set<string>([normalizeUrl(homeUrl)]);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: homeUrl, depth: 0 }];
  while (queue.length > 0 && visited.size < maxPages) {
    const { url, depth } = queue.shift()!;
    const nu = normalizeUrl(url);
    if (visited.has(nu) || depth > 2) continue;
    visited.add(nu);
    const res = await fetchPageConditional(url);
    if (res.status !== 'ok' || !res.html) continue;
    for (const a of parse(res.html).querySelectorAll('a')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      let abs: string;
      try { abs = new URL(href, url).href; } catch { continue; }
      const n = normalizeUrl(abs);
      if (keepUrl(n, rootDomain) && !found.has(n)) {
        found.add(n);
        queue.push({ url: n, depth: depth + 1 });
      }
    }
  }
  return [...found];
}

/**
 * Discover the content URLs for a provider site: sitemap-first, BFS fallback.
 * Returns a filtered, prioritised, capped list (homepage + high-value first).
 */
export async function discoverSiteUrls(
  homeUrl: string,
  rootDomain: string,
  maxPages = 70,
): Promise<{ urls: string[]; via: 'sitemap' | 'bfs' }> {
  let urls = await getSitemapUrls(rootDomain);
  let via: 'sitemap' | 'bfs' = 'sitemap';
  if (urls.length < 5) {
    urls = await bfsUrls(homeUrl, rootDomain, maxPages);
    via = 'bfs';
  }

  const home = normalizeUrl(homeUrl);
  const set = new Set(urls.map(normalizeUrl).filter(u => keepUrl(u, rootDomain)));
  set.add(home);

  const score = (u: string): number => (u === home ? 1000 : PAGE_VALUE_RE.test(u) ? 10 : 1);
  const sorted = [...set].sort((a, b) => score(b) - score(a));
  return { urls: sorted.slice(0, maxPages), via };
}
