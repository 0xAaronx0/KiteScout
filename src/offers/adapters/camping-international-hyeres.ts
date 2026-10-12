// ---------------------------------------------------------------------------
// Camping International & Spa (Acampa), Giens / Hyères (Var, France) - 4-star campsite open all year, 50 m
// from the Almanarre kite spot; rents mobile homes (some with private spa), apartments and a sea-view villa.
// Kite schools: KGG and MF Kite (courses from beginner to advanced; MF Kite also rents and sells gear).
//
// Data path (checked 2026-10-12), WordPress (theme "francecom"), English pages:
//   content  /en/international/welcome/ (open all year, 162 pitches, 3 ha, villa / apartment / mobile home texts,
//            the Google Maps place link with the pin !3d43.0413947!4d6.1279316, practical documents incl. the
//            "Tarifs-...-2026-prix-mini-maxi" rate sheet link), /en/international/accomodation/ (FAQ: minimum
//            3 nights, linen) and /en/international/sport-and-well-being-activities/ (Almanarre bay, KGG, MF Kite).
//   slots    none. Unit cards, prices and availability come only from the Ctoutvert / SecureHoliday widget
//            (establishment 3142, reservation.secureholiday.net/widgets/ -> apibookingpremium.secureholiday.net):
//            its API calls carry the widget's embedded Azure "x-functions-key" plus a "RefererFullUrl" header with
//            the campsite page URL - an embedded API key and a referer we would have to fake, so we do not call it.
//            The yearly rate sheet is a PDF (min/max prices 2026, not parsed). fetchSlots returns []
//            ("price on request") without a request.
// robots.txt (2026-10-12): acampa-vacances.com disallows only wp-admin, feeds, *.php etc.;
//   reservation.secureholiday.net "Disallow:" (empty).
// Requests per run: content 3, slots 0.
// 2026/27 operation: open all year; rate sheet linked as "...CI-2026-prix-mini-maxi" (checked on the page);
//   the group site acampa-vacances.com/ dates its news "12 mars 2026" (pool beach extension at International).
// Known limits: the rate sheet link is only a guard for the season year; no unit list (the widget renders it).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://acampa-vacances.com';
export const CI_HOME_URL = `${SITE}/en/international/welcome/`;
export const CI_ACCOMMODATION_URL = `${SITE}/en/international/accomodation/`;
export const CI_SPORT_URL = `${SITE}/en/international/sport-and-well-being-activities/`;

// --- local helpers ----------------------------------------------------------------------------
/** Visible text lines (scripts, styles, SVGs, the cookie banner dropped), split at block tags. */
export function ciLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<div[^>]+id="cmplz-cookiebanner-container"[\s\S]*$/i, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
/** Paragraph text with inline tags joined ("our <strong>162-site campsite</strong> in Hyères"). */
const flat = (html: string): string => ciLines(html).join(' ');

// --- pure parsers -----------------------------------------------------------------------------
/** The campsite pin from the Google Maps place link ("!3d<lat>!4d<lng>"). */
export function parseCiCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/place\/Camping\+International[^"]*?!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Practical-document links (rate sheet, brochure, map) as [label, url]. */
export function parseCiDocuments(html: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const m of html.matchAll(/<a href="(https:\/\/acampa-vacances\.com\/wp-content\/uploads\/[^"]+\.pdf)"[^>]*>([^<]+)<\/a>/g)) {
    const label = clean(m[2]);
    if (!out.some(d => d.url === m[1])) out.push({ label, url: m[1] });
  }
  return out;
}

export interface CiFacts {
  pitches: number | null; hectares: number | null; openAllYear: boolean; spotMeters: number | null;
  villa: string | null; villaDetail: string | null; apartments: string | null; apartmentsDetail: string | null;
  mobileHomes: string | null; mobileHomesDetail: string | null; services: string[];
}

export function parseCiFacts(homeHtml: string): CiFacts {
  const t = flat(homeHtml);
  const sentence = (re: RegExp): string | null => t.match(re)?.[0]?.trim() ?? null;
  const services = ['WEIGHT ROOM', 'SPORT ACTIVITIES', 'RESTAURANTS', 'SWIMMING POOL', 'NAUTICAL BASE/ VTT', 'APRODITE SPA', 'DIVING SCHOOL']
    .filter(s => t.includes(s));
  return {
    pitches: Number(t.match(/(\d+)-site campsite/)?.[1] ?? NaN) || null,
    hectares: Number(t.match(/our (\d+)-hectare campsite/)?.[1] ?? NaN) || null,
    openAllYear: /Open all year/i.test(t),
    spotMeters: Number(t.match(/Almanarre spot is just (\d+) meters from the campsite/i)?.[1] ?? NaN) || null,
    villa: sentence(/The villa is a [^.]+\./),
    villaDetail: sentence(/Our villa has [^.]+\./),
    apartments: sentence(/The apartments range in size from [^.]+\./),
    apartmentsDetail: sentence(/These types of rental accommodation are available as [^.]+\./),
    mobileHomes: sentence(/The comfortable mobile homes at the [^.]+\./),
    mobileHomesDetail: sentence(/Some have a private spa [^.]+\./),
    services,
  };
}

/** FAQ pairs of the accommodation page ("What is the minimum number of nights for a rental?" -> "3 nights."). */
export function parseCiFaq(html: string): Array<{ q: string; a: string }> {
  const ls = ciLines(html);
  const out: Array<{ q: string; a: string }> = [];
  for (let i = 0; i < ls.length - 1; i++) if (/\?$/.test(ls[i]) && !/\?$/.test(ls[i + 1])) out.push({ q: ls[i], a: ls[i + 1] });
  return out;
}

/** Kite block of the sport page: the Almanarre description and the KGG / MF Kite sentences. */
export function parseCiKite(html: string): string[] {
  const ls = ciLines(html);
  const i = ls.findIndex(l => /^Almanarre Bay:/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of ls.slice(i, i + 12)) {
    if (/^Discover (KGG|MF Kite)/i.test(l)) break;
    if (!/^Read more$/i.test(l)) out.push(l);
  }
  return out;
}

/** Photos of the pages: one entry per WordPress upload (size variants collapsed), stock pictures and graphics dropped. */
export function ciImages(pages: Array<[string, string]>): string[] {
  const best = new Map<string, string>();
  const rank = (u: string): number => (/-scaled\./.test(u) ? 3 : /-\d+x\d+\./.test(u) ? 1 : 2) + (/\.webp$/.test(u) && /\.jpe?g\.webp$/.test(u) ? 0 : 0.5);
  for (const [html, base] of pages) {
    for (const u of imageCandidates(html, base, null, 120)) {
      if (!/\/wp-content\/uploads\//.test(u) || /AdobeStock|unsplash|carte-|pinceaux|logo|icon|picto|\.svg|telechargement/i.test(u)) continue;
      const key = u.replace(/-(?:\d+x\d+|scaled)(?=\.)/, '').replace(/\.(jpe?g)\.webp$/i, '.$1').replace(/\.webp$/i, '');
      const prev = best.get(key);
      if (!prev || rank(u) > rank(prev)) best.set(key, u);
    }
  }
  return [...best.values()];
}

export interface CiPages { home: string; accommodation: string; sport: string }

export function parseCampingInternationalContent(p: CiPages): OfferContent {
  const f = parseCiFacts(p.home);
  const faq = parseCiFaq(p.accommodation);
  const kite = parseCiKite(p.sport);
  const docs = parseCiDocuments(p.home);
  const rates = docs.find(d => /tarif/i.test(d.url)) ?? null;
  const minNights = faq.find(x => /minimum number of nights/i.test(x.q))?.a ?? null;
  const linen = faq.find(x => /sheets and towels/i.test(x.q))?.a ?? null;
  const kiteText = kite.join(' ');
  const coords = parseCiCoords(p.home);

  const rooms: ContentRoom[] = [
    { name: 'Mobile home', description: [f.mobileHomes, f.mobileHomesDetail].filter(Boolean).join(' ') || null, features: ['Up to 6 people', 'Some with private spa (jacuzzi)', 'Some with private terrace and garden furniture'] },
    { name: 'Apartment', description: [f.apartments, f.apartmentsDetail].filter(Boolean).join(' ') || null, features: ['33-58 m²', '2 to 5 people', 'Terrace or balcony', 'Some with private spa'] },
    { name: 'Villa', description: [f.villa, f.villaDetail].filter(Boolean).join(' ') || null, features: ['130 m²', '4 bedrooms', 'Up to 8 people', 'Sea view', 'Private garden'] },
  ];

  const summary = [
    `Camping International & Spa is a 4-star campsite on the Giens peninsula in Hyères (Var, Provence-Alpes-Côte d'Azur, France), ${f.openAllYear ? 'open all year, ' : ''}just ${f.spotMeters ?? 50} m from the Almanarre kite spot, with ${f.pitches ?? 162} pitches on ${f.hectares ?? 3} hectares.`,
    `It rents mobile homes for up to 6 people (some with a private spa), apartments of 33-58 m² for 2 to 5 people and a 130 m² sea-view villa for up to 8${minNights ? `, with a minimum stay of ${minNights.replace(/\.$/, '')}` : ''}.`,
    `The Almanarre bay has five kilometres of sandy beach and shallow water; the KGG and MF Kite schools teach kitesurfing from beginner to advanced level${/renting equipment/i.test(kiteText) ? ' and MF Kite also rents and sells equipment' : ''}. On site there are restaurants, a pool, a nautical base, a diving school and the Aphrodite spa.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Camping International & Spa',
    summary,
    continent: 'Europe',
    country: 'France',
    region: "Provence-Alpes-Côte d'Azur",
    spot: "L'Almanarre, Giens (Hyères)",
    spotCoords: coords, // the campsite's own Google Maps place link
    itinerarySpots: [],
    durationDays: null,
    // sport page: "courses for everyone, from beginners to advanced kiteboarders"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /offer courses/i.test(kiteText),
    equipmentRental: /renting equipment/i.test(kiteText),
    beginnerFriendly: /from beginners/i.test(kiteText),
    includedServices: ['Swimming pool access', 'Cushions and blankets in the rentals', 'Cot and high chair on request'],
    optionalServices: [
      'Kitesurf courses with KGG or MF Kite (Almanarre bay)', 'Kite equipment rental and sales (MF Kite)',
      'Nautical base and mountain bike rental', 'Diving school', 'Aphrodite spa', 'Weight room', 'Restaurants',
    ],
    accommodation: 'mobile homes, apartments and a villa on a 4-star campsite',
    mealPlan: 'self_catering',
    languages: ['fr', 'en', 'de', 'nl', 'it'],
    rooms,
    imageUrls: ciImages([[p.home, CI_HOME_URL], [p.sport, CI_SPORT_URL], [p.accommodation, CI_ACCOMMODATION_URL]]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CI_HOME_URL,
    bookingUrl: CI_HOME_URL,
    sourceText: [
      `facts: pitches ${f.pitches ?? '-'}, hectares ${f.hectares ?? '-'}, open all year ${f.openAllYear}, Almanarre ${f.spotMeters ?? '-'} m; services ${f.services.join(', ')}`,
      `villa: ${f.villa ?? '-'} ${f.villaDetail ?? ''}`,
      `apartments: ${f.apartments ?? '-'} ${f.apartmentsDetail ?? ''}`,
      `mobile homes: ${f.mobileHomes ?? '-'} ${f.mobileHomesDetail ?? ''}`,
      `kite: ${kiteText || '-'}`,
      `faq: minimum nights ${minNights ?? '-'}; linen ${linen ?? '-'}`,
      `documents: ${docs.map(d => `${d.label} ${d.url}`).join(' | ')}`,
      `rate sheet (season guard): ${rates?.url ?? '-'}`,
      `coords (Google Maps place link): ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const campingInternationalHyeres: OfferAdapter = {
  key: 'camping-international-hyeres',
  name: 'Camping International & Spa Hyères',
  kind: 'accommodation',
  operator: {
    name: 'Acampa (Camping International & Spa)',
    websiteUrl: CI_HOME_URL,
    rootDomain: 'acampa-vacances.com',
    contactEmail: 'camping@international-giens.com',
    phone: '+33494589016',
  },
  url: CI_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 3,
  confidence: 'low', // no prices or availability readable (SecureHoliday needs an embedded API key + faked referer)
  async fetchContent(ctx) {
    const [home, accommodation, sport] = [
      await fetchText(CI_HOME_URL, { accept: 'text/html' }),
      await fetchText(CI_ACCOMMODATION_URL, { accept: 'text/html' }),
      await fetchText(CI_SPORT_URL, { accept: 'text/html' }),
    ];
    const content = parseCampingInternationalContent({ home, accommodation, sport });
    if (!/Almanarre/i.test(content.sourceText ?? '') || parseCiKite(sport).length === 0) throw new Error('camping-international: Almanarre kite block not found on the sport page');
    const rates = parseCiDocuments(home).find(d => /tarif/i.test(d.url));
    if (!rates || !/20(2[6-9]|3\d)/.test(rates.url)) ctx.note(`camping-international: rate sheet link does not name 2026 or later (${rates?.url ?? 'missing'})`);
    return content;
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('camping-international: units, prices and availability only in the Ctoutvert/SecureHoliday widget (embedded API key + referer header) - price on request');
    return [];
  },
};
