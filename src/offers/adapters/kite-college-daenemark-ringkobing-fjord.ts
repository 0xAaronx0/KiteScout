// ---------------------------------------------------------------------------
// Kite College "Kitecollege Dänemark", Ringkøbing Fjord near Hvide Sande (West Jutland, Denmark) - the German kite
// coaching outfit's (VDWS trainers from Surfschule Norddeich) event week: 6 days of training, about 4-5 hours a day,
// max 3-4 students per trainer and 9-12 per week, kites and boards of several brands, radio and video coaching, and
// 7 nights in a large Danish holiday house shared with the trainers (pool with counter-current, slide, sauna,
// private beach; single or shared double room). Kind 'camp'.
//
// Data path (checked 2026-10-19): WordPress (theme + Events Manager), server-rendered, ONE page
// /portfolio/kitecollege-daenemark/ (dateModified 2026-07-06):
//   prices   "TERMINE 2026/27" box: "1 Woche Event only ab 890€" and "1 Woche mit Unterkunft ab 1.290€" (+ "Sieben
//            Nächte Unterkunft im geteilten Doppelzimmer oder im Einzelzimmer").
//   slots    the Events Manager table "EVENT | STATUS": per row "Kitecollege Dänemark <br>22/08/2027 - 27/08/2027",
//            status <span class=ampel1green>Freie Plätze</span>, an "ANFRAGE" (request) link. One slot per week that
//            has not started: the event dates as printed (the 7 nights of lodging wrap them; arrival day not printed),
//            EUR 1,290 "ab" per person (priceUnit 'package', packageNights 7), availability from the status words
//            (Freie Plätze -> available; few / waitlist / sold-out words and the ampel colour classes are mapped too).
//   Past weeks are dropped; the parser reads whatever rows the table lists.
// robots.txt www.kite-college.com (2026-10-19): Yoast default "Disallow:" (everything allowed).
// Requests per run: 1 (content + slots share one memoised fetch).
// Flags: booking is a request ("ANFRAGE") -> instantBooking false; liveAvailability false (status words on the page,
//   not an engine).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, parse, parseAmount, todayIso } from '../parse.js';
import type { Availability, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://www.kite-college.com';
export const KCD_URL = `${SITE}/portfolio/kitecollege-daenemark/`;
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

export interface KcdWeek { start: string; end: string; status: string; statusClass: string | null; requestUrl: string | null }
export interface KcdPrices { eventOnly: number | null; withStay: number | null }

export function parseKcdPrices(html: string): KcdPrices {
  const t = blockLines(html).join('\n');
  const ev = t.match(/1 Woche Event only ab\s*([\d.,]+)\s*€/i);
  const st = t.match(/1 Woche mit Unterkunft ab\s*([\d.,]+)\s*€/i);
  return { eventOnly: ev ? parseAmount(ev[1]) : null, withStay: st ? parseAmount(st[1]) : null };
}

/** Rows of the Events Manager table: dates, status words + ampel class, request link. */
export function parseKcdWeeks(html: string): KcdWeek[] {
  const out: KcdWeek[] = [];
  for (const tr of parse(html).querySelectorAll('table.events-table tbody tr')) {
    const td = tr.querySelectorAll('td');
    if (td.length < 2) continue;
    const m = collapse(td[0].text).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) continue;
    const span = td[1].querySelector('span');
    out.push({
      start: iso(+m[3], +m[2], +m[1]),
      end: iso(+m[6], +m[5], +m[4]),
      status: collapse(td[1].text),
      statusClass: span?.getAttribute('class') ?? null,
      requestUrl: td[2]?.querySelector('a')?.getAttribute('href') ?? null,
    });
  }
  return out;
}

export function kcdAvailability(status: string, cls: string | null): Availability {
  const t = status.toLowerCase();
  if (/ausgebucht|belegt|sold out|voll\b/.test(t) || /red/i.test(cls ?? '')) return 'sold_out';
  if (/warteliste|waitlist/.test(t)) return 'waitlist';
  if (/wenige|restpl|fast|nur noch|few/.test(t) || /yellow|orange/i.test(cls ?? '')) return 'limited';
  if (/frei|verfügbar|available/.test(t) || /green/i.test(cls ?? '')) return 'available';
  return 'on_request';
}

export function buildKcdSlots(weeks: KcdWeek[], prices: KcdPrices, today: string): Slot[] {
  return weeks.filter(w => w.start >= today).map(w => ({
    key: w.start,
    startDate: w.start,
    endDate: w.end,
    unit: '1 week with accommodation (shared double or single room) + 6-day event',
    price: prices.withStay,
    currency: prices.withStay !== null ? 'EUR' : null,
    priceUnit: prices.withStay !== null ? 'package' : null,
    priceBasis: prices.withStay !== null ? 'person' : null,
    occupancy: 1,
    availability: kcdAvailability(w.status, w.statusClass),
    availabilityText: `${w.status}; booking by request${prices.withStay ? ` - from EUR ${prices.withStay} with 7 nights` : ''}${prices.eventOnly ? `, event only from EUR ${prices.eventOnly}` : ''}`,
    spotsLeft: null,
    packageNights: NIGHTS,
  }));
}

const EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const enDate = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function parseKcdContent(html: string, today: string): OfferContent {
  const lines = blockLines(html);
  const prices = parseKcdPrices(html);
  const weeks = parseKcdWeeks(html);
  const future = weeks.filter(w => w.start >= today);
  const years = [...new Set(weeks.map(w => w.start.slice(0, 4)))];
  const dates = future.length
    ? `Weeks ${future[0].start.slice(0, 4)}: ${future.map(w => `${enDate(w.start)} - ${enDate(w.end)}`).join(', ')}.`
    : `Runs every year in late summer; next dates not yet published${weeks.length ? ` (${years.join('/')}: ${[...new Set(weeks.map(w => EN_MONTH[+w.start.slice(5, 7) - 1]))].join(' and ')})` : ''}.`;
  const summary = [
    'Kite College, a German kite coaching team of VDWS-certified trainers, runs its Kitecollege Dänemark on Ringkøbing Fjord near Hvide Sande: one of Europe\'s largest standing-depth flat-water areas, with the North Sea next door.',
    'An event week brings 6 days of training (about 4-5 hours a day, max 3-4 students per trainer, kites and boards of several brands, radio and video coaching) for beginners and improvers, and 7 nights in a large Danish holiday house shared with the trainers, with indoor pool, sauna and private beach.',
    `${prices.withStay ? `From EUR ${prices.withStay.toLocaleString('en-US')} per person with accommodation (single or shared double room)${prices.eventOnly ? `, EUR ${prices.eventOnly} for the event only` : ''}; ` : ''}booking by request. ${dates}`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Kitecollege Dänemark, Ringkøbing Fjord',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Hvide Sande, West Jutland',
    spot: 'Hvide Sande',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate'], // "Ideal für Einsteiger und Fortgeschrittene", Könnenstufe 0-6
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '6 event days with about 4-5 hours of training a day (max 3-4 students per trainer)',
      'Kites (5-21 m²) and boards of several brands (Cabrinha, RRD, Flysurfer)',
      'Radio and video coaching, theory, event shirt',
      '7 nights in a shared Danish holiday house with indoor pool, sauna and private beach (single or shared double room)',
    ],
    optionalServices: prices.eventOnly ? [`Event week without accommodation: from EUR ${prices.eventOnly}`] : [],
    accommodation: 'shared Danish holiday house with pool and sauna (single or double rooms)',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms: [],
    imageUrls: imageCandidates(html, KCD_URL).slice(0, 25),
    heroVideoUrl: null,
    sourceUrl: KCD_URL,
    bookingUrl: future[0]?.requestUrl ?? KCD_URL,
    sourceText: [
      lines.slice(0, 60).join('\n'),
      `parsed: ${JSON.stringify(prices)}; weeks ${weeks.map(w => `${w.start}..${w.end} ${w.status}`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchKcdSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(KCD_URL);
  const prices = parseKcdPrices(html);
  const weeks = parseKcdWeeks(html);
  if (prices.withStay === null) ctx?.note('kite-college: "1 Woche mit Unterkunft ab" price not found - slots without price');
  if (weeks.length === 0) { ctx?.note('kite-college: no dated weeks in the events table (none published yet?)'); return []; }
  const slots = buildKcdSlots(weeks, prices, today);
  if (!slots.length) ctx?.note(`all listed weeks are past (${weeks.map(w => w.start).join(', ')}); no new dates printed yet`);
  return slots;
}

export const kiteCollegeDaenemarkRingkobingFjord: OfferAdapter = {
  key: 'kite-college-daenemark-ringkobing-fjord',
  name: 'Kitecollege Dänemark, Ringkøbing Fjord',
  kind: 'camp',
  operator: {
    name: 'Kite College',
    websiteUrl: SITE,
    rootDomain: 'kite-college.com',
  },
  url: KCD_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() { return parseKcdContent(await page(KCD_URL), todayIso()); },
  fetchSlots: ctx => fetchKcdSlots(todayIso(), ctx),
};
