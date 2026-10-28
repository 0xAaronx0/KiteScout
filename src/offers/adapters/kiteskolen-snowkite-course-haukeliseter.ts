// ---------------------------------------------------------------------------
// Kiteskolen.no "Kitekurs på Haukeliseter" - SNOWKITE courses (kiting on snow, not water) at Haukeliseter fjellstue
// on Haukelifjell (E134, southern Norway), run in cooperation with the DNT lodge (listed as its own accommodation):
// a 2-day course to independent kiter, a 1-day course and a 3-hour intro for groups of at least 4; kite gear
// included. Kiteskolen (Oslo) is a large Norwegian kite school with many winter destinations.
//
// Data path (checked 2026-10-28): WordPress, server-rendered; ONE page /destinasjoner/kitekurs-haukeliseter/.
//   slots    the three price cards: "2 dagers kitekurs 4 099 kr", "Dagskurs 2 599 kr", "3 timers introkurs 1 499 kr".
//            No dates yet: "DATOER FOR HELGEKURS 2027 ... kalender kommer ila oktober 2026" -> one undated slot per
//            course, availability 'on_request', NOK per person, priceUnit 'package'. fetchSlots notes when the
//            calendar line is gone (dates published: extend the adapter).
//   content  the same page. Its course plan and FAQ are shared with Kiteskolen's water courses (bodydragging,
//            wetsuits); the summary only uses the snow-specific parts.
// Booking: courses with an overnight stay are booked through Haukeliseter's own booking, courses without one via
//   Kiteskolen's sign-up form -> instantBooking unset.
// Liveness (2026-10-28): page titled "Kitekurs på Haukeliseter 2027" with the 2027 calendar announced for Oct 2026.
// robots.txt (2026-10-28): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: 1 (content + slots share one memoised fetch).
// Known limits: only 3 photos on the page (two of them from Haukeli) -> the listing will show few photos.
// ---------------------------------------------------------------------------
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { memoPage, wpImages, wpLines } from './kite-republic-aitutaki-winter-escape.js';

const SITE = 'https://kiteskolen.no';
export const KS_URL = `${SITE}/destinasjoner/kitekurs-haukeliseter/`;

interface KsCourse { key: string; label: RegExp; unit: string }
const COURSES: KsCourse[] = [
  { key: '2-day', label: /^2 dagers kitekurs$/i, unit: '2-day course (to independent kiter)' },
  { key: '1-day', label: /^Dagskurs$/i, unit: '1-day course (refresher or short course)' },
  { key: 'intro-3h', label: /^3 timers introkurs$/i, unit: '3-hour intro (groups of at least 4)' },
];

/** price card: a label line followed (within two lines) by "4 099 kr" */
export function parseKsPrices(lines: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of COURSES) {
    for (let i = 0; i < lines.length; i++) {
      if (!c.label.test(lines[i])) continue;
      const p = lines.slice(i + 1, i + 3).map(l => l.match(/^(\d{1,2}[  ]?\d{3})\s*kr$/i)?.[1]).find(Boolean);
      if (p) { out[c.key] = Number(p.replace(/[  ]/g, '')); break; }
    }
  }
  return out;
}

export function ksYear(lines: string[]): number | null {
  return Number(lines.map(l => l.match(/^Kitekurs på Haukeliseter (20\d\d)$/i)?.[1]).find(Boolean)) || null;
}

export function buildKsSlots(lines: string[], ctx?: Pick<FetchContext, 'note'>): Slot[] {
  const prices = parseKsPrices(lines);
  const year = ksYear(lines);
  if (!lines.some(l => /kalender kommer/i.test(l))) ctx?.note('kiteskolen-haukeliseter: the "kalender kommer" line is gone (course dates published?): extend the adapter');
  return COURSES.filter(c => prices[c.key]).map(c => ({
    key: `${c.key}|${year ?? 'season'}`, startDate: null, endDate: null, unit: c.unit,
    price: prices[c.key], currency: 'NOK', priceUnit: 'package', priceBasis: 'person', occupancy: 1,
    availability: 'on_request', availabilityText: year ? `${year} dates not published yet` : 'dates on request', spotsLeft: null,
  }));
}

export function parseKsContent(html: string): OfferContent {
  const lines = wpLines(html);
  const prices = parseKsPrices(lines);
  const year = ksYear(lines);
  if (!year || !prices['2-day']) throw new Error('kiteskolen-haukeliseter: heading year or 2-day price missing (page changed?)');
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const summary = [
    `Kiteskolen.no runs snowkite courses at Haukeliseter fjellstue, the DNT mountain lodge on the E134 at Haukelifjell in southern Norway, where the frozen lake Ståvatn and the open plateau give wide, windy practice areas.`,
    `The 2-day course (NOK ${fmt(prices['2-day'])}) teaches beginners the theory, kite control and safety to kite on their own${prices['1-day'] ? `; a 1-day course (NOK ${fmt(prices['1-day'])}) suits those who have tried before` : ''}${prices['intro-3h'] ? `, and a 3-hour intro (NOK ${fmt(prices['intro-3h'])}) runs for groups of at least 4` : ''}; all kite gear is included.`,
    `Weekend dates for ${year} are on request (the school publishes its calendar in autumn); courses with an overnight stay are booked through the lodge.`,
  ].join(' ');
  return {
    kind: 'course',
    title: 'Kiteskolen Snowkite Course, Haukeliseter',
    summary,
    continent: 'Europe',
    country: 'Norway',
    region: 'Haukelifjell',
    spot: 'Haukeliseter, Haukelifjell',
    spotCoords: { lat: 59.8239, lng: 7.1941 }, // Haukeliseter fjellstue (OSM way 117122360)
    itinerarySpots: [],
    durationDays: 2,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Snowkite instruction', 'All kite gear (kite, bar, harness)', 'Course info PDF before the course'],
    optionalServices: [
      'Stay and meals at Haukeliseter fjellstue (booked through the lodge)',
      'Course offers from the kite shop Urge.no after the course',
      'Courses on weekdays and for companies on request',
      'Not included: skis or snowboard, packed lunch',
    ],
    accommodation: null,
    mealPlan: null,
    languages: ['no', 'en'],
    rooms: [],
    imageUrls: wpImages(html, KS_URL, /logo|trapes|icon/i).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KS_URL,
    bookingUrl: KS_URL,
    sourceText: lines.join('\n'),
  };
}

export const kiteskolenSnowkiteCourseHaukeliseter: OfferAdapter = {
  key: 'kiteskolen-snowkite-course-haukeliseter',
  name: 'Kiteskolen Snowkite Course, Haukeliseter',
  kind: 'course',
  disciplines: ['snowkite'],
  operator: {
    name: 'Kiteskolen.no',
    websiteUrl: `${SITE}/`,
    rootDomain: 'kiteskolen.no',
    contactEmail: 'info@kiteskolen.no',
    phone: '+4741777888',
  },
  url: KS_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'medium', // prices printed, dates not yet published
  async fetchContent() {
    return parseKsContent(await memoPage(KS_URL));
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const lines = wpLines(await memoPage(KS_URL));
    const slots = buildKsSlots(lines, ctx);
    if (!slots.length) throw new Error('kiteskolen-haukeliseter: no course prices found (page changed?)');
    return slots;
  },
};
