// ---------------------------------------------------------------------------
// Antony Boy Camping, Viganj (Pelješac peninsula, Croatia) - one of Croatia's oldest campsites (founded in the
// early 1970s) with the LIBERAN Surf & Kite school on its own beach since the late 1970s; we list only the
// rental units: 11 Veezia mobile homes and 8 apartments (A1-A8), not the pitches or caravans.
//
// Data path (checked 2026-10-12): WordPress/Elementor site antony-boy.com (English pages).
//   content  / (camp, LIBERAN school, reception hours), /antony-boy-apartments/ (small 2+2 / large 4+2
//            apartments, amenities), /antony-boy-mobile-homes/ (Veezia mobile homes: 38.3 m² + 32 m² terrace,
//            4+2 guests, amenities), /windsurfing-i-kiteboarding-liberan/ (school, IKO / PZKite, guest
//            discount).
//   slots    the prices are only in two PDF price lists linked on every page ("CJENIK - PRICE LIST -
//            PREISLISTE 2026."):
//              /wp-content/uploads/2026/05/AB-cjenik-MOBILNE-2026.pdf    (Veezia 1-11: 109 € / 209 €)
//              /wp-content/uploads/2026/05/AB-cjenik-APARTMANI-2026.pdf  (A1-A8: 79-109 € / 130-170 €)
//            columns "01.09. - 30.06." and "01.07. - 31.08.", price per unit per day ("THE DAILY PRICE"),
//            additional person 20 / 29 €, pet 10 / 15 €. We cannot parse a PDF through fetchText, so the
//            prices below are constants read by hand (built-in browser, 2026-10-12). They are released only
//            while the home page still links the same file (liveness, like kenyaways-diani); a missing or new
//            price-list link is reported via ctx.note, no link at all is an error.
// Booking: /book-now/ embeds the CampMap unit map (campmap.com/hranto: per-unit "Send Inquiry" / booking
//   flow that loads CampMap's login pages; robots.txt there disallows /accounts and /user) -> not used, no
//   live availability. Slots are 'unknown'; from 1 November the reception text says "Inquiries only"
//   (01.11 - 01.04), so those bands are 'on_request' with that text.
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 4, slots 1.
// Parsed: slot = unit x price band of the 2026 list ("veezia-mobile-home|2026-09-01"), EUR per unit per night
//   for the base occupancy (mobile home 4, apartments 2 or 4 persons; extra persons are charged separately).
//   The off-peak column "01.09. - 30.06." is read inside the list's year: 2026-01-01..06-30 and 2026-09-01..
//   12-31 (inferred); bands that ended before today are dropped.
// Known limits: the 2027 list is not out yet (2026-10-12), so the offer drops to "price on request" after
//   2026-12-31 until the site links new PDFs (then the constants have to be re-read by hand). Tourist tax
//   (1.10 / 1.70 € per person per day) and stay discounts are room features only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, meta, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://antony-boy.com';
export const AB_HOME_URL = `${SITE}/`;
const APTS_URL = `${SITE}/antony-boy-apartments/`;
const MH_URL = `${SITE}/antony-boy-mobile-homes/`;
const KITE_URL = `${SITE}/windsurfing-i-kiteboarding-liberan/`;
const BOOKING_URL = `${SITE}/book-now/`;

// --- price lists (constants, read by hand 2026-10-12) -----------------------------------------
export const AB_SHEETS = {
  mobile: '/wp-content/uploads/2026/05/AB-cjenik-MOBILNE-2026.pdf',
  apartments: '/wp-content/uploads/2026/05/AB-cjenik-APARTMANI-2026.pdf',
} as const;
export const AB_YEAR = 2026;
export interface AbUnit { sheet: keyof typeof AB_SHEETS; unit: string; base: number; extra: number; offPeak: number; peak: number; note: string }
/** offPeak = column "01.09. - 30.06.", peak = "01.07. - 31.08." (EUR per unit per day). */
export const AB_UNITS: AbUnit[] = [
  { sheet: 'mobile', unit: 'Veezia mobile home', base: 4, extra: 2, offPeak: 109, peak: 209, note: 'Veezia 1-11, 4 + (2) persons, spots 622, 624, 625, 721, 723 and others' },
  { sheet: 'apartments', unit: 'Apartment A1', base: 2, extra: 2, offPeak: 99, peak: 160, note: 'attic east, 2 + (2) persons' },
  { sheet: 'apartments', unit: 'Apartment A2', base: 2, extra: 2, offPeak: 89, peak: 140, note: 'attic west, 2 + (2) persons' },
  { sheet: 'apartments', unit: 'Apartment A3', base: 4, extra: 2, offPeak: 109, peak: 170, note: '2nd floor east, 4 + (2) persons' },
  { sheet: 'apartments', unit: 'Apartment A4', base: 4, extra: 2, offPeak: 99, peak: 160, note: '2nd floor west, 4 + (2) persons' },
  { sheet: 'apartments', unit: 'Apartment A5', base: 4, extra: 2, offPeak: 109, peak: 170, note: '1st floor east, 4 + (2) persons' },
  { sheet: 'apartments', unit: 'Apartment A6', base: 4, extra: 2, offPeak: 99, peak: 160, note: '1st floor west, 4 + (2) persons' },
  { sheet: 'apartments', unit: 'Apartment A7', base: 2, extra: 3, offPeak: 79, peak: 130, note: 'ground floor east, 2 + (3) persons' },
  { sheet: 'apartments', unit: 'Apartment A8', base: 2, extra: 2, offPeak: 79, peak: 130, note: 'ground floor west, 2 + (2) persons' },
];
const AB_EXTRAS = [
  'Additional person: EUR 20 per day (01.09.-30.06.) / EUR 29 (01.07.-31.08.)',
  'Pet: EUR 10 per day / EUR 15',
  'Tourist tax: EUR 1.10 per person per day (01.10.-31.03.), EUR 1.70 (01.04.-30.09.)',
  'Stay discounts: next visit 10 %, 61-120 days 15 %, 121+ days 20 %, children under 12 50 % (as additional persons); not with card payment',
];

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text split at block tags (Elementor widgets: one entry each). */
export function abLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|select)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** Price-list PDFs linked on a page (paths). */
export function abSheetLinks(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(?:https?:\/\/antony-boy\.com)?(\/wp-content\/uploads\/[^"]*cjenik[^"]*\.pdf)"/gi)].map(m => m[1]))];
}

/** Reception note like "01.11 - 01.04: Inquiries only" -> the first day (MM-DD) of the inquiry-only period. */
export function abInquiryFrom(html: string): { from: string; text: string } | null {
  const l = abLines(html).find(x => /^\d{2}\.\d{2}\s*[-–]\s*\d{2}\.\d{2}\s*:\s*Inquiries only$/i.test(x));
  const m = l?.match(/^(\d{2})\.(\d{2})/);
  return m ? { from: `${m[2]}-${m[1]}`, text: l! } : null;
}

/** Bands of the year's list: off-peak Jan-Jun, peak Jul-Aug, off-peak Sep-Dec (split at the inquiry-only date). */
export function abBands(year: number, inquiry: { from: string; text: string } | null): Array<{ start: string; end: string; peak: boolean; availability: Availability; text: string | null }> {
  const b = [
    { start: iso(year, 1, 1), end: iso(year, 6, 30), peak: false },
    { start: iso(year, 7, 1), end: iso(year, 8, 31), peak: true },
    { start: iso(year, 9, 1), end: iso(year, 12, 31), peak: false },
  ];
  const out: Array<{ start: string; end: string; peak: boolean; availability: Availability; text: string | null }> = [];
  for (const x of b) {
    const cut = inquiry ? `${year}-${inquiry.from}` : null;
    if (cut && cut > x.start && cut <= x.end) {
      const dayBefore = new Date(Date.parse(`${cut}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      out.push({ ...x, end: dayBefore, availability: 'unknown', text: null });
      out.push({ ...x, start: cut, availability: 'on_request', text: `reception: ${inquiry!.text}` });
    } else out.push({ ...x, availability: 'unknown', text: null });
  }
  return out;
}

export function buildAbSlots(linked: string[], inquiry: { from: string; text: string } | null, today: string): Slot[] {
  const out: Slot[] = [];
  const bands = abBands(AB_YEAR, inquiry).filter(b => b.end >= today);
  for (const u of AB_UNITS) {
    if (!linked.includes(AB_SHEETS[u.sheet])) continue;
    for (const b of bands) {
      out.push({
        key: `${keyPart(u.unit)}|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: u.unit,
        price: b.peak ? u.peak : u.offPeak,
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: u.base,
        availability: b.availability,
        availabilityText: b.text,
        spotsLeft: null,
      });
    }
  }
  return out;
}

const PHOTO_JUNK = /logo|cropped|CARAVANS|Camping-pitches|Pension|tlocrt|Collage|Untitled/i;

/** Photos per page (og:image + uploads JPEG/WebP in document order), size variants folded, pages interleaved. */
export function abImages(pages: string[], max = 30): string[] {
  const seen = new Set<string>();
  const perPage = pages.map(html => {
    const list: string[] = [];
    for (const u of [meta(html, 'og:image') ?? '', ...[...html.matchAll(/https:\/\/antony-boy\.com\/wp-content\/uploads\/[^"'()\s]+?\.(?:jpe?g|webp)/gi)].map(m => m[0])]) {
      const url = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      const k = url.replace(/-scaled(?=\.[a-z]+$)/i, '');
      if (!url || PHOTO_JUNK.test(url) || seen.has(k)) continue;
      seen.add(k); list.push(url);
    }
    return list;
  });
  const out: string[] = [];
  for (let i = 0; out.length < max && perPage.some(l => l.length > i); i++) for (const l of perPage) if (l[i] && out.length < max) out.push(l[i]);
  return out;
}

export interface AbPages { home: string; apartments: string; mobile: string; kite: string }

export function parseAntonyBoyContent(p: AbPages): OfferContent {
  const home = abLines(p.home);
  const apts = abLines(p.apartments);
  const mh = abLines(p.mobile);
  const kite = abLines(p.kite);
  const kiteText = kite.join(' ');
  const amenities = (ls: string[]) => {
    const i = ls.findIndex(l => /^Amenities$/i.test(l));
    const out: string[] = [];
    for (let j = i + 1; i >= 0 && j < ls.length && out.length < 10; j++) {
      if (ls[j].length > 60) break;
      out.push(ls[j]);
    }
    return out;
  };
  const mhFacts = mh.filter(l => /^(Dimensions|Indoor area|Spacious terrace|Sleeps|Bedrooms):/i.test(l));
  const discount = kite.find(l => /^Guest perks/i.test(l)) ?? null;
  const priceLine = (u: AbUnit) => `${u.note}; ${AB_YEAR} price list: EUR ${u.offPeak} per day (01.09.-30.06.), EUR ${u.peak} (01.07.-31.08.)`;
  const rooms: ContentRoom[] = AB_UNITS.map(u => ({
    name: u.unit,
    description: u.sheet === 'mobile'
      ? `Veezia mobile home with two bedrooms, two bathrooms, kitchen with dishwasher and a 32 m² terrace; 11 units; sleeps ${u.base} + ${u.extra}.`
      : `${u.base === 4 ? 'Large apartment (3 rooms, 70+ m²)' : 'Small apartment (2 rooms, 40+ m²)'} about 100 m from the sea with sea-view terrace, kitchen, satellite TV and Wi-Fi; sleeps ${u.base} + ${u.extra}.`,
    features: [priceLine(u), ...(u.sheet === 'mobile' ? [...mhFacts, ...amenities(mh)] : amenities(apts)), ...AB_EXTRAS],
  }));
  const minPrice = Math.min(...AB_UNITS.map(u => u.offPeak));

  const summary = [
    'Antony Boy is a campsite in Viganj on the Pelješac peninsula in southern Croatia, founded in the early 1970s and facing the Pelješac Channel and the town of Korčula; besides pitches it rents 11 Veezia mobile homes (4 + 2 guests) and 8 apartments about 100 m from the sea.',
    'The LIBERAN Surf & Kite school, started in the late 1970s, sits on the camp\'s own beach and teaches windsurfing, kitesurfing, wing and foil with IKO / PZKite methods; camp guests get 10 % off lessons and rental in peak season and 20 % in low season.',
    `Units are self-catering and priced per unit per day (2026 list: from EUR ${minPrice} in the off-peak season, more in July and August).`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Antony Boy Camping',
    summary,
    continent: 'Europe',
    country: 'Croatia',
    region: 'Dubrovnik-Neretva',
    spot: 'Viganj',
    itinerarySpots: [],
    durationDays: null,
    // kite page: "taught everyone from total beginners to pro riders"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurf/i.test(kiteText) && /lesson/i.test(kiteText),
    equipmentRental: /rental/i.test(kiteText),
    beginnerFriendly: /beginners/i.test(kiteText),
    includedServices: ['Wi-Fi', 'Parking', 'Housekeeping and reception'],
    optionalServices: [
      'Windsurf, kitesurf, wing and foil lessons and rental at LIBERAN Surf & Kite (on the camp beach)',
      ...(discount ? [`Guest discount at LIBERAN: ${discount.replace(/^Guest perks\s*[–-]\s*/i, '')}`] : []),
      'Laundry service', 'Organized excursions', 'Pets welcome (surcharge)',
    ],
    accommodation: 'mobile homes and apartments on a campsite',
    mealPlan: 'self_catering',
    // price lists are trilingual (HR / GB / D); the site itself is English
    languages: ['hr', 'en', 'de'],
    rooms,
    imageUrls: abImages([p.mobile, p.apartments, p.kite, p.home]),
    heroVideoUrl: null,
    sourceUrl: AB_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' ')}`,
      `apartments: ${apts.join(' ')}`,
      `mobile homes: ${mh.join(' ')}`,
      `LIBERAN: ${kiteText}`,
      `price lists (constants read by hand 2026-10-12): ${AB_UNITS.map(u => `${u.unit} ${u.offPeak}/${u.peak}`).join('; ')}; ${AB_EXTRAS.join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export async function fetchAbSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const html = await fetchText(AB_HOME_URL, { accept: 'text/html' });
  const links = abSheetLinks(html);
  const known = Object.values(AB_SHEETS) as string[];
  if (!known.some(k => links.includes(k))) {
    throw new Error(`antony-boy: none of the hand-read price lists is linked any more (page links: ${links.join(', ') || 'none'}) - re-read the new PDFs by hand`);
  }
  for (const k of known.filter(k => !links.includes(k))) ctx.note(`price list ${k} no longer linked: its prices are not released`);
  for (const l of links.filter(l => !known.includes(l) && /mobil|apart/i.test(l))) ctx.note(`new price list linked: ${l} - read it by hand and update AB_UNITS`);
  ctx.note(`prices are constants read by hand from the ${AB_YEAR} PDF price lists (2026-10-12)`);
  return buildAbSlots(links, abInquiryFrom(html), today);
}

export const antonyBoyViganj: OfferAdapter = {
  key: 'antony-boy-viganj',
  name: 'Antony Boy Camping Viganj',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Antony Boy Camping d.o.o.',
    websiteUrl: SITE,
    rootDomain: 'antony-boy.com',
    contactEmail: 'info@antony-boy.com',
    phone: '+38520719077',
  },
  url: AB_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'medium',
  async fetchContent() {
    const [home, apartments, mobile, kite] = [
      await fetchText(AB_HOME_URL, { accept: 'text/html' }),
      await fetchText(APTS_URL, { accept: 'text/html' }),
      await fetchText(MH_URL, { accept: 'text/html' }),
      await fetchText(KITE_URL, { accept: 'text/html' }),
    ];
    return parseAntonyBoyContent({ home, apartments, mobile, kite });
  },
  fetchSlots: ctx => fetchAbSlots(ctx),
};
