// ---------------------------------------------------------------------------
// Grassy Flats Resort & Beach Club, Grassy Key (Marathon, Florida Keys, USA) - oceanfront boutique resort
// with three buildings and its own kiteboarding school (owner Matt Sexton, a former pro kiteboarder): cable
// park training, kite flying, jet-ski-supported open-water lessons on the shallow flat in front, guided
// downwinders; season November to April.
//
// Data path (checked 2026-10-12): Wix site www.grassyflats.com, English.
//   content  / (welcome text; the Wix site settings JSON in the page carries the owner-set business location
//            "businessLocationCoordinates":{24.7599446,-80.9537531} -> spotCoords),
//            /accommodations (room cards: <h2> "Wreckers House STANDARD ROOMS" + <p> lines incl. "Available
//            for guests ages 21+ only." / "2 night minimum stay."), /kiteboarding-lessons-florida-keys
//            (three-step system: <h3> step + <p> "$249 · 1–2 people" price line, conditions).
//   slots    none. The site prints no room rates (only an approximate "closer to $200 depending on the time
//            of year" on an editorial page, not a rate); "Book Now" goes to the Mews distributor
//            app.mews.com/distributor/cdd8d0fc-5019-499a-9c96-b34501702673, and app.mews.com +
//            api.mews.com robots.txt disallow everything for us (2026-10-12) -> fetchSlots returns [].
// robots.txt (2026-10-12): www.grassyflats.com Wix default ("Allow: /", only ?lightbox= disallowed).
// Requests per run: content 3, slots 0.
// Known limits: no prices, no availability (confidence 'low'). Lesson prices are content.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.grassyflats.com';
export const GF_HOME_URL = `${SITE}/`;
export const GF_ROOMS_URL = `${SITE}/accommodations`;
export const GF_KITE_URL = `${SITE}/kiteboarding-lessons-florida-keys`;
const BOOKING_URL = 'https://app.mews.com/distributor/cdd8d0fc-5019-499a-9c96-b34501702673';

export interface GfRoom { name: string; lines: string[] }
export interface GfLesson { name: string; price: string }

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

/** Tagged text blocks (Wix rich text: h1-h6, p, li), zero-width spaces dropped. */
function tagged(html: string): Array<{ tag: string; text: string }> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const out: Array<{ tag: string; text: string }> = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
    const t = collapse(el.text.replace(/[​﻿]/g, ''));
    if (t && out[out.length - 1]?.text !== t) out.push({ tag: el.tagName.toLowerCase(), text: t });
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
/** /accommodations room cards: <h2> "<Building> House <TYPE>" + following <p> lines. */
export function parseGfRooms(html: string): GfRoom[] {
  const out: GfRoom[] = [];
  let cur: GfRoom | null = null;
  for (const b of tagged(html)) {
    const m = b.tag === 'h2' ? b.text.match(/^(\w+ House)\s+([A-Z][A-Z ]+)$/) : null;
    if (m) { cur = { name: `${m[1]} ${titleCase(m[2])}`, lines: [] }; out.push(cur); continue; }
    if (/^h\d$/.test(b.tag)) { cur = null; continue; }
    if (cur && b.tag === 'p') cur.lines.push(b.text);
  }
  return out;
}

/** Lesson steps: an <h3> followed directly by a "$..." price line. */
export function parseGfLessons(html: string): GfLesson[] {
  const tb = tagged(html);
  const out: GfLesson[] = [];
  tb.forEach((b, i) => {
    const next = tb[i + 1];
    if (b.tag === 'h3' && next?.tag === 'p' && /^\$\d/.test(next.text)) out.push({ name: b.text.replace(/\s*[—–]\s*/g, ' - '), price: next.text.replace(/–/g, '-') });
  });
  return out;
}

/** Business location the site owner set in Wix ("businessLocationCoordinates" in the page's site settings JSON). */
export function parseGfGeo(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"businessLocationCoordinates":\{"latitude":(-?\d+\.\d+),"longitude":(-?\d+\.\d+)\}/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Wix photos: one per media id (the og:image "%7E" and the upscaled "~" variants are the same file). */
function gfPhotos(htmls: Array<[string, string]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [html, base] of htmls) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/^https:\/\/static\.wixstatic\.com\/media\//.test(u) || /\.png|\.svg|\.gif/i.test(u)) continue;
      const id = decodeURIComponent(u).match(/\/media\/([^/?]+)/)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id); out.push(`https://static.wixstatic.com/media/${id}`); // the original upload
    }
  }
  return out;
}

export interface GfPages { home: string; rooms: string; kite: string }

export function parseGrassyFlatsContent(p: GfPages): OfferContent {
  const home = tagged(p.home).map(b => b.text);
  const kite = tagged(p.kite).map(b => b.text);
  const rooms = parseGfRooms(p.rooms);
  const lessons = parseGfLessons(p.kite);
  const geo = parseGfGeo(p.home);
  const welcome = home.find(b => /family-owned, eco-friendly boutique resort/i.test(b)) ?? '';
  const intro = tagged(p.rooms).map(b => b.text).find(b => /three buildings and seven room types/i.test(b)) ?? '';
  const conditions = kite.find(b => /knots of clean wind/i.test(b)) ?? '';
  const founder = kite.find(b => /^Matt Sexton built Grassy Flats/i.test(b)) ?? '';
  const progression = kite.find(b => /You start on the cable/i.test(b)) ?? '';
  const open = lessons.find(l => /^Kiteboarding Lessons$/i.test(l.name))?.price.match(/\$(\d+)\/hr\s*·\s*1\s*·\s*\$(\d+)\/hr\s*·\s*2/) ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.lines.filter(l => !/^Available for guests ages|night minimum stay/i.test(l)).join(' ') || null,
    features: r.lines.filter(l => /^Available for guests ages|night minimum stay/i.test(l)).map(l => l.replace(/\.$/, '')),
  }));

  const summary = [
    'Grassy Flats Resort & Beach Club is a family-owned, eco-friendly oceanfront boutique resort on Grassy Key in Marathon, in the Middle Florida Keys (USA), with three buildings, ocean views from every room, two pools (one adults-only with hot tub), a sauna and on-site dining.',
    'Its kiteboarding school, built by former professional kiteboarder Matt Sexton, teaches in three steps - cable park board skills, kite flying, then jet-ski-supported open-water lessons on the shallow flat in front of the resort - and runs guided downwinders to Coco Plum or Curry Hammock.',
    `The wind season runs from November to April with mostly 15-20 knots from the north and east${open ? `; open-water lessons cost USD ${open[1]} per hour for one rider and USD ${open[2]} for two` : ''}; Wreckers House and Humidor House rooms are for guests aged 21+, the Conch House suites suit families.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Grassy Flats Resort & Beach Club',
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Florida Keys',
    spot: 'Grassy Key, Marathon',
    ...(geo ? { spotCoords: geo } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // kite page: sections "Beginners, no board experience" / "Intermediate riders" / "Advanced & freestylers" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: lessons.length > 0,
    equipmentRental: null, // gear is available through the resort, the site lists no rental prices
    beginnerFriendly: /designed for you specifically/i.test(kite.join(' ')) ? true : null,
    includedServices: ['Wi-Fi', 'Parking', 'Pools and hot tub', 'Sauna', 'Direct beach access'],
    optionalServices: [
      ...lessons.map(l => `${l.name}: ${l.price}`),
      'Kite launch day pass for riders with own gear',
      'eFoil lessons and rentals, sailing, paddleboarding',
      'Cable park and aqua park at The Lagoon',
      'Backcountry kiteboarding charters',
      'Restaurants and bars on site',
    ],
    accommodation: 'oceanfront resort rooms and suites in three buildings',
    mealPlan: null,
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: gfPhotos([[p.rooms, GF_ROOMS_URL], [p.kite, GF_KITE_URL], [p.home, GF_HOME_URL]]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: GF_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${welcome}`,
      `rooms: ${intro} || ${rooms.map(r => `${r.name}: ${r.lines.join(' ')}`).join(' || ')}`,
      `kite school: ${[founder, progression, conditions].filter(Boolean).join(' | ')}`,
      `lessons: ${lessons.map(l => `${l.name} ${l.price}`).join('; ')}`,
      `geo: ${geo ? `${geo.lat},${geo.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const grassyFlatsResortMarathon: OfferAdapter = {
  key: 'grassy-flats-resort-marathon',
  name: 'Grassy Flats Resort Marathon',
  kind: 'accommodation',
  operator: {
    name: 'Grassy Flats Resort & Beach Club',
    websiteUrl: SITE,
    rootDomain: 'grassyflats.com',
    contactEmail: 'reservations@grassyflats.com',
    phone: '+13059984590',
  },
  url: GF_KITE_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(GF_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(GF_ROOMS_URL, { accept: 'text/html' });
    const kite = await fetchText(GF_KITE_URL, { accept: 'text/html' });
    return parseGrassyFlatsContent({ home, rooms, kite });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no slot source: the site prints no room rates and robots.txt of app.mews.com / api.mews.com (the Mews booking engine) disallows everything (checked 2026-10-12)');
    return [];
  },
};
