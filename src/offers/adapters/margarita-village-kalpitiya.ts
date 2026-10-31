// ---------------------------------------------------------------------------
// Margarita Village, Kalpitiya (Sri Lanka) - the rustic kite camp of Margarita Kite School (IKO, since 2014):
// five wooden bungalows with open-air showers in Setthawadiya, about 10 minutes on foot / 5 by bike from the
// school's kite center on the Kalpitiya lagoon.
//
// Found via bstoked listings 7458 + 7776 (the same business; inactive). The camp has its OWN website, so
// nothing is read from bstoked (Aaron's data rule 2026-10-12: data from the provider's own site).
// Data path (checked 2026-10-12): WordPress (Divi + Yoast), English pages.
//   content  / (camp intro, seasons, how to get there, Google Maps embed of "Margarita Village Kalpitiya"),
//            /kite-camp-kalpitiya-sri-lanka/ (5 bungalows, facilities, kite school, FAQ),
//            /prices/ (camp services, add-ons).
//   slots    /prices/ "Bungalow Rates - Bed & Breakfast": one bungalow type, three occupancy options, EUR per
//            person per night (single 45 / double 20 / triple 18 on 2026-10-12). No dates, no season limits,
//            no inventory: bookings by WhatsApp or contact form ("We will confirm availability") ->
//            'on_request'. The site also lists the camp on Booking.com / Airbnb / Agoda; not read.
// Liveness (rule 5b): /prices/ datePublished 2026-04-08, dateModified 2026-04-26; home dateModified
//   2026-05-12 (Yoast JSON-LD) -> current 2026 rates.
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 3, slots 1.
// Map pin: the home page's own Google Maps embed (!3d8.23315390008622 !2d79.74558152042265).
// Known limits: special combined rates with kite lessons are "on enquiry" only; lesson prices live on the
//   school's site (margaritakiteschool.com, not read) - only the "from" figures the camp site prints are kept.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.margarita-village.com';
export const MV_HOME_URL = `${SITE}/`;
export const MV_CAMP_URL = `${SITE}/kite-camp-kalpitiya-sri-lanka/`;
export const MV_PRICES_URL = `${SITE}/prices/`;
const CONTACT_URL = `${SITE}/contact/`;
export const MV_UNIT = 'Wooden bungalow';

export interface MvRate { label: string; persons: number; price: number }

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  return collapse((root.querySelector('#main-content') ?? root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

const between = (t: string, from: RegExp, to: RegExp): string => {
  const a = t.search(from);
  if (a < 0) return '';
  const rest = t.slice(a);
  const b = rest.slice(1).search(to);
  return b < 0 ? rest : rest.slice(0, b + 1);
};

// --- pure parsers -------------------------------------------------------------------------------------
/** "Single Occupancy 1 person in the bungalow €45 per person / night · B&B" (x3). */
export function parseMvRates(html: string): MvRate[] {
  const t = between(mainText(html), /Bungalow Rates/i, /Special rates|All our camp services/i);
  const out: MvRate[] = [];
  for (const m of t.matchAll(/(Single|Double|Triple) Occupancy\s+(\d)\s+(?:person|people)[^€]{0,80}?€\s?(\d+(?:[.,]\d+)?)\s*per person\s*\/\s*night/gi)) {
    const price = parseAmount(m[3]);
    if (price && !out.some(r => r.persons === Number(m[2]))) out.push({ label: `${m[1]} occupancy`, persons: Number(m[2]), price });
  }
  return out;
}

export function buildMvSlots(rates: MvRate[]): Slot[] {
  return rates.map(r => ({
    key: `bungalow-${r.persons}p`,
    startDate: null,
    endDate: null,
    unit: MV_UNIT,
    price: r.price,
    currency: 'EUR',
    priceUnit: 'per_night',
    priceBasis: 'person',
    occupancy: r.persons,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** "All our camp services" list and the priced add-ons ("Bike Rental €3 / day ..."). */
export function parseMvServices(html: string): { included: string[]; addOns: string[] } {
  const t = mainText(html);
  const svc = between(t, /All our camp services/i, /Booking via Booking\.com/i);
  const included = ['Bed & breakfast daily', 'Boat transfers to the lagoon', 'Equipment storage at kite center', 'Safety rescue service', 'Beach hut assistance', 'Complimentary coffee & water']
    .filter(s => svc.toLowerCase().includes(s.toLowerCase()));
  const addOns: string[] = [];
  const add = between(t, /Activities, Meals & Equipment/i, /What your money buys|More Than Just a Bed/i);
  for (const [name, re] of [
    ['Bike rental', /Bike Rental\s+(€\s?[\d.,]+\s*\/\s*day)/i],
    ['Kayak', /Kayak\s+(Free)/i],
    ['Yoga session', /Yoga Session\s+(€\s?[\d.,]+\s*\/\s*session)/i],
    ['Lunch at the beach hut', /Lunch at Beach Hut\s+(€\s?[\d.,]+\s*\/\s*person)/i],
    ['Dinner at the kite center', /Dinner at Kite Center\s+(€\s?[\d.,]+\s*\/\s*person)/i],
    ['Dolphin watching tour', /Dolphin Watching Tour\s+(Ask us)/i],
  ] as Array<[string, RegExp]>) {
    const m = add.match(re);
    if (m) addOns.push(`${name}: ${m[1].replace(/€\s?/, 'EUR ').replace(/\s*\/\s*/, ' per ').replace(/^Free$/, 'free').replace(/^Ask us$/, 'on request')}`);
  }
  const lessons = t.match(/Kite Lessons\s*[—-]\s*from\s*€\s?(\d+)\s*\/\s*h/i)?.[1];
  const trips = t.match(/Kite Trips\s*[—-]\s*from\s*€\s?(\d+)/i)?.[1];
  const course = t.match(/kite lessons from (\d+)€ at Margarita Kite School/i)?.[1];
  if (lessons) addOns.push(`Kite lessons at Margarita Kite School: from EUR ${lessons} per hour`);
  if (course) addOns.push(`Full IKO beginner course: from EUR ${course}`);
  if (/Wing Lessons/i.test(t)) addOns.push('Wingfoil lessons');
  if (/Equipment Rental/i.test(t)) addOns.push('Equipment rental');
  if (trips) addOns.push(`Kite trips: from EUR ${trips}`);
  return { included, addOns };
}

/** The home page's Google Maps embed of the camp: ...!2d<lng>!3d<lat>... */
export function parseMvCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

// --- content --------------------------------------------------------------------------------------------
const lcFirst = (x: string): string => x.charAt(0).toLowerCase() + x.slice(1);
export interface MvPages { home: string; camp: string; prices: string }

export function parseMargaritaVillageContent(p: MvPages): OfferContent {
  const home = mainText(p.home);
  const camp = mainText(p.camp);
  const rates = parseMvRates(p.prices);
  const { included, addOns } = parseMvServices(p.prices);
  const coords = parseMvCoords(p.home);
  const nBungalows = camp.match(/has (\d+) rustic wooden bungalows/i)?.[1] ?? camp.match(/(\w+) wooden bungalows/i)?.[1] ?? null;
  const summer = home.match(/Summer Season\s+(Mid-May to mid-October)/i)?.[1] ?? null;
  const winter = home.match(/Winter Season\s+(Mid-December to mid-March)/i)?.[1] ?? null;
  if (rates.length === 0) throw new Error('margarita-village: bungalow rate cards not found on /prices/ (page changed)');
  const min = Math.min(...rates.map(r => r.price));
  const max = Math.max(...rates.map(r => r.price));

  const summary = [
    `Margarita Village is the kite camp of Margarita Kite School in the Setthawadiya neighbourhood of Kalpitiya on Sri Lanka's northwest coast: ${nBungalows ?? 'five'} rustic wooden bungalows with open-air showers under coconut trees, about 10 minutes on foot or 5 by bike from the school's kite center on the Kalpitiya lagoon.`,
    `Rates are bed and breakfast per person (EUR ${min} to ${max} a night depending on how many share a bungalow); booked directly they include boat transfers on the lagoon, gear storage at the kite center and the rescue service.`,
    `The IKO-certified school teaches kitesurfing and wingfoiling with radio helmets and a rescue boat${summer && winter ? `; the wind seasons run ${lcFirst(summer)} and ${lcFirst(winter)}` : ''}.`,
  ].join(' ');

  const rooms: ContentRoom[] = [{
    name: MV_UNIT,
    description: `${nBungalows ?? 'Five'} rustic wooden bungalows built with local timber, with open-air tropical showers under the coconut trees; one bungalow type for 1 to 3 persons.`,
    features: [
      'Open-air tropical shower',
      'Bed & breakfast',
      ...rates.map(r => `${r.label} (${r.persons} person${r.persons > 1 ? 's' : ''}): EUR ${r.price} per person per night, B&B`),
    ],
  }];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.camp, MV_CAMP_URL, null, 40), ...imageCandidates(p.home, MV_HOME_URL, null, 40)]) {
    if (/\.svg|logo|icon|cropped-|favicon/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  return {
    kind: 'accommodation',
    title: 'Margarita Village',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya',
    spotCoords: coords,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // camp page: "Beginner, intermediate, advanced and wingfoil lessons available." (2026-10-12)
    skillLevels: /Beginner, intermediate, advanced/i.test(camp) ? ['beginner', 'intermediate', 'advanced'] : ['beginner'],
    kiteLessons: true,
    equipmentRental: /Equipment Rental/i.test(mainText(p.prices)),
    beginnerFriendly: /good for beginner|best places in the world to learn/i.test(home),
    includedServices: included,
    optionalServices: addOns,
    accommodation: 'rustic wooden bungalows with open-air showers in a kite camp',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MV_CAMP_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `home: ${between(home, /Kitesurfing Holidays\s+in Kalpitiya/i, /What guests say/i)}`,
      `seasons: summer ${summer ?? '-'}, winter ${winter ?? '-'}`,
      `camp: ${between(camp, /Kite Camp in Kalpitiya/i, /What guests say/i)}`,
      `rates (EUR per person per night, B&B): ${rates.map(r => `${r.label} ${r.price}`).join('; ')}`,
      `camp services: ${included.join('; ')}`,
      `add-ons: ${addOns.join('; ')}`,
      `map pin: ${coords ? `${coords.lat},${coords.lng} (home page Google Maps embed)` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter --------------------------------------------------------------------------------------------
export const margaritaVillageKalpitiya: OfferAdapter = {
  key: 'margarita-village-kalpitiya',
  name: 'Margarita Village (Kalpitiya)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Margarita Village',
    websiteUrl: SITE,
    rootDomain: 'margarita-village.com',
    contactEmail: 'info@margarita-village.com', // the home page's contact-form mailto, 2026-10-12
    whatsapp: '+94773312378',                   // /prices/: "WhatsApp Nisala directly on +94 77 331 23 78"
    phone: '+94773312378',                      // site footer
  },
  url: MV_CAMP_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent() {
    const home = await fetchText(MV_HOME_URL, { accept: 'text/html' });
    const camp = await fetchText(MV_CAMP_URL, { accept: 'text/html' });
    const prices = await fetchText(MV_PRICES_URL, { accept: 'text/html' });
    return parseMargaritaVillageContent({ home, camp, prices });
  },
  async fetchSlots() {
    const rates = parseMvRates(await fetchText(MV_PRICES_URL, { accept: 'text/html' }));
    if (rates.length < 3) throw new Error(`margarita-village: bungalow rate table not found or changed (${rates.length} rates parsed)`);
    return buildMvSlots(rates);
  },
};
