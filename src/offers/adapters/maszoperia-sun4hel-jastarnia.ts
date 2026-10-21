// ---------------------------------------------------------------------------
// Maszoperia Sun4Hel (Jastarnia, Hel Peninsula, Poland) - family campsite on the Puck Bay side of Jastarnia with its
// own water sports school Surf4Hel (kitesurfing and windsurfing for adults and children, wingfoil, rental). Campsite
// rule: only the rental units are listed - 12 surf caravans, Wiatr family rooms, Sky container rooms and Woda rooms;
// tent pitches ("Pole namiotowe") and camper plots ("Kampery") are left out. Kite link: Surf4Hel on the campsite.
//
// Liveness (2026-10-12): footer link "Cennik 2026" -> /cennik-2026 (the 2026 price list), "© 2026".
// Data path (checked 2026-10-12): Joomla (Gridbox), Polish only.
//   slots    /cennik-YYYY (found via the newest "Cennik YYYY" link on the home page): one <p> per unit,
//            "Przyczepy od 100 zł do 750 zł – w zależności od terminu," - a from-to range per year, no dates.
//   content  / (home, contacts), the unit pages /zarezerwuj-pobyt/{przyczepy-kempingowe, pokoje-wiatr,
//            pokoje-sky, pokoje-woda} (counts, beds, equipment, parking) and /szkola-surf4hel/kitesurfing-dla-
//            doroslych (beginner and rider courses, school seasons "27.04 - 23.06 i 02.09 - 13.10" / "23.06 - 01.09").
// Booking engine: RoomAdmin widgets (roomadmin.pl / se.roomadmin.pl /widget/...) - robots.txt disallows /widget/,
//   /ws/ and every URL with a query -> not called, availability 'unknown'.
// robots.txt (2026-10-12): Joomla default (/administrator/, /api/, /components/, /modules/, ... disallowed) - the
//   pages we read are allowed.
// Requests per run: content 7, slots 2 (home + price list, memoised).
// Parsed: slot = unit for the price-list year ("caravan|2026", 2026-01-01..2026-12-31, datePrecision 'season'),
//   price = the "od" (from) amount, PLN per unit and night (per night inferred: the list prints only "od X zł do Y
//   zł", the same list prices pets per "doba"), availability 'unknown'. The upper bound goes into the room features.
// Known limits: no dates per price (the range spans low to high season); when a new "Cennik" year appears the slot
//   keys move with it; no map pin on the site (the Windy embed is a wind map, not the campsite).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, iso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://sun4hel.pl';
export const S4H_HOME_URL = `${SITE}/`;
export const S4H_UNIT_URLS = {
  caravan: `${SITE}/zarezerwuj-pobyt/przyczepy-kempingowe`,
  wiatr: `${SITE}/zarezerwuj-pobyt/pokoje-wiatr`,
  sky: `${SITE}/zarezerwuj-pobyt/pokoje-sky`,
  woda: `${SITE}/zarezerwuj-pobyt/pokoje-woda`,
} as const;
export const S4H_KITE_URL = `${SITE}/szkola-surf4hel/kitesurfing-dla-doroslych`;
const BOOKING_URL = `${SITE}/zarezerwuj-pobyt`;

type UnitKey = keyof typeof S4H_UNIT_URLS;
const UNITS: Array<{ key: UnitKey; re: RegExp; name: string }> = [
  { key: 'caravan', re: /^Przyczepy\b/i, name: 'Surf caravan' },
  { key: 'wiatr', re: /^Pokoje Wiatr\b/i, name: 'Wiatr family room' },
  { key: 'sky', re: /^Pokoje Sky\b/i, name: 'Sky room' },
  { key: 'woda', re: /^Pokoje Woda\b/i, name: 'Woda room' },
];

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
/** Visible lines of the Gridbox page body (menus repeat on every page; callers slice what they need). */
export function s4hLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
/** The page's own text block: between the first "Kontakt" menu item and the "Mapa kempingu" teaser grid. */
function body(html: string): string {
  const l = s4hLines(html);
  const a = l.indexOf('Kontakt');
  const b = l.indexOf('Mapa kempingu', a + 1);
  return l.slice(a + 1, b > a ? b : undefined).join('\n');
}
const PL_NUM: Record<string, number> = {
  jeden: 1, dwa: 2, trzy: 3, cztery: 4, czterech: 4, 'pięć': 5, 'pięciu': 5, 'sześć': 6, 'sześciu': 6, siedem: 7,
  siedmiu: 7, osiem: 8, 'ośmiu': 8, 'dziewięć': 9, 'dziesięć': 10, 'jedenaście': 11, 'dwanaście': 12,
};
const plNum = (w: string | undefined): number | null => (w ? (PL_NUM[w.toLowerCase()] ?? (Number(w) || null)) : null);

// --- pure parsers -----------------------------------------------------------------------------
/** Newest "Cennik YYYY" link of the home page. */
export function s4hPriceListUrl(home: string): { url: string; year: number } | null {
  const links = [...home.matchAll(/href="(\/cennik-(20\d{2}))"/g)].map(m => ({ url: `${SITE}${m[1]}`, year: Number(m[2]) }));
  return links.sort((a, b) => b.year - a.year)[0] ?? null;
}

export interface S4hPrice { key: UnitKey; name: string; from: number; to: number; raw: string }
export function parseS4hPrices(html: string): S4hPrice[] {
  const out: S4hPrice[] = [];
  for (const l of s4hLines(html)) {
    const m = l.match(/^(.+?) od (\d[\d\s]*)\s*zł do (\d[\d\s]*)\s*zł/i);
    const u = m ? UNITS.find(x => x.re.test(m[1])) : undefined;
    if (!m || !u || out.some(o => o.key === u.key)) continue;
    out.push({ key: u.key, name: u.name, from: Number(m[2].replace(/\s/g, '')), to: Number(m[3].replace(/\s/g, '')), raw: l.replace(/,\s*$/, '') });
  }
  return out;
}

export function buildS4hSlots(prices: S4hPrice[], year: number): Slot[] {
  return prices.map(p => ({
    key: `${p.key}|${year}`,
    startDate: iso(year, 1, 1),
    endDate: iso(year, 12, 31),
    datePrecision: 'season' as const,
    unit: p.name,
    price: p.from,
    currency: 'PLN',
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: null,
    availability: 'unknown' as const,
    availabilityText: null,
    spotsLeft: null,
  }));
}

export interface S4hPages { home: string; prices: string; year: number; caravan: string; wiatr: string; sky: string; woda: string; kite: string }

export function parseSun4helContent(p: S4hPages): OfferContent {
  const prices = parseS4hPrices(p.prices);
  const range = (k: UnitKey) => { const x = prices.find(y => y.key === k); return x ? [`PLN ${x.from}-${x.to} per night depending on the dates (price list ${p.year})`] : []; };
  const car = body(p.caravan);
  const wia = body(p.wiatr);
  const sky = body(p.sky);
  const wod = body(p.woda);
  const kite = body(p.kite);
  const nCar = plNum(car.match(/(\S+) surferskich przyczep/i)?.[1]);
  const carGuests = car.match(/od (\S+) do (\S+) osób/i);
  const nWia = plNum(wia.match(/(\S+) pokoi mieszkalnych/i)?.[1]);
  const nSky = plNum(sky.match(/(\S+) pokoi SKY/i)?.[1]);
  const skyView = plNum(sky.match(/z czego (\S+) z widokiem na zatokę/i)?.[1]);
  const skyMax = plNum(sky.match(/max (\S+) osób/i)?.[1]);
  const lowSeason = kite.match(/sezon niski:\s*([\d.]+\s*-\s*[\d.]+ i [\d.]+\s*-\s*[\d.]+)/i)?.[1]?.replace(' i ', ' and ') ?? null;
  const pets = s4hLines(p.prices).join(" ").match(/Zwierzak\s*[–-]\s*(\d+)\s*zł\s*\/\s*doba/i)?.[1] ?? null;
  const highSeason = kite.match(/sezon wysoki:\s*([\d.]+\s*-\s*[\d.]+)/i)?.[1] ?? null;
  const guard = (re: RegExp, text: string, f: string) => (re.test(text) ? [f] : []);

  const rooms: ContentRoom[] = [
    {
      name: 'Surf caravan',
      description: `${nCar ?? 'Several'} surf caravans in a shared fenced area${carGuests ? ` for ${plNum(carGuests[1])} to ${plNum(carGuests[2])} guests` : ''}, each with an equipped awning and one parking space.`,
      features: [
        ...guard(/łóżko trzypiętrowe/i, car, 'Example layout: triple bunk bed, double bed, sofa bed'),
        ...guard(/kuchenka indukcyjna/i, car, 'Bed linen, TV, induction hob, fridge, electric kettle, crockery and cookware'),
        ...guard(/podłączona jest do wody i prądu/i, car, 'Water and electricity connection'),
        ...guard(/komplet ratanowy/i, car, 'Awning with rattan lounge set, dining table, wardrobe, wetsuit rack and wooden floor'),
        ...guard(/sanitariaty/i, car, 'Shared showers and toilets nearby'),
        ...range('caravan'),
      ],
    },
    {
      name: 'Wiatr family room',
      description: `${nWia ?? 'Several'} family rooms in a U-shaped building around an atrium with a transparent roof and a shared kitchen; one parking space included.`,
      features: [
        ...guard(/rozkładaną sofę/i, wia, 'Sofa bed, cupboards, table and chairs, TV, crockery for 2-4 guests'),
        ...guard(/pościel/i, wia, 'Bed linen'),
        ...guard(/wspólna kuchnia/i, wia, 'Shared kitchen with fridge, microwave and induction hob in the atrium'),
        ...range('wiatr'),
      ],
    },
    {
      name: 'Sky room',
      description: `${nSky ?? 'Several'} rooms built from living containers on two levels${skyView ? `, ${skyView} with a view of the bay 50 m away` : ''}${skyMax ? `, for up to ${skyMax} guests` : ''}.`,
      features: [
        ...guard(/łóżko piętrowe, dwuosobową kanapę/i, sky, 'Bunk bed and double sofa bed'),
        ...guard(/telewizor/i, sky, 'TV, kettle, crockery for 2-4 guests, bed linen'),
        ...guard(/aula z częścią kuchenną/i, sky, 'Glass-roofed common hall with kitchen and lounge, hammocks outside'),
        ...guard(/sanitariaty/i, sky, 'Shared showers and toilets nearby'),
        ...guard(/części pokojów SKY przynależne jest miejsce parkingowe/i, sky, 'Parking space for some rooms'),
        ...range('sky'),
      ],
    },
    {
      name: 'Woda room',
      description: 'Room with a corner sofa that opens into a double bed (one child may share it with the parents), in a shared recreation area; one parking space included.',
      features: [
        ...guard(/szafę, komodę/i, wod, 'Wardrobe, chest of drawers, table and chairs, TV, kettle, cookware and crockery'),
        ...guard(/zadaszony dziedziniec/i, wod, 'Covered courtyard of about 200 m², upstairs patio, hammocks and loungers'),
        ...guard(/dwie strefy kuchenne/i, wod, 'Two shared kitchen areas'),
        ...range('woda'),
      ],
    },
  ];

  const imageUrls: string[] = [];
  for (const [html, url] of [[p.caravan, S4H_UNIT_URLS.caravan], [p.sky, S4H_UNIT_URLS.sky], [p.wiatr, S4H_UNIT_URLS.wiatr], [p.woda, S4H_UNIT_URLS.woda], [p.kite, S4H_KITE_URL]] as const) {
    for (const u of imageCandidates(html, url, null, 60)) {
      if (!/\/images\/s4h\/(przyczepy-kem|pokoje-(wiatr|sky|woda)|Surf4Hel)\//i.test(u)) continue;
      if (!imageUrls.includes(u)) imageUrls.push(u);
    }
  }

  const car$ = prices.find(x => x.key === 'caravan');
  const rooms$ = prices.filter(x => x.key !== 'caravan');
  const summary = [
    'Maszoperia Sun4Hel is a family campsite in Jastarnia on the Puck Bay side of the Hel Peninsula with its own water sports school, Surf4Hel, which teaches kitesurfing and windsurfing to adults and children, plus wingfoil and equipment rental.',
    `For rent are ${nCar ?? ''} surf caravans${carGuests ? ` for ${plNum(carGuests[1])} to ${plNum(carGuests[2])} guests` : ''}, ${nWia ?? ''} Wiatr family rooms around a shared kitchen, ${nSky ?? ''} Sky container rooms${skyView ? ` (${skyView} with a bay view)` : ''} and Woda rooms, all with bed linen and most with a parking space.`.replace(/\s{2,}/g, ' '),
    car$ && rooms$.length
      ? `The ${p.year} price list gives PLN ${car$.from}-${car$.to} per caravan and PLN ${Math.min(...rooms$.map(r => r.from))}-${Math.max(...rooms$.map(r => r.to))} per room and night depending on the dates; the campsite also has restaurants, a pizzeria, a food truck, shops and children's activities.`
      : null,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Maszoperia Sun4Hel',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Jastarnia, Hel Peninsula',
    spot: 'Jastarnia',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: /pływający/i.test(kite) ? ['beginner', 'intermediate'] : ['beginner'],
    kiteLessons: /Kitesurfing dla dorosłych/i.test(kite),
    equipmentRental: /Wypożyczalnia/i.test(p.home),
    beginnerFriendly: /początkujący/i.test(kite) ? true : null,
    includedServices: ['Bed linen', 'One parking space (caravans, Wiatr and Woda rooms)'],
    optionalServices: [
      `Kitesurfing for adults (beginners and riders, private or group) and children at Surf4Hel${lowSeason && highSeason ? ` (low season ${lowSeason}, high season ${highSeason})` : ''}`,
      'Windsurfing, wingfoil and skateboard lessons; equipment rental',
      'Restaurant, pizzeria, food truck and shops on the campsite',
      'Children\'s animation, summer camps, Lady Camps',
      ...(pets ? [`Pets PLN ${pets} per night`] : []),
    ],
    accommodation: 'campsite caravans, family rooms and container rooms',
    mealPlan: 'self_catering',
    languages: ['pl'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: S4H_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `price list ${p.year}: ${parseS4hPrices(p.prices).map(x => x.raw).join(' | ')}`,
      `caravans: ${car}`, `wiatr: ${wia}`, `sky: ${sky}`, `woda: ${wod}`, `kite school: ${kite}`,
      `contact: ${(s4hLines(p.home).join('\n').match(/MASZOPERIA SUN4HEL[\s\S]*?obozy@sun4hel\.pl/) ?? [''])[0]}`,
    ].join('\n'),
  };
}

async function priceList(): Promise<{ html: string; year: number }> {
  const link = s4hPriceListUrl(await get(S4H_HOME_URL));
  if (!link) throw new Error('maszoperia-sun4hel-jastarnia: no "Cennik YYYY" link on the home page');
  return { html: await get(link.url), year: link.year };
}

export const maszoperiaSun4helJastarnia: OfferAdapter = {
  key: 'maszoperia-sun4hel-jastarnia',
  name: 'Maszoperia Sun4Hel Jastarnia',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Maszoperia Sun4Hel',
    websiteUrl: SITE,
    rootDomain: 'sun4hel.pl',
    contactEmail: 'rezerwacja@sun4hel.pl',
    phone: '+48 793 416 998',
  },
  url: S4H_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 8,
  confidence: 'low',
  async fetchContent() {
    const home = await get(S4H_HOME_URL);
    const { html: prices, year } = await priceList();
    const [caravan, wiatr, sky, woda, kite] = [
      await get(S4H_UNIT_URLS.caravan), await get(S4H_UNIT_URLS.wiatr), await get(S4H_UNIT_URLS.sky),
      await get(S4H_UNIT_URLS.woda), await get(S4H_KITE_URL),
    ];
    return parseSun4helContent({ home, prices, year, caravan, wiatr, sky, woda, kite });
  },
  async fetchSlots(ctx) {
    const { html, year } = await priceList();
    const prices = parseS4hPrices(html);
    if (prices.length === 0) throw new Error(`maszoperia-sun4hel-jastarnia: no unit lines ("... od X zł do Y zł") in the ${year} price list`);
    if (prices.length < UNITS.length) ctx.note(`only ${prices.map(p => p.key).join(', ')} found in the ${year} price list`);
    return buildS4hSlots(prices, year);
  },
};
