// ---------------------------------------------------------------------------
// Surfescape Fuerteventura, Lajares (Fuerteventura, Canary Islands, Spain) - surf, kite and coworking
// guesthouse (coliving) with apartments, double rooms, a studio and a villa around a pool and garden; on-site
// surf school and kite lessons for beginners and intermediates.
//
// Data path (checked 2026-10-12), Framer site, server-rendered:
//   content  /destinations/fuerteventura: room cards (<h5> name + "Description" paragraph), amenities, coworking
//            prices, JSON-LD Resort (address Lajares, geo 28.681183,-13.943622, amenityFeature incl. "Kite lessons")
//            and the Framer CMS handover data (<script type="framer/handover">) with the school items: kite lesson
//            and surf class prices and the surf & yoga camp as Framer rich text ([4,tag,attrs,...] / [5,text]).
//            / (home): "Early booker 10% off, summer 27 ... Fuerteventura May 2027" (2026/27 evidence) and
//            "Surf, yoga, kite for beginners and intermediate".
//   slots    none. The site prints no room prices; booking runs on Cloudbeds (hotels.cloudbeds.com/en/reservation/
//            iie28k), whose /booking/* data calls answer HTTP 403 to non-browser clients (seen on keros-blue-limnos,
//            flag-beach) - not called. The only stay prices on the page belong to the "8 days, 7 nights surf and
//            yoga camp" (EUR per person per week incl. surf lessons and meals), a surf package, so they are kept in
//            the optional services, not as room slots. fetchSlots returns [] ("price on request").
// robots.txt (2026-10-12): www.surfescape.com "Allow: /".
// Requests per run: content 2, slots 0.
// Known limits: where the kite lessons take place is not stated (the north shore is "a 5 minute drive").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, ldOfType, meta } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.surfescape.com';
export const SE_PAGE_URL = `${SITE}/destinations/fuerteventura`;
export const SE_HOME_URL = `${SITE}/`;
const BOOKING_URL = 'https://hotels.cloudbeds.com/en/reservation/iie28k?currency=eur';

// --- Framer helpers ---------------------------------------------------------------------------
/** The Framer CMS handover array (flat list of values; rich text bodies are JSON strings). */
export function framerHandover(html: string): unknown[] {
  const m = html.match(/<script type="framer\/handover" id="__framer__handoverData">([\s\S]*?)<\/script>/);
  if (!m) return [];
  try { const v = JSON.parse(m[1]); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Framer rich text "[1,[4,"p",{..},[5,"text"]],...]" -> one line per p / li / heading. */
export function framerRichTextLines(s: string): string[] {
  let tree: unknown;
  try { tree = JSON.parse(s); } catch { return []; }
  const lines: string[] = [];
  const text = (n: unknown): string => {
    if (!Array.isArray(n)) return '';
    if (n[0] === 5) return String(n[1] ?? '');
    if (n[0] === 4) return n.slice(3).map(text).join('');
    return n.slice(1).map(text).join('');
  };
  const walk = (n: unknown): void => {
    if (!Array.isArray(n)) return;
    if (n[0] === 4 && typeof n[1] === 'string' && /^(p|li|h\d)$/.test(n[1])) {
      // a <li> wraps a <p>: take the li text once
      const t = clean(text(n));
      if (t && !(n[1] === 'p' && lines.length && lines[lines.length - 1] === t)) lines.push(t);
      return;
    }
    for (const c of n.slice(n[0] === 4 ? 3 : 1)) walk(c);
  };
  walk(tree);
  return lines;
}

export interface SeSchoolItem { title: string; lines: string[] }

/** CMS school items: a short title string ("Beginner kite lessons in Fuerteventura.") followed by its rich text body. */
export function parseSeSchool(html: string): SeSchoolItem[] {
  const out: SeSchoolItem[] = [];
  let title: string | null = null;
  for (const v of framerHandover(html)) {
    if (typeof v !== 'string') continue;
    if (v.startsWith('[1,[4,')) {
      if (title && !v.includes('framer-text-module')) {
        const lines = framerRichTextLines(v);
        if (lines.length && !out.some(x => x.title === title)) out.push({ title, lines });
      }
      continue;
    }
    if (v.length < 90 && /\b(lessons?|classes|camp|pricing)\b/i.test(v) && /\.$/.test(v.trim())) title = clean(v);
  }
  return out;
}

/** "3 days: €395" lines of a school item. */
export function sePrices(lines: string[]): Array<{ label: string; amount: number }> {
  const out: Array<{ label: string; amount: number }> = [];
  for (const l of lines) {
    const m = l.match(/^(\d+ days?):\s*€\s?(\d[\d.,]*)$/i);
    if (m) out.push({ label: m[1], amount: Number(m[2].replace(/[.,](?=\d{3}$)/, '')) });
  }
  return out;
}

/** Room cards: <h5>name</h5> + the "Description" paragraph (each breakpoint renders them again: deduped). */
export function parseSeRooms(html: string): Array<{ name: string; description: string }> {
  const out: Array<{ name: string; description: string }> = [];
  const re = /<h5[^>]*>([\s\S]*?)<\/h5><\/div><div class="[^"]+" data-framer-name="Description"[^>]*><p[^>]*>([\s\S]*?)<\/p>/g;
  for (const m of html.matchAll(re)) {
    const name = clean(m[1].replace(/<[^>]+>/g, ' '));
    const description = clean(m[2].replace(/<[^>]+>/g, ' '));
    if (!name || /\bcamp\b/i.test(name) || out.some(r => r.name === name)) continue;
    out.push({ name, description });
  }
  return out;
}

/** Amenities shared by all rooms ("What you will find in all rooms." list). */
export function parseSeAmenities(html: string): string[] {
  const t = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').split(/<\/?(?:p|li|h\d|div)\b[^>]*>/i).map(s => clean(s.replace(/<[^>]+>/g, ' '))).filter(Boolean);
  const i = t.findIndex(l => /^Rooms and apartments prepared carefully/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of t.slice(i + 1)) {
    if (/^Book now$/i.test(l)) break;
    if (l.length < 40 && !out.includes(l)) out.push(l);
  }
  return out;
}

/** Original-size Framer images (query stripped), photos >= 1000 px wide only. */
export function seImages(html: string): string[] {
  const out: string[] = [];
  const og = meta(html, 'og:image');
  const cands = [og ?? '', ...[...html.matchAll(/https:\/\/framerusercontent\.com\/images\/[A-Za-z0-9]+\.(?:jpe?g|webp)(?:\?[^"'\s,)]*)?/g)].map(m => m[0])];
  for (const raw of cands) {
    const m = raw.match(/^(https:\/\/framerusercontent\.com\/images\/[A-Za-z0-9]+\.(?:jpe?g|webp))(?:\?(.*))?$/);
    if (!m) continue;
    const w = Number(new URLSearchParams((m[2] ?? '').replace(/&amp;/g, '&')).get('width') ?? 0);
    if (w && w < 1000) continue;
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export interface SePages { page: string; home: string }

export function parseSurfescapeContent(p: SePages): OfferContent {
  const resort = ldOfType(p.page, 'Resort')[0] ?? {};
  const geo = (resort.geo ?? {}) as Record<string, unknown>;
  const amenityLd = Array.isArray(resort.amenityFeature)
    ? (resort.amenityFeature as Array<Record<string, unknown>>).filter(a => a.value === true).map(a => String(a.name)) : [];
  const rooms = parseSeRooms(p.page);
  const amenities = parseSeAmenities(p.page);
  const school = parseSeSchool(p.page);
  const kiteBeg = school.find(x => /^Beginner kite/i.test(x.title));
  const kiteInt = school.find(x => /^Intermediate kite/i.test(x.title));
  const camp = school.find(x => /surf and yoga camp/i.test(x.title));
  const begPrices = kiteBeg ? sePrices(kiteBeg.lines) : [];
  const intPrices = kiteInt ? sePrices(kiteInt.lines) : [];
  const homeText = clean(p.home.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const earlyBooker = homeText.match(/Early booker 10% off,\s*summer 27\.?\s*"EARLY"\s*Fuerteventura\s*May 2027/i)?.[0] ?? null;
  const levels = homeText.match(/Surf, yoga, kite for beginners and intermediate/i)?.[0] ?? null;
  // FAQ answer "How far is the beach?" (CMS handover string)
  const beach = framerHandover(p.page).find((v): v is string => typeof v === 'string' && /The North shore is a \d+ minute drive/i.test(v)) ?? null;
  const beachMin = beach?.match(/North shore is a (\d+) minute drive and the West and East Coast are (\d+) minutes/i) ?? null;
  const fmt = (xs: Array<{ label: string; amount: number }>) => xs.map(x => `${x.label} EUR ${x.amount}`).join(', ');

  const contentRooms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: r.description, features: amenities }));

  const summary = [
    'Surfescape Fuerteventura is a surf, kite and coworking guesthouse in the surf village of Lajares in the north of Fuerteventura (Canary Islands), with apartments, double rooms, a studio and a two-bedroom villa around a pool and garden, plus a coworking space and the Secret Garden restaurant.',
    `It runs an on-site surf school and kite lessons for beginners and intermediates${begPrices.length ? `: beginner courses (kite control, body dragging, water start) cost EUR ${begPrices[0].amount} for ${begPrices[0].label}` : ''}${intPrices.length ? `, intermediate classes (upwind riding, transitions) EUR ${intPrices[0].amount} for ${intPrices[0].label}` : ''}.`,
    `${beachMin ? `The north shore is a ${beachMin[1]}-minute drive away and the west and east coasts ${beachMin[2]} minutes; c` : 'C'}oworking is free for hotel guests.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Surfescape Fuerteventura',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Canary Islands',
    spot: 'Lajares, Fuerteventura',
    spotCoords: typeof geo.latitude === 'number' && typeof geo.longitude === 'number' ? { lat: geo.latitude, lng: geo.longitude } : null, // JSON-LD geo of the page
    itinerarySpots: [],
    durationDays: null,
    // home: "Surf, yoga, kite for beginners and intermediate"
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: begPrices.length > 0 || amenityLd.includes('Kite lessons'),
    equipmentRental: null, // not stated
    beginnerFriendly: begPrices.length > 0,
    includedServices: [...new Set([...amenities, ...amenityLd.filter(a => !/Kite lessons|Surf school|Yoga studio/i.test(a)), 'Coworking free for hotel guests'])],
    optionalServices: [
      begPrices.length ? `Beginner kite lessons (${fmt(begPrices)})` : 'Beginner kite lessons',
      intPrices.length ? `Intermediate kite classes (${fmt(intPrices)})` : 'Intermediate kite classes',
      'Group and private surf classes', 'Yoga classes',
      camp ? `8 days / 7 nights surf and yoga camp (${camp.lines.filter(l => /€\/week\/person/.test(l)).join('; ')})` : '8 days / 7 nights surf and yoga camp',
      'Secret Garden restaurant',
    ],
    accommodation: 'apartments, double rooms, a studio and a two-bedroom villa',
    mealPlan: null, // breakfast is included for the apartment and the large double room, not stated for the others
    languages: ['en', 'es', 'it'],
    rooms: contentRooms,
    imageUrls: seImages(p.page).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SE_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `rooms: ${rooms.map(r => `${r.name}: ${r.description}`).join(' | ')}`,
      `amenities: ${amenities.join(', ')}`,
      `json-ld amenities: ${amenityLd.join(', ')}; geo ${geo.latitude ?? '-'},${geo.longitude ?? '-'}`,
      ...school.map(x => `school - ${x.title} ${x.lines.join(' | ')}`),
      `beach: ${beach ?? '-'}`,
      `home: ${levels ?? '-'} | ${earlyBooker ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const surfescapeLajares: OfferAdapter = {
  key: 'surfescape-lajares',
  name: 'Surfescape Fuerteventura Lajares',
  kind: 'accommodation',
  operator: {
    name: 'Surfescape',
    websiteUrl: SITE,
    rootDomain: 'surfescape.com',
  },
  url: SE_PAGE_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 2,
  confidence: 'low', // no room prices on the site; Cloudbeds /booking/* is 403 for non-browser clients
  async fetchContent() {
    const [page, home] = [
      await fetchText(SE_PAGE_URL, { accept: 'text/html' }),
      await fetchText(SE_HOME_URL, { accept: 'text/html' }),
    ];
    if (parseSeRooms(page).length < 3) throw new Error('surfescape: room cards (<h5> + Description) not found on the Fuerteventura page');
    return parseSurfescapeContent({ page, home });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('surfescape: no room prices on the site; Cloudbeds /booking/* answers 403 to non-browser clients - price on request');
    return [];
  },
};
