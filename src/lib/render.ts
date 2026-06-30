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

/** Render a page with JS executed and return its full HTML, or null on any failure. */
export async function renderPage(url: string): Promise<string | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  let ctx: Awaited<ReturnType<Browser['newContext']>> | undefined;
  try {
    ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1600 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // let client-side rendering + lazy galleries populate
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { /* best effort */ });
    await page.waitForTimeout(1200);
    return await page.content();
  } catch {
    return null;
  } finally {
    if (ctx) await ctx.close().catch(() => { /* */ });
  }
}

/** Close the shared browser (call once at the end of a run so the process exits). */
export async function closeRenderer(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  await b?.close().catch(() => { /* */ });
}
