// ---------------------------------------------------------------------------
// Hotel Puclaro, Gualliguaica (Puclaro reservoir, Valle del Elqui, Coquimbo, Chile) - small "boutique wind &
// kite resort" on the shore of the Embalse Puclaro: "cubos" and cabañas, pool, hot tub; a base for
// windsurfing, kitesurfing, wing foiling and SUP on the reservoir.
//
// Data path (checked 2026-10-12): one-page static site hotelpuclaro.cl (Spanish with English headings).
//   content  / only: sections (h1-h3 + p), photo captions, unit types (<h3>Cubos / Cabañas + <p>), the
//            experiences block ("Windsurf & kitesurf - El embalse, tu cancha natural", "Slow mornings -
//            Desayuno, piscina y silencio"), the Google Maps search link (address only, no coordinates).
//            Images under assets/generated/ are captioned "Concept image" on the page -> left out.
//   slots    none. The page prints no rates; "Reservar" opens the Beds24 booking page
//            beds24.com/book-puclaro?propid=36545, which answered "Service unavailable, please try again
//            later" (HTTP 200, 43 bytes) to our UA on 2026-10-12 (as at Studios Vrettos), and the Beds24
//            JSON API host api.beds24.com disallows everything in robots.txt -> fetchSlots returns [].
// robots.txt (2026-10-12): hotelpuclaro.cl "User-agent: *" with no rules (allow all).
// Requests per run: content 1, slots 0.
// Known limits: no prices, no availability, no unit count or contact address on the site (confidence 'low');
//   the site names no kite school (the reservoir is the riding spot).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://hotelpuclaro.cl';
export const PUCLARO_HOME_URL = `${SITE}/`;
const BOOKING_URL = 'https://beds24.com/book-puclaro?propid=36545';

export interface PuclaroSection { heading: string; text: string }

function tagged(html: string): Array<{ tag: string; text: string }> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, nav')) el.remove();
  const out: Array<{ tag: string; text: string }> = [];
  for (const el of root.querySelectorAll('h1, h2, h3, p')) {
    const t = collapse(el.text);
    if (t && out[out.length - 1]?.text !== t) out.push({ tag: el.tagName.toLowerCase(), text: t });
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
/** Every <h3> with the <p> right after it (unit types and the experiences block). */
export function parsePuclaroCards(html: string): PuclaroSection[] {
  const tb = tagged(html);
  const out: PuclaroSection[] = [];
  tb.forEach((b, i) => {
    if (b.tag === 'h3' && tb[i + 1]?.tag === 'p') out.push({ heading: b.text, text: tb[i + 1].text });
  });
  return out;
}

/** Real photos of the page (assets/...), without the generated concept images. */
export function puclaroPhotos(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of imageCandidates(html, PUCLARO_HOME_URL, null, 80)) {
    if (!u.startsWith(`${SITE}/assets/`) || /\/generated\/|logo|icon|\.svg|\.png$/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); out.push(u);
  }
  return out;
}

export function parsePuclaroContent(html: string): OfferContent {
  const tb = tagged(html);
  const cards = parsePuclaroCards(html);
  const lead = tb.find(b => /Un hotel boutique, una base para el deporte acuático/i.test(b.text))?.text ?? '';
  const sports = tb.find(b => /^Windsurf, kitesurf, wingfoil o SUP/i.test(b.text))?.text ?? '';
  const units = cards.filter(c => /^(Cubos|Cabañas)$/i.test(c.heading));
  const pageText = collapse(parse(html).querySelector('body')?.text ?? '');
  const tagline = pageText.match(/Boutique wind & kite resort\s*·\s*Valle del Elqui/)?.[0] ?? null;
  const address = decodeURIComponent(html.match(/google\.com\/maps\/search\/([^"]+)"/)?.[1] ?? '').replace(/\+/g, ' ') || null;

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.heading === 'Cubos' ? 'Cubo' : 'Cabaña',
    description: u.heading === 'Cubos'
      ? 'Small, intimate unit with a view of the reservoir ("Pequeños, íntimos y conectados con el paisaje").'
      : 'Wooden cabin with more space for longer stays ("Más espacio para quedarte un poco más").',
    features: [],
  }));

  const summary = [
    'Hotel Puclaro is a small boutique wind and kite hotel on the shore of the Puclaro reservoir near Gualliguaica in the Elqui Valley, Coquimbo region, Chile, a base for windsurfing, kitesurfing, wing foiling and SUP on the reservoir.',
    'Guests stay in "cubos", small units facing the reservoir, or in larger wooden cabañas; there is a pool and a hot tub, and breakfast is served.',
    'Beyond the water the hotel points guests to stargazing (astrotourism) and the villages and food of the Elqui Valley.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hotel Puclaro',
    summary,
    continent: 'South America',
    country: 'Chile',
    region: 'Coquimbo',
    spot: 'Embalse Puclaro',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null, // the site names no school or lessons
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Pool', 'Hot tub'],
    optionalServices: ['Breakfast', 'Astrotourism (stargazing nights)', 'Excursions in the Elqui Valley'],
    accommodation: 'cubes (small units) and wooden cabins by the reservoir',
    mealPlan: null, // "Desayuno, piscina y silencio" - breakfast is offered, the site does not say a rate includes it
    languages: ['es', 'en'],
    rooms,
    imageUrls: puclaroPhotos(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PUCLARO_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `tagline: ${tagline ?? '-'}`,
      `lead: ${lead}`,
      `water sports: ${sports}`,
      `cards: ${cards.map(c => `${c.heading}: ${c.text}`).join(' | ')}`,
      `address (Google Maps link): ${address ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const hotelPuclaroGualliguaica: OfferAdapter = {
  key: 'hotel-puclaro-gualliguaica',
  name: 'Hotel Puclaro Gualliguaica',
  kind: 'accommodation',
  operator: {
    name: 'Hotel Puclaro',
    websiteUrl: SITE,
    rootDomain: 'hotelpuclaro.cl',
  },
  url: PUCLARO_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 1,
  confidence: 'low',
  async fetchContent() {
    return parsePuclaroContent(await fetchText(PUCLARO_HOME_URL, { accept: 'text/html' }));
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no slot source: the site prints no rates; the Beds24 booking page answers "Service unavailable" to our UA and api.beds24.com is robots-disallowed (checked 2026-10-12)');
    return [];
  },
};
