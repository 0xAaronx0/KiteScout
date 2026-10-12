// ---------------------------------------------------------------------------
// Puza Moya Guest House (Cape Sports Center), Langebaan (Western Cape, South Africa) - the guest house of the Cape
// Sports Center kite / wing / windsurf centre, across the road from the beach and about 90 m from the centre: 4 en-suite
// twin rooms and 2 en-suite family rooms around a private courtyard, communal kitchen, solar power; breakfast at the
// centre's Wunderbar on request.
//
// Liveness (checked 2026-10-12): season rates dated "Christmas 11. Dec. 2026 - 14. Jan. 2027" ... "31. Aug. 2027";
//   WordPress modified dates (wp-json) - /accommodation/ 2026-10-07T11:00:06, /kitesurfing/ 2026-10-07T17:25:34,
//   home 2026-10-07T17:11:07.
// Kite link: own kite school next door (Cape Sports Center: group and private kite lessons, rentals of Duotone / Core,
//   "Rent Your Kite-Buddy"); the guest house is "only 90m from the Cape Sports Center".
//
// Data path (checked 2026-10-12): capesports.co.za (WordPress / Divi).
//   content  /accommodation/ (Puza Moya block, facilities, season toggles, booking request form), /kitesurfing/
//            (lessons, packages, brands), /puza-moya/ (photos only).
//   slots    /accommodation/ season toggles: "High Season" (Christmas + Easter ranges, "Per room : R1450.00"), "Mid
//            Season A & B" (ranges A-C, "Double shared room p.p: R600", "Single: R950"), "Low Season A" (range, p.p.
//            and single rate). Rates are ZAR per night (the page does not say "per night"; guest-house rates, inferred).
//   Villa 2 (a self-catering townhouse the centre also lets) prints only 2025 / early-2026 rates: content only.
// Known inconsistency: the separate /puza-moya/ page (modified 2026-10-07T09:04, earlier the same day) prints low
//   season "30. March - 30. Aug. 2027" at R550 / R900, while /accommodation/ prints "2830. March - 31. Aug. 2027" at
//   R525 / R850. We read /accommodation/ only; its unreadable low-season start is set to the day after the last mid-
//   season range (1 May 2027, inferred).
// Booking: request form on the page (no engine) -> 'on_request'.
// robots.txt (2026-10-12): "User-agent: * Allow: /".
// Requests per run: content 3, slots 1.
// Parsed: per season range: high = per room (2 guests); mid / low = per person sharing (2 guests) and single (1 guest);
//   ranges that ended before today are dropped. Extra-child and breakfast prices go into the services.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://capesports.co.za';
export const PM_ACCOM_URL = `${SITE}/accommodation/`;
export const PM_KITE_URL = `${SITE}/kitesurfing/`;
export const PM_HOUSE_URL = `${SITE}/puza-moya/`;

/** Visible text split at block tags (script/style bodies dropped), en/em dashes normalised to hyphens. */
export function pmLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/\s*[–—]\s*/g, ' - '))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface PmRange { label: string; start: string | null; end: string }
export interface PmSeason { season: 'high' | 'mid' | 'low'; ranges: PmRange[]; perRoom: number | null; perPersonShared: number | null; single: number | null; extraChild: number | null; breakfast: number | null }

const validDay = (d: number) => d >= 1 && d <= 31;

/** "Christmas 11. Dec. 2026 - 14. Jan. 2027", "A 1. Sept. - 10. Dec. 2026", "Easter 26. to 29. March 2027". */
export function pmRange(line: string): PmRange | null {
  let m = line.match(/^(.*?)\s*(\d{1,4})\.\s*([A-Za-z]+)\.?\s*(\d{4})?\s*(?:-|to)\s*(\d{1,2})\.\s*([A-Za-z]+)\.?\s*(\d{4})$/);
  if (m && monthOf(m[3].replace(/^sept$/i, 'sep')) && monthOf(m[6].replace(/^sept$/i, 'sep'))) {
    const endY = Number(m[7]);
    const sm = monthOf(m[3].replace(/^sept$/i, 'sep'))!;
    const em = monthOf(m[6].replace(/^sept$/i, 'sep'))!;
    const sy = m[4] ? Number(m[4]) : sm > em ? endY - 1 : endY;
    const sd = Number(m[2]);
    return { label: m[1].trim(), start: validDay(sd) ? iso(sy, sm, sd) : null, end: iso(endY, em, Number(m[5])) };
  }
  m = line.match(/^(.*?)\s*(\d{1,2})\.\s*to\s*(\d{1,2})\.\s*([A-Za-z]+)\.?\s*(\d{4})$/);
  if (m && monthOf(m[4])) {
    const mo = monthOf(m[4])!;
    return { label: m[1].trim(), start: iso(Number(m[5]), mo, Number(m[2])), end: iso(Number(m[5]), mo, Number(m[3])) };
  }
  return null;
}

/** Season toggles of the Puza Moya block (between "High Season" and the Pilates / Villa 2 blocks). */
export function parsePmSeasons(html: string): PmSeason[] {
  const lines = pmLines(html);
  const out: PmSeason[] = [];
  let cur: PmSeason | null = null;
  for (const l of lines) {
    const head = l.match(/^(High|Mid|Low) Season\b/i);
    if (head) {
      cur = { season: head[1].toLowerCase() as PmSeason['season'], ranges: [], perRoom: null, perPersonShared: null, single: null, extraChild: null, breakfast: null };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^(Book with us|Pilates|VILLA 2|In Season)/i.test(l)) { cur = null; continue; }
    const r = pmRange(l);
    if (r) { cur.ranges.push(r); continue; }
    const amount = (re: RegExp) => { const m = l.match(re); return m ? parseAmount(m[1]) : null; };
    cur.perRoom ??= amount(/^Per room\s*:\s*R\s?([\d.,\s]+)$/i);
    cur.perPersonShared ??= amount(/^D(?:ou)?b(?:le|l) (?:shared )?room (?:share )?p\.p\.?\s*:\s*R\s?([\d.,]+)/i);
    cur.single ??= amount(/^Single\s*:\s*R\s?([\d.,]+)/i);
    cur.extraChild ??= amount(/^Extra child[^:]*:\s*R\s?([\d.,]+)/i);
    cur.breakfast ??= amount(/Breakfast\s*@\s*R\s?([\d.,]+)/i);
  }
  return out.filter(s => s.ranges.length && (s.perRoom || s.perPersonShared || s.single));
}

const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

export function buildPmSlots(seasons: PmSeason[], today: string): Slot[] {
  const dated = seasons.flatMap(s => s.ranges).filter(r => r.start);
  const out: Slot[] = [];
  for (const s of seasons) {
    for (const r of s.ranges) {
      // unreadable start ("2830. March"): the day after the latest earlier-ending range of another season (inferred)
      const start = r.start ?? addDays(dated.filter(d => d.end < r.end).map(d => d.end).sort().pop() ?? r.end, 1);
      if (r.end < today) continue;
      const base = { startDate: start, endDate: r.end, unit: 'En-suite room', currency: 'ZAR', priceUnit: 'per_night' as const, availability: 'on_request' as const, spotsLeft: null };
      const label = `${s.season} season${r.label ? ` ${r.label}` : ''}`;
      if (s.perRoom) out.push({ ...base, key: `room|${start}`, price: s.perRoom, priceBasis: 'room', occupancy: 2, availabilityText: label });
      if (s.perPersonShared) out.push({ ...base, key: `room-shared-pp|${start}`, price: s.perPersonShared, priceBasis: 'person', occupancy: 2, availabilityText: label });
      if (s.single) out.push({ ...base, key: `room-single|${start}`, price: s.single, priceBasis: 'room', occupancy: 1, availabilityText: label });
    }
  }
  return out.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.key.localeCompare(b.key));
}

/** The facilities paragraph is one run-on line ("DSTV / WiFi Complimentary tea & coffee (Nespresso) Bar fridge ..."). */
const FACILITIES: Array<[RegExp, string]> = [
  [/DSTV \/ WiFi/i, 'DSTV and Wi-Fi'],
  [/Complimentary tea & coffee/i, 'Complimentary tea and coffee (Nespresso)'],
  [/Bar fridge/i, 'Bar fridge'],
  [/Heaters/i, 'Heaters, electric blankets and hair dryers'],
  [/Safe for your valuables/i, 'Safe'],
  [/Separate entrances/i, 'Separate entrance to each room from the courtyard'],
  [/braai/i, 'Outside braai area'],
  [/private courtyard/i, 'Private courtyard'],
  [/communal kitchen/i, 'Communal kitchen, lounge and dining room'],
];

export interface PmPages { accommodation: string; kite: string; house: string }

export function parsePmContent(p: PmPages): OfferContent {
  const lines = pmLines(p.accommodation);
  const text = lines.join(' ');
  const kite = pmLines(p.kite).join(' ');
  const seasons = parsePmSeasons(p.accommodation);
  const facilities = text.match(/\bFacilities\b([\s\S]*?)(?:Just 100m from the beach|High Season|$)/)?.[1] ?? '';
  const twins = text.match(/(\d+) en-suite twin bedrooms/i)?.[1] ?? null;
  const families = text.match(/(\d+) en-suite family rooms/i)?.[1] ?? null;
  const high = seasons.find(s => s.season === 'high');
  const mid = seasons.find(s => s.season === 'mid');
  const breakfast = seasons.find(s => s.breakfast)?.breakfast ?? null;
  const fmt = (n: number) => `R${n.toLocaleString('en-US')}`;

  const rooms: ContentRoom[] = [
    { name: 'En-suite twin bedroom', description: 'Twin room with bath, shower and toilet, own entrance from the courtyard.', features: [twins ? `${twins} rooms` : null, 'Bar fridge, safe, heaters and electric blankets', 'DSTV and Wi-Fi'].filter((x): x is string => !!x) },
    { name: 'En-suite family room', description: 'Family room with bath, shower and toilet, own entrance from the courtyard.', features: [families ? `${families} rooms` : null, 'Child friendly', 'DSTV and Wi-Fi'].filter((x): x is string => !!x) },
  ];

  // only photos named after the guest house (the pages also show Villa 2, team and partner images)
  const imgs: string[] = [];
  for (const [html, base] of [[p.accommodation, PM_ACCOM_URL], [p.house, PM_HOUSE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/capesports\.co\.za\/wp-content\/uploads\/.*puza-?moya/i.test(u) || /\.png|\.svg|-Guest-house\./i.test(u)) continue;
      if (!imgs.includes(u)) imgs.push(u);
    }
  }

  const summary = [
    `Puza Moya is the guest house of the Cape Sports Center in Langebaan on South Africa's West Coast, across the road from the lagoon beach and about 90 m from the centre's kite, wing and windsurf school, with ${twins ?? 'four'} en-suite twin rooms and ${families ?? 'two'} en-suite family rooms around a private courtyard.`,
    'Guests share a fully equipped kitchen, lounge, dining room and braai area, the house runs on solar power, and breakfast is served on request at the centre\'s Wunderbar overlooking the lagoon.',
    `Rates are published by season for 2026/27${high?.perRoom ? `: ${fmt(high.perRoom)} per room at Christmas and Easter` : ''}${mid?.perPersonShared ? `, ${fmt(mid.perPersonShared)} per person sharing or ${fmt(mid.single ?? 0)} single in mid season` : ''}; the centre teaches group and private kite lessons and rents Duotone and Core gear.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Puza Moya Guest House (Cape Sports Center)',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Langebaan',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /lesson/i.test(kite),
    equipmentRental: /rental|hire equipment/i.test(kite),
    beginnerFriendly: /Beginner group package|Beginner private package/i.test(kite),
    includedServices: FACILITIES.filter(([re]) => re.test(facilities)).map(([, label]) => label),
    optionalServices: [
      breakfast ? `Breakfast at the Wunderbar: ${fmt(breakfast)} per person` : null,
      'Kite lessons: group (2 to 3 people) and private beginner packages, progression and advanced private lessons',
      'Kite rental (Duotone, Core), "Rent Your Kite-Buddy" accompanied kiting',
      'Wing foiling, windsurfing and tow-foiling at the Cape Sports Center',
      /Pilates/i.test(text) ? 'Pilates classes in the adjoining studio' : null,
    ].filter((x): x is string => !!x),
    accommodation: 'guest house rooms (en-suite twin and family rooms)',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PM_ACCOM_URL,
    bookingUrl: PM_ACCOM_URL,
    sourceText: [
      `accommodation: ${lines.filter(l => l.length > 25 && !/privacy policy|cancellation policy/i.test(l)).join(' | ')}`,
      `kitesurfing: ${pmLines(p.kite).filter(l => l.length > 40).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const puzaMoyaCapeSportsLangebaan: OfferAdapter = {
  key: 'puza-moya-cape-sports-langebaan',
  name: 'Puza Moya Guest House (Cape Sports Center)',
  kind: 'accommodation',
  operator: {
    name: 'Cape Sports Center',
    websiteUrl: SITE,
    rootDomain: 'capesports.co.za',
    contactEmail: 'info@capesport.co.za',
    phone: '+27227721114',
  },
  url: PM_ACCOM_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // dated season table, no inventory; per-night unit inferred
  async fetchContent() {
    const accommodation = await fetchText(PM_ACCOM_URL, { accept: 'text/html' });
    const kite = await fetchText(PM_KITE_URL, { accept: 'text/html' });
    const house = await fetchText(PM_HOUSE_URL, { accept: 'text/html' }); // photos only (its rate table differs, see header)
    return parsePmContent({ accommodation, kite, house });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const seasons = parsePmSeasons(await fetchText(PM_ACCOM_URL, { accept: 'text/html' }));
    if (seasons.length === 0) throw new Error('puza-moya-cape-sports-langebaan: no season rates on /accommodation/ (layout changed?)');
    if (seasons.some(s => s.ranges.some(r => !r.start))) ctx.note('a season start date was unreadable on the page; inferred from the previous range');
    const slots = buildPmSlots(seasons, todayIso());
    if (slots.length === 0) ctx.note('all published season ranges have ended (new rates not published yet?)');
    return slots;
  },
};
