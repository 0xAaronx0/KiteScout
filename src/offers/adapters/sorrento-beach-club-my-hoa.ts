// ---------------------------------------------------------------------------
// Sorrento Beach Club & Kite Village, My Hoa lagoon (Ninh Hai, north of Phan Rang, Vietnam) - boutique hotel with
// two infinity pools, restaurant/bar and its own IKO-affiliated kite school and kite club on the lagoon.
//
// Liveness (re-check 2026-10-12): the IKO course calendar lists courses at "Sorrento Beach Club and Kite Centre"
//   in January 2026 (Assistant 3-7 Jan, First Aid 9 Jan, Instructor Level 1 10-14 Jan; seen as web-search snippets
//   of ikointl.com, a hint, not data); own site: the footer template was edited 2026-07-29 (Yoast tatsu_footer
//   sitemap lastmod), /play/ 2024-12-12 ("2024/25" kite prices). Verdict LIVE.
// Data path (checked 2026-10-12): WordPress (Tatsu builder) at sorrentobeachclub.com:
//   content  / (overview), /stay/ (5 room types: <h5> name, <p> beds/guests, STANDARD RATE / PEAK RATE <p>s,
//            "Peak rate applicable: ..." + a photo carousel per room), /play/ (kite school, lesson packages
//            2024/25, rental, kite club membership + lockers), /about/ (the place, how to get there).
//   slots    /stay/ rate table, VND per room per night. GATE: the rates are used only while the table's peak
//            ranges reach today or later (the table names its own season). On 2026-10-12 the peak ranges are
//            "Dec 22, 2023 to Jan 03, 2024 and Feb 08 to Feb 15 2024" -> stale -> fetchSlots returns [] with a note
//            ("price on request"). When the owner publishes a new season the same parser yields one undated
//            standard-rate slot per room x view and one dated peak slot per room x view x peak range.
//   No booking engine: reservations by e-mail / phone.
// robots.txt (2026-10-12): Yoast default, "Disallow:" (nothing).
// Requests per run: content 4, slots 1.
// Known limits: no coordinates on the site (only a Google Maps short link); the room features say which views a room
//   type is sold with only where the rate lines name them (Executive Deluxe: Ocean View / Pool/Garden view).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://sorrentobeachclub.com';
export const SBC_HOME_URL = `${SITE}/`;
export const SBC_STAY_URL = `${SITE}/stay/`;
export const SBC_PLAY_URL = `${SITE}/play/`;
export const SBC_ABOUT_URL = `${SITE}/about/`;

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface SbcRate { view: string | null; amount: number }
export interface SbcRoom { name: string; text: string | null; guests: number | null; standard: SbcRate[]; peak: SbcRate[] }
export interface SbcStay { rooms: SbcRoom[]; peakRanges: Array<{ start: string; end: string }>; peakText: string | null }

// --- pure parsers -----------------------------------------------------------------------------
function rateLines(pHtml: string): SbcRate[] {
  return pHtml.split(/<br\s*\/?>/i).map(x => clean(x)).filter(x => /VND/i.test(x)).map(x => {
    const m = x.match(/^(.*?):\s*([\d.,]+)\s*VND/i);
    return { view: m ? m[1].trim() : null, amount: parseAmount(m ? m[2] : x) ?? 0 };
  }).filter(r => r.amount > 0);
}

/** "Dec 22, 2023 to Jan 03, 2024 and Feb 08 to Feb 15 2024" -> ISO ranges (a year-less start takes the end's year). */
export function parseSbcPeak(text: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  const body = text.replace(/^.*?applicable:\s*/i, '');
  for (const part of body.split(/\s+and\s+/i)) {
    const m = part.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})?\s+to\s+([A-Za-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})/i);
    if (!m || !monthOf(m[1]) || !monthOf(m[4])) continue;
    const ey = Number(m[6]);
    const sm = monthOf(m[1])!; const em = monthOf(m[4])!;
    const sy = m[3] ? Number(m[3]) : (sm > em ? ey - 1 : ey);
    out.push({ start: iso(sy, sm, Number(m[2])), end: iso(ey, em, Number(m[5])) });
  }
  return out;
}

/** /stay/: one room per <h5>, its <p>s up to the next <h5>. */
export function parseSbcStay(html: string): SbcStay {
  const rooms: SbcRoom[] = [];
  let peakText: string | null = null;
  const parts = html.split(/<h5[^>]*>/i).slice(1);
  for (const part of parts) {
    const name = clean(part.slice(0, part.search(/<\/h5>/i)));
    if (!name || /visit us|contact/i.test(name)) continue;
    const ps = [...part.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1]);
    const text = ps.map(p => clean(p)).find(t => /bed|guests/i.test(t) && !/RATE/.test(t)) ?? null;
    const std = ps.find(p => /STANDARD RATE/i.test(p));
    const peak = ps.find(p => /PEAK RATE/i.test(p));
    const pk = ps.map(p => clean(p)).find(t => /Peak rate applicable/i.test(t));
    if (pk && !peakText) peakText = pk;
    const guests = Number(text?.match(/suitable for (\d+) guests/i)?.[1]) || null;
    rooms.push({ name, text, guests, standard: std ? rateLines(std) : [], peak: peak ? rateLines(peak) : [] });
  }
  return { rooms, peakRanges: peakText ? parseSbcPeak(peakText) : [], peakText };
}

/** Rates count only while the table's own peak ranges reach `today`; otherwise the table is a past season. */
export function sbcRatesCurrent(stay: SbcStay, today: string): boolean {
  return stay.peakRanges.some(r => r.end >= today);
}

export function buildSbcSlots(stay: SbcStay, today: string): Slot[] {
  if (!sbcRatesCurrent(stay, today)) return [];
  const out: Slot[] = [];
  const base = (room: SbcRoom, r: SbcRate) => ({
    unit: r.view ? `${room.name} (${r.view})` : room.name,
    price: r.amount, currency: 'VND', priceUnit: 'per_night' as const, priceBasis: 'room' as const,
    occupancy: room.guests, availability: 'unknown' as const, availabilityText: null, spotsLeft: null,
  });
  for (const room of stay.rooms) {
    for (const r of room.standard) {
      out.push({ key: `${keyPart(room.name)}${r.view ? `-${keyPart(r.view)}` : ''}|standard`, startDate: null, endDate: null, ...base(room, r) });
    }
    for (const r of room.peak) {
      for (const band of stay.peakRanges.filter(b => b.end >= today)) {
        out.push({ key: `${keyPart(room.name)}${r.view ? `-${keyPart(r.view)}` : ''}|peak|${band.start}`, startDate: band.start, endDate: band.end, ...base(room, r) });
      }
    }
  }
  return out;
}

function lines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td')) {
    const t = collapse(el.text);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export interface SbcPages { home: string; stay: string; play: string; about: string }

export function parseSorrentoContent(p: SbcPages, today = todayIso()): OfferContent {
  const stay = parseSbcStay(p.stay);
  const current = sbcRatesCurrent(stay, today);
  const years = stay.peakRanges.flatMap(r => [r.start.slice(0, 4), r.end.slice(0, 4)]).sort();
  const tableSeason = years.length ? (years[0] === years[years.length - 1] ? years[0] : `${years[0]}/${years[years.length - 1].slice(2)}`) : null;
  const play = lines(p.play);
  const about = lines(p.about);
  const home = lines(p.home);
  const intro = home.find(t => /^Sorrento Beach Club offers/i.test(t)) ?? null;
  const roomsIntro = lines(p.stay).find(t => /^All rooms are tastefully decorated/i.test(t)) ?? null;
  const iko = play.find(t => /IKO Affiliated/i.test(t)) ?? null;
  const membership = play.find(t => /^All riders must register/i.test(t)) ?? null;
  const membershipItems = (() => {
    const i = play.findIndex(t => /^KITE MEMBERSHIP INCLUDES/i.test(t));
    return i < 0 ? [] : play.slice(i + 1, i + 6).filter(t => !/^Cost not applicable|^KITE MEMBERSHIP/i.test(t));
  })();
  const residentsFree = play.some(t => /Cost not applicable to Sorrento Beach Club residents/i.test(t));
  const seasonal = play.find(t => /^Seasonal\s+[A-Z][a-z]+-[A-Z][a-z]+$/.test(t))?.replace(/^Seasonal\s+/, '') ?? null;
  const packages = play.filter(t => /^\d+ Hr – .*Package = [\d.,]+ VND$/.test(t)).map(t => t.replace(/\s*=.*$/, ''));
  const aboutText = about.filter(t => /first resort-style|Conceived after|situated on My Hoa lagoon/i.test(t));

  const rooms: ContentRoom[] = stay.rooms.map(r => ({
    name: r.name,
    description: r.text,
    features: [
      ...(r.guests ? [`Up to ${r.guests} guests`] : []),
      ...r.standard.filter(x => x.view).map(x => `${x.view}`),
      'Air conditioning', 'Private patio', 'Wi-Fi',
    ],
  }));
  const largest = Math.max(0, ...stay.rooms.map(r => r.guests ?? 0));

  // home hero photos, then room carousels and kite gallery interleaved
  const homeImgs = imageCandidates(p.home, SBC_HOME_URL, null, 20).filter(u => /\/uploads\/.*\.jpe?g$/i.test(u));
  const stayImgs = imageCandidates(p.stay, SBC_STAY_URL, null, 80).filter(u => /\/uploads\/.*\.jpe?g$/i.test(u));
  const playImgs = imageCandidates(p.play, SBC_PLAY_URL, null, 40).filter(u => /\/uploads\/.*\.jpe?g$/i.test(u));
  const mixed: string[] = [...homeImgs];
  for (let i = 0; i < Math.max(stayImgs.length, playImgs.length); i++) {
    if (stayImgs[i]) mixed.push(stayImgs[i]);
    if (playImgs[i]) mixed.push(playImgs[i]);
  }
  const imageUrls = [...new Set(mixed)].slice(0, 30);

  const roomList = stay.rooms.map(r => r.name.toLowerCase().replace(/^2 bedroom suite$/, 'two-bedroom suite'));
  const summary = [
    'Sorrento Beach Club & Kite Village is a boutique hotel on the My Hoa lagoon in the Ninh Hai area north of Phan Rang, Vietnam, at the edge of Nui Chau National Park, with two infinity pools, a restaurant and a bar.',
    `Its ${stay.rooms.length || 5} room types (${roomList.join(', ').replace(/, ([^,]*)$/, ' and $1')}${largest ? `, up to ${largest} guests` : ''}) are air-conditioned and open onto private patios facing the pools, the garden or the sea.`,
    `The on-site kite school is IKO affiliated and runs lesson packages, instructor training, rental and a kite club with storage, compressor, beach assistance and rescue inside the lagoon${residentsFree ? ', free for hotel guests' : ''}${seasonal ? `; the kite season runs ${seasonal.replace(/^Nov-/, 'November-').replace('-', ' to ')}` : ''}.`,
    current
      ? 'Room rates are published per room and view, with higher peak rates on the listed peak dates.'
      : `The room rates on the site are for the ${tableSeason ?? 'past'} season, so stays are priced on request.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Sorrento Beach Club & Kite Village',
    summary,
    continent: 'Asia',
    country: 'Vietnam',
    region: 'Ninh Thuan',
    spot: 'My Hoa Lagoon',
    itinerarySpots: [],
    durationDays: null,
    // /play/: Discovery / Beginner / Begin & Ride / VIP Advanced packages + independent rental (2024/25)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: packages.length > 0 || !!iko,
    equipmentRental: play.some(t => /Rental Package|Kiting Gear Rental/i.test(t)),
    beginnerFriendly: true,
    includedServices: [
      'Air conditioning', 'Private patio', 'Wi-Fi', 'Daily toiletries', 'Two infinity pools',
      ...(residentsFree ? [`Kite club membership for hotel guests: ${membershipItems.join(', ').toLowerCase()}`] : []),
    ],
    optionalServices: [
      ...packages.map(x => `Kite lessons: ${x}`),
      'IKO instructor training courses',
      'Kite rental (full set, kite/bar, board, harness, by hour/day/week)',
      'Private kite lockers',
      'Beach assistance (set-up / pack-down)',
      'Restaurant and bar',
    ],
    accommodation: 'boutique hotel rooms and a two-bedroom suite',
    mealPlan: null,
    languages: ['en'],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: SBC_HOME_URL,
    bookingUrl: `${SITE}/contact/`,
    sourceText: [
      `home: ${intro ?? ''}`,
      `about: ${aboutText.join(' ')}`,
      `rooms: ${roomsIntro ?? ''}`,
      ...stay.rooms.map(r => `room ${r.name}: ${r.text ?? ''} | standard ${r.standard.map(x => `${x.view ?? ''} ${x.amount} VND`).join(', ')} | peak ${r.peak.map(x => `${x.view ?? ''} ${x.amount} VND`).join(', ')}`),
      `peak: ${stay.peakText ?? ''}`,
      `kite school: ${iko ?? ''}; packages: ${packages.join('; ')}`,
      `kite club: ${membership ?? ''} includes ${membershipItems.join('; ')}; residents free: ${residentsFree}; seasonal: ${seasonal ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const sorrentoBeachClubMyHoa: OfferAdapter = {
  key: 'sorrento-beach-club-my-hoa',
  name: 'Sorrento Beach Club & Kite Village My Hoa',
  kind: 'accommodation',
  operator: {
    name: 'Sorrento Beach Club',
    websiteUrl: SITE,
    rootDomain: 'sorrentobeachclub.com',
    contactEmail: 'sorrentobeachclub@gmail.com',
    phone: '+84333317122', // "+84 3333 17122 (Accommodation)"
  },
  url: SBC_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'low',
  async fetchContent() {
    const [home, stay, play, about] = [
      await fetchText(SBC_HOME_URL, { accept: 'text/html' }),
      await fetchText(SBC_STAY_URL, { accept: 'text/html' }),
      await fetchText(SBC_PLAY_URL, { accept: 'text/html' }),
      await fetchText(SBC_ABOUT_URL, { accept: 'text/html' }),
    ];
    return parseSorrentoContent({ home, stay, play, about });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const stay = parseSbcStay(await fetchText(SBC_STAY_URL, { accept: 'text/html' }));
    if (stay.rooms.length === 0) throw new Error('sorrento-beach-club: no room blocks (<h5>) on /stay/ (layout changed?)');
    const today = todayIso();
    if (!sbcRatesCurrent(stay, today)) {
      ctx.note(`rate table is a past season (${stay.peakText ?? 'no peak dates'}): offer stays "price on request"`);
      return [];
    }
    return buildSbcSlots(stay, today);
  },
};
