// ---------------------------------------------------------------------------
// Cheap, conditional page fetcher used by the monitor's first tier.
//
// Sends If-None-Match / If-Modified-Since when we have stored validators so an
// unchanged page can return 304 with no body — costing essentially nothing.
// ---------------------------------------------------------------------------

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BLOCK_RE =
  /(captcha|cloudflare|just a moment|access denied|forbidden|are you a (human|robot)|enable javascript)/i;

export interface FetchResult {
  status: 'not_modified' | 'ok' | 'blocked' | 'error';
  html?: string;
  etag?: string | null;
  lastModified?: string | null;
  httpStatus?: number;
}

export async function fetchPageConditional(
  url: string,
  opts: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en;q=0.9,de;q=0.8',
  };
  if (opts.etag) headers['If-None-Match'] = opts.etag;
  if (opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;

  try {
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });

    if (res.status === 304) return { status: 'not_modified', httpStatus: 304 };
    if (res.status === 403 || res.status === 429) return { status: 'blocked', httpStatus: res.status };
    if (!res.ok) return { status: 'error', httpStatus: res.status };

    const html = await res.text();
    if (html.trim().length < 500 && BLOCK_RE.test(html)) {
      return { status: 'blocked', httpStatus: res.status };
    }

    return {
      status: 'ok',
      html,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      httpStatus: res.status,
    };
  } catch {
    return { status: 'error' };
  }
}
