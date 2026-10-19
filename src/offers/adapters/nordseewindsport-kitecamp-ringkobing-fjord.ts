// ---------------------------------------------------------------------------
// Nordseewindsport "Kitesurf-Event in Dänemark", Ringkøbing Fjord near Hvide Sande (West Jutland, Denmark) - the
// German North Sea kite school's guided kite weeks: 7 nights in its event house on the fjord (private water access,
// pool, sauna, two hot tubs, up to 20 guests; North Sea 1.5 km, Hvide Sande 7 minutes by car), 6 full event days of
// guided kiting with the school's gear (own kite per guest, coaching sessions and video tips; a full lesson package
// costs extra), SUPs, yoga. Kind 'camp' (one place; supervised kiting rather than a course - see kiteLessons).
//
// Data path (checked 2026-10-19): CM4all site builder, server-rendered, ONE page /Camps/Daenemark/index.php/:
//   slots    "<year> bieten wir folgende Eventwochen an:" + per week "29.08. - 05.09.2026" / "alle Level" /
//            "leider ausgebucht". The parser reads every dated week row the page lists and keeps those that have not
//            started; status words -> availability (ausgebucht -> sold_out, few / waitlist words mapped, else
//            on_request: bookings are requests answered with an offer, 20% deposit).
//   prices   "Privates Einzelzimmer 999 Euro pro Person", "Doppelbelegung 899 Euro pro Person" (guided kiting and
//            rental gear included), "- 200 Euro pro Person mit eigenem Material", "Schulungspaket ... + 250 Euro".
//            One slot per week x room option, EUR per person (priceUnit 'package', packageNights 7).
//   content  the same page; photos are CM4all uploads (/.cm4all/uproc.php/ is robots-allowed), 1600 px rendition.
// robots.txt nordseewindsport.de (2026-10-19): "User-agent: * Crawl-delay: 10", /.cm4all/ disallowed except mediadb,
//   sysdb and uproc.php. One request per run (content + slots memoised), so the crawl delay is never hit.
// State 2026-10-19: all three 2026 weeks (29.08.-19.09.) are past and were "leider ausgebucht" -> 0 slots; the summary
//   says the 2027 dates are not published yet. New weeks appear automatically once the page lists them.
// Flags: request + deposit by invoice -> instantBooking false; liveAvailability false.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { parseAmount, todayIso } from '../parse.js';
import type { Availability, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://nordseewindsport.de';
export const NWS_URL = `${SITE}/Camps/Daenemark/index.php/`;
const NIGHTS = 7;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface NwsWeek { start: string; end: string; level: string | null; status: string | null }
export interface NwsPrices { single: number | null; double: number | null; ownGear: number | null; lessons: number | null }

const pad = (n: number | string): string => String(n).padStart(2, '0');

/** Dated week rows "29.08. - 05.09.2026" followed by level and status lines. */
export function parseNwsWeeks(html: string): NwsWeek[] {
  const lines = blockLines(html);
  const out: NwsWeek[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) continue;
    const ey = Number(m[6]);
    const sy = m[3] ? Number(m[3]) : (Number(m[2]) > Number(m[5]) ? ey - 1 : ey);
    const next = lines.slice(i + 1, i + 3);
    const level = next.find(l => /level|anfänger|fortgeschritten/i.test(l)) ?? null;
    const status = next.find(l => /ausgebucht|frei|plätze|warteliste|buchbar|verfügbar/i.test(l)) ?? null;
    out.push({ start: `${sy}-${pad(m[2])}-${pad(m[1])}`, end: `${ey}-${pad(m[5])}-${pad(m[4])}`, level, status });
  }
  return out;
}

export function parseNwsPrices(html: string): NwsPrices {
  const lines = blockLines(html);
  const after = (re: RegExp): number | null => {
    const i = lines.findIndex(l => re.test(l));
    const m = i >= 0 ? lines[i + 1]?.match(/^([\d.,]+)\s*Euro pro Person/i) : null;
    return m ? parseAmount(m[1]) : null;
  };
  const t = lines.join('\n');
  const own = t.match(/-\s*([\d.,]+)\s*Euro pro Person mit eigenem Material/i);
  const iLesson = lines.findIndex(l => /^Schulungspaket$/i.test(l));
  const lesson = iLesson >= 0 ? lines.slice(iLesson, iLesson + 5).join(' ').match(/\+\s*([\d.,]+)\s*Euro/i) : null;
  return {
    single: after(/^Privates Einzelzimmer$/i),
    double: after(/^Doppelbelegung$/i),
    ownGear: own ? parseAmount(own[1]) : null,
    lessons: lesson ? parseAmount(lesson[1]) : null,
  };
}

export function nwsAvailability(status: string | null): Availability {
  const t = (status ?? '').toLowerCase();
  if (/ausgebucht/.test(t)) return 'sold_out';
  if (/warteliste/.test(t)) return 'waitlist';
  if (/wenige|nur noch|restpl|letzte/.test(t)) return 'limited';
  return 'on_request';
}

export function buildNwsSlots(weeks: NwsWeek[], p: NwsPrices, today: string): Slot[] {
  const out: Slot[] = [];
  for (const w of weeks.filter(x => x.start >= today)) {
    for (const [room, price, occ] of [['single', p.single, 1], ['double', p.double, 2]] as const) {
      if (price === null) continue;
      out.push({
        key: `${room}|${w.start}`,
        startDate: w.start,
        endDate: w.end,
        unit: room === 'single' ? 'Private single room + guided kiting with rental gear' : 'Shared double room + guided kiting with rental gear',
        price,
        currency: 'EUR',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: occ,
        availability: nwsAvailability(w.status),
        availabilityText: [w.status, w.level, 'booking request, offer with 20% deposit',
          p.ownGear ? `EUR ${p.ownGear} less with own gear` : null, p.lessons ? `lesson package +EUR ${p.lessons}` : null].filter(Boolean).join('; '),
        spotsLeft: null,
        packageNights: NIGHTS,
      });
    }
  }
  return out;
}

/** CM4all photos, 1600 px rendition, logo and video posters dropped. */
export function nwsImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\/\.cm4all\/uproc\.php\/0\/((?:[^/"'\s]+\/)*)\.([^/"'\s]+\.(?:jpe?g|png|webp))\/picture-\d+(\?_=[0-9a-f]+)?/gi)) {
    if (/logo/i.test(m[2])) continue;
    const u = `${SITE}/.cm4all/uproc.php/0/${m[1]}.${m[2]}/picture-1600${m[3] ?? ''}`;
    if (!out.some(x => x.includes(`/.${m[2]}/`))) out.push(u);
  }
  return out;
}

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseNwsContent(html: string, today: string): OfferContent {
  const lines = blockLines(html);
  const weeks = parseNwsWeeks(html);
  const prices = parseNwsPrices(html);
  const future = weeks.filter(w => w.start >= today);
  const years = [...new Set(weeks.map(w => Number(w.start.slice(0, 4))))];
  const months = [...new Set(weeks.flatMap(w => [Number(w.start.slice(5, 7)), Number(w.end.slice(5, 7))]))].map(m => MONTH_EN[m - 1]);
  const dates = future.length
    ? `Event weeks: ${future.map(w => `${w.start} to ${w.end}`).join(', ')}.`
    : `Runs every year; ${years.length ? `${Math.max(...years) + 1} dates not yet published (${years.join('/')}: ${months.join(' and ')})` : 'next dates not yet published'}.`;
  const summary = [
    'Nordseewindsport, a German North Sea kite school, runs guided kite weeks in its event house on Ringkøbing Fjord near Hvide Sande: private access to the shallow, standing-depth fjord, the North Sea 1.5 km away, pool, sauna and two hot tubs, room for up to 20 guests.',
    'A week brings 7 nights and 6 full event days of supervised kiting with the school\'s gear (no sharing of kites), coaching tips and video, theory, SUPs and optional yoga; a full lesson package costs extra and dinners are cooked together, costs shared.',
    `${prices.double && prices.single ? `EUR ${prices.double} per person in a double room or EUR ${prices.single} in a single room; ` : ''}booking by request. ${dates}`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Nordseewindsport Kite Event Week, Ringkøbing Fjord',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Hvide Sande, West Jutland',
    spot: 'Hvide Sande',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // "alle Level"
    kiteLessons: true, // coaching sessions + videos included, full lesson package optional
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights in the event house on Ringkøbing Fjord (private water access, pool, sauna, two hot tubs)',
      '6 full event days of guided kiting, coaching sessions and video tips',
      'Kites, boards and bars (own kite per guest, no buddy system)',
      'Theory: gear, self-rescue, new tricks; 5 SUPs; yoga sessions',
    ],
    optionalServices: [
      prices.lessons ? `Lesson package with a trainer at every session: +EUR ${prices.lessons}` : null,
      prices.ownGear ? `Own gear: EUR ${prices.ownGear} less per person` : null,
      'Food, electricity and water shared on site (about EUR 40 for dinners and EUR 30-40 for utilities per week)',
    ].filter((x): x is string => !!x),
    accommodation: 'shared event house on the fjord, single or double rooms',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms: [],
    imageUrls: nwsImages(html).slice(0, 25),
    heroVideoUrl: null,
    sourceUrl: NWS_URL,
    bookingUrl: NWS_URL,
    sourceText: [
      lines.slice(0, 62).join('\n'),
      `parsed: weeks ${weeks.map(w => `${w.start}..${w.end} ${w.status}`).join('; ')}; prices ${JSON.stringify(prices)}`,
    ].join('\n'),
  };
}

export async function fetchNwsSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(NWS_URL);
  const weeks = parseNwsWeeks(html);
  const prices = parseNwsPrices(html);
  if (prices.single === null && prices.double === null) throw new Error('nordseewindsport: room prices not found (layout changed?)');
  if (!weeks.length) { ctx?.note('nordseewindsport: no dated event weeks on the page'); return []; }
  const slots = buildNwsSlots(weeks, prices, today);
  if (!slots.length) ctx?.note(`all listed event weeks are past (${weeks.map(w => `${w.start} ${w.status ?? ''}`.trim()).join(', ')}); next dates not published yet`);
  return slots;
}

export const nordseewindsportKitecampRingkobingFjord: OfferAdapter = {
  key: 'nordseewindsport-kitecamp-ringkobing-fjord',
  name: 'Nordseewindsport Kite Event Week, Ringkøbing Fjord',
  kind: 'camp',
  operator: {
    name: 'Nordseewindsport',
    websiteUrl: SITE,
    rootDomain: 'nordseewindsport.de',
    contactEmail: 'info@nordseewindsport.de',
    phone: '+49 178 8240990',
  },
  url: NWS_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 1,
  async fetchContent() { return parseNwsContent(await page(NWS_URL), todayIso()); },
  fetchSlots: ctx => fetchNwsSlots(todayIso(), ctx),
};
