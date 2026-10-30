// ---------------------------------------------------------------------------
// Casa Mikoko (Umm Al Quwain, United Arab Emirates) - small eco beach resort of five chalets in the mangroves of Khor Al
// Yeefrah on the Arabian Gulf; the resort's activity list includes a kitesurfing course (1-10 hours, certified
// instructors, IKO certification available) next to kayak, SUP and sailing trips. Press reports (2023) place the
// bungalows at the Kite Beach Center Umm Al Quwain; the site itself only says "Mangrove Beach, Umm Al Quwain".
//
// Data path (checked 2026-10-30): casamikoko.com is a Vite/React single-page app - the HTML is an empty shell, every text
//   and price sits in ONE bundle /assets/index-<hash>.js (the hash changes per deploy, so it is read from the home HTML).
//   rooms    the accommodations page array: per chalet {id:"chalet-...",title,description,images:[...],details,price:"AED
//            n",capacity,features:[...],bookingLink}. 5 chalets on 2026-10-30: Moja 101 + Mbili 102 (private pool, AED
//            2,200), Tatu 103 + Nne 104 (outdoor bathtub, AED 1,200), Tano 105 (2 rooms, pool, AED 4,500).
//            The home page cards print other prices for the same types (1,320 without pool, 4,300 family); the chalet
//            list is the more specific source and is used, the card prices go to sourceText.
//   kite     the activities array entry {id:"kitesurfing-course",...,duration:"1-10 hours",price:"AED 300-2,500"} and the
//            detail entry "kitesurfing-course":{full,features,includes,capacity}.
//   policy   "Free cancellation up to 7 days before arrival", "Complimentary WiFi, breakfast, and parking".
// Booking: "Book Now" goes to the RMS Cloud booking engine (ibe12.rmscloud.com); its availability calls need a session,
//   so no live prices -> 'price_table', availability 'unknown'. The kite course is "Enquire now" only.
// Contact: booking@casamikoko.ae, info@casamikoko.ae, phone / WhatsApp +971 52 729 3060 and +971 55 812 3060.
// robots.txt (2026-10-30): "Allow: /", disallows /admin, /private, /api/ and *.json - the HTML and the JS bundle are allowed.
// Requests per run: 2 (home HTML + bundle, memoised; content and slots share them).
// Map pin = the Google Maps embed on the contact page (!2d55.6286385 !3d25.5392061).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://casamikoko.com';
export const CM_HOME_URL = `${SITE}/`;
export const CM_KITE_URL = `${SITE}/activity/kitesurfing-course`;
const BOOKING_URL = 'https://ibe12.rmscloud.com/BA32117C1581D605/59';
/** Google Maps embed on the contact page ("!2d55.62863850000001!3d25.539206099999998", 2026-10-30). */
export const CM_COORDS = { lat: 25.5392061, lng: 55.6286385 };

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string, accept?: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, accept ? { accept } : {});
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** The app bundle named in the home HTML (<script type="module" src="/assets/index-<hash>.js">). */
export function cmBundleUrl(home: string): string | null {
  const m = home.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? `${SITE}${m[0]}` : null;
}

async function bundle(): Promise<{ home: string; js: string }> {
  const home = await page(CM_HOME_URL);
  const url = cmBundleUrl(home);
  if (!url) throw new Error('casa-mikoko: no /assets/index-*.js bundle in the home HTML (build changed?)');
  return { home, js: await page(url, 'application/javascript,*/*;q=0.8') };
}

const strings = (list: string) => [...list.matchAll(/"([^"]*)"/g)].map(m => m[1]);

export interface CmChalet {
  id: string;
  title: string;
  description: string;
  details: string;
  price: number | null;
  capacity: string;
  features: string[];
  images: string[];
}

/** Chalet objects of the accommodations page (English fields; the *Ar twins are skipped). */
export function parseCmChalets(js: string): CmChalet[] {
  const out: CmChalet[] = [];
  const re = /\{id:"(chalet-[a-z0-9-]+)",title:"([^"]+)",[^{}]*?description:"([^"]*)",[^{}]*?images:\[([^\]]*)\],details:"([^"]*)",[^{}]*?price:"([^"]*)",capacity:"([^"]*)",[^{}]*?features:\[([^\]]*)\]/g;
  for (const m of js.matchAll(re)) {
    if (out.some(c => c.id === m[1])) continue;
    out.push({
      id: m[1],
      title: clean(m[2].replace(/\s*[—–-]\s*/g, ' ')),
      description: clean(m[3]),
      images: strings(m[4]).map(p => new URL(p, SITE).href),
      details: clean(m[5]),
      price: parseAmount(m[6]),
      capacity: clean(m[7]),
      features: strings(m[8]),
    });
  }
  return out;
}

export type CmRoomType = 'pool' | 'bathtub' | 'family';
export const CM_TYPE_NAMES: Record<CmRoomType, string> = {
  pool: 'Bungalow with private pool',
  bathtub: 'Bungalow with outdoor bathtub',
  family: 'Family bungalow (2 rooms, private pool)',
};
export function cmType(c: CmChalet): CmRoomType {
  if (c.features.includes('2 Bedrooms')) return 'family';
  return c.features.includes('Private Pool') ? 'pool' : 'bathtub';
}

/** The home page cards ("Bungalows With Pool" … priceRange:"AED 2,200") - only for sourceText. */
export function parseCmCards(js: string): string[] {
  return [...js.matchAll(/nameKey:"([^"]+)",descriptionKey:"[^"]*",priceRange:"([^"]+)",capacity:"([^"]+)"/g)]
    .map(m => `${m[1]}: ${m[2]} per night (${m[3]})`);
}

export interface CmKite { duration: string; price: string; min: number | null; max: number | null; full: string; features: string[]; includes: string[]; capacity: string }

export function parseCmKite(js: string): CmKite | null {
  const a = js.match(/\{id:"kitesurfing-course",name:"Kitesurfing Course",[^{}]*?duration:"([^"]+)",[^{}]*?price:"([^"]+)"/);
  const d = js.match(/"kitesurfing-course":\{full:"([^"]+)",[^{}]*?features:\[([^\]]*)\],[^{}]*?includes:\[([^\]]*)\],[^{}]*?capacity:"([^"]+)"/);
  if (!a) return null;
  const [lo, hi] = a[2].replace(/^AED\s*/, '').split(/\s*-\s*/);
  return {
    duration: a[1],
    price: a[2],
    min: parseAmount(lo ?? ''),
    max: parseAmount(hi ?? lo ?? ''),
    full: d ? clean(d[1]) : '',
    features: d ? strings(d[2]) : [],
    includes: d ? strings(d[3]) : [],
    capacity: d ? d[4] : '',
  };
}

/** One slot per room type at the lowest chalet price of that type; AED per night per chalet, no dates (the site prints none). */
export function buildCmSlots(chalets: CmChalet[]): Slot[] {
  const out: Slot[] = [];
  for (const t of ['bathtub', 'pool', 'family'] as CmRoomType[]) {
    const group = chalets.filter(c => cmType(c) === t && c.price);
    if (!group.length) continue;
    const price = Math.min(...group.map(c => c.price!));
    const occupancy = Number(group[0].capacity.match(/^(\d+)/)?.[1]) || null;
    out.push({
      key: `room|${t}`,
      startDate: null,
      endDate: null,
      unit: CM_TYPE_NAMES[t],
      room: group.map(c => c.title).join(', '),
      price,
      currency: 'AED',
      priceUnit: 'per_night',
      priceBasis: 'room',
      occupancy,
      availability: 'unknown',
      availabilityText: `${group.map(c => c.title).join(', ')}: ${group[0].capacity}; breakfast included; free cancellation up to 7 days before arrival`,
      spotsLeft: null,
    });
  }
  return out;
}

const SKIP_IMG = /logo|dining|favicon|apple-touch/i;

export function cmImages(js: string, chalets: CmChalet[]): string[] {
  const out: string[] = [];
  const add = (u: string) => { if (!SKIP_IMG.test(u) && !out.includes(u)) out.push(u); };
  // chalet photos first: the .webp section images (aerial, banner) look edited or rendered
  for (const c of chalets) for (const u of c.images) add(u);
  for (const m of js.matchAll(/"(\/images\/[A-Za-z0-9_.-]+\.(?:jpe?g|webp|png))"/g)) add(`${SITE}${m[1]}`);
  return out;
}

export function parseCasaMikokoContent(js: string): OfferContent {
  const chalets = parseCmChalets(js);
  const kite = parseCmKite(js);
  const slots = buildCmSlots(chalets);
  const rooms: ContentRoom[] = (['bathtub', 'pool', 'family'] as CmRoomType[]).flatMap(t => {
    const g = chalets.filter(c => cmType(c) === t);
    return g.length ? [{ name: CM_TYPE_NAMES[t], description: `${g.map(c => c.title).join(', ')}: ${g[0].details}`, features: g[0].features }] : [];
  });
  const from = slots.length ? Math.min(...slots.map(s => s.price ?? Infinity)) : null;

  const summary = [
    'Casa Mikoko is a small eco beach resort of five chalets in the mangroves of Khor Al Yeefrah, Umm Al Quwain, on the Arabian Gulf coast of the United Arab Emirates.',
    `The chalets have a queen bed, a balcony and either a private pool or an outdoor bathtub; a two-room family chalet sleeps six${from ? `. Prices start at AED ${from.toLocaleString('en-US')} per chalet and night with breakfast` : ''}.`,
    kite ? `The resort runs a kitesurfing course of ${kite.duration} (AED ${kite.min?.toLocaleString('en-US')} to ${kite.max?.toLocaleString('en-US')}) with certified instructors, all gear included and IKO certification available, in the shallow water of the lagoon; it is booked on request.` : '',
    'Kayak tours through the mangroves, stand-up paddling and traditional sailing trips are offered as well.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Casa Mikoko, Umm Al Quwain',
    summary,
    continent: 'Asia',
    country: 'United Arab Emirates',
    region: 'Umm Al Quwain',
    spot: 'Khor Al Yeefrah, Umm Al Quwain',
    spotCoords: CM_COORDS,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite ? true : null,
    equipmentRental: null,
    beginnerFriendly: kite ? true : null,
    includedServices: ['Breakfast', 'WiFi', 'Parking'],
    optionalServices: [
      ...(kite ? [`Kitesurfing course ${kite.duration}: ${kite.price} (on request; ${kite.includes.join(', ')}; ${kite.capacity})`] : []),
      'Extra bed: AED 300 per night',
      'Kayak mangrove tour, stand-up paddle, sailing boat trips',
    ],
    accommodation: 'beach chalets with private pool or outdoor bathtub',
    mealPlan: 'breakfast',
    languages: ['en', 'ar'],
    rooms,
    imageUrls: cmImages(js, chalets).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CM_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `chalets: ${chalets.map(c => `${c.title} AED ${c.price} (${c.capacity}; ${c.features.join(', ')})`).join('; ')}`,
      `home cards: ${parseCmCards(js).join('; ')}`,
      `kite: ${kite ? `${kite.duration} ${kite.price} | ${kite.full} | ${kite.features.join(', ')} | ${kite.includes.join(', ')} | ${kite.capacity}` : 'not found'}`,
    ].join('\n'),
  };
}

export const casaMikokoUmmAlQuwain: OfferAdapter = {
  key: 'casa-mikoko-umm-al-quwain',
  name: 'Casa Mikoko, Umm Al Quwain',
  kind: 'accommodation',
  operator: {
    name: 'Casa Mikoko',
    websiteUrl: SITE,
    rootDomain: 'casamikoko.com',
    contactEmail: 'booking@casamikoko.ae',
    whatsapp: '+971527293060',
    phone: '+971527293060',
  },
  url: CM_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  async fetchContent() {
    const { js } = await bundle();
    if (!parseCmChalets(js).length) throw new Error('casa-mikoko: no chalet objects in the bundle (app rebuilt?)');
    if (!parseCmKite(js)) throw new Error('casa-mikoko: kitesurfing course missing from the activities (kite offer gone?)');
    return parseCasaMikokoContent(js);
  },
  async fetchSlots() {
    const { js } = await bundle();
    const chalets = parseCmChalets(js);
    if (!chalets.length) throw new Error('casa-mikoko: no chalet objects in the bundle (app rebuilt?)');
    return buildCmSlots(chalets);
  },
};
