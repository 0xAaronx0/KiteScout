// ---------------------------------------------------------------------------
// Windloop Kite Week & Sleep, Neuharlingersiel (East Frisia, German North Sea) - 5-day kite camp for beginners and
// improvers of the Windloop kite and windsurf school, with optional double glamping tents on the Nordsee Campingplatz
// next to the kite spot. KIND = 'camp': the own site sells the tents only with the camp ("Glamping-Zelten, welche während
// der Camp-Woche genutzt werden"; home: "buchen dein Windloop Glamping-Zelt direkt mit Parkplatz gleich mit!"), never as a
// stay on their own.
//
// Data path (checked 2026-10-14), Locomotive CMS (server-rendered):
//   content  /kurse/kite-week-und-sleep-ein-plus-aufsteiger-camp (camp text, dates, prices), / (season notice
//            "WINTERPAUSE 2026/2027 - ab 1.10. geschlossen", tent note), /kontakt (address, "Ab 01.05.2027 wieder
//            geöffnet", Google map marker = the school's station -> spotCoords).
//   slots    the camp page: "Zeiträume: 03. – 07 Juni / 17. – 21 Juni - Girls only mit Jantje / 01. – 05. Juli /
//            15. – 19. Juli" + "Preis: 599 € pro Person" + "Zelt pro Nacht 35,00 € (Doppelzelt)".
//            The weeks carry no year: the year is INFERRED as the one (of last / this / next year) in which the start
//            day is a Wednesday ("Camp Start: Mittwoch früh"); on 2026-10-14 that is 2026 for all four weeks.
// Booking: the page's "Kurs buchen" frame is a Leão calendar (myleao.com/plugins/iframe/calendar.php?tag=1147), but
//   that tag is the "Aufbaukurs Kitesurfen" and showed "Keine Termine gefunden" on 2026-10-14 -> not a slot source.
// robots.txt (2026-10-14): "Allow: /".
// Requests per run: content 3, slots 1 (memoised with content).
// Parsed: one slot per camp week (key "kite-week-sleep|<start>"), EUR 599 per person for the 5-day camp
//   (priceUnit 'package'; the tent is NOT included: EUR 35 per double tent per night, in the room features),
//   availability 'unknown'. Weeks that already started are dropped -> [] until the 2027 weeks appear.
// Known limits: the camp price excludes the tent, breakfast (EUR 10/day), parking (EUR 10/day) and the
//   Neuharlingersiel Kurbeitrag (EUR 3/day). The kontakt page embeds a Google Maps API key (redacted in fixtures).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { ALL_DATES } from '../types.js';

const SITE = 'https://www.windloop.de';
export const WLP_CAMP_URL = `${SITE}/kurse/kite-week-und-sleep-ein-plus-aufsteiger-camp`;
export const WLP_HOME_URL = `${SITE}/`;
export const WLP_CONTACT_URL = `${SITE}/kontakt`;
const CAMP_DAYS = 5;
const START_WEEKDAY = 3; // Wednesday ("Camp Start: Mittwoch früh")

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the pages */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function wlpLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table|header|footer)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface WlpWeek { start: string; end: string; label: string | null }
export interface WlpCamp {
  weeks: WlpWeek[];
  campPrice: number | null;
  tentPrice: number | null;
  breakfast: number | null;
  kurbeitrag: number | null;
  parking: number | null;
  durationDays: number | null;
}

const weekday = (d: string): number => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Year-less "03. – 07 Juni" ranges: the year (last / this / next) in which the start day is a Wednesday. */
export function inferWeekYear(day: number, month: number, today: string): number | null {
  const y0 = Number(today.slice(0, 4));
  const hits = [y0 - 1, y0, y0 + 1].filter(y => weekday(iso(y, month, day)) === START_WEEKDAY);
  return hits.length === 1 ? hits[0] : null;
}

/** Camp page: "Zeiträume:" list, "Preis: 599 € pro Person", tent / breakfast / Kurbeitrag / parking prices. */
export function parseWlpCamp(html: string, today: string): WlpCamp {
  const lines = wlpLines(html);
  const text = lines.join('\n');
  const weeks: WlpWeek[] = [];
  const from = lines.findIndex(l => /^Zeiträume:?$/i.test(l));
  if (from >= 0) {
    for (const l of lines.slice(from + 1, from + 12)) {
      if (/Das Camp|Inhalte|Dauer/i.test(l)) break;
      const m = l.match(/^(\d{1,2})\.?\s*[–-]\s*(\d{1,2})\.?\s+([A-Za-zäÄ]+)\.?(?:\s+(20\d{2}))?\s*(?:-\s*(.+))?$/);
      if (!m || !monthOf(m[3])) continue;
      const mo = monthOf(m[3])!;
      const year = m[4] ? Number(m[4]) : inferWeekYear(Number(m[1]), mo, today);
      if (!year) continue;
      weeks.push({ start: iso(year, mo, Number(m[1])), end: iso(year, mo, Number(m[2])), label: m[5]?.trim() || null });
    }
  }
  const num = (re: RegExp): number | null => { const m = text.match(re); return m ? parseAmount(m[1]) : null; };
  return {
    weeks,
    campPrice: num(/Preis:\s*([\d.,]+)\s*€\s*pro Person/i),
    tentPrice: num(/Zelt pro Nacht\s*([\d.,]+)\s*€/i) ?? num(/Glamping Zelt \(Doppelzelt\) pro Nacht ab\s*([\d.,]+)/i),
    breakfast: num(/Frühstück \(optional\):\s*([\d.,]+)\s*€/i),
    kurbeitrag: num(/Kurbeitrag[^:]*:\s*([\d.,]+)\s*€/i),
    parking: num(/Parkplatz \(optional\):\s*([\d.,]+)\s*€/i),
    durationDays: num(/Dauer:\s*(\d+)\s*Tage/i),
  };
}

export const WLP_UNIT = 'Kite Week & Sleep camp (5 days; glamping tent extra)';

export function buildWlpSlots(camp: WlpCamp, today: string): Slot[] {
  if (!camp.campPrice) return [];
  return camp.weeks.filter(w => w.start >= today).map(w => ({
    key: `kite-week-sleep|${w.start}`,
    startDate: w.start,
    endDate: w.end,
    unit: w.label ? `${WLP_UNIT} - ${w.label}` : WLP_UNIT,
    price: camp.campPrice,
    currency: 'EUR',
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: 1,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** Contact page: Google map marker "new google.maps.LatLng(53.700978, 7.694482)" + opening notice. */
export function parseWlpContact(html: string): { coords: { lat: number; lng: number } | null; closed: string | null; reopens: string | null; address: string | null } {
  const m = html.match(/google\.maps\.LatLng\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
  const text = wlpLines(html).join(' ');
  return {
    coords: m ? { lat: Number(m[1]), lng: Number(m[2]) } : null,
    closed: text.match(/Ab (\d{1,2}\.\d{1,2}\.20\d{2}) geschlossen/i)?.[1] ?? null,
    reopens: text.match(/Ab (\d{1,2}\.\d{1,2}\.20\d{2}) wieder geöffnet/i)?.[1] ?? null,
    address: text.match(/Surfschulen Windloop (.+? \d{5} Neuharlingersiel)/)?.[1] ?? null,
  };
}

/** "1.10.2026" -> "1 October 2026" */
function longDate(dmy: string): string {
  const [d, m, y] = dmy.split('.').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface WlpPages { camp: string; home: string; contact: string }

export function parseWindloopContent(p: WlpPages, today: string): OfferContent {
  const camp = parseWlpCamp(p.camp, today);
  const contact = parseWlpContact(p.contact);
  const lines = wlpLines(p.camp);
  const stay = lines.find(l => /Die Übernachtung erfolgt auf dem Nordsee Campingplatz/i.test(l)) ?? null;
  const winter = wlpLines(p.home).find(l => /WINTERPAUSE/i.test(l)) ?? null;
  const tentNote = wlpLines(p.home).find(l => /Glamping-Zelt/i.test(l)) ?? null;
  const intro = collapse(lines.slice(lines.findIndex(l => /^Kursbeschreibung$/i.test(l)) + 1).join(' ')).match(/Hast du Bock[\s\S]*?Sessions hinausgeht\./)?.[0] ?? null;
  const eur = (n: number | null) => (n !== null ? `EUR ${n}` : null);
  const dates = camp.weeks.map(w => `${w.start}..${w.end}${w.label ? ` (${w.label})` : ''}`).join(', ');

  // photos are lazy CSS backgrounds (data-bg="url('...')"): the camp header + its swiper gallery, then the home header
  const imgs: string[] = [];
  for (const html of [p.camp, p.home]) {
    for (const m of html.matchAll(/data-bg="url\('(https:\/\/(?:assets|cdn)\.locomotive\.works\/[^']+?\.(?:jpe?g|png|webp)(?:\?\d+)?)'\)"/gi)) {
      if (/logo|platzhalter|kontakt\.png/i.test(m[1]) || imgs.includes(m[1])) continue;
      if (html === p.home && !/\/pages\//.test(m[1])) continue; // home: only its own header photo, not other courses' cards
      imgs.push(m[1]);
    }
  }

  const summary = [
    `Kite Week & Sleep is a ${camp.durationDays ?? CAMP_DAYS}-day kitesurf camp for beginners and improvers run by the Windloop kite and windsurf school in Neuharlingersiel on the East Frisian North Sea coast, which teaches on its own large standing-depth spot with VDWS instructors and Duotone equipment.`,
    `Campers can sleep in double glamping tents with wooden beds on the Nordsee Campingplatz next to the kite spot${camp.tentPrice ? ` (EUR ${camp.tentPrice} per tent per night, booked with the camp)` : ''}; the camp${camp.campPrice ? ` costs EUR ${camp.campPrice} per person and` : ''} runs Wednesday to Sunday with daily kite sessions, theory and video analysis, all equipment included.`,
    ...(contact.closed && contact.reopens ? [`The school is closed for the winter from ${longDate(contact.closed)} and reopens on ${longDate(contact.reopens)}.`] : []),
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Windloop Kite Week & Sleep (glamping tents)',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Neuharlingersiel, East Frisia',
    spot: 'Neuharlingersiel',
    ...(contact.coords ? { spotCoords: contact.coords } : {}),
    itinerarySpots: [],
    durationDays: camp.durationDays ?? CAMP_DAYS,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: /Alles an Material wird von uns gestellt/i.test(lines.join(' ')),
    beginnerFriendly: true,
    includedServices: [
      'Daily kite sessions on land and water (one or two per day depending on conditions)',
      'Theory: wind and spot knowledge, safety, equipment',
      'Video analysis',
      'All kite equipment (neoprene shoes excepted)',
      'Group evenings (games night, pizza at sunset)',
    ],
    optionalServices: [
      ...(camp.tentPrice ? [`Glamping tent (double) on the Nordsee Campingplatz: EUR ${camp.tentPrice} per night`] : []),
      ...(camp.breakfast ? [`Shared breakfast at the station: EUR ${camp.breakfast} per person per day`] : []),
      ...(camp.parking ? [`Parking: EUR ${camp.parking} per day`] : []),
      'VDWS kitesurf licence exam',
      ...(camp.kurbeitrag ? [`Neuharlingersiel Kurbeitrag (visitor tax): EUR ${camp.kurbeitrag} per day`] : []),
    ],
    accommodation: 'double glamping tents with wooden beds on the campsite next to the kite spot',
    mealPlan: null,
    languages: ['de'],
    rooms: [{
      name: 'Glamping tent (double)',
      description: 'Double tent with wooden beds and mattresses on the Nordsee Campingplatz in Neuharlingersiel, close to the kite spot, used during the camp week; bring bed linen or a sleeping bag and a 90x200 fitted sheet.',
      features: [camp.tentPrice ? `EUR ${camp.tentPrice} per tent per night` : 'Price on request', 'Booked together with the camp'],
    }],
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WLP_CAMP_URL,
    bookingUrl: `${WLP_CAMP_URL}#buchen`,
    sourceText: [
      `camp: ${intro ?? ''}`,
      `dates (year inferred from the Wednesday start): ${dates || '-'}`,
      `prices: camp ${eur(camp.campPrice) ?? '-'} pp, tent ${eur(camp.tentPrice) ?? '-'} per night (double tent), breakfast ${eur(camp.breakfast) ?? '-'}/day, Kurbeitrag ${eur(camp.kurbeitrag) ?? '-'}/day, parking ${eur(camp.parking) ?? '-'}/day`,
      `stay: ${stay ?? ''}`,
      `home: ${winter ?? ''} | ${tentNote ?? ''}`,
      `contact: ${contact.address ?? ''}; closed from ${contact.closed ?? '-'}, reopens ${contact.reopens ?? '-'}`,
    ].join('\n'),
  };
}

export async function fetchWlpSlots(ctx: Pick<FetchContext, 'note' | 'lastPublished'>, today: string): Promise<Slot[]> {
  const camp = parseWlpCamp(await page(WLP_CAMP_URL), today);
  if (!camp.campPrice) throw new Error('windloop-glamping-neuharlingersiel: "Preis: ... € pro Person" not found on the camp page');
  if (camp.weeks.length === 0) ctx.note('windloop-glamping-neuharlingersiel: no camp weeks parsed ("Zeiträume" list missing or year not inferable)');
  const slots = buildWlpSlots(camp, today);
  ctx.lastPublished?.(buildWlpSlots(camp, ALL_DATES));
  if (camp.weeks.length > 0 && slots.length === 0) ctx.note('windloop-glamping-neuharlingersiel: all listed camp weeks are past - price on request until new dates');
  return slots;
}

export const windloopGlampingNeuharlingersiel: OfferAdapter = {
  key: 'windloop-glamping-neuharlingersiel',
  name: 'Windloop Kite Week & Sleep Neuharlingersiel',
  kind: 'camp',
  operator: {
    name: 'Surfschulen Windloop',
    websiteUrl: SITE,
    rootDomain: 'windloop.de',
    phone: '+4915170166966',
  },
  url: WLP_CAMP_URL,
  slotMethod: 'html_dates',
  fetchBudget: 4,
  confidence: 'medium', // week years inferred from the weekday
  async fetchContent() {
    const camp = await page(WLP_CAMP_URL);
    const home = await page(WLP_HOME_URL);
    const contact = await page(WLP_CONTACT_URL);
    if (!/Glamping/i.test(camp)) throw new Error('windloop-glamping-neuharlingersiel: glamping tent text missing on the camp page');
    return parseWindloopContent({ camp, home, contact }, todayIso());
  },
  async fetchSlots(ctx) {
    return fetchWlpSlots(ctx, todayIso());
  },
};
