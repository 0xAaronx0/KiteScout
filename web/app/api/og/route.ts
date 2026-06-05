import { NextRequest, NextResponse } from 'next/server';

// Patterns that mark an image as NOT a usable hero (logos, icons, sprites, etc.)
const JUNK = /(logo|icon|sprite|favicon|avatar|badge|placeholder|spinner|loader|pixel|tracking|1x1|blank|transparent)/i;

function absolutize(src: string, base: string): string | null {
  if (!src) return null;
  src = src.trim().replace(/&amp;/g, '&');
  if (src.startsWith('data:')) return null;
  try {
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('http')) return src;
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

function looksLikeImage(u: string): boolean {
  if (JUNK.test(u)) return false;
  if (/\.svg(\?|$)/i.test(u)) return false; // svgs are almost always logos
  return true;
}

// Pull provider images out of a page's HTML, best-first, deduped.
function extractImages(html: string, base: string, into: string[], seen: Set<string>, limit: number) {
  const add = (raw: string | null | undefined) => {
    if (into.length >= limit || !raw) return;
    const abs = absolutize(raw, base);
    if (!abs || !looksLikeImage(abs)) return;
    // Dedupe ignoring the query string (CDNs vary it for resizing).
    const key = abs.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    into.push(abs);
  };
  const pick = (re: RegExp) => { const m = re.exec(html); if (m) add(m[1]); };

  // 1. Open Graph + Twitter (the provider's chosen hero/share images).
  pick(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i);
  pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  pick(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i);
  pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i);

  // 2. itemprop / link rel=image_src.
  pick(/<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i);
  pick(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);

  // 3. JSON-LD images (string, array, or { url }).
  for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = block[1];
    for (const m of body.matchAll(/"(?:url|contentUrl)"\s*:\s*"(https?:[^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)) add(m[1]);
    for (const m of body.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) add(m[1]);
  }

  // 4. Hero background-image: url(...) in inline styles or <style>.
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) add(m[2]);

  // 5. Content <img> / <source srcset> in document order (skips logos/icons via filter).
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*?(?:src|srcset|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi)) {
    add(m[1].split(',')[0].trim().split(/\s+/)[0]); // srcset → first URL
  }
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
      // Social crawler UA — many sites only serve og:image to crawlers.
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return null;
    return { html: await res.text(), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ imageUrl: null });

  // Try the given page (often a specific trip/cruise page with a fitting hero),
  // then fall back to the site root if nothing usable was found.
  const targets: string[] = [];
  try {
    const u = new URL(url);
    targets.push(u.href);
    if (u.pathname !== '/' && u.pathname !== '') targets.push(u.origin + '/');
  } catch {
    return NextResponse.json({ imageUrl: null });
  }

  const LIMIT = 6;
  const images: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (images.length >= LIMIT) break;
    const page = await fetchHtml(target);
    if (!page) continue;
    extractImages(page.html, page.finalUrl, images, seen, LIMIT);
  }

  return NextResponse.json(
    { images, imageUrl: images[0] ?? null },
    // Short browser cache (so UI changes propagate fast) with long stale-while-revalidate.
    { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=604800' } },
  );
}
