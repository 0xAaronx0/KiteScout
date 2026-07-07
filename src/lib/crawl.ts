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
import { renderPage } from './render.js';

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
  /(pricing|price|rate|cost|fare|gallery|photo|destination|trip|cruise|safari|liveaboard|itinerary|boat|yacht|fleet|cabin|date|book|tour|package|about|contact|faq|review|crucero|cruzeiro|kreuzfahrt|croisi|crociera|viaje|viagg|viagem|reise|voyage|oferta|velero|segelt)/i;

// Genuine product / destination / cruise pages — ranked ABOVE everything else so
// they survive the page cap on blog-heavy sites.
const PRODUCT_PAGE_RE =
  /(cruise|crucero|cruzeiro|kreuzfahrt|croisi|crociera|safari|liveaboard|catamar|itinerar|destination|charter|flotille|segel|[\s/_-]sail)/i;
// Blog posts / SEO articles / legal & info pages — ranked LAST. These pile up on
// content-marketing sites (e.g. "kite-safari-meaning", "why-...", "/blog/...",
// "/2007/...") and otherwise crowd genuine cruise pages out of the cap.
const ARTICLE_PAGE_RE =
  /\/(blog|news|press|article|stories|story|magazin|guide|faq|terms|privacy|cookie|impressum|datenschutz|jobs)\b|\/20\d\d\/|[\s/_-](why|what|how|when|where|which|meaning|vs|review|reviews|guide|tips|hate|love|truth|conflict|restriction|crypto|reddit|advisor|expensive|possible|sunk)(?=[\s/_-]|$)/i;

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

/** Same-domain, in-scope links found in a chunk of HTML. */
function linksFromHtml(html: string, baseUrl: string, rootDomain: string): string[] {
  const out = new Set<string>();
  for (const a of parse(html).querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).href; } catch { continue; }
    const n = normalizeUrl(abs);
    if (keepUrl(n, rootDomain)) out.add(n);
  }
  return [...out];
}

/** Same-domain links found on a single page via a plain (static) fetch. */
async function pageLinks(pageUrl: string, rootDomain: string): Promise<string[]> {
  const res = await fetchPageConditional(pageUrl);
  if (res.status !== 'ok' || !res.html) return [];
  return linksFromHtml(res.html, pageUrl, rootDomain);
}

/** The last path segment of a URL — its slug ("" for the homepage). */
function urlSlug(u: string): string {
  try { return new URL(u).pathname.split('/').filter(Boolean).pop() ?? ''; } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Language-tree preference: crawl the ENGLISH version of a site when it exists.
// ---------------------------------------------------------------------------
const LANG_CODES = new Set([
  'de','fr','es','it','nl','pt','pl','ru','cs','sk','da','sv','nb','no','fi',
  'tr','el','hu','ro','bg','hr','sl','sr','ar','he','zh','ja','ko','th','uk',
  'ca','et','lt','lv','is','mk','sq',
]);

/** Leading language segment of a path (/de/x, /fr-fr/x) → { lang, rest of path }. */
function langOfPath(pathname: string): { lang: string | null; rest: string } {
  const m = pathname.match(/^\/([a-z]{2})(?:-[a-z]{2})?(?=\/|$)/i);
  if (!m) return { lang: null, rest: pathname };
  const code = m[1].toLowerCase();
  if (code !== 'en' && !LANG_CODES.has(code)) return { lang: null, rest: pathname };
  const rest = pathname.slice(m[0].length) || '/';
  return { lang: code, rest };
}

/** www-stripped host + trailing-slash-normalized path — equivalence key. */
function hostPathKey(host: string, path: string): string {
  return host.replace(/^www\./, '') + (path.replace(/\/$/, '') || '/');
}

/**
 * Drop pages from non-English language trees whose English (or language-neutral)
 * equivalent was also discovered — so multilingual sites get crawled in English.
 * A page WITHOUT an English/neutral equivalent is always kept (localized slugs,
 * single-language sites): language preference must never cost coverage.
 */
function preferEnglishTree(set: Set<string>): void {
  const keys = new Set<string>();
  for (const u of set) {
    try { const x = new URL(u); keys.add(hostPathKey(x.hostname, x.pathname)); } catch { /* skip */ }
  }
  for (const u of [...set]) {
    let x: URL;
    try { x = new URL(u); } catch { continue; }
    const { lang, rest } = langOfPath(x.pathname);
    if (!lang || lang === 'en') continue;
    const enEquiv = hostPathKey(x.hostname, `/en${rest === '/' ? '' : rest}`);
    const neutral = hostPathKey(x.hostname, rest);
    if (keys.has(enEquiv) || keys.has(neutral)) set.delete(u);
  }
}

/** Short slug matching a product/destination term and not an article → a real offer page. */
function isProductPage(u: string): boolean {
  return PRODUCT_PAGE_RE.test(u) && !ARTICLE_PAGE_RE.test(u) && urlSlug(u).split('-').length < 6;
}

/**
 * Discover the content URLs for a provider site: sitemap-first, BFS fallback,
 * plus the homepage's own nav links merged in (catches product pages a
 * content-marketing sitemap omits). Returns a filtered, prioritised, capped list.
 */
export async function discoverSiteUrls(
  homeUrl: string,
  rootDomain: string,
  maxPages = 100,
): Promise<{ urls: string[]; via: 'sitemap' | 'bfs' }> {
  let urls = await getSitemapUrls(rootDomain);
  let via: 'sitemap' | 'bfs' = 'sitemap';
  if (urls.length < 5) {
    // BFS from the site ROOT, not a possibly-deep website_url (e.g.
    // "/en/camps-and-sail/") whose page links to almost nothing — otherwise a
    // provider with a deep website_url gets crawled as a single page.
    let root = `https://${rootDomain}/`;
    try { root = new URL(homeUrl).origin + '/'; } catch { /* keep default */ }
    urls = await bfsUrls(root, rootDomain, maxPages);
    via = 'bfs';
  }

  const home = normalizeUrl(homeUrl);
  const set = new Set(urls.map(normalizeUrl).filter(u => keepUrl(u, rootDomain)));
  set.add(home);

  // A sitemap can omit product/destination pages that only live in the nav — e.g.
  // content-marketing sites whose sitemap is all blog posts (sickdogsurf.com lists
  // ~100 articles but not its /kite-cruise-<dest>/ pages). Merge the homepage's own
  // links so those nav-linked pages aren't missed. (BFS already follows links, so
  // this is only needed when a sitemap was the source.)
  let root = `https://${rootDomain}/`;
  try { root = new URL(homeUrl).origin + '/'; } catch { /* keep default */ }
  if (via === 'sitemap') {
    for (const l of await pageLinks(root, rootDomain)) set.add(l);
  }
  // Still few real product pages? The nav is likely JS-rendered (sickdogsurf's
  // product menu, and pure SPAs like kitecharters, only exist after JS runs).
  // Render the homepage and harvest its links too. Gated so sites with a healthy
  // sitemap/nav never pay the render cost.
  if ([...set].filter(isProductPage).length < 4) {
    const html = await renderPage(root);
    if (html) for (const l of linksFromHtml(html, root, rootDomain)) set.add(l);
  }

  // Multilingual sites: crawl the English tree where an equivalent exists.
  preferEnglishTree(set);

  const nonEnTree = (u: string): boolean => {
    try { const { lang } = langOfPath(new URL(u).pathname); return lang !== null && lang !== 'en'; }
    catch { return false; }
  };
  const score = (u: string): number => {
    if (u === home) return 1000;
    // A long, sentence-like slug ("best-time-of-year-to-book-a-kite-safari-in-egypt")
    // is almost always a blog/SEO article, even when it contains "cruise"/"safari".
    const longSlug = urlSlug(u).split('-').length >= 6;
    const article = ARTICLE_PAGE_RE.test(u) || longSlug;
    // Localized slugs can't be equivalence-matched, so both trees survive; a mild
    // penalty lets English/neutral pages fill the page cap first.
    const langPenalty = nonEnTree(u) ? 1 : 0;
    if (PRODUCT_PAGE_RE.test(u) && !article) return 100 - langPenalty;
    if (article) return 1;                               // blog/SEO/legal pages last
    if (PAGE_VALUE_RE.test(u)) return 10 - langPenalty;
    return 5 - langPenalty;
  };
  const sorted = [...set].sort((a, b) => score(b) - score(a));
  return { urls: sorted.slice(0, maxPages), via };
}
