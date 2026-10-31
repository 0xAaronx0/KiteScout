// ---------------------------------------------------------------------------
// Ruuk Village, Kalpitiya (Sri Lanka) - small off-grid eco lodge (about 10 cabanas, max 20 guests) on the
// Kalpitiya lagoon with its own kite school (IKO / VDWS instruction, CrazyFly / Core rental, boat transfer
// to a teaching zone). Founded 2014.
//
// Data path (checked 2026-10-12), Squarespace site ruukvillage.com (the www host redirects there):
//   content  / (site-wide JSON-LD LodgingBusiness: description, geo 8.244 / 79.739, amenities, number of
//            rooms, services), /sri-lanka-eco-friendly-accommodation (five cabana types, seasons),
//            /kitesurfing-school-sri-lanka (courses + prices), /kalpitiya-zero-to-hero (kite camp package).
//   slots    /sri-lanka-eco-friendly-accommodation: "Choose Your Stay" cards with a B&B price hint per cabana
//            type ("B&B 58€ | 69 US$ *", "*Final pricing depends on season, board option ... and length of
//            stay"; page last modified 2026-01-08 per the sitemap) + the two full-board "No Worries" pages
//            (/no-worries-package-kalpitiya = Wadiya fisherman's cabin, /no-worries-package-kalpitiya-junior-suite
//            = ensuite cabana) with a per-person double-occupancy rate and a single-occupancy rate.
// No booking engine: "Check availability" is an inquiry form / WhatsApp -> availability 'on_request'. The site
//   links its Booking.com and Airbnb listings; we never read those.
// robots.txt (2026-10-12): Squarespace defaults (/config, /search, /api/, /static/, ?format=json ...) - the
//   pages we read are allowed. The sitemap needs Accept: application/xml (406 for text/html).
// Requests per run: content 4, slots 3.
// Parsed: B&B slots per cabana type ("garden-cabana-bb"), full-board slots per cabana x occupancy
//   ("wadiya-full-board-2p"), EUR per person per night, no dates (the site prints none).
// Known limits / inferred: the B&B hints do not say "per person"; they equal the per-person double-occupancy
//   rates of the older B&B pages (23 / 38 EUR), so they are stored per person for 2 guests. The older B&B pages
//   (2024) also say B&B is not offered May-September and December-March - not repeated on the 2026 page,
//   so not applied. No 2026/27 dates on the site; current operation is inferred from edits in 2026
//   (sitemap lastmod up to 2026-05-01, JSON-LD "grown over 12 years" since 2014).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, ldOfType, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://ruukvillage.com';
export const RV_HOME_URL = `${SITE}/`;
export const RV_TYPES_URL = `${SITE}/sri-lanka-eco-friendly-accommodation`;
export const RV_SCHOOL_URL = `${SITE}/kitesurfing-school-sri-lanka`;
export const RV_ZTH_URL = `${SITE}/kalpitiya-zero-to-hero`;
export const RV_FB_WADIYA_URL = `${SITE}/no-worries-package-kalpitiya`;
export const RV_FB_ENSUITE_URL = `${SITE}/no-worries-package-kalpitiya-junior-suite`;
const BOOKING_URL = `${SITE}/book-kitesurfing-in-sri-lanka`;

export interface RvType { name: string; description: string; tags: string[]; bb: number | null; bbUsd: number | null }
export interface RvFullBoard { unit: string; slug: string; double: number | null; single: number | null }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text split at block tags (one entry per heading / paragraph). */
export function rvLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|select|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** "Choose Your Stay" cards: name, "a · b · c" description, two tag lines, "B&B 58€ | 69 US$ *". */
export function parseRvTypes(html: string): RvType[] {
  const ls = rvLines(html);
  const from = ls.findIndex(l => /^Choose Your Stay$/i.test(l));
  const to = ls.findIndex((l, i) => i > from && /^Price hints/i.test(l));
  if (from < 0 || to < 0) return [];
  const block = ls.slice(from + 1, to);
  const out: RvType[] = [];
  for (let i = 0; i < block.length - 1; i++) {
    if (!block[i + 1].includes(' · ') || block[i].includes(' · ') || block[i].length > 40) continue;
    const t: RvType = { name: block[i].replace(/’/g, "'"), description: block[i + 1], tags: [], bb: null, bbUsd: null };
    for (let j = i + 2; j < block.length && !(block[j + 1]?.includes(' · ') && !block[j].includes(' · ')); j++) {
      const bb = block[j].match(/^B&B\s*(\d[\d.,]*)\s*€\s*\|\s*(\d[\d.,]*)\s*US\$/i);
      if (bb) { t.bb = parseAmount(bb[1]); t.bbUsd = parseAmount(bb[2]); } else t.tags.push(block[j]);
    }
    out.push(t);
  }
  return out;
}

/** Full-board "No Worries" page: per-person double-occupancy rate + single-occupancy rate. */
export function parseRvFullBoard(html: string, unit: string, slug: string): RvFullBoard {
  const t = rvLines(html).join('\n');
  const dbl = t.match(/(\d[\d.,]*)\s*€\s*per person on double occupancy/i)?.[1]
    ?? t.match(/Double [^\n]*?cabana per person:\s*€\s*(\d[\d.,]*)/i)?.[1] ?? null;
  const sgl = t.match(/Single occupancy:\s*€?\s*(\d[\d.,]*)\s*€?/i)?.[1] ?? null;
  return { unit, slug, double: dbl ? parseAmount(dbl) : null, single: sgl ? parseAmount(sgl) : null };
}

export function buildRvSlots(types: RvType[], fullBoard: RvFullBoard[]): Slot[] {
  const out: Slot[] = [];
  for (const t of types) {
    if (t.bb === null) continue;
    out.push({
      key: `${keyPart(t.name)}-bb`,
      startDate: null, endDate: null,
      unit: `${t.name} (bed & breakfast)`,
      price: t.bb, currency: 'EUR', priceUnit: 'per_night', priceBasis: 'person', occupancy: 2,
      availability: 'on_request',
      availabilityText: 'B&B price hint; final price depends on season, board option and length of stay',
      spotsLeft: null,
    });
  }
  for (const f of fullBoard) {
    for (const [occ, price] of [[2, f.double], [1, f.single]] as const) {
      if (price === null) continue;
      out.push({
        key: `${f.slug}-full-board-${occ}p`,
        startDate: null, endDate: null,
        unit: `${f.unit} (full board)`,
        price, currency: 'EUR', priceUnit: 'per_night', priceBasis: 'person', occupancy: occ,
        availability: 'on_request', availabilityText: null, spotsLeft: null,
      });
    }
  }
  return out;
}

export interface RvPages { home: string; types: string; school: string; zeroToHero: string; fbWadiya: string; fbEnsuite: string }

export function parseRuukContent(p: RvPages): OfferContent {
  const lodging = ldOfType(p.home, 'LodgingBusiness')[0] ?? {};
  const geo = (lodging.geo ?? {}) as Record<string, unknown>;
  const amenities = ((lodging.amenityFeature ?? []) as Array<Record<string, unknown>>).map(a => String(a.name ?? '')).filter(Boolean);
  const catalog = (((lodging.hasOfferCatalog ?? {}) as Record<string, unknown>).itemListElement ?? []) as Array<Record<string, unknown>>;
  const services = catalog.map(o => (o.itemOffered ?? {}) as Record<string, unknown>).map(s => ({ name: String(s.name ?? ''), description: String(s.description ?? '') }));
  const rental = services.find(s => /Equipment Rental/i.test(s.name));
  const school = services.find(s => /Kitesurfing School/i.test(s.name));
  const types = parseRvTypes(p.types);
  const fb = [parseRvFullBoard(p.fbWadiya, "Wadiya fisherman's cabin", 'wadiya'), parseRvFullBoard(p.fbEnsuite, 'Ensuite cabana', 'ensuite')];
  const schoolLines = rvLines(p.school);
  const lessonPrices = schoolLines.filter(l => /^€\d+.*·.*hours?/i.test(l));
  const groupMin = Math.min(...lessonPrices.filter(l => /per person/i.test(l)).map(l => parseAmount(l) ?? Infinity));
  const privateMin = Math.min(...lessonPrices.filter(l => /one on one|private/i.test(l)).map(l => parseAmount(l) ?? Infinity));
  const zth = rvLines(p.zeroToHero).join(' ').match(/Zero to Hero[”"]? kite camp\s*[–-]\s*€\s*(\d[\d.,]*) per person\.\s*(\d+) days\s*\/\s*(\d+) nights/i);
  const seasons = rvLines(p.types).filter(l => /^(December to March|May to September|October to November)$/i.test(l));

  const rooms: ContentRoom[] = types.map(t => {
    const f = /Fisherman/i.test(t.name) ? fb[0] : null;
    return {
      name: t.name,
      description: t.description,
      features: [
        ...t.tags,
        ...(t.bb !== null ? [`B&B price hint: EUR ${t.bb} (USD ${t.bbUsd}) per person per night`] : []),
        ...(f && f.double !== null ? [`Full board ("No Worries"): EUR ${f.double} per person (double), EUR ${f.single} single`] : []),
      ],
    };
  });
  const ens = fb[1];
  if (ens.double !== null) {
    rooms.push({
      name: 'Ensuite cabana',
      description: 'Cabana with private open-air shower garden and WC; offered as the full-board "No Worries" package.',
      features: [`Full board: EUR ${ens.double} per person (double), EUR ${ens.single} single`],
    });
  }

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.home, RV_HOME_URL], [p.types, RV_TYPES_URL], [p.fbWadiya, RV_FB_WADIYA_URL], [p.fbEnsuite, RV_FB_ENSUITE_URL], [p.school, RV_SCHOOL_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/squarespace-cdn\.com\/content/.test(u) || /logo|icon|favicon|\.svg|\.png/i.test(u)) continue;
      const k = u.replace(/\?.*$/, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(k);
    }
  }

  const cheapestFb = Math.min(...fb.map(f => f.double ?? Infinity));
  const maxGuests = amenities.join(' ').match(/(\d+) guests/)?.[1] ?? null;
  const summary = [
    `Ruuk Village is a small off-grid eco lodge on the Kalpitiya lagoon in north-western Sri Lanka, founded in 2014 on a former coconut plantation, with about ${lodging.numberOfRooms ?? 10} wooden cabanas${maxGuests ? ` for at most ${maxGuests} guests` : ''}, solar power and local food cooked over an open fire.`,
    `Cabana types range from a fisherman's cabin to a wooden chalet, booked as bed & breakfast or full board${Number.isFinite(cheapestFb) ? ` (full board from EUR ${cheapestFb} per person per night in a double)` : ''} through an inquiry form.`,
    `Its own kite school teaches on the lagoon with boat transfers to a flat, waist-deep teaching zone, rents ${rental?.description.match(/^([A-Za-z]+ and [A-Za-z]+) kites/)?.[1] ?? 'CrazyFly and Core'} equipment and runs island trips; the main wind season is May to September, with lighter wind from December to March.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Ruuk Village',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kalpitiya',
    spotCoords: typeof geo.latitude === 'number' && typeof geo.longitude === 'number' ? { lat: geo.latitude, lng: geo.longitude } : null, // site JSON-LD geo
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // JSON-LD kite school: "Beginner to advanced"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: !!school || lessonPrices.length > 0,
    equipmentRental: !!rental,
    beginnerFriendly: /beginner/i.test(school?.description ?? ''),
    includedServices: ['Housekeeping', 'Wi-Fi in common areas (solar)', 'Full board package: three meals, tea, coffee and water, SUP use, boat rides to the kite area'],
    optionalServices: [
      lessonPrices.length ? `Kite lessons (group from EUR ${groupMin} per person, private from EUR ${privateMin}; beginner, refresher, 6-day kite camp, advanced coaching)` : 'Kite lessons',
      'Kite equipment rental (CrazyFly / Core)',
      ...(zth ? [`"From Zero to Hero" kite camp: ${zth[2]} days / ${zth[3]} nights, EUR ${zth[1]} per person (double occupancy)`] : []),
      'Kite safari day trips (Vellai Island, Dream Spot)',
      'Airport transfer from Colombo (CMB), VW surfer van on request',
      'Dolphin and whale watching (seasonal), Wilpattu safari by boat, cooking class, yoga',
    ],
    accommodation: 'eco cabanas, a wooden chalet and a VW camper van',
    mealPlan: 'bed & breakfast or full board',
    languages: ['en', 'de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: RV_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `json-ld: ${String(lodging.description ?? '')}`,
      `amenities: ${amenities.join('; ')}`,
      `services: ${services.map(s => `${s.name}: ${s.description}`).join(' | ')}`,
      `cabana types: ${types.map(t => `${t.name} [${t.description}] B&B ${t.bb ?? '-'} EUR / ${t.bbUsd ?? '-'} USD`).join('; ')}`,
      `full board: ${fb.map(f => `${f.unit} ${f.double ?? '-'} pp double / ${f.single ?? '-'} single`).join('; ')}`,
      `seasons: ${seasons.join(' | ')}`,
      `kite school prices: ${lessonPrices.join(' | ')}`,
      `geo (JSON-LD): ${geo.latitude ?? ''},${geo.longitude ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const ruukVillageKalpitiya: OfferAdapter = {
  key: 'ruuk-village-kalpitiya',
  name: 'Ruuk Village Kalpitiya',
  kind: 'accommodation',
  operator: {
    name: 'Ruuk Village',
    websiteUrl: SITE,
    rootDomain: 'ruukvillage.com',
    contactEmail: 'contact@kalpitiya.info',
    whatsapp: '+94710425874',
    phone: '+94710425874',
  },
  url: RV_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 7,
  confidence: 'medium', // no 2026/27 dates on the site; rates are hints without dates
  async fetchContent() {
    const [home, types, school, zeroToHero, fbWadiya, fbEnsuite] = [
      await fetchText(RV_HOME_URL, { accept: 'text/html' }),
      await fetchText(RV_TYPES_URL, { accept: 'text/html' }),
      await fetchText(RV_SCHOOL_URL, { accept: 'text/html' }),
      await fetchText(RV_ZTH_URL, { accept: 'text/html' }),
      await fetchText(RV_FB_WADIYA_URL, { accept: 'text/html' }),
      await fetchText(RV_FB_ENSUITE_URL, { accept: 'text/html' }),
    ];
    return parseRuukContent({ home, types, school, zeroToHero, fbWadiya, fbEnsuite });
  },
  async fetchSlots(ctx) {
    const types = parseRvTypes(await fetchText(RV_TYPES_URL, { accept: 'text/html' }));
    const fb = [
      parseRvFullBoard(await fetchText(RV_FB_WADIYA_URL, { accept: 'text/html' }), "Wadiya fisherman's cabin", 'wadiya'),
      parseRvFullBoard(await fetchText(RV_FB_ENSUITE_URL, { accept: 'text/html' }), 'Ensuite cabana', 'ensuite'),
    ];
    if (types.filter(t => t.bb !== null).length < 3) throw new Error(`ruuk-village: cabana B&B price hints not found or changed (${types.length} types)`);
    for (const f of fb) if (f.double === null) ctx.note(`no full-board rate found for ${f.unit}`);
    return buildRvSlots(types, fb);
  },
};
