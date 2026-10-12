// ---------------------------------------------------------------------------
// VilanCool NGO Beach Resort & IKO Kite School, Vilanculos (Inhambane, Mozambique) - non-profit social project on
// South Beach (Bairro Desse) run by a local team: five self-catering beach villas / beach houses for 2-6 guests and
// its own IKO kite school (kite safaris to the Bazaruto archipelago, rentals, SUP).
//
// Liveness (checked 2026-10-12): Wix sitemap (pages-sitemap.xml) lastmod 2026-08-18 for every page (home, kite school,
//   rentals, terms, contact); footer "Copyright - VilanCool Water Sports LDA, 2026". The blog is older (last post
//   2024-03), the site itself was republished in August 2026.
// Kite link: "VilanCool is a non-profit Beach Resort & IKO Kite School"; /kitesurfing-mozambique lists IKO courses
//   (Level 1 Discovery $90 ... Kiteclub package $350); a /kite-rentals page exists (not read).
//
// Data path (checked 2026-10-12): www.vilancool.com, Wix (server-rendered HTML).
//   content  / (villa tabs: name, "(up to N people)", "from 99$ per night", description; team, contact),
//            /kitesurfing-mozambique (IKO course list with USD prices).
//   slots    / : per unit "<type> "<name>" (up to N people)" followed by "from N$ per night" - USD from-prices per unit
//            and night, no dates, no season; "Check availability" opens a mail to hello@vilancool.com -> 'on_request'.
// robots.txt (2026-10-12): Wix default (Allow /, only ?lightbox= disallowed for all).
// Requests per run: content 2, slots 1.
// Parsed: 5 slots (Flying Turtle, Waving Manta, Sleeping Dugong, Dancing Flamingo, Smiling Dolphin), USD per unit per
//   night ("from" prices), occupancy = the stated maximum.
// Known limits: from-prices only (the exact rate comes by mail); no season dates; no map pin on the site.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.vilancool.com';
export const VC_HOME_URL = `${SITE}/`;
export const VC_KITE_URL = `${SITE}/kitesurfing-mozambique`;

/** Visible text split at block tags (script/style bodies dropped, Wix zero-width spaces removed). */
export function vcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ').replace(/​/g, '')))
    .filter(Boolean);
}

const keyPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers -----------------------------------------------------------------------------
export interface VcUnit { type: string; name: string; maxGuests: number; fromUsd: number; description: string | null }

/** Villa tabs: type line, "<name>", "(up to N people)", "from N$ per night", then the description paragraph. */
export function parseVcUnits(html: string): VcUnit[] {
  const lines = vcLines(html);
  const joined = lines.join(' | ');
  const out: VcUnit[] = [];
  const re = /((?:One|Two|Three|Four)-Bedroom Villa(?: - Beach Front)?|Beach House - Sea View)\s*\|?\s*"([^"]+)"\s*\|?\s*\(up to (\d+) people\)\s*\|\s*from (\d+)\s*\$\s*per night\s*\|\s*([^|]+)/g;
  for (const m of joined.matchAll(re)) {
    if (out.some(u => u.name === m[2])) continue;
    out.push({ type: m[1], name: m[2], maxGuests: Number(m[3]), fromUsd: Number(m[4]), description: clean(m[5]) || null });
  }
  return out;
}

export function buildVcSlots(units: VcUnit[]): Slot[] {
  return units.map(u => ({
    key: keyPart(u.name),
    startDate: null,
    endDate: null,
    unit: `${u.type} "${u.name}"`,
    price: u.fromUsd,
    currency: 'USD',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: u.maxGuests,
    availability: 'on_request',
    availabilityText: `from ${u.fromUsd}$ per night (up to ${u.maxGuests} people)`,
    spotsLeft: null,
  }));
}

/** IKO courses on the kite page: "IKO Level 1 - Discovery (2 hrs)* ... $90.00". */
export function parseVcCourses(html: string): Array<{ name: string; usd: number }> {
  const lines = vcLines(html);
  const out: Array<{ name: string; usd: number }> = [];
  let name: string | null = null;
  for (const l of lines) {
    const head = l.match(/^((?:IKO Level \d[^*]*|Starter Pack[^*]*|VilanCool Kiteclub Package[^*]*|Evolution Lesson[^*]*))\*$/);
    if (head) { name = head[1].trim(); continue; }
    if (/^Private Lessons$/i.test(l)) { name = 'Private lesson (per hour)'; continue; }
    const price = l.match(/^\$(\d+(?:\.\d+)?)/);
    if (price && name) { out.push({ name: name.replace(/\s+/g, ' '), usd: Number(price[1]) }); name = null; }
  }
  return out;
}

export function vcImages(html: string): string[] {
  const out: string[] = [];
  for (const raw of imageCandidates(html, VC_HOME_URL, null, 80)) {
    const u = decodeURIComponent(raw).replace(/\/v1\/.*$/, '');
    if (!/static\.wixstatic\.com\/media\/[^/]+~mv2(?:_[^/]*)?\.jpe?g$/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

export interface VcPages { home: string; kite: string }

export function parseVcContent(p: VcPages): OfferContent {
  const units = parseVcUnits(p.home);
  const courses = parseVcCourses(p.kite);
  const home = vcLines(p.home).join(' ');
  const kite = vcLines(p.kite).join(' ');
  const prices = units.map(u => u.fromUsd).sort((a, b) => a - b);

  const rooms: ContentRoom[] = units.map(u => ({
    name: `${u.type} "${u.name}"`,
    description: u.description,
    features: [`Up to ${u.maxGuests} people`, `From ${u.fromUsd} USD per night`, 'Self-catering kitchen', 'Air conditioning'],
  }));

  const summary = [
    'VilanCool is a non-profit beach resort and IKO kite school on South Beach in Vilanculos, Mozambique, run by a local team as a social project that reinvests its revenue in education and employment.',
    `It rents ${units.length || 5} self-catering beach villas and beach houses for 2 to 6 guests with air conditioning and fully equipped kitchens${prices.length ? `, from ${prices[0]} to ${prices[prices.length - 1]} US dollars per night` : ''}; bookings are made by e-mail or WhatsApp.`,
    'The on-site kite school teaches IKO levels 1 to 4 with private lessons and packages and rents kite equipment; island safaris in the Bazaruto park and game safaris in Kruger Park are arranged with partners.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'VilanCool Beach Resort & Kite School',
    summary,
    continent: 'Africa',
    country: 'Mozambique',
    region: 'Inhambane',
    spot: 'Vilanculos',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /IKO/i.test(kite),
    equipmentRental: /KITE RENTALS/i.test(home) || /rental/i.test(kite),
    beginnerFriendly: /Discovery/i.test(kite),
    includedServices: ['Self-catering kitchen', 'Air conditioning', /guide you to the supermarket/i.test(home) ? 'Team guides guests to the supermarket and local markets' : null]
      .filter((x): x is string => !!x),
    optionalServices: [
      ...courses.map(c => `${c.name}: ${c.usd} USD`),
      'Kite equipment rental',
      /Island Safaris/i.test(home) ? 'Island safaris in Bazaruto Park (partner)' : null,
      /Game Safaris/i.test(home) ? 'Game safaris in Kruger Park (partner)' : null,
    ].filter((x): x is string => !!x),
    accommodation: 'self-catering beach villas and beach houses',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: vcImages(p.home).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: VC_HOME_URL,
    bookingUrl: 'mailto:hello@vilancool.com',
    sourceText: [
      `units: ${units.map(u => `${u.type} "${u.name}" (up to ${u.maxGuests} people) from ${u.fromUsd}$ per night: ${u.description ?? ''}`).join(' | ')}`,
      `courses: ${courses.map(c => `${c.name} $${c.usd}`).join('; ')}`,
      `kite page: ${vcLines(p.kite).filter(l => l.length > 60).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const vilancoolVilanculos: OfferAdapter = {
  key: 'vilancool-vilanculos',
  name: 'VilanCool Beach Resort & Kite School',
  kind: 'accommodation',
  operator: {
    name: 'VilanCool Water Sports',
    websiteUrl: SITE,
    rootDomain: 'vilancool.com',
    contactEmail: 'hello@vilancool.com',
    whatsapp: '+258847862170',
    phone: '+258842730614',
  },
  url: VC_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium', // undated "from" prices on a site republished 2026-08-18; inquiry by mail / WhatsApp
  async fetchContent() {
    const home = await fetchText(VC_HOME_URL, { accept: 'text/html' });
    const kite = await fetchText(VC_KITE_URL, { accept: 'text/html' });
    return parseVcContent({ home, kite });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const units = parseVcUnits(await fetchText(VC_HOME_URL, { accept: 'text/html' }));
    if (units.length === 0) throw new Error('vilancool-vilanculos: no "(up to N people) from N$ per night" villa tabs on the home page (layout changed?)');
    if (units.length < 5) ctx.note(`only ${units.length} villa tabs with prices (5 expected)`);
    return buildVcSlots(units);
  },
};
