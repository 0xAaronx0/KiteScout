// ---------------------------------------------------------------------------
// Kite Passion Glamping, Puttgarden (Fehmarn, Germany) - glamping yurts with up to two sleeping places on the Camping
// Puttgarden site, right at the VDWS surf school Kite Passion (kite and wing courses, 2:1 coaching with radio helmets,
// rental) on the north coast of Fehmarn.
//
// Data path (checked 2026-10-14), Astro site kite-passion.de (German only):
//   content  /unterkunft/ (glamping text, price box, service table, photos, JSON-LD SportsActivityLocation with geo and
//            the school season "validFrom 2026-04-01 / validThrough 2026-10-31"), /kite-kurse (courses from EUR 149,
//            "Wir schulen von April bis Oktober auf Fehmarn", max. two students per coach).
//   slots    the price box of /unterkunft/: "Juni–September 55 €/Nacht, außerhalb 49 €/Nacht (1 Person). Mit 2 Personen
//            gesamt +34 €/Nacht." and "Mindestbuchung 3 Nächte". No year and no day limits are printed (only months),
//            so the slots carry no dates (like michaels-kite-vacancies-rhodes).
// Booking: the site's own form /buchungssystem/unterkunft/ (arrival, departure, persons; POST, then contact data and
//   payment). It shows no calendar or inventory, so there is nothing to read live; we never post it.
// robots.txt (2026-10-14): "Allow: /", only /buchungssystem/cockpit/ and /buchungssystem/payments/ disallowed.
// Requests per run: content 2, slots 1 (the /unterkunft/ page is memoised, so a full run makes 2).
// Parsed: 4 slots = season (June to September / other months) x persons (1, 2), EUR per yurt per night (priceBasis
//   'room', occupancy 1 or 2; 2 persons = base price + the printed EUR 34 surcharge), minNights 3, availability 'unknown'.
// Known limits: "Buchbar ab Juni" is printed next to the price box without a year; the slots stay undated. The 2027
//   camp page announces the Fehmarn camps without dates yet.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, ldOfType } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kite-passion.de';
export const KPG_STAY_URL = `${SITE}/unterkunft/`;
export const KPG_COURSES_URL = `${SITE}/kite-kurse`;
const BOOKING_URL = `${SITE}/buchungssystem/unterkunft/`;
export const KPG_UNIT = 'Glamping yurt';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share /unterkunft/ */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function kpgLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|header|footer|article)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface KpgPrices { high: number; low: number; secondPerson: number; minNights: number | null; text: string }

/** Price sentence of the glamping box: "Juni–September 55 €/Nacht, außerhalb 49 €/Nacht (1 Person). Mit 2 Personen gesamt +34 €/Nacht." */
export function parseKpgPrices(html: string): KpgPrices | null {
  const text = kpgLines(html).join('\n');
  const m = text.match(/Juni\s*[–-]\s*September\s+(\d+(?:,\d+)?)\s*€\s*\/\s*Nacht,?\s*außerhalb\s+(\d+(?:,\d+)?)\s*€\s*\/\s*Nacht\s*\(1 Person\)\.?\s*Mit 2 Personen gesamt\s*\+\s*(\d+(?:,\d+)?)\s*€\s*\/\s*Nacht/);
  if (!m) return null;
  const n = (s: string) => Number(s.replace(',', '.'));
  const min = text.match(/Mindestbuchung:?\s*(\d+)\s*Nächte/);
  return { high: n(m[1]), low: n(m[2]), secondPerson: n(m[3]), minNights: min ? Number(min[1]) : null, text: m[0] };
}

export function buildKpgSlots(p: KpgPrices): Slot[] {
  const seasons: Array<{ id: string; label: string; price: number }> = [
    { id: 'jun-sep', label: 'June to September', price: p.high },
    { id: 'other-months', label: 'outside June to September', price: p.low },
  ];
  const out: Slot[] = [];
  for (const s of seasons) {
    for (const persons of [1, 2]) {
      out.push({
        key: `glamping-${persons}p|${s.id}`,
        startDate: null,
        endDate: null,
        unit: `${KPG_UNIT} (${s.label})`,
        price: persons === 1 ? s.price : s.price + p.secondPerson,
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: persons,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
        minNights: p.minNights,
      });
    }
  }
  return out;
}

/** Photos of the accommodation page (yurt, campsite, sanitary block) and the course page; logos, brands, mascot dropped. */
export function kpgImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img[^>]+src="(\/images\/[^"]+\.(?:webp|jpe?g|png))"/gi)) {
    if (/\/brands\/|\/trainer\/|logo|mascot|\.svg/i.test(m[1])) continue;
    const u = new URL(m[1], SITE).toString();
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface KpgPages { stay: string; courses: string }

export function parseKitePassionContent(p: KpgPages): OfferContent {
  const stay = kpgLines(p.stay);
  const courses = kpgLines(p.courses);
  const prices = parseKpgPrices(p.stay);
  const school = ldOfType(p.stay, 'SportsActivityLocation')[0] ?? null;
  const geo = (school?.geo ?? null) as { latitude?: number; longitude?: number } | null;
  const coords = geo && Number.isFinite(Number(geo.latitude)) && Number.isFinite(Number(geo.longitude))
    ? { lat: Number(geo.latitude), lng: Number(geo.longitude) } : null;
  const intro = stay.find(l => /^Glamping auf der Sonneninsel/.test(l)) ?? null;
  const bookFrom = stay.find(l => /^Buchbar ab Juni$/.test(l)) ?? null;
  const schoolSeason = courses.find(l => /Wir schulen von April bis Oktober/.test(l)) ?? null;
  const fromPrice = courses.join(' ').match(/Kurse ab (\d+) €/)?.[1] ?? null;
  const services = ['Fahrrad-Tagesmiete vor Ort', 'Kaffee / Kaltgetränke', 'Waschmaschine', 'Trockner']
    .map(label => { const i = stay.indexOf(label); return i >= 0 ? `${label}: ${stay[i + 1]}` : null; })
    .filter((x): x is string => !!x);

  const rooms: ContentRoom[] = [{
    name: KPG_UNIT,
    description: 'Glamping yurt on the Camping Puttgarden site, a few steps from the surf school and the water; up to 2 sleeping places per unit.',
    features: [
      ...(prices ? [
        `June to September: EUR ${prices.high} per night for 1 person`,
        `Other months: EUR ${prices.low} per night for 1 person`,
        `Second person: +EUR ${prices.secondPerson} per night`,
        ...(prices.minNights ? [`Minimum stay ${prices.minNights} nights`] : []),
      ] : []),
      'Tourist tax and campsite service included',
      'Campsite sanitary building with showers, washroom, playground and sports field',
    ],
  }];

  const summary = [
    'Kite Passion is a VDWS surf school on the Camping Puttgarden site on the north coast of Fehmarn, Germany, and rents glamping yurts with up to two sleeping places right next to its station, so guests sleep a few steps from the kite spot.',
    prices
      ? `June to September a yurt costs EUR ${prices.high} per night for one person and EUR ${prices.low} in the other months, plus EUR ${prices.secondPerson} per night for a second person${prices.minNights ? `; the minimum stay is ${prices.minNights} nights` : ''}, tourist tax and campsite service included.`
      : 'Prices are given on request.',
    `The school teaches kitesurfing and wing foiling from April to October with at most two students per coach and radio helmets${fromPrice ? ` (courses from EUR ${fromPrice})` : ''}, and rents equipment.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Passion Glamping',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Puttgarden, Fehmarn',
    spot: 'Puttgarden',
    // JSON-LD SportsActivityLocation "geo" on /unterkunft/ (54.5034587, 11.2165698 on 2026-10-14)
    spotCoords: coords,
    itinerarySpots: [],
    durationDays: null,
    // course page: "Kitekurse auf Fehmarn für Anfänger und Aufsteiger"
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: courses.some(l => /Kitekurse auf Fehmarn/.test(l)) ? true : null,
    equipmentRental: stay.some(l => /Material-Miete|Material-Rental/.test(l)) ? true : null,
    beginnerFriendly: true,
    includedServices: ['Tourist tax (Kurtaxe)', 'Campsite service', 'Sanitary building with showers', 'Electricity and fresh water'],
    optionalServices: [
      'Kite and wing courses, camps and equipment rental at the surf school',
      'Bike rental (EUR 10 per day)',
      'Coffee and cold drinks on site',
      'Washing machine and dryer',
    ],
    accommodation: 'glamping yurts on a campsite at the kite school',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: [...kpgImages(p.stay), ...kpgImages(p.courses)].filter((u, i, a) => a.indexOf(u) === i).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KPG_STAY_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `stay: ${intro ?? ''}${bookFrom ? ` | ${bookFrom}` : ''}`,
      `prices: ${prices?.text ?? 'not found'}${prices?.minNights ? ` | Mindestbuchung ${prices.minNights} Nächte` : ''}`,
      `services: ${services.join('; ')}`,
      `school: ${schoolSeason ?? ''}${fromPrice ? ` | Kurse ab ${fromPrice} €` : ''}`,
      `school JSON-LD: ${school ? `${String(school.name ?? '')}; ${String(school.description ?? '')}` : '-'}`,
    ].join('\n'),
  };
}

export const kitePassionGlampingPuttgarden: OfferAdapter = {
  key: 'kite-passion-glamping-puttgarden',
  name: 'Kite Passion Glamping Puttgarden',
  kind: 'accommodation',
  operator: {
    name: 'Surfschule Kite Passion',
    websiteUrl: SITE,
    rootDomain: 'kite-passion.de',
    contactEmail: 'hello@kite-passion.de',
    whatsapp: '+491735679695',
    phone: '+491735679695',
  },
  url: KPG_STAY_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  async fetchContent() {
    const stay = await page(KPG_STAY_URL);
    const courses = await page(KPG_COURSES_URL);
    if (!/Puttgarden/.test(stay) || !/Surfschule/.test(stay)) throw new Error('kite-passion-glamping: accommodation page changed (no Puttgarden / Surfschule)');
    return parseKitePassionContent({ stay, courses });
  },
  async fetchSlots() {
    const prices = parseKpgPrices(await page(KPG_STAY_URL));
    if (!prices) throw new Error('kite-passion-glamping: price sentence "Juni–September … €/Nacht, außerhalb … (1 Person). Mit 2 Personen gesamt +… €/Nacht" not found');
    return buildKpgSlots(prices);
  },
};
