// ---------------------------------------------------------------------------
// Watamu Beach Cottages, Turtle Bay Road, Watamu (Kenya) - family-run beachfront property on a 5-acre plot in the
// Watamu National Marine Park with cottages, club rooms, chalets, apartments, a villa and tents; JC Kiteschool
// (and Turtle Dive Center) operate from the property.
//
// Data path (checked 2026-10-12): WordPress + WpRentals theme (own booking: listing pages, cart, checkout).
//   content  / (property, facilities, kite school, guest reviews with dates), /contact/ (e-mail, address).
//   slots    / : the "listing_wrapper" cards of every unit: name (itemprop=name), nightly price (itemprop=price,
//            "$ 93 /night"), type (/listings/<type>/ link) and kind (/action/<kind>/ link). Units are grouped
//            by type; the "Own Tent" pitch (bring your own tent / overlander) is not a rental unit and is skipped.
// Booking engine: WpRentals on the site itself. Each listing page embeds control_vars_property with
//   default_price and booking_array - the latter was "[]" for the unit checked (Nomad, 2026-10-12) although guest
//   reviews show stays in 2026, so the site calendar does not hold the bookings (reviews are synced from another
//   platform) -> no availability is read; slots stay 'unknown'. custom_price was empty (no seasonal prices).
// robots.txt (2026-10-12): WooCommerce defaults (/wp-admin/, ?add-to-cart=, upload logs) - pages allowed.
// Requests per run: content 2, slots 1.
// Parsed: slot = accommodation type ("1-bedroom-cottage"), lowest nightly price of its units in USD per unit
//   (priceBasis room), no dates, availability 'unknown'.
// Known limits: the cards do not state guests per unit (occupancy null); the map vars of the theme carry its
//   demo default coordinates (New York), so no pin.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parseDate } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://watamubeachcottages.com';
export const WBC_HOME_URL = `${SITE}/`;
const WBC_CONTACT_URL = `${SITE}/contact/`;

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text split at block tags. */
export function wbcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface WbcUnit { id: string; name: string; url: string; price: number | null; currency: string; type: string | null; kind: string | null; image: string | null }

/** Unit cards on the home page (one per listing; the first card per listing id wins). */
export function parseWbcUnits(html: string): WbcUnit[] {
  const out: WbcUnit[] = [];
  for (const part of html.split(/class="listing_wrapper /).slice(1)) {
    const card = part.slice(0, 8000);
    const id = card.match(/data-listid="(\d+)"/)?.[1];
    const name = card.match(/<span itemprop="name">\s*([\s\S]*?)\s*<\/span>/)?.[1];
    const url = card.match(/href="(https:\/\/watamubeachcottages\.com\/holiday-home\/[^"]+)"/)?.[1];
    if (!id || !name || !url || out.some(u => u.id === id)) continue;
    const price = card.match(/itemprop="price" content="([\d.]+)"/)?.[1];
    const cur = card.match(/itemprop="priceCurrency" content="([^"]*)"/)?.[1] ?? '$';
    out.push({
      id,
      name: clean(name),
      url,
      price: price ? Number(price) : null,
      currency: cur === '$' || /USD/i.test(cur) ? 'USD' : cur,
      type: clean(card.match(/href="https:\/\/watamubeachcottages\.com\/listings\/[^"]+" rel="tag">([^<]+)<\/a>/)?.[1] ?? '') || null,
      kind: clean(card.match(/href="https:\/\/watamubeachcottages\.com\/action\/[^"]+" rel="tag">([^<]+)<\/a>/)?.[1] ?? '') || null,
      image: card.match(/data-src="([^"]+)"/)?.[1] ?? null,
    });
  }
  return out;
}

export interface WbcType { id: string; name: string; units: WbcUnit[]; from: number | null; currency: string }

const typeLabel = (t: string, units: WbcUnit[]): string => {
  const base = t === 'Clubrooms' ? 'Club room' : t;
  return units.every(u => /\bB&B\b/.test(u.name)) ? `${base} (B&B)` : base;
};

/** Rental units grouped by type (own-tent pitches dropped), in the order the cards first show a type. */
export function groupWbcTypes(units: WbcUnit[]): WbcType[] {
  const out: WbcType[] = [];
  for (const u of units) {
    if (!u.type || /own tent/i.test(u.kind ?? '')) continue;
    let g = out.find(x => x.id === keyPart(u.type!));
    if (!g) { g = { id: keyPart(u.type), name: u.type, units: [], from: null, currency: u.currency }; out.push(g); }
    g.units.push(u);
  }
  for (const g of out) {
    const prices = g.units.map(u => u.price).filter((p): p is number => p !== null && p > 0);
    g.from = prices.length ? Math.min(...prices) : null;
    g.name = typeLabel(g.name, g.units);
  }
  return out;
}

export function buildWbcSlots(types: WbcType[]): Slot[] {
  return types.filter(t => t.from !== null).map(t => ({
    key: t.id,
    startDate: null,
    endDate: null,
    unit: t.name,
    price: t.from,
    currency: t.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: null,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** Dates of the guest reviews shown on the home page ("September 29, 2026"), newest first. */
export function wbcReviewDates(lines: string[]): string[] {
  return [...new Set(lines.filter(l => /^[A-Z][a-z]+ \d{1,2}, 20\d{2}$/.test(l)).map(l => parseDate(l)).filter((d): d is string => !!d))].sort().reverse();
}

// --- content ----------------------------------------------------------------------------------
export interface WbcPages { home: string; contact: string }

export function parseWatamuContent(p: WbcPages): OfferContent {
  const home = wbcLines(p.home);
  const contact = wbcLines(p.contact);
  const homeText = home.join(' ');
  const units = parseWbcUnits(p.home);
  const types = groupWbcTypes(units);
  const reviews = wbcReviewDates(home);
  const rental = types.flatMap(t => t.units);
  const cheapest = [...types].filter(t => t.from !== null).sort((a, b) => a.from! - b.from!)[0];
  const find = (re: RegExp) => home.find(l => re.test(l)) ?? null;

  const rooms: ContentRoom[] = types.map(t => ({
    name: t.name,
    description: `${t.units.length} unit${t.units.length > 1 ? 's' : ''}: ${t.units.map(u => u.name).join(', ')}.`,
    features: [
      ...t.units.map(u => `${u.name}: ${u.price !== null ? `USD ${u.price} per night` : 'price on request'}`),
      ...(t.units[0]?.kind ? [t.units[0].kind] : []),
    ],
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    if (seen.has(k) || !/watamubeachcottages\.com\/wp-content\/uploads\//.test(k) || /logo|icon|favicon|\.png$|\.svg$/i.test(k)) return;
    seen.add(k); imgs.push(k);
  };
  rental.forEach(u => u.image && push(u.image));
  imageCandidates(p.home, WBC_HOME_URL, null, 80).forEach(push);

  const summary = [
    'Watamu Beach Cottages is a family-run beachfront property on a 5-acre plot along Turtle Bay Road, about 5 km from Watamu village on the north coast of Kenya, inside the Watamu National Marine Park, with private paths down to the beach.',
    `It rents ${rental.length} units, from forest tents and tent huts to air-conditioned club rooms and chalets on bed & breakfast, self-catering cottages, two sea-view apartments, a penthouse and a villa${cheapest ? `, from USD ${cheapest.from} per night (${cheapest.name})` : ''}; guests share a salt-water pool, the Bamba Kofi snack bar, a gym and lookout points over the ocean.`,
    'JC Kiteschool operates from the property and teaches kitesurfing on the beach in front, and the Turtle Dive Center is based there too.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Watamu Beach Cottages',
    summary,
    continent: 'Africa',
    country: 'Kenya',
    region: 'Kilifi County',
    spot: 'Watamu',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /JC Kiteschool/i.test(homeText),
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: [
      /fast speed internet is freely available|WIFI with fast speed/i.test(homeText) ? 'Free Wi-Fi' : null,
      'Salt-water pool, viewpoints and rooftop lounge',
      'Daily housekeeping',
      /24 hour security|two guards on duty/i.test(homeText) ? '24-hour security' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [
      'Kitesurf lessons with JC Kiteschool (on the property)',
      'Scuba diving with Turtle Dive Center (on the property)',
      'Bamba Kofi snack bar meals', 'Sea Breeze massage', 'Private cook', 'Airport taxi transfers', 'E-bike hire', 'Excursions and safaris',
    ],
    accommodation: 'cottages, club rooms, chalets, apartments, a villa, tent huts and tents',
    mealPlan: null, // B&B for club rooms and chalets, self-catering for the rest (see unit names)
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WBC_HOME_URL,
    bookingUrl: WBC_HOME_URL,
    sourceText: [
      `home: ${[find(/^Watamu Beach Cottages is a beautiful/), find(/^Location$/) ? find(/situated on the North Coast of Kenya in Watamu/) : null, find(/^Explore your surroundings/), find(/^We are situated along one of the best beaches/)].filter(Boolean).join(' | ')}`,
      `units: ${units.map(u => `${u.name} [${u.type ?? '-'} / ${u.kind ?? '-'}] ${u.price ?? '-'} ${u.currency}`).join('; ')}`,
      `latest guest reviews: ${reviews.slice(0, 5).join(', ')}`,
      `contact: ${contact.filter(l => /@|Plot|Turtle Bay/.test(l)).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const watamuBeachCottagesWatamu: OfferAdapter = {
  key: 'watamu-beach-cottages-watamu',
  name: 'Watamu Beach Cottages',
  kind: 'accommodation',
  operator: {
    name: 'Watamu Beach Cottages',
    websiteUrl: SITE,
    rootDomain: 'watamubeachcottages.com',
    contactEmail: 'info@watamubeachcottages.com',
    phone: '+254728986066',
  },
  url: WBC_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  async fetchContent() {
    const home = await fetchText(WBC_HOME_URL, { accept: 'text/html' });
    const contact = await fetchText(WBC_CONTACT_URL, { accept: 'text/html' });
    return parseWatamuContent({ home, contact });
  },
  async fetchSlots() {
    const types = groupWbcTypes(parseWbcUnits(await fetchText(WBC_HOME_URL, { accept: 'text/html' })));
    if (types.length < 4) throw new Error(`watamu-beach-cottages: unit cards not found or changed (${types.length} types parsed)`);
    return buildWbcSlots(types);
  },
};
