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

// Pull the best provider image out of a page's HTML, in priority order.
function extractImage(html: string, base: string): string | null {
  const pick = (re: RegExp): string | null => {
    const m = re.exec(html);
    const abs = m ? absolutize(m[1], base) : null;
    return abs && looksLikeImage(abs) ? abs : null;
  };

  // 1. Open Graph (the provider's chosen share image — usually a real hero).
  let img =
    pick(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i) ??
    pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (img) return img;

  // 2. Twitter card image.
  img =
    pick(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ??
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i);
  if (img) return img;

  // 3. itemprop / link rel=image_src.
  img =
    pick(/<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i) ??
    pick(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
  if (img) return img;

  // 4. JSON-LD "image": "...", or "image": ["..."], or "image": { "url": "..." }
  for (const block of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = block[1];
    const m =
      /"image"\s*:\s*"([^"]+)"/i.exec(body) ??
      /"image"\s*:\s*\[\s*"([^"]+)"/i.exec(body) ??
      /"image"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i.exec(body);
    const abs = m ? absolutize(m[1], base) : null;
    if (abs && looksLikeImage(abs)) return abs;
  }

  // 5. First sizeable hero background-image: url(...) in inline styles or <style>.
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) {
    const abs = absolutize(m[2], base);
    if (abs && looksLikeImage(abs)) return abs;
  }

  // 6. First content <img> / <source srcset> that isn't obviously a logo/icon.
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*?(?:src|srcset|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi)) {
    // srcset can be "url1 1x, url2 2x" — take the first URL.
    const first = m[1].split(',')[0].trim().split(/\s+/)[0];
    const abs = absolutize(first, base);
    if (abs && looksLikeImage(abs)) return abs;
  }

  return null;
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

  let imageUrl: string | null = null;
  for (const target of targets) {
    const page = await fetchHtml(target);
    if (!page) continue;
    imageUrl = extractImage(page.html, page.finalUrl);
    if (imageUrl) break;
  }

  return NextResponse.json(
    { imageUrl },
    { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } },
  );
}
