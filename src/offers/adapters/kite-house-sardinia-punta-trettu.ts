// ---------------------------------------------------------------------------
// Kite House Sardinia, near San Giovanni Suergiu (south-west Sardinia, Italy) - family-run kitesurf resort
// with holiday apartments around a garden with pool, and its own IKO-affiliated kite school on the
// property (lessons mostly at the Punta Trettu lagoon, 6 km away). Open all year.
//
// Data path (checked 2026-10-12): WordPress (The7 theme, WPBakery), English pages:
//   slots    /holiday-apartments-punta-trettu/  one block per apartment type: <h3>Two-room Apartments
//            "Palme"</h3><p>description ... Sleeps up to 3 guests ...</p><ul><li>Size: 50 m²</li>
//            <li>Rates: €40–€180 per night</li></ul> + an amenity list. Yoast dateModified 2026-05-04.
//            No season dates or per-date prices; booking = request form (/contacts/#!/booking-request).
//   content  / (resort, school, services, distances), the apartments page, /seasons-kitesurf-sardinia/
//            ("Our kitesurf school as well as our holiday homes are open all year round").
// Booking engine: the 2026-10-09 survey saw an eZee engine (live.ipms247.com) on the home page; on
//   2026-10-12 no page links it any more (only the booking-request form), so we do not call it.
// robots.txt (2026-10-12): only /wp-content/uploads/wpo/wpo-plugins-tables-list.json disallowed.
// Requests per run: content 3, slots 1.
// Parsed: slot = apartment type ("palme"), EUR per apartment per night = the LOW end of the printed
//   range ("from" price), no dates, availability 'on_request'; the full range stays in the room features.
// Known limits: the range covers season and occupancy without saying which; occupancy is left null.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitehousesardinia.com';
export const KHS_HOME_URL = `${SITE}/`;
export const KHS_APTS_URL = `${SITE}/holiday-apartments-punta-trettu/`;
export const KHS_SEASONS_URL = `${SITE}/seasons-kitesurf-sardinia/`;
const BOOKING_URL = `${SITE}/contacts/#!/booking-request`;

export interface KhsApartment {
  slug: string;
  name: string;           // "Palme"
  heading: string;        // 'Two-room Apartments "Palme"'
  kind: string;           // "Two-room apartment"
  description: string;
  maxGuests: number | null;
  size: string | null;    // "50 m²"
  beds: string | null;
  rateMin: number;
  rateMax: number | null;
  currency: string;
  amenities: string[];
}

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const text = (h: string): string => collapse(parse(h).text);

// --- pure parsers -----------------------------------------------------------------------------
/** Apartment blocks: every <h3> whose section (up to the next <h3>) prints "Rates: €a–€b per night". */
export function parseKhsApartments(html: string): KhsApartment[] {
  const heads = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)];
  const out: KhsApartment[] = [];
  heads.forEach((h, i) => {
    const section = html.slice(h.index!, i + 1 < heads.length ? heads[i + 1].index! : html.length);
    const lis = [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => text(m[1]));
    const rateLi = lis.find(l => /^Rates?:/i.test(l));
    if (!rateLi) return;
    const r = rateLi.match(/(€|EUR)\s?([\d.,]+)\s*(?:[–—-]\s*(?:€|EUR)?\s?([\d.,]+))?\s*per night/i);
    const rateMin = r ? parseAmount(r[2]) : null;
    if (!rateMin) return;
    const heading = text(h[1]).replace(/[“”]/g, '"');
    const name = heading.match(/"([^"]+)"/)?.[1] ?? heading;
    const description = text(section.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
    const kind = heading.replace(/"[^"]*"/, '').trim().replace(/Apartments?$/i, 'apartment').replace(/^(\w)/, c => c.toUpperCase());
    out.push({
      slug: keyPart(name),
      name,
      heading,
      kind,
      description,
      maxGuests: Number(description.match(/Sleeps up to (\d+) guests/i)?.[1]) || null,
      size: lis.find(l => /^Size:/i.test(l))?.replace(/^Size:\s*/i, '') ?? null,
      beds: lis.find(l => /^Bed types?:/i.test(l))?.replace(/^Bed types?:\s*/i, '') ?? null,
      rateMin,
      rateMax: r?.[3] ? parseAmount(r[3]) : null,
      currency: 'EUR',
      amenities: [...section.matchAll(/<span class="kh-amenity">([\s\S]*?)<\/span>/g)].map(m => text(m[1])).filter(Boolean),
    });
  });
  return out;
}

export function buildKhsSlots(apts: KhsApartment[]): Slot[] {
  return apts.map(a => ({
    key: a.slug,
    startDate: null,
    endDate: null,
    unit: `${a.name} (${a.kind.toLowerCase()}${a.maxGuests ? `, up to ${a.maxGuests} guests` : ''})`,
    room: a.heading, // the content room of this apartment type (parseKiteHouseSardiniaContent names rooms by heading)
    price: a.rateMin,
    currency: a.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: null,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
  }));
}

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, svg')) el.remove();
  return collapse((root.querySelector('#main') ?? root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}
const pick = (t: string, re: RegExp): string | null => t.match(re)?.[0]?.trim() ?? null;

/** Distances list on the home page ("Punta Trettu 6 km"). */
export function parseKhsDistances(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of html.matchAll(/<li[^>]*>\s*([A-Z][A-Za-z.’' ]+?)\s+(\d+)\s*km\s*<\/li>/g)) out[collapse(m[1])] = Number(m[2]);
  return out;
}

/** Own photos (wp-content/uploads), originals without -WxH; logos, the site plan, screenshots dropped. */
export function khsImages(pages: string[], max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const html of pages) {
    const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const all = [...(og ? [og] : []), ...[...html.matchAll(/https:\/\/kitehousesardinia\.com\/wp-content\/uploads\/[^"' )?,]+\.jpe?g/gi)].map(m => m[0])];
    for (const raw of all) {
      const u = raw.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      if (/logo|plan-kite|screenshot|instagram|icon|mtb-/i.test(u)) continue;
      if (seen.has(u)) continue;
      seen.add(u); out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface KhsPages { home: string; apartments: string; seasons: string }

export function parseKiteHouseSardiniaContent(p: KhsPages): OfferContent {
  const home = mainText(p.home);
  const apts = parseKhsApartments(p.apartments);
  const seasons = mainText(p.seasons);
  const dist = parseKhsDistances(p.home);
  const openAllYear = /holiday homes are open all year round/i.test(seasons);
  // "● Apartments with fully equipped kitchens ● High-speed Wi-Fi ..." paragraphs under the h3s
  const bulletParas = parse(p.home).querySelectorAll('p').map(x => collapse(x.text)).filter(t => t.startsWith('●'));
  const services = bulletParas.find(t => /Apartments with fully equipped kitchens/i.test(t)) ?? '';
  const kiteServices = bulletParas.find(t => /Kitesurf courses/i.test(t)) ?? '';
  const bullets = (s: string) => s.split('●').map(x => collapse(x)).filter(Boolean);
  const school = pick(home, /The Kite House Sardinia ASD kitesurf school[^.]*\.[^.]*\./i);

  const mins = apts.map(a => a.rateMin);
  const maxs = apts.map(a => a.rateMax ?? a.rateMin);
  const guests = apts.map(a => a.maxGuests).filter((g): g is number => g !== null);
  const sizes = apts.map(a => Number(a.size?.match(/\d+/)?.[0])).filter(n => n > 0);

  const rooms: ContentRoom[] = apts.map(a => ({
    name: a.heading,
    description: a.description || null,
    features: [
      a.size ? `Size: ${a.size}` : null,
      a.beds ? `Beds: ${a.beds}` : null,
      a.maxGuests ? `Sleeps up to ${a.maxGuests}` : null,
      `Rates: EUR ${a.rateMin}${a.rateMax ? `-${a.rateMax}` : ''} per night`,
      ...a.amenities,
    ].filter((x): x is string => !!x),
  }));

  const summary = [
    `Kite House Sardinia is a family-run kitesurf resort with holiday apartments near San Giovanni Suergiu in south-west Sardinia, ${dist['Punta Trettu'] ?? 6} km from the Punta Trettu lagoon and ${dist['Porto Botte'] ?? 9} km from Porto Botte${openAllYear ? '; apartments and kite school are open all year' : ''}.`,
    `Its ${apts.length} apartment types${sizes.length ? ` (${Math.min(...sizes)}-${Math.max(...sizes)} m²${guests.length ? `, sleeping up to ${Math.min(...guests)}-${Math.max(...guests)} guests` : ''})` : ''} have a full kitchen, air conditioning, Wi-Fi and a porch with hammock, set in a garden with pool, jacuzzi and BBQ areas${mins.length ? `; rates run from EUR ${Math.min(...mins)} to ${Math.max(...maxs)} per night depending on apartment and season` : ''}.`,
    'The Kite House Sardinia ASD school on the property is an IKO affiliate and teaches all levels with radio helmets, mostly at Punta Trettu, and also offers rental, storage, coaching, wing foil courses and a rescue service.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite House Sardinia',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Punta Trettu, Sardinia',
    spot: 'Punta Trettu',
    itinerarySpots: [],
    durationDays: null,
    // home: "we welcome kiters of all levels"; "kitesurf courses for all levels and ages" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kitesurf courses/i.test(kiteServices) || /kitesurf lessons/i.test(home),
    equipmentRental: /equipment rental/i.test(kiteServices) || /equipment rental/i.test(home),
    beginnerFriendly: /perfect for beginners/i.test(home),
    includedServices: ['Apartment with fully equipped kitchen', 'High-speed Wi-Fi', 'Pool and jacuzzi', 'BBQ area and outdoor kitchen', 'Private parking', 'Bed linen and towels'],
    optionalServices: [
      ...bullets(kiteServices).map(s => `Kite: ${s}`),
      ...bullets(services).filter(s => /massage|e-bike|transfer|dinner|request/i.test(s)),
      'Yoga classes', 'SUP tours and surf sessions',
    ],
    accommodation: 'holiday apartments (studio to three-room) in a garden resort with pool',
    mealPlan: 'self_catering',
    languages: ['en', 'it', 'de', 'fr'],
    rooms,
    imageUrls: khsImages([p.apartments, p.home]),
    heroVideoUrl: null,
    sourceUrl: KHS_APTS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `resort: ${home.slice(0, 2500)}`,
      `school: ${school ?? ''}`,
      `apartments: ${apts.map(a => `${a.heading}: ${a.size ?? '?'}, up to ${a.maxGuests ?? '?'} guests, EUR ${a.rateMin}-${a.rateMax ?? '?'}/night`).join('; ')}`,
      `distances: ${Object.entries(dist).map(([k, v]) => `${k} ${v} km`).join(', ')}`,
      `season: ${pick(seasons, /Our kitesurf school as well as our[^.]*\./i) ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteHouseSardiniaPuntaTrettu: OfferAdapter = {
  key: 'kite-house-sardinia-punta-trettu',
  name: 'Kite House Sardinia Punta Trettu',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Kite House Sardinia',
    websiteUrl: SITE,
    rootDomain: 'kitehousesardinia.com',
    contactEmail: 'info@kitehousesardinia.com',
    phone: '+393929470448',
    whatsapp: '+393929470448',
  },
  url: KHS_APTS_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  async fetchContent() {
    const [home, apartments, seasons] = [
      await fetchText(KHS_HOME_URL, { accept: 'text/html' }),
      await fetchText(KHS_APTS_URL, { accept: 'text/html' }),
      await fetchText(KHS_SEASONS_URL, { accept: 'text/html' }),
    ];
    return parseKiteHouseSardiniaContent({ home, apartments, seasons });
  },
  async fetchSlots() {
    const apts = parseKhsApartments(await fetchText(KHS_APTS_URL, { accept: 'text/html' }));
    if (apts.length < 3) throw new Error(`kite-house-sardinia: expected the apartment rate blocks on ${KHS_APTS_URL}, parsed ${apts.length}`);
    return buildKhsSlots(apts);
  },
};
