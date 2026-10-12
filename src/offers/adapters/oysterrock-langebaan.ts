// ---------------------------------------------------------------------------
// OysterRock self catering by the beach, Langebaan (Western Cape, South Africa) - five renovated self-catering "kite
// pads" in Jacoba Street, about 100 m (a 90-second walk) from Langebaan main beach on the lagoon, each with a lockable
// kite gear store and patio; shared garden with braai areas, hot outdoor shower and gazebo; up to 12 guests in total.
// Same owner as Boardrooms in Blouberg (own adapter).
//
// Liveness (checked 2026-10-12): WordPress modified dates (wp-json) - the five pad pages 2025-11-17, home 2025-10-01,
//   prices/booking page 2025-09-30; the owner's Boardrooms site (home modified 2026-08-18) still links "accommodation
//   in Langebaan Oysterrock" (www.oysterrock.com) for guests taking lessons.
// Kite link: "our five self-catering pads are perfectly positioned for kitesurfers", "secure kite gear storage",
//   "Our accommodation pods are made by water people for water people", "You can walk to the main beach with your
//   gear"; booking page: "Each unit has a large lockable kite store".
//
// Data path (checked 2026-10-12): oysterrock.com, WordPress.
//   content  / (intro, kite / beach blocks, the five pad descriptions, location), /booking-and-prices/ (equipment
//            per unit, booking channels).
//   slots    none: the site prints no prices ("Directly booking coming soon. or call Darren"); each pad links to its
//            Airbnb listing, which is a platform and not used -> price on request.
// robots.txt (2026-10-12): WordPress default (/wp-admin/ only).
// Requests per run: content 2, slots 0.
// Parsed: content only; fetchSlots returns [] (confidence 'low').
// Known limits: no prices, dates or availability on the own site; the Google Maps embed is a place-name query (no
//   coordinates).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://oysterrock.com';
export const OR_HOME_URL = `${SITE}/`;
export const OR_BOOKING_URL = `${SITE}/booking-and-prices/`;

/** Visible text split at block tags (script/style bodies dropped). */
export function orLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface OrPad { name: string; description: string; sizeM2: number | null; sleeps: number | null }

const SLEEPS: Record<string, number> = { one: 2, two: 2, three: 2, four: 4, five: 2 };

/** Pad cards on the home page: "OysterRock self catering by the beach - pad one" [ | "pad one"] | description. */
export function parseOrPads(html: string): OrPad[] {
  const joined = orLines(html).join(' | ');
  const out: OrPad[] = [];
  for (const m of joined.matchAll(/OysterRock self catering by the beach - pad (one|two|three|four|five)\s*\|\s*(?:pad \1\s*\|\s*)?([^|]{60,})/gi)) {
    const n = m[1].toLowerCase();
    if (out.some(p => p.name === `Pad ${n}`)) continue;
    const description = clean(m[2].replace(/\s*pad \w+ link\s*$/i, '')).replace(/\s*[\u2013\u2014]\s*/g, ' - ');
    out.push({
      name: `Pad ${n}`,
      description,
      sizeM2: Number(description.match(/(\d+)\s?m²/)?.[1]) || null,
      // the menu says "pad one - sleeps 2" ... "pad four sleeps four", "pad five sea view - sleeps two"
      sleeps: SLEEPS[n] ?? null,
    });
  }
  return out;
}

/** Photos from wp-content/uploads (any size variant collapsed to the original), platform logos left out. */
export function orImages(...pages: string[]): string[] {
  const out: string[] = [];
  for (const html of pages) {
    for (const m of html.matchAll(/https:\/\/oysterrock\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^"'\s,)]+\.(?:jpe?g|webp)/gi)) {
      const u = m[0].replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (/google-hotels|airbnb|booking-accommodation|logo|icon|cropped-/i.test(u)) continue;
      if (/-1\.(?:jpe?g|webp)$/i.test(u) && out.includes(u.replace(/-1(\.[a-z]+)$/i, '$1'))) continue;
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

export interface OrPages { home: string; booking: string }

export function parseOrContent(p: OrPages): OfferContent {
  const pads = parseOrPads(p.home);
  const home = orLines(p.home).join(' ');
  const booking = orLines(p.booking).join(' ');
  const units = Number(home.match(/We have (\d+) units available/i)?.[1]) || pads.length || 5;
  const guests = Number(home.match(/cater for (\d+) people in total/i)?.[1]) || null;

  const rooms: ContentRoom[] = pads.map(pd => ({
    name: pd.name,
    description: pd.description,
    features: [
      pd.sleeps ? `Sleeps ${pd.sleeps}` : null,
      pd.sizeM2 ? `${pd.sizeM2} m²` : null,
      'Private patio',
      'Fully equipped kitchen',
      /lockable kite store/i.test(booking) ? 'Lockable kite store' : null,
    ].filter((x): x is string => !!x),
  }));

  const summary = [
    `OysterRock is a group of ${units} renovated self-catering apartments ("pads") in Jacoba Street, Langebaan, about 100 m from the main beach on the Langebaan lagoon, built with kitesurfers in mind${guests ? ` and sleeping up to ${guests} guests in total` : ''}.`,
    'Each pad has its own patio, a fully equipped kitchen, fast Wi-Fi and a lockable kite gear store; guests share a garden with two braai areas, a hot outdoor shower and a gazebo, and can walk to the beach with their gear.',
    'Units range from a 28 m² budget studio to a 62 m² apartment with two queen beds and a lagoon-view studio; the site lists no rates, so prices are on request from the owner.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'OysterRock self catering by the beach',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Langebaan',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: [
      /secure kite gear storage|lockable kite store/i.test(`${home} ${booking}`) ? 'Lockable kite gear store per unit' : null,
      /hot outdoor shower/i.test(home) ? 'Hot outdoor shower' : null,
      /braai/i.test(home) ? 'Garden with braai areas and gazebo' : null,
      /fast WiFi/i.test(home) ? 'Fast Wi-Fi' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [],
    accommodation: 'self-catering apartments (kite pads)',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: orImages(p.home, p.booking).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: OR_HOME_URL,
    bookingUrl: OR_BOOKING_URL,
    sourceText: [
      `home: ${orLines(p.home).filter(l => l.length > 50).join(' | ')}`,
      `booking: ${orLines(p.booking).filter(l => l.length > 50 && !/airbnb\.co/i.test(l)).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const oysterrockLangebaan: OfferAdapter = {
  key: 'oysterrock-langebaan',
  name: 'OysterRock self catering by the beach',
  kind: 'accommodation',
  operator: {
    name: 'OysterRock',
    websiteUrl: SITE,
    rootDomain: 'oysterrock.com',
    contactEmail: 'db@escaping.co.za',
    whatsapp: '+27834482177',
    phone: '+27834482177',
  },
  url: OR_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'low', // no prices on the own site (Airbnb only)
  async fetchContent() {
    const home = await fetchText(OR_HOME_URL, { accept: 'text/html' });
    const booking = await fetchText(OR_BOOKING_URL, { accept: 'text/html' });
    return parseOrContent({ home, booking });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no prices on oysterrock.com (the pads link to Airbnb, a platform we do not read); price on request');
    return [];
  },
};
