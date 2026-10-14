// ---------------------------------------------------------------------------
// FTF Watersports ("Fuck the Forecast") Kite Camp Base, Zipke (Kenz-Küstrow, Barther Bodden, Mecklenburg-Vorpommern,
// Germany) - VDWS kite school with a base at Hofstraße 10 in Zipke; its 5-day kite camps (Mon-Fri, max. 8 per week,
// EUR 599, VDWS licence included) run June-September 2027. The stays are booked separately ("Die Unterkunft ist nicht im
// Camp-Preis enthalten"): on the base grounds or a few steps away on the partner farm Ritter-Zipke (Hofstraße 19), with
// the prices printed on the FTF page. Listed: those rental units, never the camper pitches or tent places.
//
// Data path (checked 2026-10-14), Squarespace site www.ftf-watersports.com:
//   content  /kite-camps ("Kitecamp Deutschland 2027": camp description, "Unterkunft & Campleben", "Unterkunftsmöglichkeiten
//            vor Ort" list, camp dates 2027 with "(8 Plätze frei)", FAQ) + www.ritter-zipke.de/ (the partner farm's own
//            home page, linked from the FTF page: prints the farm's position "54°20'28.9"N 12°46'37.6"E" -> spotCoords).
//   slots    the "Unterkunftsmöglichkeiten vor Ort" bullets on /kite-camps: "• Ferienwohnungen für 2 Personen (65€ pro
//            Nacht)", "• Schäferwagen für 2 Personen (34€ pro Nacht)", "• Mobilheim für bis zu 5 Personen (80€ pro Nacht)",
//            "• Bauwagen für 2 Personen (45€ pro Nacht)" (+ pitches 28 € and tents 15 €, skipped). No dates, no year.
// Booking: accommodation by request (FTF contact / the farm by phone: "Bitte rufen Sie vorher an") -> 'on_request'; the
//   camp itself is a Squarespace cart product (not read).
// robots.txt (2026-10-14): www.ftf-watersports.com Squarespace defaults (/api/, /static/, ?format=json ... - not the pages
//   we read); www.ritter-zipke.de WordPress default (/wp-admin/).
// Requests per run: content 2, slots 1 (the camp page, memoised) -> 2.
// Parsed: one undated slot per unit type, EUR per unit per night as printed ("pro Nacht"; per unit INFERRED from "für 2
//   Personen" / "für bis zu 5 Personen"), occupancy = the persons named, availability 'on_request'.
// Known limits: the page does not say which unit is on the base and which on the farm; the prices carry no season. The
//   camp weeks (dated, with free places) are content only - a camp-kind adapter could use them (see report).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.ftf-watersports.com';
export const FTF_CAMP_URL = `${SITE}/kite-camps`;
export const FTF_FARM_URL = 'https://www.ritter-zipke.de/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the camp page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function ftfLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface FtfUnit { label: string; name: string; persons: number | null; price: number }
const UNIT_EN: Array<[RegExp, string]> = [
  [/^Ferienwohnung/i, 'Holiday flat'], [/^Schäferwagen/i, "Shepherd's hut (Schäferwagen)"], [/^Mobilheim/i, 'Mobile home'],
  [/^Bauwagen/i, 'Construction trailer (Bauwagen)'],
];

/** "• Ferienwohnungen für 2 Personen (65€ pro Nacht)" bullets; pitches and tent places are skipped. */
export function parseFtfUnits(html: string): FtfUnit[] {
  const out: FtfUnit[] = [];
  for (const l of ftfLines(html)) {
    const m = l.match(/^•?\s*(.+?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*€\s*pro Nacht\s*\)/i);
    if (!m) continue;
    const label = m[1].trim();
    if (/Stellpl|Camper|Zelt/i.test(label)) continue;
    const en = UNIT_EN.find(([re]) => re.test(label))?.[1];
    if (!en) continue;
    const persons = Number(label.match(/(\d+)\s+Personen/)?.[1] ?? NaN) || null;
    out.push({ label, name: `${en}${persons ? `${/bis zu/i.test(label) ? ' for up to' : ' for'} ${persons}` : ''}`, persons, price: parseAmount(m[2])! });
  }
  return out;
}

export function buildFtfSlots(units: FtfUnit[]): Slot[] {
  return units.map(u => ({
    key: keyPart(u.name),
    startDate: null,
    endDate: null,
    unit: u.name,
    price: u.price,
    currency: 'EUR',
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: u.persons,
    availability: 'on_request' as const,
    availabilityText: null,
    spotsLeft: null,
  }));
}

export interface FtfCampWeek { start: string; end: string; free: number | null }
/** "07.06 - 11.06.2027 (8 Plätze frei)" (the page has one typo "14.06 - 18.06.2026" inside the 2027 list -> taken as 2027). */
export function parseFtfCampWeeks(html: string): FtfCampWeek[] {
  const text = ftfLines(html).join('\n');
  const listYear = Number(text.match(/Kite Camp Termine (20\d{2})/)?.[1] ?? NaN) || null;
  const out: FtfCampWeek[] = [];
  for (const m of text.matchAll(/(\d{1,2})\.(\d{1,2})\.?\s*-\s*(\d{1,2})\.(\d{1,2})\.\s*(20\d{2})\s*\((\d+)\s*Plätze frei\)/g)) {
    const y = listYear ?? +m[5];
    out.push({ start: iso(y, +m[2], +m[1]), end: iso(y, +m[4], +m[3]), free: Number(m[6]) });
  }
  return out;
}

/** "54°20'28.9"N 12°46'37.6"E" on the partner farm's home page -> decimal degrees. */
export function parseFtfFarmPin(html: string): { lat: number; lng: number } | null {
  const t = ftfLines(html).join(' ').replace(/&quot;|″|”/g, '"').replace(/′|’/g, "'");
  const m = t.match(/(\d{1,2})°\s*(\d{1,2})'\s*([\d.]+)"\s*([NS])\s+(\d{1,3})°\s*(\d{1,2})'\s*([\d.]+)"\s*([EW])/);
  if (!m) return null;
  const dd = (d: string, mi: string, s: string, h: string) => (Number(d) + Number(mi) / 60 + Number(s) / 3600) * (/[SW]/.test(h) ? -1 : 1);
  return { lat: Math.round(dd(m[1], m[2], m[3], m[4]) * 1e5) / 1e5, lng: Math.round(dd(m[5], m[6], m[7], m[8]) * 1e5) / 1e5 };
}

/** Squarespace gallery photos of the camp page (data-image originals), logo dropped. */
export function ftfImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-image="(https:\/\/images\.squarespace-cdn\.com\/content\/v1\/[^"]+)"/g)) {
    const u = m[1].replace(/&amp;/g, '&');
    if (/logo/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  if (out.length === 0) for (const u of imageCandidates(html, FTF_CAMP_URL, null, 40)) if (!/logo/i.test(u)) out.push(u);
  return out;
}

export function parseFtfContent(camp: string, farm: string): OfferContent {
  const lines = ftfLines(camp);
  const all = lines.join('\n');
  const units = parseFtfUnits(camp);
  const weeks = parseFtfCampWeeks(camp);
  const pin = parseFtfFarmPin(farm);
  const campPrice = parseAmount(lines.find(l => /^€\s*\d/.test(l)) ?? '');
  const pick = (re: RegExp) => lines.find(l => re.test(l)) ?? null;
  const months = [...new Set(weeks.map(w => new Date(`${w.start}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })))];
  const year = weeks[0]?.start.slice(0, 4) ?? null;

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: /Ferienwohnung/i.test(u.label) ? 'Holiday flat at the base or on the neighbouring partner farm.'
      : /Mobilheim/i.test(u.label) ? 'Mobile home at the base or on the neighbouring partner farm.'
      : `Simple ${/Schäfer/i.test(u.label) ? "shepherd's hut" : 'converted construction trailer'} at the base or on the neighbouring partner farm.`,
    features: [`EUR ${u.price} per night (as printed: "${u.label} (${u.price}€ pro Nacht)")`, 'Shared common room with kitchen at the base', 'Pond on the grounds'],
  }));

  const summary = [
    'FTF Watersports is a kite school with VDWS-licensed instructors and its own base in Zipke on the Barther Bodden (Darß-Zingst Bodden chain), a shallow standing-depth area for learning, with several spots for different wind directions and light-wind kites from about 6-8 knots.',
    `Its 5-day kite camps (Monday to Friday, max. 8 riders a week, ${campPrice ? `EUR ${campPrice}` : 'price on the page'} with equipment, coaching and VDWS licence) run${months.length ? ` ${months[0]} to ${months[months.length - 1]}` : ''}${year ? ` ${year}` : ''}; accommodation is not included and is booked separately.`,
    `Guests stay on the base grounds or a few steps away on the partner farm Ritter-Zipke: ${units.map(u => `${u.name.charAt(0).toLowerCase()}${u.name.slice(1)} EUR ${u.price}`).join(', ')} per night, plus a shared common room with kitchen; there is a free pick-up from Barth station.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'FTF Watersports Kite Camp Base',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Zipke, Fischland-Darß',
    spot: 'Zipke',
    ...(pin ? { spotCoords: pin } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: /komplettem Equipment/i.test(all) ? true : null,
    beginnerFriendly: /ohne Vorerfahrung|Anfänger/i.test(all),
    includedServices: ['Shared common room with kitchen at the base', 'Free pick-up from Barth station (on request)'],
    optionalServices: [
      `5-day kite camp (Mon-Fri, max. 8 per week, max. 4 beginners per instructor)${campPrice ? `: EUR ${campPrice} per person incl. equipment and VDWS licence` : ''}`,
      ...(weeks.length ? [`Camp weeks ${year}: ${weeks.map(w => `${w.start.slice(8, 10)}.${w.start.slice(5, 7)}.-${w.end.slice(8, 10)}.${w.end.slice(5, 7)}.${w.free !== null ? ` (${w.free} free)` : ''}`).join(', ')}`] : []),
      'Pizza and barbecue evening during the camp week',
      'SUP and wakeboarding on no-wind days',
    ],
    accommodation: 'holiday flats, mobile home, shepherd\'s hut and Bauwagen at the kite base and the partner farm',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: ftfImages(camp).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FTF_CAMP_URL,
    bookingUrl: FTF_CAMP_URL,
    sourceText: [
      `camp: ${pick(/^Kitecamp Deutschland 2027/i) ?? ''} | price ${campPrice ?? '-'} | ${pick(/Barther Bodden/i) ?? ''}`,
      `stay: ${pick(/Deine Unterkunft befindet sich/i) ?? ''} | ${pick(/nicht im Camp-Preis enthalten/i) ?? ''}`,
      `units: ${lines.filter(l => /pro Nacht\)/.test(l)).join(' | ')}`,
      `weeks: ${weeks.map(w => `${w.start}..${w.end} free ${w.free}`).join('; ')}`,
      `farm pin: ${pin ? `${pin.lat},${pin.lng}` : '-'}`,
    ].join('\n'),
  };
}

export const ftfWatersportsZipke: OfferAdapter = {
  key: 'ftf-watersports-zipke',
  name: 'FTF Watersports Kite Camp Base Zipke',
  kind: 'accommodation',
  operator: {
    name: 'FTF Watersports',
    websiteUrl: SITE,
    rootDomain: 'ftf-watersports.com',
    contactEmail: 'info@ftf-watersports.com',
    phone: '+4915207865534',
  },
  url: FTF_CAMP_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  async fetchContent() {
    const camp = await page(FTF_CAMP_URL);
    const farm = await page(FTF_FARM_URL);
    if (!/Kitecamp|Kitesurf/i.test(camp)) throw new Error('ftf-watersports-zipke: kite camp text missing on /kite-camps');
    return parseFtfContent(camp, farm);
  },
  async fetchSlots() {
    const units = parseFtfUnits(await page(FTF_CAMP_URL));
    if (units.length === 0) throw new Error('ftf-watersports-zipke: "Unterkunftsmöglichkeiten vor Ort" price bullets not found on /kite-camps');
    return buildFtfSlots(units);
  },
};
