// ---------------------------------------------------------------------------
// Pousada Raia 1, Praia de Ibiraquera (Imbituba, Santa Catarina, Brazil) - 10-unit pousada facing the sea and the
// Ibiraquera lagoon, with a storage room (guarderia) for windsurf, kitesurf and SUP gear; kite lessons with local
// instructors (Ling, Alexandre Takeo) are listed on its activities page.
//
// Inclusion (rule 5): kite link = home "Para os amantes do esporte temos Guarderia onde podem deixar seu equipamento
//   de Windsurf, Kitesurf e SUP" + /atividades "KiteSurf ... Praticado tanto no mar como na lagoa ... Aulas com
//   Ling ... ou Alexandre Takeo". Current operation: footer "© 2026", site favicon re-published 2026-09-03 (Duda
//   timestamp in the favicon file name), HSystem booking engine linked (not read).
//
// Data path (checked 2026-10-12): www.pousadaraia1.com.br (Duda, Portuguese):
//   content  / (intro, 10 units: 7 facing sea and lagoon, 3 garden units; services), /acomodacoes (the ten units
//            as blocks "<TYPE> (<numbers>)" + text + equipment list ending "RESERVAR"), /atividades (surf, windsurf,
//            kitesurf lessons and seasons, SUP rental, whale watching).
//   slots    none: the site prints no prices ("CONSULTAR VALORES" opens the HSystem engine
//            hbook.hsystem.com.br/booking?companyId=5e0f8c0cab41d40cc85f6c3e, whose /Booking path is disallowed
//            by robots.txt - not used). fetchSlots re-reads /acomodacoes (memoised) and returns [] (offer = "price
//            on request"); it notes when an amount shows up so the adapter can be extended.
// robots.txt (2026-10-12): www.pousadaraia1.com.br has an empty `User-agent: *` group (allow all).
// Requests per run: content 3, slots 0 extra (1 when run alone).
// Known limits: no prices, season dates or map coordinates on the site; confidence 'low' (content only); Duda
//   answers JSON when Accept lists application/json, so pages are fetched with accept text/html.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, findPrices, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.pousadaraia1.com.br';
export const RAIA_PAGES = { home: `${SITE}/`, rooms: `${SITE}/acomodacoes`, activities: `${SITE}/atividades` } as const;

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

/** Block-level visible lines (scripts, styles, navigation and forms dropped), de-duplicated, Duda filler removed. */
export function raiaLines(html: string, dedupe = true): string[] {
  const seen = new Set<string>();
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(l => l && !/^(Button|Título Novo|Parágrafo Novo|‹|›)$/.test(l) && (!dedupe || (!seen.has(l) && (seen.add(l), true))));
}

export interface RaiaUnit { type: string; numbers: string; text: string; equipment: string[] }

/** /acomodacoes: "SUPER LUXO (1)" heading, a sentence, the equipment list, "RESERVAR". */
export function parseRaiaUnits(roomsHtml: string): RaiaUnit[] {
  const lines = raiaLines(roomsHtml, false); // equipment lines repeat across units: no de-duplication here
  const out: RaiaUnit[] = [];
  let cur: RaiaUnit | null = null;
  for (const l of lines) {
    const h = l.match(/^((?:SUPER LUXO|LUXO|STANDARD|APTO FAMILIA|FAMÍLIA|FAMILIA)[A-Z ]*?)\s*\(([\d ,eou]+)\)$/i);
    if (h) { cur = { type: h[1].trim(), numbers: h[2].trim(), text: '', equipment: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (l === 'RESERVAR') { cur = null; continue; }
    if (!cur.text) cur.text = l;
    else if (!/^Observações:?$/.test(l)) cur.equipment.push(l);
  }
  return out;
}

/** /atividades: "KiteSurf" block (the line after the heading). */
export function parseRaiaKite(activitiesHtml: string): string | null {
  const lines = raiaLines(activitiesHtml);
  const at = lines.findIndex(l => /^Kite\s?Surf$/i.test(l));
  return at >= 0 ? lines[at + 1] ?? null : null;
}

const TYPE_EN: Record<string, string> = { 'SUPER LUXO': 'Super Luxo suite', LUXO: 'Luxo suite', STANDARD: 'Standard suite', 'APTO FAMILIA': 'Family apartment' };
const typeName = (t: string, numbers: string) => `${TYPE_EN[t.toUpperCase()] ?? t} (${numbers.replace(/\s+(?:e|ou)\s+/gi, ', ')})`;

function unitFeatures(u: RaiaUnit): string[] {
  const has = (re: RegExp) => u.equipment.some(e => re.test(e)) || re.test(u.text);
  return [
    has(/de frente para o mar|vista para o mar/i) && !has(/sem vista para o mar/i) ? 'Sea and lagoon view' : null,
    has(/voltad[ao] para o jardim|vista para o jardim/i) ? 'Garden view' : null,
    has(/Cama King-size/i) ? 'King-size bed' : null,
    has(/Mezanino/i) ? 'Mezzanine with extra beds' : null,
    has(/Bicama/i) ? 'Trundle bed' : null,
    has(/hidromassagem/i) ? 'Double whirlpool bath' : null,
    has(/cozinha/i) ? 'Kitchenette' : null,
    has(/Sacada privativa/i) ? 'Private balcony with hammock' : null,
    has(/Ar-condicionado/i) ? 'Air conditioning' : null,
    has(/Frigobar|geladeira/i) ? 'Fridge or minibar' : null,
    has(/até 6 pessoas/i) ? 'Up to 6 guests' : null,
  ].filter((x): x is string => !!x);
}

export interface RaiaPages { home: string; rooms: string; activities: string }

export function parseRaiaContent(p: RaiaPages): OfferContent {
  const home = raiaLines(p.home);
  const units = parseRaiaUnits(p.rooms);
  const kite = parseRaiaKite(p.activities);
  const homeText = home.join(' ');
  const nUnits = homeText.match(/dispõe de (\d+) acomodações/)?.[1] ?? null;
  const nSea = homeText.match(/São (\d+) acomodações de frente para o mar/)?.[1] ?? null;
  const guarderia = /Guarderia onde podem deixar seu equipamento de Windsurf, Kitesurf e SUP/i.test(homeText);

  const rooms: ContentRoom[] = units.map(u => ({ name: typeName(u.type, u.numbers), description: null, features: unitFeatures(u) }));

  const seen = new Set<string>();
  const imgs: string[] = [];
  for (const [html, base] of [[p.rooms, RAIA_PAGES.rooms], [p.home, RAIA_PAGES.home]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/cdn-website\.com\/05334b84\//.test(u) || /\.png|favicon|seo-|-640w\./i.test(u)) continue;
      const k = u.split('/').pop()!.replace(/-\d+w(?=\.[a-z]+$)/i, '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(u);
    }
  }

  const summary = [
    `Pousada Raia 1 is a pousada with ${nUnits ?? 10} units on Praia de Ibiraquera (Imbituba, Santa Catarina, Brazil), facing the sea and the Ibiraquera lagoon${nSea ? `: ${nSea} suites face the sea and lagoon, the others the garden` : ''}.`,
    'Units have a king-size bed, air conditioning and TV, some with a double whirlpool bath, mezzanine or kitchenette, and a family apartment sleeps up to six; breakfast with a view of the sea and lagoon is served, and a garden barbecue area is shared.',
    `${guarderia ? 'A storage room (guarderia) keeps guests\' windsurf, kitesurf and SUP gear. ' : ''}${kite ? 'The activities page says kitesurfing works on the sea and on the lagoon for beginners and experienced riders and lists two local instructors.' : ''} The site publishes no prices; stays are booked through its online booking engine or WhatsApp.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada Raia 1',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ibiraquera, Santa Catarina',
    spot: 'Praia de Ibiraquera',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    // /atividades: "agradando aos iniciantes e aos mais experientes kitesurfistas"
    skillLevels: kite && /iniciantes/i.test(kite) && /experientes/i.test(kite) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: kite ? /Aulas com/i.test(kite) : null, // local instructors, not run by the pousada
    equipmentRental: null,
    beginnerFriendly: kite && /iniciantes/i.test(kite) ? true : null,
    includedServices: ['Breakfast', 'Wi-Fi', 'Parking', ...(guarderia ? ['Storage for windsurf, kitesurf and SUP gear'] : [])],
    optionalServices: ['Kitesurf lessons with local instructors (Ling, Alexandre Takeo)', 'Surf and windsurf lessons', 'SUP rental', 'Horseback rides', 'Whale watching (July to November)', 'Skydiving'],
    accommodation: 'beachfront pousada suites and family apartment',
    mealPlan: 'breakfast',
    languages: ['pt'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: RAIA_PAGES.home,
    bookingUrl: 'https://hbook.hsystem.com.br/booking?companyId=5e0f8c0cab41d40cc85f6c3e',
    sourceText: [
      `home: ${homeText.slice(0, 4000)}`,
      `units: ${units.map(u => `${u.type} (${u.numbers}): ${u.text} [${u.equipment.join('; ')}]`).join(' | ')}`,
      `kite: ${kite ?? '-'}`,
      `activities: ${raiaLines(p.activities).join(' ').slice(0, 3000)}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the rooms page starts printing some. */
export function raiaVisiblePrices(roomsHtml: string): string[] {
  return findPrices(raiaLines(roomsHtml).join(' ')).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaRaia1Ibiraquera: OfferAdapter = {
  key: 'pousada-raia-1-ibiraquera',
  name: 'Pousada Raia 1 Ibiraquera',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Raia 1',
    websiteUrl: SITE,
    rootDomain: 'pousadaraia1.com.br',
    contactEmail: 'reservaspousadaraia1@gmail.com',
    phone: '+5548991213065',
    whatsapp: '+5548991213065',
  },
  url: RAIA_PAGES.rooms,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low', // no prices on the site; the HSystem booking engine is robots-disallowed
  async fetchContent() {
    const [home, rooms, activities] = [await page(RAIA_PAGES.home), await page(RAIA_PAGES.rooms), await page(RAIA_PAGES.activities)];
    return parseRaiaContent({ home, rooms, activities });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(RAIA_PAGES.rooms);
    if (parseRaiaUnits(html).length === 0) throw new Error('raia-1: no unit blocks on /acomodacoes (layout changed?)');
    const prices = raiaVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /acomodacoes (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
