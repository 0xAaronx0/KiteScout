// ---------------------------------------------------------------------------
// Loop It Academy apartments, Jastarnia (Hel Peninsula, Poland) - the Loop It Academy kitesurf and wingfoil school
// rents two-level apartments ("Tarifa", 6 guests; "Cape Town", 7 guests) and a 4-person caravan on a quiet campsite
// 30 m from Puck Bay; "Szkoła kitesurfingu i wingfoila tuż pod apartamentem" (the school is right below the
// apartments). Kite link: the school itself (PZKite levels 1-4, radio helmets, big-air coaching).
//
// Liveness (2026-10-12): the apartments page was published 2026-02-19 and edited 2026-03-16 (Yoast JSON-LD);
//   "Regulamin Loop It Academy 2026" PDF uploaded 2026-07.
// Data path (checked 2026-10-12): WordPress / Elementor, Polish only.
//   slots    /kursy-kitesuringu/ (the "Apartamenty Jastarnia" page despite its slug): per unit an <h4>
//            ('Apartament "Tarifa" (6 os.):', 'Przyczepa campingowa (4 os.):') followed by a <p> "Cena: 800 PLN (6
//            os.), 725 PLN (5 os.), 650 PLN (4 os. i mniej)<br />description" and the unit's image carousel. The
//            headline "650 zł / 1 dzień" shows the prices are per day; no dates, no season, no year.
//   content  the same page (amenities, location) + /kurs-kitesurfing/ (course levels, lesson prices).
// No booking engine: phone (+48 664 368 333) -> 'on_request'.
// robots.txt (2026-10-12): Yoast default, allows everything.
// Requests per run: content 2, slots 1 (memoised).
// Parsed: slot = unit x guest count ("apartment-tarifa-6p"), PLN per unit and night (the page's "1 dzień" daily
//   rate read as per night, inferred), occupancy = the guest count of the price ("4 os. i mniej" -> 4), no dates.
//   GATE (like pensao-alcinda-santa-kite-sal): the undated prices are used only while the page was edited within the
//   last 15 months (dateModified 2026-03-16); after that fetchSlots returns [] with a note ("price on request").
// Known limits: no season limits on the page; no map pin (the contact page embeds a Google Maps search query, the
//   address is only "Polna, 84-140 Jastarnia").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, jsonLd, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://loopitacademy.pl';
export const LIA_APARTMENTS_URL = `${SITE}/kursy-kitesuringu/`;
export const LIA_COURSE_URL = `${SITE}/kurs-kitesurfing/`;
const CONTACT_URL = `${SITE}/kontakt/`;
const FRESH_MONTHS = 15;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const strip = (s: string): string => clean(s.replace(/<[^>]+>/g, ' ')).replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();
export function liaLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(strip)
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface LiaUnit {
  key: string;
  name: string;
  maxGuests: number;
  prices: Array<{ guests: number; amount: number; orFewer: boolean }>;
  description: string;
  images: string[];
}

/** Unit blocks: <h4>Apartament "X" (N os.):</h4> / <h4>Przyczepa campingowa (N os.):</h4> + "Cena: ..." paragraph. */
export function parseLiaUnits(html: string): LiaUnit[] {
  const heads = [...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)];
  const out: LiaUnit[] = [];
  heads.forEach((h, i) => {
    const title = strip(h[1]);
    const m = title.match(/^(Apartament\s*["„“”]([^"„“”]+)["„“”]|Przyczepa campingowa)\s*\((\d+)\s*os\.\)/i);
    if (!m) return;
    const seg = html.slice(h.index! + h[0].length, heads[i + 1]?.index ?? undefined);
    // the "Cena:" paragraph (price line + description after a <br>) and, for the caravan, a second paragraph
    const body = seg.split(/Nasi Partnerzy/i)[0];
    const parts = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].slice(0, 2)
      .flatMap(x => x[1].split(/<br\s*\/?>/i)).map(strip).filter(Boolean);
    const priceLine = parts.find(x => /^Cena:/i.test(x)) ?? '';
    const prices = [...priceLine.matchAll(/(\d[\d\s]*)\s*PLN\s*\((\d+)\s*os\.(\s*i mniej)?\)/gi)]
      .map(x => ({ guests: Number(x[2]), amount: Number(x[1].replace(/\s/g, '')), orFewer: !!x[3] }));
    const apartment = m[2] ?? null;
    const name = apartment ? `Apartment "${apartment}"` : 'Caravan';
    const images = [...seg.matchAll(/<img[^>]+src="([^"]+\.(?:jpe?g|webp))"/gi)].map(x => x[1]);
    out.push({
      key: apartment ? `apartment-${keyPart(apartment)}` : 'caravan',
      name,
      maxGuests: Number(m[3]),
      prices,
      description: parts.filter(x => x !== priceLine).join(' '),
      images,
    });
  });
  return out.filter(u => u.prices.length > 0);
}

export function liaModified(html: string): string | null {
  const page = jsonLd(html).find(o => o['@type'] === 'WebPage' && typeof o.dateModified === 'string');
  return page ? String(page.dateModified).slice(0, 10) : null;
}

export function liaFresh(modified: string | null, today: string): boolean {
  if (!modified) return false;
  const d = new Date(`${modified}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + FRESH_MONTHS);
  return d.toISOString().slice(0, 10) >= today;
}

export function buildLiaSlots(units: LiaUnit[]): Slot[] {
  return units.flatMap(u => u.prices.map(p => ({
    key: `${u.key}-${p.guests}p`,
    startDate: null,
    endDate: null,
    unit: u.name,
    price: p.amount,
    currency: 'PLN',
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: p.guests,
    availability: 'on_request' as const,
    availabilityText: null,
    spotsLeft: null,
  })));
}

const DESC: Array<[RegExp, string]> = [
  [/Salon z aneksem/i, 'Living room with kitchenette'],
  [/, kanapa,/i, 'Sofa'],
  [/łazienka/i, 'Bathroom'],
  [/sypialnia na poddaszu z balkonem/i, 'Attic bedroom with balcony'],
  [/sypialnia na poddaszu,/i, 'Attic bedroom'],
  [/balkon,/i, 'Balcony'],
  [/dodatkowa sypialnia/i, 'Extra bedroom'],
  [/miejsce na sprzęt/i, 'Space for kite gear'],
  [/taras z grillem/i, 'Terrace with grill'],
  [/rozkładana kanapa/i, 'Sofa bed'],
  [/lodówka/i, 'Fridge'],
  [/w pełni wyposażona kuchnia/i, 'Fully equipped kitchen'],
  [/pościel/i, 'Bed linen'],
  [/klimatyzacja/i, 'Air conditioning'],
  [/płukania i suszenia pianek/i, 'Wetsuit rinsing and drying area on the campsite'],
];

export function parseLoopItContent(page: string, course: string): OfferContent {
  const units = parseLiaUnits(page);
  const t = liaLines(page).join('\n');
  const c = liaLines(course).join('\n');
  const group = c.match(/(\d+)\s*zł\s*\n?\s*\/\s*1h\s*\n?\s*Grupowa lekcja/i)?.[1] ?? null;
  const distance = t.match(/zaledwie (\d+) metrów od Zatoki Puckiej/i)?.[1] ?? null;
  const apts = units.filter(u => u.key.startsWith('apartment'));
  const caravan = units.find(u => u.key === 'caravan');
  const range = (u: LiaUnit) => { const a = u.prices.map(p => p.amount); return Math.min(...a) === Math.max(...a) ? `PLN ${a[0]}` : `PLN ${Math.min(...a)}-${Math.max(...a)}`; };
  const amenities = [
    /Dostęp do Wi-Fi/i.test(t) && 'Wi-Fi',
    /Aneks kuchenny/i.test(t) && 'Kitchenette',
    /prywatna łazienka/i.test(t) && 'Private bathroom',
    /miejsce parkingowe/i.test(t) && 'Parking space',
    /taras z dostępem do grilla/i.test(t) && 'Terrace with grill',
  ].filter((x): x is string => !!x);

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: u.key === 'caravan'
      ? `Air-conditioned caravan with awning for up to ${u.maxGuests} guests on the same campsite.`
      : `Two-level apartment for up to ${u.maxGuests} guests above the school, ${distance ?? '30'} m from Puck Bay.`,
    features: [
      ...DESC.filter(([re]) => re.test(u.description)).map(([, f]) => f),
      ...(u.key === 'caravan' ? [] : amenities.filter(a => ['Wi-Fi', 'Parking space'].includes(a))),
      ...u.prices.map(p => `${p.guests}${p.orFewer ? ' or fewer' : ''} guests: PLN ${p.amount} per night`),
    ],
  }));

  const imageUrls: string[] = [];
  for (const u of [...units.flatMap(x => x.images), ...imageCandidates(page, LIA_APARTMENTS_URL, null, 60)]) {
    if (/\.png$|logo|slingshot|prolimit|kiteninja|king-of-kite|\.svg/i.test(u)) continue;
    const abs = new URL(u, LIA_APARTMENTS_URL).toString();
    if (!imageUrls.includes(abs)) imageUrls.push(abs);
  }

  const summary = [
    `Loop It Academy, a kitesurf and wingfoil school in Jastarnia on the Hel Peninsula, rents ${apts.length} two-level apartments${caravan ? ' and a caravan' : ''} on a quiet campsite ${distance ?? '30'} m from Puck Bay, with the school right below the apartments.`,
    apts.length
      ? `${apts.map(a => `Apartment ${a.name.replace(/^Apartment /, '')} (up to ${a.maxGuests} guests) costs ${range(a)}`).join(' and ')} per night depending on the number of guests${caravan ? `; the air-conditioned caravan for ${caravan.maxGuests} costs ${range(caravan)}` : ''}.`
      : null,
    `The apartments have a kitchenette, private bathroom, Wi-Fi, parking and a terrace with grill; the school teaches the four PZKite levels with radio contact${group ? `, group lessons from PLN ${group} per hour with all equipment` : ''}.`,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Loop It Academy apartments, Jastarnia',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Jastarnia, Hel Peninsula',
    spot: 'Jastarnia',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: /czterech poziomach zaawansowania/i.test(c) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /Kurs Kitesurfing/i.test(c),
    equipmentRental: null,
    beginnerFriendly: /od pierwszego startu|od podstaw/i.test(c) ? true : null,
    includedServices: amenities,
    optionalServices: [
      `Kitesurfing lessons (PZKite levels 1-4, private, pairs or groups${group ? `, from PLN ${group} per hour` : ''}, equipment included)`,
      'Wingfoil and kite foil lessons',
      'Big-air coaching with video analysis',
      'Kids sports club',
    ],
    accommodation: 'two-level apartments and a caravan on a campsite',
    mealPlan: 'self_catering',
    languages: ['pl'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: LIA_APARTMENTS_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `apartments: ${(t.match(/Nowoczesne apartamenty[\s\S]*?Nasi Partnerzy/) ?? [t.slice(0, 5000)])[0]}`,
      `course: ${(c.match(/Kurs Kitesurfing\nIndywidualne[\s\S]*?czas indywidualny[^\n]*/) ?? [c.slice(0, 4000)])[0]}`,
      `units: ${units.map(u => `${u.name} max ${u.maxGuests}: ${u.prices.map(p => `${p.guests}p ${p.amount}`).join(', ')}`).join(' | ')}`,
      `dateModified: ${liaModified(page)}`,
    ].join('\n'),
  };
}

export async function fetchLiaSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const page = await get(LIA_APARTMENTS_URL);
  const units = parseLiaUnits(page);
  if (units.length === 0) throw new Error('loop-it-academy-apartments-jastarnia: no unit blocks ("Apartament ... (N os.):" + "Cena: ...") found');
  const modified = liaModified(page);
  if (!liaFresh(modified, today)) {
    ctx.note(`undated prices on a page last edited ${modified ?? 'unknown'} (older than ${FRESH_MONTHS} months): price on request`);
    return [];
  }
  return buildLiaSlots(units);
}

export const loopItAcademyApartmentsJastarnia: OfferAdapter = {
  key: 'loop-it-academy-apartments-jastarnia',
  name: 'Loop It Academy apartments Jastarnia',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Loop It Academy',
    websiteUrl: SITE,
    rootDomain: 'loopitacademy.pl',
    contactEmail: 'loopitacademy@gmail.com',
    phone: '+48 664 368 333',
  },
  url: LIA_APARTMENTS_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const [page, course] = [await get(LIA_APARTMENTS_URL), await get(LIA_COURSE_URL)];
    return parseLoopItContent(page, course);
  },
  async fetchSlots(ctx) {
    return fetchLiaSlots(ctx);
  },
};
