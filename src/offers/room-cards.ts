// ---------------------------------------------------------------------------
// Room photos from room cards (Aaron 2026-11-02: "alle anderen Accommodations dementsprechend bearbeiten"): many stay
// pages show each room as a card - its name as a heading, its pictures around it. roomCardImages finds the heading
// that names the room and takes the pictures of the closest enclosing block, but only when that block names no other
// room (a shared block would hand one room the others' photos). Adapters call it with the page they already fetched.
// ---------------------------------------------------------------------------
import { upscaleCdnUrl } from '../lib/images.js';
import { fetchText } from './http.js';
import { imageCandidates, parse, type HTMLElement } from './parse.js';
import type { OfferContent } from './types.js';

const plain = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const NOT_A_PHOTO = /logo|icon|favicon|sprite|placeholder|flag|\.svg(?:$|\?)|\.gif(?:$|\?)|\/[a-z]{2}\.png(?:$|\?)/i;
/** how far up from the heading a card may reach before it stops being this room's card */
const MAX_LEVELS = 5;

function largestFromSrcset(srcset: string): string | null {
  let best: { url: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    const w = parseInt(size ?? '', 10) || 0;
    if (url && (!best || w > best.w)) best = { url, w };
  }
  return best?.url ?? null;
}

function picturesIn(el: HTMLElement, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const img of el.querySelectorAll('img')) {
    const srcset = img.getAttribute('data-srcset') || img.getAttribute('srcset');
    const raw = (srcset && largestFromSrcset(srcset)) || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src');
    if (!raw || raw.startsWith('data:') || NOT_A_PHOTO.test(raw)) continue;
    // CDN thumbnails (WordPress -WxH, Wix fill, Photon ?w=) -> the original, as the gallery does
    try { urls.push(upscaleCdnUrl(new URL(raw, baseUrl).href)); } catch { /* not a URL */ }
  }
  return [...new Set(urls)];
}

/** room name -> pictures of its own card on `html`, in page order; rooms without an unshared card are absent */
export function roomCardImages(html: string, baseUrl: string, roomNames: string[]): Map<string, string[]> {
  const root = parse(html);
  const names = roomNames.map(plain);
  const headings = root.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,a,p,span,div,li');
  const out = new Map<string, string[]>();
  roomNames.forEach((roomName, i) => {
    const n = names[i];
    if (!n) return;
    const others = names.filter((o, j) => j !== i && o && !n.includes(o));
    const hits = headings.filter(e => { const t = plain(e.text); return t === n || (t.includes(n) && t.length < n.length + 25); });
    for (const h of hits.slice(0, 3)) {
      let el: HTMLElement | null = h;
      for (let level = 0; level < MAX_LEVELS && el; level++, el = el.parentNode as HTMLElement | null) {
        const pics = picturesIn(el, baseUrl);
        if (!pics.length) continue;
        const text = plain(el.text);
        if (!others.some(o => text.includes(o))) out.set(roomName, pics);
        break;
      }
      if (out.has(roomName)) break;
    }
  });
  return out;
}

/**
 * Stays whose provider pages show each room on its own, reviewed picture by picture on contact sheets (2026-11-02).
 * Read only for --room-photos, so the daily ingest makes no extra request; the stored photos are carried over by room
 * name.
 *   (default)  the source page shows each room as a card
 *   pages      [room, path]: the room has its own page (a card for it on that page, else the page's pictures)
 *   cards      false: only the pages, the source page has no room cards
 *   skip       rooms whose card shows something else (a view from another house)
 */
interface RoomCardPage { skip?: RegExp; pages?: Array<[room: RegExp, path: string]>; cards?: false }

export const ROOM_CARD_PAGES: Record<string, RoomCardPage> = {
  '35-knots-macapa': {},
  'antony-boy-viganj': { cards: false, pages: [[/^veezia mobile home/i, '/antony-boy-mobile-homes/']] },
  'baja-joes-la-ventana': {},
  'costa-kite-bahia-salinas': {},
  'escape-pousada-barra-nova': {},
  'hatteras-island-vacation-rentals-avon': {
    cards: false,
    pages: [[/^seas the breeze i$/i, '/seas-the-breeze-i-orp5b5e665x'], [/^seas the breeze ii$/i, '/seas-the-breeze-ii-orp5b5e666x'], [/^sounds sea.?rious/i, '/sounds-searious-orp5b66becx']],
  },
  'habagat-aissatou-boracay': {},
  'hotel-100-fun-valdevaqueros': {},
  'hotel-puclaro-gualliguaica': {},
  'keros-blue-limnos': {},
  'kite-buen-hombre-eco-lodge': { skip: /^the palace$/i },
  'kite-lodge-brazil-prea': {},
  'kitesurf-mindoro-bulalacao': {},
  'kitesurf-tofo': {},
  'kitesurfing-guimaras-san-lorenzo': {},
  'kokohau-bungalows-santa-veronica': {},
  'lion-hostel-tarifa': {},
  'new-spirit-dakhla': {},
  'pousada-pais-tropical-icarai': {},
  'studios-vrettos-plaka': {},
  'surfescape-lajares': {},
  'white-wind-resort-guajiru': {},
  'windchaser-villas-long-bay': {},
};

/** the content with card / room-page pictures on the rooms that bring none of their own; a page that fails is passed over */
export async function withCardRoomPhotos(key: string, c: OfferContent, fetchPage: (url: string) => Promise<string> = fetchText): Promise<OfferContent> {
  const page = ROOM_CARD_PAGES[key];
  if (!page) return c;
  const names = c.rooms.map(r => r.name);
  const pics = new Map<string, string[]>();
  if (page.cards !== false) {
    const html = await fetchPage(c.sourceUrl).catch(() => null);
    if (html) for (const [name, urls] of roomCardImages(html, c.sourceUrl, names)) pics.set(name, urls);
  }
  const subpages = new Map<string, string | null>();
  for (const name of names) {
    const path = page.pages?.find(([room]) => room.test(name))?.[1];
    if (!path) continue;
    const url = new URL(path, c.sourceUrl).href;
    if (!subpages.has(url)) subpages.set(url, await fetchPage(url).catch(() => null));
    const html = subpages.get(url);
    if (!html) continue;
    const own = roomCardImages(html, url, names).get(name) ?? imageCandidates(html, url, null, 12);
    if (own.length) pics.set(name, own);
  }
  return {
    ...c,
    rooms: c.rooms.map(r => {
      const p = pics.get(r.name);
      return r.imageUrls?.length || !p || page.skip?.test(r.name) ? r : { ...r, imageUrls: p };
    }),
  };
}
