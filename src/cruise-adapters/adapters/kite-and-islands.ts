// ---------------------------------------------------------------------------
// Kite & Islands (kite-and-islands.ch) - Red Sea kite safaris + Kite & Sail trips.
// The loudest provider in the old monitor (102 of 722 changes by 2026-10-12): its
// Wix pages carry live countdowns ("12 Tage bis zur Veranstaltung"), so the page
// hash changes every day.
//
// Data path (checked 2026-10-12, robots.txt allows all):
//   product pages /kite-body /kite-dive /kite-family /kite-vibe: one Wix-Events card
//     per departure: "<status> <n> Tage bis zur Veranstaltung <TITLE>
//     24. Okt. 2026, 19:00 – 31. Okt. 2026, 10:00 <port> ..."; status words
//     "AUSGEBUCHT!", "Nur noch 4 Plätze frei", "50% bereits vorreserviert!".
//     The site-wide "ALLE TRIPS IM ÜBERBLICK" list repeats cards WITHOUT a year
//     and is ignored by the year-anchored range.
//   event pages /event-details/<slug>: "Dein gewählter Kitetrip <range>" and
//     "Anmeldung geschlossen" when registration is closed.
// Prices: safaris are on request; Kite & Sail shows "ab 129€ pPpN" (per person per
// night), which the per-trip price columns can't hold → no prices from here.
// Requests per run: 10 pages.
// ---------------------------------------------------------------------------
import { fetchText } from '../../offers/http.js';
import { htmlToText, iso, monthOf } from '../../offers/parse.js';
import type { Departure, DepartureStatus } from '../../pipeline/cruise-state.js';
import { emptyState, type CruiseAdapter, type CruiseAdapterItem } from '../types.js';

const BASE = 'https://www.kite-and-islands.ch';
export const KAI_PRODUCT_PAGES = ['/kite-body', '/kite-dive', '/kite-family', '/kite-vibe'].map(p => BASE + p);
export const KAI_EVENT_PAGES = [
  'kite-sail-griechenland-2027', 'kite-sail-karibik-hauptsaison', 'kite-sail-karibik-nebensaison',
  'kite-sail-weltweit', 'kitesafari-nach-wunsch', 'privatgruppe-kitesafari-mit-hermes-2026-10-03-17-00',
].map(s => `${BASE}/event-details/${s}`);

// "24. Okt. 2026, 19:00 – 31. Okt. 2026, 10:00" (Wix Events, German locale)
const RANGE = /(\d{1,2})\.\s?([A-Za-zÄäÖöÜü]{3,9})\.?\s(\d{4}),\s\d{1,2}:\d{2}\s[–-]\s(\d{1,2})\.\s?([A-Za-zÄäÖöÜü]{3,9})\.?\s(\d{4})/g;

export function statusFromText(t: string): { status: DepartureStatus | null; text: string | null } {
  const m =
    t.match(/ausgebucht!?/i) ?? t.match(/warteliste[^.!]*/i) ?? t.match(/anmeldung geschlossen/i) ??
    t.match(/nur noch \d+ (?:plätze|platz|zimmer|kabinen?)[^.!]*/i) ??
    t.match(/\d+\s?% bereits (?:vor)?reserviert!?|jetzt platz reservieren!?|last-minute-angebote erhältlich/i);
  if (!m) return { status: null, text: null };
  const w = m[0].toLowerCase();
  const status: DepartureStatus =
    w.startsWith('ausgebucht') ? 'sold_out'
      : w.startsWith('warteliste') ? 'waitlist'
        : w.startsWith('anmeldung') ? 'closed'
          : w.startsWith('nur noch') ? 'few_spots'
            : 'available';
  return { status, text: m[0].trim() };
}

function rangeAt(m: RegExpMatchArray): { start: string; end: string } | null {
  const sm = monthOf(m[2]), em = monthOf(m[5]);
  if (!sm || !em) return null;
  return { start: iso(+m[3], sm, +m[1]), end: iso(+m[6], em, +m[4]) };
}

/** Product page: one departure per dated card; status = the words right before the countdown. */
export function parseKaiProductPage(html: string): Departure[] {
  const text = htmlToText(html);
  const out: Departure[] = [];
  let prevEnd = 0;
  for (const m of text.matchAll(RANGE)) {
    const r = rangeAt(m);
    if (!r) continue;
    // The card header between the previous card and this date: "<status> 12 Tage bis zur Veranstaltung <TITLE>"
    const head = text.slice(Math.max(prevEnd, m.index! - 260), m.index!);
    prevEnd = m.index! + m[0].length;
    if (!/bis zur Veranstaltung/i.test(head)) continue; // body text that merely mentions a date range
    const { status } = statusFromText(head.split(/bis zur Veranstaltung/i)[0]);
    out.push({ start_date: r.start, end_date: r.end, price: null, currency: null, status });
  }
  return out;
}

/** Event page: the single dated trip + registration state; null = individual / on request. */
export function parseKaiEventPage(html: string): Departure[] | null {
  const text = htmlToText(html);
  const i = text.indexOf('Dein gewählter Kitetrip');
  if (i === -1) return null;
  const m = [...text.slice(i, i + 200).matchAll(RANGE)][0];
  const r = m ? rangeAt(m) : null;
  if (!r) return null;
  const { status } = statusFromText(text.slice(Math.max(0, i - 400), i));
  return [{ start_date: r.start, end_date: r.end, price: null, currency: null, status: status ?? null }];
}

export const kiteAndIslands: CruiseAdapter = {
  key: 'kite-and-islands',
  domain: 'kite-and-islands.ch',
  urls: [...KAI_PRODUCT_PAGES, ...KAI_EVENT_PAGES],
  async fetchStates(): Promise<CruiseAdapterItem[]> {
    const items: CruiseAdapterItem[] = [];
    for (const url of KAI_PRODUCT_PAGES) {
      const deps = parseKaiProductPage(await fetchText(url));
      items.push({ sourceUrl: url, state: emptyState({ departures: deps.length ? deps : null }) });
    }
    for (const url of KAI_EVENT_PAGES) {
      items.push({ sourceUrl: url, state: emptyState({ departures: parseKaiEventPage(await fetchText(url)) }) });
    }
    return items;
  },
};
