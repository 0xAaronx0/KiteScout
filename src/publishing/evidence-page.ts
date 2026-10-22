// ---------------------------------------------------------------------------
// One operator page fetched at verification time, reduced to searchable text zones.
// Fetching goes through src/offers/http.ts: honest KiteScoutBot UA, robots.txt checked before every
// request, per-host throttle, and a host refusal (403 / captcha) is never bypassed. No browser UA
// fallback here (unlike image downloads): evidence must come from a page the operator lets us read.
// ---------------------------------------------------------------------------
import { HTMLElement, parse } from 'node-html-parser';
import { fetchText, BlockedByHost, HttpStatusError, RobotsDisallowed } from '../offers/http.js';
import { sha256 } from './catalog-values.js';

export type Zone = 'visible' | 'meta' | 'jsonld';

export interface EvidencePage {
  url: string;
  fetchedAt: string;
  ok: true;
  htmlSha256: string;
  textSha256: string;
  zones: Record<Zone, string>;
  /** hostnames of absolute links on the page (a homepage linking to the offer page's site) */
  linkHosts: string[];
}
export interface FailedPage { url: string; fetchedAt: string; ok: false; error: string; kind: 'robots' | 'blocked' | 'http' | 'network' }

const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', euro: '€', pound: '£', yen: '¥', cent: '¢',
  ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', laquo: '"', raquo: '"',
  middot: '·', deg: '°', times: 'x', shy: '', zwnj: '', zwj: '',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    const lower = e.toLowerCase();
    if (lower in NAMED) return NAMED[lower];
    // accented letters: &eacute; &atilde; &ccedil; ...
    const acc = lower.match(/^([a-z])(acute|grave|circ|tilde|uml|cedil|ring|slash)$/);
    if (acc) return (acc[1] + { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', cedil: '̧', ring: '̊', slash: '' }[acc[2]]!).normalize('NFC');
    return ' ';
  });
}

const squash = (s: string): string => s.replace(/[\s   ]+/g, ' ').trim();

/**
 * The page without elements carrying the `hidden` attribute (and their subtree): the browser does not
 * render them. Every UCPA product page ships its "Ce séjour n'est plus proposé à la vente" / "complet"
 * states this way (AMP, revealed by amp-bind only in that state), and the judge read them as current.
 * Any value hides, `hidden="false"` too (Elementor writes it). Kept on purpose:
 * - role="tabpanel": an inactive tab, real offer content one click away on the same page;
 * - hidden="until-found": collapsed content the browser's find-in-page reveals;
 * - id="S:<n>": a React streaming segment (Next.js), moved into the page by an inline $RC script on
 *   load; kitesurfingcolombia.co ships its whole page body in one;
 * - aria-hidden="true": rendered for sighted readers, only left out of the accessibility tree;
 * - inline display:none: we never run the page's scripts, and sliders / tooltips start out that way.
 * Elements are cut by their source range, so everything around them stays byte-identical.
 */
export function withoutHidden(html: string): string {
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } });
  const cuts: Array<readonly [number, number]> = [];
  const stack: HTMLElement[] = [root];
  const shown = (el: HTMLElement): boolean => el.getAttribute('hidden')?.toLowerCase() === 'until-found'
    || el.getAttribute('role')?.toLowerCase() === 'tabpanel' || /^S:[0-9a-f]+$/i.test(el.getAttribute('id') ?? '');
  while (stack.length) {
    for (const node of stack.pop()!.childNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.getAttribute('hidden') !== undefined && !shown(node)) cuts.push(node.range);
      else stack.push(node);
    }
  }
  let out = '';
  let at = 0;
  for (const [start, end] of cuts.sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    out += `${html.slice(at, start)} `;
    at = end;
  }
  return out + html.slice(at);
}

export function pageZones(html: string): Record<Zone, string> {
  const meta: string[] = [];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) meta.push(title);
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? '';
    if (!/^(description|og:title|og:description|og:site_name|twitter:title|twitter:description)$/.test(key)) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (content) meta.push(content);
  }
  const jsonld = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1]);
  const visible = withoutHidden(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|tr|td|th|h[1-6]|section|article|header|footer|option)\b[^>]*>/gi, ' \n ')
    .replace(/<[^>]+>/g, ' ');
  return {
    visible: squash(decodeEntities(visible)),
    meta: squash(decodeEntities(meta.join(' | '))),
    jsonld: squash(decodeEntities(jsonld.join(' ').replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))))),
  };
}

export async function fetchEvidencePage(url: string): Promise<EvidencePage | FailedPage> {
  try {
    const html = await fetchText(url, { timeoutMs: 30000 });
    const fetchedAt = new Date().toISOString();
    const zones = pageZones(html);
    const linkHosts = [...new Set([...html.matchAll(/\bhref\s*=\s*["']https?:\/\/([^/"'?#:]+)/gi)].map(m => m[1].toLowerCase()))];
    return { url, fetchedAt, ok: true, htmlSha256: sha256(html), textSha256: sha256(`${zones.meta}\n${zones.visible}\n${zones.jsonld}`), zones, linkHosts };
  } catch (e) {
    const fetchedAt = new Date().toISOString();
    const kind = e instanceof RobotsDisallowed ? 'robots' : e instanceof BlockedByHost ? 'blocked' : e instanceof HttpStatusError ? 'http' : 'network';
    return { url, fetchedAt, ok: false, error: (e as Error).message, kind };
  }
}
