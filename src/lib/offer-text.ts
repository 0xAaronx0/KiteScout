// ---------------------------------------------------------------------------
// Guards for user-facing offer fields (packages and cruises).
//
// Audit 2026-10-27 (docs/app-inventar-report-2026-10-27.md, sections 9 and 11): research notes written
// for us ("the page does not describe it", "no kite school named on the site") reached the product UI,
// and a YouTube watch page was stored as hero video (the app plays hero_video_url in a <video> tag).
// ---------------------------------------------------------------------------

/** Notes about our own sources ("the page does not say ...") - true for us, noise for a traveller. */
const INTERNAL_NOTE_RES: RegExp[] = [
  /\b(?:the\s+)?(?:\w+\s+)?(?:page|site|website|listing|source)s?\s+(?:does|do|did)\s*(?:not|n['’]t)\s+(?:say|state|describe|list|mention|name|show|give|print)\b/i,
  /\b(?:no|not)\b[^.;()]{0,60}\b(?:named|listed|stated|described|mentioned)\s+on\s+the\s+(?:site|page|website)\b/i,
  /\bmap pin\b[^.]*\bapproximate\b/i,
];

/** The first internal-note phrase in `text`, or null. */
export function internalNote(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const re of INTERNAL_NOTE_RES) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

const VIDEO_FILE = /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i;
const VIDEO_PAGE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|facebook\.com|instagram\.com|tiktok\.com)$/i;

/** A URL a <video> element can play: an http(s) video file, never a YouTube/Vimeo/social page. */
export function isPlayableVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (VIDEO_PAGE_HOSTS.test(u.hostname)) return false;
  return VIDEO_FILE.test(u.pathname);
}

/** En/em dashes -> plain hyphens in text we write (Aaron 2026-08-06: no dashes in anything user-visible). */
export function plainDashes<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  return text.replace(/\s+[–—]\s+/g, ' - ').replace(/[–—]/g, '-') as T;
}
