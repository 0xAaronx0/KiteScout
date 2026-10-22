import { EVERGREEN_PILOT_SUMMARIES } from '../evergreen-pilot-summaries.js';
// ---------------------------------------------------------------------------
// KiteMex Kite & Wingfoil Camp, La Ventana (Baja California Sur, Mexico) - dated 6-night camp weeks of the KiteMex
// kitesurf and wing foil school, which works from La Ventana Beach Resort (same address, Carretera Isla Cerralvo
// km 7.5): up to 15 hours of private kite / wing foil coaching over 5 days, 6 nights in a shared beachfront double
// room at the resort, breakfast and lunch, gear, 4 yoga / SUP mornings, no-wind activities.
//
// Data path (checked 2026-10-14):
//   content+slots  kitemex.com/kitesurf-and-wingfoil-camps/ (WordPress/Elementor, one page): "6 Nights | 5 Days of
//            Coaching | Up to 15 Hours", "Price: US$ 2,799 per person", "Camp Dates" lines ("December 6–12, 2026",
//            "January 9–15, 2027", ...), "Limited availability for each camp.", inclusions as numbered <h2>
//            sections; "Book Now" goes to the contact page (deposit 30%, no booking engine) -> 'on_request'.
//   pin      www.laventanabeachresort.com/ (the resort's Google Maps place link !3d24.0467991!4d-109.9883454;
//            the KiteMex site only links a maps.app.goo.gl short link). Resort photos from the same page.
// robots.txt (2026-10-14): kitemex.com disallows /wp-admin/ only; laventanabeachresort.com = Squarespace default.
// Requests per run: content 2 (camp page + resort home), slots 1 (camp page, memoised within a run).
// Parsed: slot = camp week, key = start date, USD 2,799 per person (shared double room, occupancy 2), package of
//   6 nights, availability 'on_request' with the page's words; weeks that have ended are dropped.
// Known limits: private-room surcharge is "contact us" (not a slot); the "Limited availability" line is generic
//   copy on all weeks, not a per-week count.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, parseRange, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { LVBR_HOME_URL, mapsPin } from './la-ventana-beach-resort.js';

export const KMC_URL = 'https://kitemex.com/kitesurf-and-wingfoil-camps/';
const CONTACT_URL = 'https://kitemex.com/contact/';
export const KMC_UNIT = 'Beachfront Double Room (shared)';

// --- local helpers ---------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export function kmcLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, template, nav, header, footer')) el.remove();
  return root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}

export interface KmcCamp {
  nights: number | null;
  coachingDays: number | null;
  hours: number | null;
  price: number | null;
  currency: string | null;
  perPerson: boolean;
  weeks: Array<{ start: string; end: string; text: string }>;
  availabilityText: string | null;
}

export function parseKmcCamp(html: string): KmcCamp {
  const lines = kmcLines(html);
  const head = lines.find(l => /\d+\s+Nights\s*\|/i.test(l)) ?? '';
  const priceLine = lines.find(l => /^Price:/i.test(l)) ?? '';
  const weeks: KmcCamp['weeks'] = [];
  const i = lines.findIndex(l => /^Camp Dates$/i.test(l));
  if (i >= 0) {
    for (const l of lines.slice(i + 1)) {
      if (!/\b20\d{2}\b/.test(l)) break;
      const r = parseRange(l);
      if (r) weeks.push({ ...r, text: l });
    }
  }
  return {
    nights: Number(head.match(/(\d+)\s+Nights/i)?.[1]) || null,
    coachingDays: Number(head.match(/(\d+)\s+Days of Coaching/i)?.[1]) || null,
    hours: Number(head.match(/Up to (\d+) Hours/i)?.[1]) || null,
    price: parseAmount(priceLine.replace(/^Price:/i, '')),
    currency: /US\$|USD/i.test(priceLine) ? 'USD' : null,
    perPerson: /per person/i.test(priceLine),
    weeks,
    availabilityText: lines.find(l => /availability for each camp/i.test(l)) ?? null,
  };
}

export function buildKmcSlots(c: KmcCamp, today: string): Slot[] {
  if (!c.price || !c.currency) return [];
  return c.weeks.filter(w => w.end >= today).map(w => ({
    key: w.start,
    startDate: w.start,
    endDate: w.end,
    unit: KMC_UNIT,
    price: c.price,
    currency: c.currency,
    priceUnit: 'package',
    priceBasis: c.perPerson ? 'person' : 'group',
    occupancy: 2,
    availability: 'on_request',
    availabilityText: c.availabilityText,
    spotsLeft: null,
    packageNights: c.nights,
  }));
}

// --- content -------------------------------------------------------------------------------------
export function parseKmcContent(campHtml: string, resortHome: string): OfferContent {
  const lines = kmcLines(campHtml);
  const camp = parseKmcCamp(campHtml);
  const pin = mapsPin(resortHome);
  const has = (re: RegExp) => lines.some(l => re.test(l));
  const nights = camp.nights ?? 6;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(campHtml, KMC_URL, null, 30), ...imageCandidates(resortHome, LVBR_HOME_URL, null, 30)]) {
    if (/\.svg|logo|IMAGOTIPO|icon|removebg|static1\.squarespace\.com/i.test(u)) continue;
    const k = u.replace(/\?.*$/, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = EVERGREEN_PILOT_SUMMARIES['kitemex-camp-la-ventana'];

  return {
    kind: 'camp',
    title: 'KiteMex Kite & Wingfoil Camp',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'La Ventana, Baja California Sur',
    spot: 'La Ventana',
    ...(pin ? { spotCoords: pin } : {}),
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: has(/equipment, wetsuit, radio communication and safety equipment are included/i),
    beginnerFriendly: has(/suitable for complete beginners/i),
    includedServices: [
      `Up to ${camp.hours ?? 15} hours of private kiteboarding and wing foil coaching over ${camp.coachingDays ?? 5} days`,
      `${nights} nights in a shared beachfront double room at La Ventana Beach Resort`,
      'Continental breakfast and lunch daily',
      'Kite and wing foil equipment, wetsuit, radio communication and safety equipment',
      '4 guided morning yoga, stretching and SUP sessions',
      'Personal host and 24/7 support',
      'No-wind day activities (seafari, tow / jet ski session, e-bike)',
    ],
    optionalServices: ['Private room (extra cost, on request)'],
    accommodation: 'beachfront double room at La Ventana Beach Resort (shared, two double beds)',
    mealPlan: 'breakfast and lunch',
    languages: ['en', 'es'],
    rooms: [{
      name: KMC_UNIT,
      description: 'Beachfront room at La Ventana Beach Resort with two double beds for two guests sharing during the camp.',
      features: ['Two double beds', 'Private bathroom with hot water', 'Air conditioning', 'Wi-Fi', 'Mini fridge', 'Ceiling fans'],
    }],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KMC_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `camp: ${lines.filter(l => !/^(Menu|HOME|ABOUT|GALLERY|Contacto|Scroll to Top|WhatsApp us|English|Spanish)$/i.test(l)).join('\n')}`,
      pin ? `pin (La Ventana Beach Resort, Google Maps place link): ${pin.lat},${pin.lng}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export const kitemexCampLaVentana: OfferAdapter = {
  key: 'kitemex-camp-la-ventana',
  name: 'KiteMex Kite & Wingfoil Camp La Ventana',
  kind: 'camp',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'KiteMex',
    websiteUrl: 'https://kitemex.com',
    rootDomain: 'kitemex.com',
    contactEmail: 'info@kitemex.com',
    phone: '+52 984 137 3711',
  },
  url: KMC_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    const camp = await page(KMC_URL);
    const resort = await fetchText(LVBR_HOME_URL, { accept: 'text/html' });
    return parseKmcContent(camp, resort);
  },
  async fetchSlots() {
    const camp = parseKmcCamp(await page(KMC_URL));
    if (camp.weeks.length === 0 || !camp.price) throw new Error(`kitemex-camp: camp dates or price not found (${camp.weeks.length} dates, price ${camp.price})`);
    return buildKmcSlots(camp, todayIso());
  },
};
