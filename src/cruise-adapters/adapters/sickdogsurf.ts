// ---------------------------------------------------------------------------
// Sick Dog Kite (sickdogsurf.com) - Red Sea kite safari weeks on Heaven Liberty.
// Handed over 2026-10-12 (session "Kitesurf-Guesthouses weltweit"): the LLM path wrote the
// Oct-Dec 2026 weeks as 2025 and the 2027 weeks as 2026 (the rows carry no year), so the app
// showed no future departure at all.
//
// Data path (checked 2026-10-12, WordPress; robots.txt allows /kite-safari/):
//   /kite-safari/: heading "Kite Safari Weeks 2026/2027", then tables "WEEKS BOAT PRICE PER PERSON"
//   with rows like "October 17 - 24 Heaven Liberty 900€ - Last Minute", "October 24 - 31 Heaven
//   Liberty FULL", "May 29 - 5 June ...", "5-12 June ...", "December 26 - January 2 ...".
// Year rule: the first row is in the FIRST heading year; whenever the start month goes backwards
// (December → March) the year rolls over. If the result lies entirely in the past the adapter
// throws instead of writing (a heading not updated for a new season would otherwise date it wrong).
// The page lists the whole schedule → departures REPLACE the stored set.
// Requests per run: 1.
// ---------------------------------------------------------------------------
import { fetchText } from '../../offers/http.js';
import { collapse, iso, monthOf, parse } from '../../offers/parse.js';
import type { Departure, DepartureStatus } from '../../pipeline/cruise-state.js';
import { emptyState, type CruiseAdapter, type CruiseAdapterItem } from '../types.js';

export const SDS_URL = 'https://sickdogsurf.com/kite-safari/';
const BOATS = 'Heaven Liberty|New Regency|Galaxy';
const M = '[A-Z][a-z]{2,8}';
// "October 17 - 24" | "October 31- November 7" | "May 29 - 5 June" | "5-12 June" | "26 June - 3 July"
const ROW = new RegExp(
  `(?:(${M})\\s(\\d{1,2})|(\\d{1,2})(?:\\s(${M}))?)\\s?[-–]\\s?(?:(${M})\\s(\\d{1,2})|(\\d{1,2})(?:\\s(${M}))?)\\s+(${BOATS})\\s+(FULL|(\\d{3,5})\\s?€(?:\\s?[-–]\\s?(Last [A-Za-z]+))?)`,
  'g',
);

function text(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return collapse(root.structuredText);
}

export interface SdsRow { start: string; end: string; boat: string; price: number | null; status: DepartureStatus; note: string | null }

export function parseSdsSchedule(html: string): SdsRow[] {
  const t = text(html);
  const head = t.match(/Kite Safari Weeks\s+(20\d{2})/i);
  if (!head) return [];
  let year = +head[1];
  let prevMonth = 0;
  const out: SdsRow[] = [];
  for (const m of t.matchAll(ROW)) {
    const sMonthWord = m[1] ?? m[4] ?? m[5] ?? m[8];
    const eMonthWord = m[5] ?? m[8] ?? m[1] ?? m[4];
    const sm = sMonthWord ? monthOf(sMonthWord) : null;
    const em = eMonthWord ? monthOf(eMonthWord) : null;
    if (!sm || !em) continue;
    const sd = +(m[2] ?? m[3]);
    const ed = +(m[6] ?? m[7]);
    if (sm < prevMonth) year++;
    prevMonth = sm;
    const endYear = em < sm ? year + 1 : year;
    const full = m[10] === 'FULL';
    const last = m[12] ?? null;
    out.push({
      start: iso(year, sm, sd),
      end: iso(endYear, em, ed),
      boat: m[9],
      price: full ? null : Number(m[11]),
      status: full ? 'sold_out' : last && /cabin|spot|place/i.test(last) ? 'few_spots' : 'available',
      note: full ? 'FULL' : last,
    });
  }
  return out;
}

export const sickdogsurf: CruiseAdapter = {
  key: 'sickdogsurf',
  domain: 'sickdogsurf.com',
  urls: [SDS_URL],
  async fetchStates(): Promise<CruiseAdapterItem[]> {
    const rows = parseSdsSchedule(await fetchText(SDS_URL));
    const today = new Date().toISOString().slice(0, 10);
    if (rows.length > 0 && rows.every(r => r.end < today)) {
      throw new Error('sickdogsurf: every parsed week lies in the past - the season heading is probably stale, check the year rule');
    }
    const deps: Departure[] = rows.map(r => ({ start_date: r.start, end_date: r.end, price: r.price, currency: r.price ? 'EUR' : null, status: r.status }));
    const bookable = rows.filter(r => r.price && r.end >= today).map(r => r.price!);
    return [{
      sourceUrl: SDS_URL,
      titleHint: /Red Sea/i,
      state: emptyState({
        departures: deps.length ? deps : null,
        pricePP: bookable.length ? { amount: Math.min(...bookable), currency: 'EUR' } : null,
      }),
    }];
  },
};
