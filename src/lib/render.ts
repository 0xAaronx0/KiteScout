// ---------------------------------------------------------------------------
// Headless-browser render fallback for JS-only sites.
//
// Some operator sites are client-rendered SPAs (e.g. kitecharters.com): a plain
// HTTP fetch returns an empty shell, and even Tavily extract gets nothing. This
// renders the page in a real (headless) Chromium so the JS-built content AND any
// lazy-loaded image galleries are present in the returned HTML.
//
// Best-effort: a lazily-launched singleton browser (reused across calls). If
// Playwright or its Chromium isn't available, every call returns null and the
// caller falls back to whatever static content it has.
// ---------------------------------------------------------------------------
import type { Browser } from 'playwright';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let browserPromise: Promise<Browser | null> | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const { chromium } = await import('playwright');
        return await chromium.launch({ headless: true });
      } catch (err) {
        console.error('  [render] Playwright/Chromium unavailable — skipping JS render:', err instanceof Error ? err.message : err);
        return null;
      }
    })();
  }
  return browserPromise;
}

export interface RenderCookie { name: string; value: string; domain: string; path?: string }

/**
 * Render a page with JS executed; returns the HTML plus the FINAL url (after
 * client/server redirects — e.g. a Google Maps search resolving to a place).
 * Optional cookies let callers pre-accept consent walls (Google).
 */
export async function renderPageEx(
  url: string,
  opts: { cookies?: RenderCookie[] } = {},
): Promise<{ html: string; url: string } | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  let ctx: Awaited<ReturnType<Browser['newContext']>> | undefined;
  try {
    ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 1600 },
      // Prefer the English site version on language-negotiating sites.
      locale: 'en-US',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9,de;q=0.8' },
    });
    if (opts.cookies?.length) {
      await ctx.addCookies(opts.cookies.map(c => ({ ...c, path: c.path ?? '/' })));
    }
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // let client-side rendering + lazy galleries populate
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { /* best effort */ });
    await page.waitForTimeout(1200);
    // Scroll through the page: lazy galleries (bstoked image-bg, WP lazyload)
    // only swap their real image URLs in when scrolled into view.
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 1000).catch(() => { /* */ });
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(600);
    return { html: await page.content(), url: page.url() };
  } catch {
    return null;
  } finally {
    if (ctx) await ctx.close().catch(() => { /* */ });
  }
}

/** Render a page with JS executed and return its full HTML, or null on any failure. */
export async function renderPage(url: string): Promise<string | null> {
  const r = await renderPageEx(url);
  return r?.html ?? null;
}

/** Close the shared browser (call once at the end of a run so the process exits). */
export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => { /* */ });
}
