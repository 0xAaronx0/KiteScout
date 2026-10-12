// ---------------------------------------------------------------------------
// Kite Safari Season (kite-safari-season.ru, Kitepiter St. Petersburg) - Red Sea kite safari.
//
// Data path (checked 2026-10-12, robots.txt allows all): one page /en.html with
//   - one schema.org Event per departure (startDate/endDate, Hurghada Marina); the
//     Event "availability" is boilerplate (InStock everywhere) → not used as status
//   - visible price table "“Standard” Cabin Twin Room 1 400 €/person ..." → the
//     cheapest €/person line is the per-person price
// The Events only list the season currently on sale (2027 since ~2026-09-29), so the
// departure set is MERGED into the stored one (never removes a departure).
// Requests per run: 1.
// ---------------------------------------------------------------------------
import { fetchText } from '../../offers/http.js';
import { htmlToText, ldOfType } from '../../offers/parse.js';
import type { Departure, Money } from '../../pipeline/cruise-state.js';
import { emptyState, type CruiseAdapter, type CruiseAdapterItem } from '../types.js';

export const KSS_URL = 'https://kite-safari-season.ru/en.html';

export function parseKssDepartures(html: string): Departure[] {
  const out: Departure[] = [];
  for (const ev of ldOfType(html, 'Event')) {
    const s = typeof ev.startDate === 'string' ? ev.startDate.slice(0, 10) : null;
    const e = typeof ev.endDate === 'string' ? ev.endDate.slice(0, 10) : null;
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
    const cancelled = typeof ev.eventStatus === 'string' && /Cancelled/i.test(ev.eventStatus);
    out.push({ start_date: s, end_date: e, price: null, currency: null, status: cancelled ? 'closed' : null });
  }
  return out;
}

/** Cheapest "1 400 €/person" in the visible price table. */
export function parseKssPricePP(html: string): Money | null {
  const text = htmlToText(html);
  const prices = [...text.matchAll(/(\d{1,2}(?:[  .,]\d{3})+|\d{3,5})\s?€\s?\/\s?person/gi)]
    .map(m => Number(m[1].replace(/[  .,]/g, '')))
    .filter(n => n >= 300 && n <= 20000);
  return prices.length ? { amount: Math.min(...prices), currency: 'EUR' } : null;
}

export const kiteSafariSeason: CruiseAdapter = {
  key: 'kite-safari-season',
  domain: 'kite-safari-season.ru',
  urls: [KSS_URL],
  datesMode: 'merge',
  async fetchStates(): Promise<CruiseAdapterItem[]> {
    const html = await fetchText(KSS_URL);
    const deps = parseKssDepartures(html);
    return [{ sourceUrl: KSS_URL, state: emptyState({ departures: deps.length ? deps : null, pricePP: parseKssPricePP(html) }) }];
  },
};
