// ---------------------------------------------------------------------------
// Ventus Kitesurf & Wing Foil - Brazil group trips (three 8-day routes on one offer)
//
// Data path (checked 2026-10-09): one Wix page, server-rendered text,
//   https://www.ventuskitesurf.com/brazil-group-trips-kitesurf-wingfoil
//   Each route block: heading ("Brazil Essentials Route" / "Classic Route" / "Wild Wind Route"),
//   a date line ("Oct 3-10 | Dec 5-12 2026", "Oct 17-24 | Oct 31-07 | ...", "August | Sept 2026"),
//   "7 Nights/8 Days", "$1550 USD P/P", included / not-included lists, spot lines ("Start in Paracuru – ...").
//   The page's JSON-LD is WRONG (describes the Colombia trip) - never read it.
//   "Secure Your Spot" opens an inquiry form (/book-now): no inventory -> availability 'on_request'.
// robots.txt (2026-10-09): "Allow: /", only ?lightbox= disallowed.
// Requests per run: 1 (content and slots each fetch the page once).
// Parsed: one slot per route x departure (unit = route name). Month-only departures (Wild Wind:
//   "August | Sept") become one slot per month with startDate null and endDate = month end.
// Known limits: no availability signal at all; single room = +15% (noted in content, no extra slots);
//   the shared parseRange() rolls "Oct 31-07" into the next YEAR, so dates are parsed locally here.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, imageCandidates, iso, meta, monthOf, parse, parseRange } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';

export const VENTUS_PAGE_URL = 'https://www.ventuskitesurf.com/brazil-group-trips-kitesurf-wingfoil';
const BOOKING_URL = 'https://www.ventuskitesurf.com/book-now';

export interface VentusDeparture { start: string | null; end: string; month: string | null; label: string }
export interface VentusRoute {
  name: string;
  dateLabel: string;
  departures: VentusDeparture[];
  price: number | null;
  currency: string | null;
  nights: number | null;
  days: number | null;
  singleRoomSurchargePct: number | null;
  spots: string[];
  included: string[];
  notIncluded: string[];
}

// --- local helpers ----------------------------------------------------------------------------
function textLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/[​ ]/g, ' '))).filter(Boolean);
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(brazil|route)\b/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function monthEnd(y: number, m: number): string {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const DATE_PART = /^([A-Za-z]{3,9})\.?(?:\s+(\d{1,2})\s*-\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2}))?(?:\s+(20\d{2}))?$/;

/** "Oct 3-10 | Dec 5-12 2026" style line? */
export function isVentusDateLine(line: string): boolean {
  const parts = line.split('|').map(p => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => { const m = p.match(DATE_PART); return !!m && !!monthOf(m[1]); });
}

/**
 * Parse a date line. "Oct 31-07" = Oct 31 to Nov 7 (end day before start day rolls into the NEXT MONTH,
 * not the next year as the shared parseRange would); a bare month ("August") is a month band.
 */
export function parseVentusDates(label: string, fallbackYear: number | null): VentusDeparture[] {
  const out: VentusDeparture[] = [];
  const parts = label.split('|').map(p => p.trim()).filter(Boolean);
  const labelYear = label.match(/\b(20\d{2})\b/)?.[1];
  const y = labelYear ? Number(labelYear) : fallbackYear;
  if (!y) return out;
  for (const p of parts) {
    const m = p.match(DATE_PART);
    if (!m || !monthOf(m[1])) continue;
    const mon = monthOf(m[1])!;
    const year = m[5] ? Number(m[5]) : y;
    if (!m[2]) { // month only
      out.push({ start: null, end: monthEnd(year, mon), month: `${year}-${String(mon).padStart(2, '0')}`, label: p });
      continue;
    }
    if (m[3] && monthOf(m[3])) { // "Oct 31-Nov 7": explicit end month, the shared helper handles it
      const r = parseRange(`${m[1]} ${m[2]}-${m[3]} ${m[4]} ${year}`);
      if (r) out.push({ start: r.start, end: r.end, month: null, label: p });
      continue;
    }
    const d1 = Number(m[2]);
    const d2 = Number(m[4]);
    let endMon = mon;
    let endYear = year;
    if (d2 < d1) { endMon = mon === 12 ? 1 : mon + 1; if (mon === 12) endYear++; }
    out.push({ start: iso(year, mon, d1), end: iso(endYear, endMon, d2), month: null, label: p });
  }
  return out;
}

// spot lines in the Classic / Wild Wind blocks: "<verb phrase> <Spot> – <description>"
const SPOT_LEAD = /^(?:Start in|Session in|Progress in|Glide through|Slow down in|Ride in|Drift into|Explore the|Touch down in|Feel the freedom in)\s+(.+?)\s+[–—-]\s+/;

/** Route blocks: heading line followed directly by a date line. */
export function parseVentusRoutes(html: string): VentusRoute[] {
  const lines = textLines(html);
  const heads: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/\bRoute$/.test(lines[i]) && lines[i].length < 40 && isVentusDateLine(lines[i + 1])) heads.push(i);
  }
  const stop = lines.findIndex(l => /^Beachfront stays/i.test(l));
  return heads.map((h, idx) => {
    const end = heads[idx + 1] ?? (stop > h ? stop : lines.length);
    const sec = lines.slice(h, end);
    const secText = sec.join('\n');
    const yearInSection = secText.match(/\b(20\d{2})\b/)?.[1];
    const priceLine = sec.find(l => /USD\s*P\/P|P\/P/i.test(l) && /\d/.test(l)) ?? '';
    const price = findPrices(priceLine)[0] ?? null;
    const nd = secText.match(/(\d+)\s*Nights?\s*\/\s*(\d+)\s*Days?/i);
    const single = secText.match(/single room[^%]*?(\d+)\s*%/i);

    const spots: string[] = [];
    for (const l of sec) {
      const m = l.match(SPOT_LEAD);
      if (m) spots.push(m[1].trim());
      for (const s of l.matchAll(/\b\d+\s+nights\s+in\s+([A-ZÀ-Ý][\p{L} ]+?)(?=\s+and\b|[.,—–]|$)/gu)) spots.push(s[1].trim());
    }

    const incStart = sec.findIndex(l => /^What is included\??$/i.test(l));
    const flights = sec.findIndex((l, i) => i > incStart && /^Flights$/i.test(l));
    const notHead = sec.findIndex((l, i) => i > incStart && /^What is not included\??$/i.test(l));
    const incEnd = [flights, notHead].filter(i => i > incStart).sort((a, b) => a - b)[0] ?? -1;
    const included = incStart >= 0 && incEnd > incStart
      ? sec.slice(incStart + 1, incEnd).map(l => l.split(/[:—–]/)[0].trim()).filter(l => l.length > 2)
      : [];
    const personal = sec.findIndex((l, i) => i > flights && /^Personal expenses/i.test(l));
    const notIncluded = flights >= 0 && personal >= flights ? sec.slice(flights, personal + 1) : [];

    return {
      name: lines[h],
      dateLabel: lines[h + 1],
      departures: parseVentusDates(lines[h + 1], yearInSection ? Number(yearInSection) : null),
      price: price?.amount ?? null,
      currency: price?.currency ?? null,
      nights: nd ? Number(nd[1]) : null,
      days: nd ? Number(nd[2]) : null,
      singleRoomSurchargePct: single ? Number(single[1]) : null,
      spots: [...new Set(spots)],
      included,
      notIncluded,
    };
  });
}

/** One slot per route x departure; inquiry-only booking -> on_request. */
export function parseVentusSlots(html: string): Slot[] {
  const out: Slot[] = [];
  for (const r of parseVentusRoutes(html)) {
    for (const d of r.departures) {
      out.push({
        key: `${keyPart(r.name)}|${d.start ?? d.month}`,
        startDate: d.start,
        endDate: d.end,
        unit: r.name,
        price: r.price,
        currency: r.price !== null ? r.currency : null,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: null,          // shared room; single room +15%
        availability: 'on_request',
        availabilityText: d.start ? null : `${d.label} (exact dates on request)`,
        spotsLeft: null,
        datePrecision: d.start ? 'day' : 'month',
      });
    }
  }
  return out;
}

const REGIONS: Array<[RegExp, string]> = [
  [/cumbuco|ta[ií]ba|paracuru|icara[ií]|guajiru|guri[uú]|tatajuba|jericoacoara/i, 'Ceará'],
  [/barra grande|macap[aá]|parna[ií]ba/i, 'Piauí'],
  [/arpoador|atins|len[cç][oó]is/i, 'Maranhão'],
];

export function parseVentusContent(html: string): OfferContent {
  const routes = parseVentusRoutes(html);
  const lines = textLines(html);
  const allText = lines.join('\n');
  const title = (meta(html, 'og:title') ?? '').split('|')[0].trim() || 'Brazil Kitesurf & Wing Foil Group Trips';

  const names: string[] = [];
  for (const r of routes) for (const s of r.spots) if (!names.includes(s)) names.push(s);
  const itinerarySpots: ItinerarySpot[] = names.map((name, i) => ({
    name, country: 'Brazil', region: REGIONS.find(([re]) => re.test(name))?.[1] ?? null, order: i + 1,
  }));

  // services present on every route stay plain, route-specific ones get the route name
  const short = (n: string) => n.replace(/^Brazil\s+/i, '').replace(/\s+Route$/i, '');
  const inAll = (item: string) => routes.every(r => r.included.includes(item));
  const included: string[] = [];
  for (const r of routes) for (const it of r.included) {
    const label = inAll(it) ? it : `${it} (${short(r.name)})`;
    if (!included.includes(label)) included.push(label);
  }
  const notIncluded = [...new Set(routes.flatMap(r => r.notIncluded))];
  const surcharge = routes.find(r => r.singleRoomSurchargePct)?.singleRoomSurchargePct ?? null;
  const group = allText.match(/Usually\s+(\d+)\s*[–-]\s*(\d+)\s+riders/i);
  const days = routes.find(r => r.days)?.days ?? null;

  const routeText = routes.map(r => `${short(r.name)} (${r.spots.slice(0, 1).concat(r.spots.length > 1 ? [r.spots[r.spots.length - 1]] : []).join(' to ')}${r.price ? `, USD ${r.price.toLocaleString('en-US')}` : ''})`).join(', ');
  const summary = [
    `Small-group${group ? ` (usually ${group[1]}-${group[2]} riders)` : ''} ${days ?? 8}-day kitesurf and wing foil trips along the coast of northeast Brazil, with an English-speaking instructor in the water and private 4x4 transfers between spots.`,
    routes.length ? `There are ${routes.length} routes: ${routeText}.` : null,
    'Seven nights of accommodation, daily breakfast, downwinder sessions and photos are included; flights, lunch and dinner are not.',
    surcharge ? `A single room costs ${surcharge}% more; all levels are welcome and lessons are available.` : 'All levels are welcome and lessons are available.',
  ].filter(Boolean).join(' ');

  // Wix: keep only absolute static.wixstatic.com originals (the srcset splitter turns
  // ".../v1/fill/...,enc_avif,quality_auto/x.jpg" into relative junk that 404s); drop logos/icons
  const images = imageCandidates(html, VENTUS_PAGE_URL, null, 80)
    .filter(u => /^https:\/\/static\.wixstatic\.com\/media\//.test(u) && !/\.png$/i.test(u));

  return {
    kind: 'tour',
    title,
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: names[0] ?? 'Cumbuco',
    itinerarySpots,
    durationDays: days,
    // FAQ "Do I need to be experienced to join? Not at all!" + "Kitesurf & Wing foil Lessons Available" (2026-10-09)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Lessons\s+Available/i.test(allText),
    equipmentRental: /arrange rentals/i.test(allText),
    beginnerFriendly: /designed for all levels|All levels welcome/i.test(allText),
    includedServices: included,
    optionalServices: [
      ...(surcharge ? [`Single room: +${surcharge}% on the trip price`] : []),
      ...(/arrange rentals/i.test(allText) ? ['Kite / wing gear rental (arranged on request)'] : []),
      ...(/extend your stay/i.test(allText) ? ['Extra nights before or after the trip'] : []),
    ],
    accommodation: 'Beachfront or near-the-beach lodges and pousadas with Wi-Fi and A/C (shared rooms)',
    mealPlan: 'breakfast',
    languages: ['en'],   // "speaks English"; the page also promises "bilingual support" (second language not named)
    rooms: [],
    imageUrls: images.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: VENTUS_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      ...routes.map(r => `${r.name} | ${r.dateLabel} | ${r.nights}n/${r.days}d | ${r.currency} ${r.price} | spots: ${r.spots.join(' > ')} | incl: ${r.included.join('; ')} | excl: ${r.notIncluded.join('; ')}`),
      allText,
    ].join('\n'),
  };
}

export const ventusBrazilRoutes: OfferAdapter = {
  key: 'ventus-brazil-routes',
  name: 'Ventus Brazil kitesurf & wing foil group trips',
  kind: 'tour',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Ventus Kitesurf',
    websiteUrl: 'https://www.ventuskitesurf.com',
    rootDomain: 'ventuskitesurf.com',
  },
  url: VENTUS_PAGE_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  async fetchContent() {
    return parseVentusContent(await fetchText(VENTUS_PAGE_URL));
  },
  async fetchSlots(ctx) {
    const html = await fetchText(VENTUS_PAGE_URL);
    const routes = parseVentusRoutes(html);
    if (routes.length === 0) throw new Error('ventus: no route blocks (heading + date line) found - page layout changed');
    for (const r of routes) {
      if (r.price === null) ctx.note(`${r.name}: no price found`);
      for (const d of r.departures) {
        if (d.start && r.days) {
          const len = Math.round((Date.parse(d.end) - Date.parse(d.start)) / 86400000) + 1;
          if (len !== r.days) ctx.note(`${r.name} ${d.label}: ${len} days but the route says ${r.days}`);
        }
      }
    }
    return parseVentusSlots(html);
  },
};
