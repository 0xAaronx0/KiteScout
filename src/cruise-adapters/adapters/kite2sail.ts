// ---------------------------------------------------------------------------
// Kite2Sail (kite2sail.com) - catamaran kite cruises: Greece, Sardinia/Corsica,
// Antigua, Bahamas, Grenadines. 36 old-monitor changes, almost all testimonials /
// CTA / gallery reshuffles on Wix pages.
//
// Data path (checked 2026-10-12, robots.txt allows all):
//   every destination page embeds the same site-wide schedule table
//     "Termine 2026 ... 04.07 - 11.07.2026 Greece, Cyclades 05.09 - 12.09.2026 Sardinia & Corsica
//      16.01 - 26.01.2027 Antigua & Barbuda" (no availability column → status unknown)
//   and its own headline price "starting from 2.500 EUR" (per person, catamaran week).
// Requests per run: 5 destination pages (the private-charter page has no dates/prices).
// ---------------------------------------------------------------------------
import { fetchText } from '../../offers/http.js';
import { htmlToText, iso } from '../../offers/parse.js';
import type { Departure, Money } from '../../pipeline/cruise-state.js';
import { emptyState, type CruiseAdapter, type CruiseAdapterItem } from '../types.js';

const BASE = 'https://www.kite2sail.com';
/** destination page → how the schedule table names it */
export const K2S_PAGES: Array<{ url: string; label: RegExp }> = [
  { url: `${BASE}/griechenland`, label: /^(?:Greece|Griechenland)/i },
  { url: `${BASE}/sardinien-korsika`, label: /^(?:Sardinia|Sardinien)/i },
  { url: `${BASE}/antigua-barbuda`, label: /^Antigua/i },
  { url: `${BASE}/bahamas`, label: /^(?:Bahamas|Exuma|Great Exuma)/i },
  { url: `${BASE}/grenadinen`, label: /^(?:St\.? Vincent|Grenadine)/i },
];

/** Schedule rows "DD.MM - DD.MM.YYYY <destination>"; a start month after the end month is the previous year. */
export function parseK2sSchedule(html: string): Array<{ start: string; end: string; destination: string }> {
  const text = htmlToText(html);
  const out: Array<{ start: string; end: string; destination: string }> = [];
  const re = /(\d{1,2})\.(\d{1,2})\.?\s?[-–]\s?(\d{1,2})\.(\d{1,2})\.(\d{4})\s+([A-Z][A-Za-z.&,' ]{2,40}?)(?=\s+\d{1,2}\.\d{1,2}|\s+Leistungen|\s+Trip|$)/g;
  for (const m of text.matchAll(re)) {
    const endY = +m[5];
    const startY = +m[2] > +m[4] ? endY - 1 : endY;
    out.push({ start: iso(startY, +m[2], +m[1]), end: iso(endY, +m[4], +m[3]), destination: m[6].trim() });
  }
  return out;
}

/** "starting from 2.500 EUR" → 2500 EUR */
export function parseK2sPrice(html: string): Money | null {
  const m = htmlToText(html).match(/starting from\s+(\d{1,2}[.,]?\d{3})\s?(EUR|€)/i);
  return m ? { amount: Number(m[1].replace(/[.,]/g, '')), currency: 'EUR' } : null;
}

export const kite2sail: CruiseAdapter = {
  key: 'kite2sail',
  domain: 'kite2sail.com',
  urls: K2S_PAGES.map(p => p.url),
  async fetchStates(): Promise<CruiseAdapterItem[]> {
    const items: CruiseAdapterItem[] = [];
    let schedule: ReturnType<typeof parseK2sSchedule> | null = null;
    for (const page of K2S_PAGES) {
      const html = await fetchText(page.url);
      // The table is the same on every page; take the first page that has one.
      if (!schedule || schedule.length === 0) schedule = parseK2sSchedule(html);
      const deps: Departure[] = (schedule ?? [])
        .filter(r => page.label.test(r.destination))
        .map(r => ({ start_date: r.start, end_date: r.end, price: null, currency: null, status: null }));
      items.push({ sourceUrl: page.url, state: emptyState({ departures: deps.length ? deps : null, pricePP: parseK2sPrice(html) }) });
    }
    return items;
  },
};
