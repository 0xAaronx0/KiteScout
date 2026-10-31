// ---------------------------------------------------------------------------
// Hotel Todo Bien, El Sargento (La Ventana bay, Baja California Sur, Mexico) - oceanfront boutique hotel with
// 10 rooms, 2 suites and 2 private villas, restaurant and bar, heated pool and hot tub. Kite link (Aaron's
// call 2026-10-14, described as the site states it): kiting and wing foiling in the bay in front of the
// hotel, an easy beach launch and beachfront gear storage; no school on site and no named school - the hotel
// connects guests with local instructors on request.
//
// Data path (checked 2026-10-14): Duda site www.hoteltodobien.com.
//   content  / (intro: "kite-board or wing-foil across the bay", "beachfront gear storage"), /rooms (12 units:
//            <h2> name + <p> text), /villas (2 villas: configuration, beds, max guests, minimum 6 nights),
//            /activities ("Wind": beach launch, lessons via trusted local instructors, season Nov-Apr).
//   coordinates  every page links the hotel's Google Maps place maps.app.goo.gl/y7zMewr65m2bzooo7; resolved
//            once by hand on 2026-10-14 to the place pin 24.0674522,-109.9895713 (constant below, used only
//            while the page still links that same place). Cloudbeds' JSON-LD geo (24.0517807,-109.98918152)
//            sits in La Ventana town, not at the hotel, so it is not used.
//   slots    none. The site prints no rates; "Book Now" goes to Cloudbeds (hotels.cloudbeds.com/reservation/
//            5r6IWY, robots-allowed, HTTP 200), but the engine's data calls (/booking/*, e.g. POST
//            /booking/availability_calendar for property 170736) answer HTTP 403 to our UA (checked once
//            2026-10-14, as at Keros Blue) -> not used. fetchSlots returns [] ("price on request").
// robots.txt (2026-10-14): www.hoteltodobien.com has no Disallow ("User-agent: *" + Content-Signal only).
// Requests per run: content 4, slots 0.
// Room photos: the Duda gallery after each unit's <h2> on /rooms and /villas (6 to 26 per unit); a file naming another,
//   different room type ("Room 3 Bathroom" in Room 1) is left out. Spot photos: only the hotel's own wind series and
//   camera files of the /activities "Wind" gallery (not its TYPO3 thumbnail, brand action shot or edited picture).
// Known limits: no prices, no availability (confidence low). The 2026 footer ("© 2026") and the 2026
//   Instagram recaps are the liveness evidence.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.hoteltodobien.com';
export const TB_HOME_URL = `${SITE}/`;
export const TB_ROOMS_URL = `${SITE}/rooms`;
export const TB_VILLAS_URL = `${SITE}/villas`;
export const TB_ACTIVITIES_URL = `${SITE}/activities`;
const BOOKING_URL = 'https://hotels.cloudbeds.com/reservation/5r6IWY';
/** The hotel's own Google Maps place link and the pin it resolved to (2026-10-14). */
export const TB_MAPS_LINK = 'https://maps.app.goo.gl/y7zMewr65m2bzooo7';
const TB_PIN = { lat: 24.0674522, lng: -109.9895713 };

// --- local helpers ----------------------------------------------------------------
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '').replace(/﻿/g, '').trim();

/** h2 / p blocks in document order, without scripts, galleries' "Button" captions and the footer. */
export function blocks(html: string): Array<{ tag: string; text: string }> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  const out: Array<{ tag: string; text: string }> = [];
  for (const el of root.querySelectorAll('h1, h2, h3, p')) {
    const t = txt(el);
    if (!t || t === 'Button') continue;
    if (el.tagName === 'P' && t === 'LOCATION') break; // footer starts here
    out.push({ tag: el.tagName.toLowerCase(), text: t });
  }
  return out;
}

export interface TbUnit { name: string; text: string; facts: string[] }
const UNIT_RE = /^(?:.*Suite|Room \d+\b.*|Villa\b.*)$/;

/** Units on /rooms and /villas: a heading "Casita Suite" / "Room 9 - Pool Front & Oceanview" (+ "2 Queens") / "Villa Cortez". */
export function parseTbUnits(html: string): TbUnit[] {
  const out: TbUnit[] = [];
  let cur: TbUnit | null = null;
  let lastWasHeading = false;
  for (const b of blocks(html)) {
    if (b.tag === 'h2' && UNIT_RE.test(b.text)) { cur = { name: b.text, text: '', facts: [] }; out.push(cur); lastWasHeading = true; continue; }
    if (b.tag === 'h2' && cur && lastWasHeading) { cur.name = `${cur.name} ${b.text}`.replace(/\s+/g, ' '); continue; }
    lastWasHeading = false;
    if (b.tag !== 'p' || !cur) continue;
    if (/^(Configuration|Bed Setup|Max Occupancy|Minimum Stay):/i.test(b.text)) cur.facts.push(b.text);
    else cur.text = `${cur.text} ${b.text}`.trim();
  }
  return out;
}

/** "Wind" section of /activities. */
export function parseTbWind(html: string): string {
  const bs = blocks(html);
  const i = bs.findIndex(b => b.tag === 'h2' && /^Wind$/i.test(b.text));
  if (i < 0) return '';
  const out: string[] = [];
  for (const b of bs.slice(i + 1)) { if (b.tag === 'h2') break; out.push(b.text); }
  return out.join(' ');
}

// --- photos ---------------------------------------------------------------------
const TB_JUNK_RE = /logo|icon|\.svg|instagram|cdninstagram|fbcdn|\/Background[-.]/i;
/** one key per photo: Duda serves size variants under /opt/ with a "-1920w" suffix */
const tbKey = (u: string): string => u.replace(/\/opt\//, '/').replace(/-\d+w(?=\.[a-z]+$)/i, '');

/** image URLs of an HTML fragment by the gallery rule (imageCandidates, junk dropped, one URL per photo) */
function tbImages(html: string, url: string, max = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of imageCandidates(html, url, null, max)) {
    if (TB_JUNK_RE.test(u)) continue;
    const k = tbKey(u);
    if (seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}

type TbToken = { kind: 'h1' | 'h2' | 'p'; text: string } | { kind: 'img'; html: string };
/** h1 / h2 / p / img in document order (scripts dropped), up to the footer ("LOCATION"), as blocks() reads them. */
function tbTokens(html: string): TbToken[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  const out: TbToken[] = [];
  let done = false;
  const walk = (n: HTMLElement): void => {
    for (const ch of n.childNodes) {
      if (done) return;
      if (ch.nodeType !== 1) continue;
      const el = ch as HTMLElement;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'img') { out.push({ kind: 'img', html: el.outerHTML }); continue; }
      if (tag === 'h1' || tag === 'h2' || tag === 'p') {
        const t = txt(el);
        if (tag === 'p' && t === 'LOCATION') { done = true; return; }
        if (t && t !== 'Button') out.push({ kind: tag, text: t });
      }
      walk(el);
    }
  };
  walk(root);
  return out;
}

const roomNo = (name: string): number | null => { const m = name.match(/^Room (\d+)\b/); return m ? Number(m[1]) : null; };
const roomKind = (name: string): string => name.replace(/^Room \d+\s*-\s*/, '').toLowerCase();

/**
 * Per unit heading (same order and test as parseTbUnits) the photos of its gallery, until the next heading. In a
 * "Room N" gallery a file naming another room is kept only for a room of the same kind (Room 9 / Room 10 share one).
 */
export function parseTbUnitPhotos(html: string, url: string): string[][] {
  const units = parseTbUnits(html);
  const out: string[][] = [];
  let cur: string[] | null = null;
  let lastWasHeading = false;
  for (const t of tbTokens(html)) {
    if (t.kind === 'h2' && UNIT_RE.test(t.text)) { cur = []; out.push(cur); lastWasHeading = true; continue; }
    if (t.kind === 'h2' && cur && lastWasHeading) continue; // "2 Queens" under "Room 9 - Pool Front & Oceanview"
    if (t.kind !== 'img') {
      lastWasHeading = false;
      if (t.kind !== 'p') cur = null; // any other heading ends the unit's gallery
      continue;
    }
    if (!cur) continue;
    const own = units[out.length - 1];
    const n = own ? roomNo(own.name) : null;
    for (const u of tbImages(t.html, url)) {
      const named = decodeURIComponent(u.split('/').pop() ?? '').match(/\bRoom[+\s_-]*(\d+)/i);
      if (n !== null && named && Number(named[1]) !== n) {
        const other = units.find(x => roomNo(x.name) === Number(named[1]));
        if (!other || roomKind(other.name) !== roomKind(own!.name)) continue;
      }
      if (!cur.includes(u)) cur.push(u);
    }
  }
  return out.length === units.length ? out : units.map(() => []);
}

/** /activities "Wind" gallery: the hotel's own "wind-N" series and camera files (IMG_NNNN, UUID-named phone exports). */
export function parseTbWindPhotos(html: string): string[] {
  const out: string[] = [];
  let inWind = false;
  for (const t of tbTokens(html)) {
    if (t.kind === 'h1' || t.kind === 'h2') { inWind = t.kind === 'h2' && /^Wind$/i.test(t.text); continue; }
    if (t.kind !== 'img' || !inWind) continue;
    for (const u of tbImages(t.html, TB_ACTIVITIES_URL)) {
      const file = decodeURIComponent(u.split('/').pop() ?? '');
      if (/^(?:wind-\d+|IMG_\d+(?!\d|-scaled)|[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-)/i.test(file) && !out.includes(u)) out.push(u);
    }
  }
  return out;
}

export interface TbPages { home: string; rooms: string; villas: string; activities: string }

export function parseTbContent(p: TbPages): OfferContent {
  const homeText = blocks(p.home).filter(b => b.tag === 'p').map(b => b.text).join(' ');
  const wind = parseTbWind(p.activities);
  const rooms = parseTbUnits(p.rooms);
  const villas = parseTbUnits(p.villas);
  const gearStorage = /beachfront gear storage/i.test(homeText);
  const kiting = /kite-?board|kiting/i.test(`${homeText} ${wind}`);
  const localInstructors = /connect you with trusted local instructors/i.test(wind);
  const season = wind.match(/primary wind season runs (\w+) through (\w+)/i);
  const pin = [p.home, p.rooms].some(h => h.includes(TB_MAPS_LINK)) ? TB_PIN : null;
  const nRooms = rooms.filter(r => /^Room \d+/.test(r.name)).length;
  const nSuites = rooms.filter(r => /Suite/.test(r.name)).length;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const byKey = new Map<string, string>();
  for (const [html, url] of [[p.rooms, TB_ROOMS_URL], [p.home, TB_HOME_URL], [p.villas, TB_VILLAS_URL], [p.activities, TB_ACTIVITIES_URL]] as const) {
    for (const u of imageCandidates(html, url, null, 40)) {
      if (TB_JUNK_RE.test(u)) continue;
      const k = tbKey(u);
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u); byKey.set(k, u);
    }
  }
  /** the general list's URL for a photo when it holds one (so the curation matches the same variant) */
  const same = (urls: string[]): string[] => urls.map(u => byKey.get(tbKey(u)) ?? u);

  const unitPhotos = [...parseTbUnitPhotos(p.rooms, TB_ROOMS_URL), ...parseTbUnitPhotos(p.villas, TB_VILLAS_URL)];
  const contentRooms: ContentRoom[] = [...rooms, ...villas].map((u, i) => {
    const photos = same(unitPhotos[i] ?? []);
    return {
      name: u.name,
      description: u.text || null,
      features: u.facts,
      ...(photos.length ? { imageUrls: photos } : {}),
    };
  });
  const spotImageUrls = same(parseTbWindPhotos(p.activities));

  const summary = [
    `Hotel Todo Bien is an oceanfront boutique hotel on La Ventana bay near El Sargento, Baja California Sur, with ${nRooms || 10} rooms, ${nSuites || 2} suites and ${villas.length || 2} private villas, a restaurant and bar, a heated pool and hot tub, a fire pit and a yoga deck.`,
    `${kiting ? 'Guests kite and wing foil in the bay in front of the hotel' : 'The bay in front of the hotel is used for wind sports'}${gearStorage ? ', with an easy beach launch and beachfront gear storage' : ''}; there is no kite school on site${localInstructors ? ', and the hotel connects guests with local instructors when asked before the stay' : ''}.`,
    `${season ? `The main wind season runs ${season[1]} to ${season[2]}; ` : ''}room rates are not published on the site (price on request or via the hotel's online booking).`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hotel Todo Bien',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'El Sargento, Baja California Sur',
    spot: 'El Sargento',
    ...(pin ? { spotCoords: pin } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // the activities page says the bay suits beginners as well as intermediate and expert riders
    skillLevels: /great for beginners/i.test(wind) && /intermediate and expert/i.test(wind) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: null,      // no school on site; lessons only through local instructors the hotel recommends
    equipmentRental: null,  // not offered by the hotel
    beginnerFriendly: null,
    includedServices: [
      ...(gearStorage ? ['Beachfront gear storage'] : []),
      'Paddle boards, kayaks and snorkel gear',
      'Heated pool and hot tub',
      'Yoga mat and blocks in every room',
    ],
    optionalServices: [
      ...(localInstructors ? ['Kite and wing lessons with local instructors (arranged by the hotel, book about two weeks ahead)'] : []),
      'Restaurant and bar, room service',
      'Boat trips with local panga captains (whales, fishing, snorkeling)',
      'E-foil rental and boat towing',
      'Massage',
    ],
    accommodation: 'oceanfront boutique hotel rooms, suites and private villas',
    mealPlan: null,
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    ...(spotImageUrls.length ? { spotImageUrls } : {}),
    heroVideoUrl: null,
    sourceUrl: TB_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${homeText}`,
      `wind: ${wind}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.text}`).join(' | ')}`,
      `villas: ${villas.map(r => `${r.name}: ${r.text} ${r.facts.join('; ')}`).join(' | ')}`,
      `maps link: ${pin ? `${TB_MAPS_LINK} -> ${TB_PIN.lat},${TB_PIN.lng}` : 'not found'}`,
    ].join('\n'),
  };
}

export const hotelTodoBienElSargento: OfferAdapter = {
  key: 'hotel-todo-bien-el-sargento',
  name: 'Hotel Todo Bien, El Sargento',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Hotel Todo Bien',
    websiteUrl: SITE,
    rootDomain: 'hoteltodobien.com',
    contactEmail: 'manager@hoteltodobien.com',
    phone: '+52 612 111 4520',
  },
  url: TB_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const [home, rooms, villas, activities] = [
      await fetchText(TB_HOME_URL, { accept: 'text/html' }),
      await fetchText(TB_ROOMS_URL, { accept: 'text/html' }),
      await fetchText(TB_VILLAS_URL, { accept: 'text/html' }),
      await fetchText(TB_ACTIVITIES_URL, { accept: 'text/html' }),
    ];
    const c = parseTbContent({ home, rooms, villas, activities });
    if (c.rooms.length === 0) throw new Error('hotel-todo-bien: no room headings on /rooms (layout changed?)');
    return c;
  },
  async fetchSlots(): Promise<Slot[]> {
    return []; // no published rates; Cloudbeds data calls answer 403 (see header)
  },
};
