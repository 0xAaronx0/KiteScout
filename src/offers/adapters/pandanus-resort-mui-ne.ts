// ---------------------------------------------------------------------------
// Pandanus Resort, Mui Ne (Lam Dong - formerly Binh Thuan, Vietnam) - Cham-style beach resort (suites, bungalows,
// superior rooms; two free-form pools, spa) whose beach hosts the watersports school of Source Kiteboarding (kite, wing,
// surf; North / Mystic distributor for Vietnam).
//
// Kite link (the on-site kite school's own site, 2026-10-12): sourcekiteboarding.com home "Our Locations ... Watersports
//   School Pandanus Resort, Khu Pho 5"; /services/accommodation/ "Pandanus Resort - Just a few steps from our watersports
//   center" (Source also books the resort for its guests). The resort's own site does not mention kiting.
// Liveness (2026-10-12): resort footer "Copyright © 2004-2026", WordPress uploads 2026/05-2026/10, "Summer Escape" offer
//   "valid for booking stays from now until 31/10/2026"; Source's sitemap index lastmod 2026-01-29. Verdict LIVE.
// Data path (checked 2026-10-12): www.pandanusresort.com (WordPress/Elementor, English):
//   content  / (about, resort highlights, room slider: <h3> name, <ul><li> size / bedrooms / view / beds, <p> text, photos),
//            /premium-all-inclusive-programme (what all guests get), /contact/ (Google Maps embed "!3d10.945...!2d108.294..." -> spotCoords), + sourcekiteboarding.com home and
//            /services/accommodation/ (kite facts).
//   slots    none. Rates sit in the Sabre SynXis engine (be.synxis.com, chain 9005, hotel 60700) - a session-based
//            booking app, not a public read we use; the offers print only percentage discounts -> fetchSlots returns []
//            ("price on request").
// robots.txt (2026-10-12): pandanusresort.com Yoast default (/wp-admin/ only); sourcekiteboarding.com WooCommerce default.
// Requests per run: content 5, slots 0.
// Known limits: no prices; Source's own pages were last edited in 2025 (sitemap 2026-01), so the school's presence at the
//   resort is as stated there.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.pandanusresort.com';
export const PR_HOME_URL = `${SITE}/`;
export const PR_CONTACT_URL = `${SITE}/contact/`;
export const PR_ALLINC_URL = `${SITE}/premium-all-inclusive-programme`;
const SRC = 'https://www.sourcekiteboarding.com';
export const SRC_HOME_URL = `${SRC}/`;
export const SRC_ACCOMMODATION_URL = 'https://sourcekiteboarding.com/services/accommodation/';
export const PR_BOOKING_URL = 'https://be.synxis.com/?chain=9005&hotel=60700&level=hotel&locale=en-GB';

/** Page text without script/style/svg bodies, whitespace collapsed. */
export function prText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  return root.text.replace(/\s+/g, ' ');
}

// --- pure parsers -----------------------------------------------------------------------------
export interface PrRoom { name: string; facts: string[]; text: string | null; sizeM2: number | null }

/** Home page room slider: .content-wrapper .item -> h3 name, li facts, p text. */
export function parsePrRooms(html: string): PrRoom[] {
  const out: PrRoom[] = [];
  for (const item of parse(html).querySelectorAll('.content-wrapper .item')) {
    const name = collapse(item.querySelector('.title h3')?.text ?? '');
    if (!name || out.some(r => r.name === name)) continue;
    const facts = item.querySelectorAll('.content li').map(li => collapse(li.text)).filter(Boolean);
    out.push({
      name,
      facts,
      text: collapse(item.querySelector('.content p')?.text ?? '') || null,
      sizeM2: Number(facts.find(f => /sq\.?\s?m/i.test(f))?.match(/(\d+)/)?.[1]) || null,
    });
  }
  return out;
}

/** Google Maps embed on /contact/: "!2d<lng>!3d<lat>". */
export function parsePrCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

/** Source Kiteboarding statements tying its school to the resort, plus school facts. */
export function parseSource(home: string, acc: string): { atPandanus: boolean; facts: string[] } {
  const h = prText(home);
  const a = prText(acc);
  const atPandanus = /Watersports School\s*Pandanus Resort/.test(h) || /Pandanus Resort\s*Just a few steps from our watersports center/.test(a);
  const pick = (s: string, re: RegExp): string | null => s.match(re)?.[0]?.trim() ?? null;
  const facts = [
    pick(h, /Watersports School\s*Pandanus Resort, Khu Pho 5/),
    pick(a, /Pandanus Resort\s*Just a few steps from our watersports center[^.]*\./),
    pick(h, /Here at Source Kiteboarding we provide kitesurf, wingfoil and surf lessons[^.…]*/),
    pick(h, /We are official distributors of North Kiteboarding and Mystic in Vietnam[^.]*\./),
    pick(h, /Here at Source, we have over 20 years of kitesurfing experience/),
  ].filter((x): x is string => !!x).map(s => s.replace(/\s+/g, ' '));
  return { atPandanus, facts };
}

export interface PrPages { home: string; contact: string; allInclusive: string; srcHome: string; srcAccommodation: string }

export function parsePandanusContent(p: PrPages): OfferContent {
  const rooms = parsePrRooms(p.home);
  const coords = parsePrCoords(p.contact);
  const src = parseSource(p.srcHome, p.srcAccommodation);
  const home = prText(p.home);
  const pools = /two large free-form swimming pools/i.test(home);
  const address = home.match(/3 Nguyen Huu Tho, Mui Ne, Lam Dong \d+, Vietnam/)?.[0] ?? null;
  const sizes = rooms.map(r => r.sizeM2).filter((x): x is number => !!x);
  const allInc = prText(p.allInclusive);
  const allGuests = /all guests enjoy access to the resort’s unique Mui Ne walking tour, daily activities including yoga and tai chi classes/i.test(allInc.replace(/'/g, '’'));

  const contentRooms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: r.text, features: r.facts }));

  const imgs: string[] = [];
  for (const m of `${p.home}\n${p.allInclusive}\n${p.contact}`.matchAll(/(?:data-src|src)="(https:\/\/www\.pandanusresort\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"]+\.(?:jpe?g|webp))"/g)) {
    const u = m[1];
    if (/logo|icon|popup|mobile|1080x1920|-\d+x\d+\./i.test(u) || imgs.includes(u)) continue;
    imgs.push(u);
  }

  const summary = [
    `Pandanus Resort is a Cham-style beach resort in Mui Ne, southern Vietnam, set in a tropical garden with ${pools ? 'two large free-form pools (one by the beach, one with a swim-up bar)' : 'pools'}, a spa and several restaurants and bars.`,
    src.atPandanus ? 'Source Kiteboarding runs its watersports school on the resort\'s beach, a few steps from the rooms, with kitesurf, wing foil and surf lessons, rental and North and Mystic equipment.' : 'The resort sits on the Mui Ne kite beach.',
    `Rooms range from ${sizes.length ? `${Math.min(...sizes)} m²` : 'standard'} superior rooms to ${sizes.length ? `${Math.max(...sizes)} m²` : 'large'} suites, bungalows with outdoor baths and two-bedroom family and executive suites; rates are only shown in the booking engine, so prices are on request.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pandanus Resort',
    summary,
    continent: 'Asia',
    country: 'Vietnam',
    region: 'Lam Dong (Binh Thuan)',
    spot: 'Mui Ne',
    spotCoords: coords, // Google Maps embed on the resort's /contact/ page
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: src.atPandanus,
    equipmentRental: src.atPandanus,
    beginnerFriendly: true,
    // "all guests enjoy access to the resort's unique Mui Ne walking tour, daily activities including yoga and tai chi
    // classes, leisure facilities, and in-room minibar snacks" (/premium-all-inclusive-programme)
    includedServices: allGuests ? ['Mui Ne walking tour', 'Daily yoga and tai chi classes', 'In-room minibar snacks'] : [],
    optionalServices: [
      'Source Kiteboarding kitesurf, wing foil and surf lessons and rental (school on the resort beach)',
      'Premium All-Inclusive programme (all meals and drinks, daily spa treatment)',
      'Hibiscus Spa', 'Cooking classes', 'Jeep tours to the White Sand Dunes',
    ],
    accommodation: 'beach resort suites, bungalows and superior rooms',
    mealPlan: null,
    languages: ['en', 'vi'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PR_HOME_URL,
    bookingUrl: PR_BOOKING_URL,
    sourceText: [
      `home: ${home.match(/Imagine yourself in Paradise\.[^]*?Welcome to a refreshing retreat!/)?.[0] ?? ''} ${home.match(/We have two large free-form swimming pools\.[^]*?swim-up bar built into it\./)?.[0] ?? ''}`,
      `address: ${address ?? ''}`,
      `all guests: ${allInc.match(/While all guests enjoy[^.]*\./)?.[0] ?? ''}`,
      ...rooms.map(r => `room ${r.name}: ${r.facts.join(' | ')} | ${r.text ?? ''}`),
      `map: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
      `Source Kiteboarding (${SRC_HOME_URL}): at Pandanus: ${src.atPandanus}; ${src.facts.join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const pandanusResortMuiNe: OfferAdapter = {
  key: 'pandanus-resort-mui-ne',
  name: 'Pandanus Resort (Mui Ne)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Pandanus Resort',
    websiteUrl: SITE,
    rootDomain: 'pandanusresort.com',
    contactEmail: 'pandanus@pandanusresort.com', // site footer, 2026-10-12
    phone: '+842523849849',
  },
  url: PR_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 5,
  confidence: 'low', // no public rates; kite link from the school's site only
  async fetchContent() {
    const home = await fetchText(PR_HOME_URL, { accept: 'text/html' });
    const contact = await fetchText(PR_CONTACT_URL, { accept: 'text/html' });
    const allInclusive = await fetchText(PR_ALLINC_URL, { accept: 'text/html' });
    const srcHome = await fetchText(SRC_HOME_URL, { accept: 'text/html' });
    const srcAccommodation = await fetchText(SRC_ACCOMMODATION_URL, { accept: 'text/html' });
    return parsePandanusContent({ home, contact, allInclusive, srcHome, srcAccommodation });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('rates only in the SynXis booking engine (session-based, not a public read); offers print percentages only: price on request');
    return [];
  },
};
