// ---------------------------------------------------------------------------
// Pousada Natural Park, Ibiraquera (Imbituba, Santa Catarina, Brazil) - twelve fully equipped houses on the edge of
// the Ibiraquera lagoon, opposite Praia da Ibiraquera; the site's kitesurf page recommends local kite instructors
// for lessons on the flat lagoon or in the waves.
//
// Inclusion: Aaron's decision of 2026-10-12 (all 18 Brazil stays of round 2, weak liveness built content-only,
//   confidence 'low'). Kite link (rule 5a) on the own site: home block "Kitesurf" and /experiencias/ "Kitesurf na
//   Ibiraquera ... Aulas de Kitesurf no Mar ou na Lagoa ... perfeito para aulas com instrutores profissionais"
//   (instructors Guilly Brandão and Alemão named). Liveness (rule 5b, WEAK): only the footer "© 2026 Pousada Natural
//   Park" (probably the current year printed by the theme); Yoast dateModified of all pages is 2023 (home
//   2023-06-12), photo uploads 2023/01-04; no prices, dates or engine.
//
// Data path (checked 2026-10-12): pousadanaturalpark.com.br (WordPress/Elementor, Portuguese):
//   content  / (12 houses, kitesurf teaser, address), /acomodacoes/ (equipped kitchens, playground, small pets,
//            the house list Casa 01-11 + Casa 04 Anexo with one-line teasers), /experiencias/ (kitesurf, surf and
//            SUP, horse rides, whale watching), /reservas/ (request form, payment and check-in rules).
//   slots    none: no prices on the site; bookings by request form or WhatsApp. fetchSlots re-reads /reservas/
//            (memoised) and returns [] (offer = "price on request"); it notes when an amount shows up there.
// robots.txt (2026-10-12): answers HTTP 500; http.ts treats a 5xx robots.txt as "no rules" (re-checked after 1 h).
// Requests per run: content 4, slots 0 extra (1 when run alone).
// Known limits: no house sizes or capacities on the list page (12 detail pages not fetched), no map coordinates,
//   no prices; confidence 'low'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, findPrices } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://pousadanaturalpark.com.br';
export const NP_PAGES = { home: `${SITE}/`, houses: `${SITE}/acomodacoes/`, experiences: `${SITE}/experiencias/`, booking: `${SITE}/reservas/` } as const;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Block-level visible lines (scripts, styles, navigation and forms dropped), de-duplicated. */
export function npLines(html: string): string[] {
  const seen = new Set<string>();
  return html
    .replace(/<(script|style|noscript|select|svg|header|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(l => l && !seen.has(l) && (seen.add(l), true));
}

/** /acomodacoes/: "Casa 01" + teaser + "Conhecer". */
export function parseNpHouses(housesHtml: string): Array<{ name: string; teaser: string }> {
  const lines = npLines(housesHtml);
  const out: Array<{ name: string; teaser: string }> = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^Casa \d{2}(?: - Anexo)?$/.test(lines[i])) out.push({ name: lines[i], teaser: lines[i + 1] === 'Conhecer' ? '' : lines[i + 1] });
  }
  return out;
}

/** /experiencias/ "Kitesurf na Ibiraquera" block up to "SURF & SUP". */
export function parseNpKite(experiencesHtml: string): string[] {
  const lines = npLines(experiencesHtml);
  const at = lines.findIndex(l => /^Kitesurf na Ibiraquera/i.test(l));
  const end = lines.findIndex((l, i) => i > at && /^SURF & SUP$/i.test(l));
  return at >= 0 ? lines.slice(at + 1, end > at ? end : at + 12) : [];
}

/** Footer year ("© 2026 Pousada Natural Park"), the only current-year sign on the site. */
export function npFooterYear(html: string): number | null {
  const m = npLines(html).join(' ').match(/© (20\d\d) Pousada Natural Park/);
  return m ? Number(m[1]) : null;
}

export interface NpPages { home: string; houses: string; experiences: string; booking: string }

export function parseNaturalParkContent(p: NpPages): OfferContent {
  const home = npLines(p.home);
  const housesText = npLines(p.houses);
  const houses = parseNpHouses(p.houses);
  const kite = parseNpKite(p.experiences);
  const booking = npLines(p.booking);
  const nHouses = home.join(' ').match(/consiste em (doze|\d+) casas/i)?.[1] ?? null;
  const count = nHouses ? (/doze/i.test(nHouses) ? 12 : Number(nHouses)) : houses.length;
  const kiteText = kite.join(' ');

  const rooms: ContentRoom[] = houses.map(h => ({ name: h.name, description: null, features: ['Equipped kitchen'] }));

  const imgs: string[] = [];
  for (const html of [p.home, p.experiences]) {
    for (const m of html.matchAll(/https?:\\?\/\\?\/pousadanaturalpark\.com\.br\\?\/wp-content\\?\/uploads\\?\/[^"' )&]+?\.(?:jpe?g|webp)/gi)) {
      const u = m[0].replace(/\\\//g, '/').replace(/^http:/, 'https:').replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (/logo|thumb-mobile|whatsapp|Baleia|gralha|garca|Mocho/i.test(u) || imgs.includes(u)) continue;
      imgs.push(u);
    }
  }

  const summary = [
    `Pousada Natural Park rents ${count} fully equipped houses on the edge of the Ibiraquera lagoon, opposite Praia da Ibiraquera (Imbituba, Santa Catarina, Brazil), about 80 km south of Florianópolis.`,
    'Each house has its own equipped kitchen; there is a playground, fruit trees and room for small dogs, and restaurants are across the lagoon mouth or in Praia do Rosa.',
    `The site describes Ibiraquera as a kitesurf, windsurf and wing foil spot: flat water on the lagoon for lessons with professional instructors and waves at sea with northeast wind${/Guilly Brandão/.test(kiteText) ? '; it names local instructors for lagoon and wave lessons' : ''}. Stays are booked by request form or WhatsApp; the site publishes no prices.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada Natural Park',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ibiraquera, Santa Catarina',
    spot: 'Ibiraquera',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: kite.length ? /Aulas de Kitesurf/i.test(kiteText) : null, // independent instructors the site recommends
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Fully equipped houses with kitchen', 'Playground'],
    optionalServices: ['Kitesurf lessons with local instructors on the lagoon or at sea', 'Surf and SUP', 'Horse rides', 'Whale watching (June to September)', 'Skydiving'],
    accommodation: 'self-catering houses',
    mealPlan: 'self_catering',
    languages: ['pt'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NP_PAGES.houses,
    bookingUrl: NP_PAGES.booking,
    sourceText: [
      `home: ${home.join(' ').slice(0, 3000)}`,
      `houses: ${housesText.join(' ').slice(0, 2500)}`,
      `kite: ${kiteText}`,
      `booking: ${booking.join(' ').slice(0, 2000)}`,
      `footer year: ${npFooterYear(p.home) ?? '-'}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the booking page starts printing some. */
export function npVisiblePrices(html: string): string[] {
  return findPrices(npLines(html).join(' ')).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaNaturalParkIbiraquera: OfferAdapter = {
  key: 'pousada-natural-park-ibiraquera',
  name: 'Pousada Natural Park Ibiraquera',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Natural Park',
    websiteUrl: SITE,
    rootDomain: 'pousadanaturalpark.com.br',
    whatsapp: '+554833556488',
  },
  url: NP_PAGES.houses,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'low', // Aaron 2026-10-12: content only, weak liveness (footer year only), no prices on the site
  async fetchContent() {
    const [home, houses, experiences, booking] = [await page(NP_PAGES.home), await page(NP_PAGES.houses), await page(NP_PAGES.experiences), await page(NP_PAGES.booking)];
    return parseNaturalParkContent({ home, houses, experiences, booking });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(NP_PAGES.booking);
    if (!/Qual casa gostaria de reservar/i.test(html)) throw new Error('natural-park: request form missing on /reservas/ (layout changed?)');
    const prices = npVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /reservas/ (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
