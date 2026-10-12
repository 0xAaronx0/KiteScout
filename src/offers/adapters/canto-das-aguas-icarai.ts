// ---------------------------------------------------------------------------
// Pousada Canto das Águas, Icaraí de Amontada (Icaraizinho, Ceará, Brazil) - beachfront pousada in the centre of
// Icaraizinho bay next to the village: a 5-bedroom house (Canto Mar) and two apartments (Canto Rio), pool, lawn
// and deck onto the beach; a kite / wing / foil area with landing zone, compressor and storage, and its own wing
// school (Icarai Wing Academy). Team in place since 2011.
//
// Data path (checked 2026-10-12): www.cantodasaguas.com (WordPress/Elementor, PT default with /en/ and /fr/; the
//   English pages are read):
//   content  /en/home-en/ (values, kite-wing-foil facilities, contacts), /en/rooms/ (3 units: <h2> name, text-editor
//            paragraphs, icon-list amenities), /en/kite-wing-en/ (wind, spot, wing facilities, school link).
//   slots    none: the site prints no price ("When you contact us, we will inform you of the available rooms");
//            booking is a request form (/en/reserve/), e-mail or WhatsApp. fetchSlots re-reads /en/rooms/
//            (memoised) and returns [] (offer = "price on request"); it notes when a price appears.
// Liveness (rule 5b, weak - Aaron approved content-only, confidence 'low', 2026-10-12): Yoast dateModified
//   2026-04-07 (home, rooms) and 2026-04-08 (kite & wing); new photos uploaded 2026/04 (deck, pool, terrace, team,
//   sky view, wing-and-kyte). No dated 2026/27 season, price or booking calendar on the site.
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Known limits: no prices, no meal plan stated, no map coordinates (the map link is a goo.gl short link).
//   The Ground-floor apartment's amenity list is partly Portuguese on the English page (translated here).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.cantodasaguas.com';
export const CA_HOME_URL = `${SITE}/en/home-en/`;
export const CA_ROOMS_URL = `${SITE}/en/rooms/`;
export const CA_KITE_URL = `${SITE}/en/kite-wing-en/`;
const RESERVE_URL = `${SITE}/en/reserve/`;

// --- local helpers ----------------------------------------------------------------------------
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

/** Elementor content text: heading + text-editor widgets in document order (header / footer / chat dropped). */
export function caText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, [data-elementor-type="header"], [data-elementor-type="footer"]')) el.remove();
  const parts = root.querySelectorAll('.elementor-widget-heading .elementor-heading-title, .elementor-widget-text-editor')
    .map(el => collapse(el.structuredText.replace(/\n/g, ' ')).replace(/​/g, '').trim()).filter(Boolean);
  return [...new Set(parts)].join(' ');
}

const AMENITY_EN: Record<string, string> = {
  'Banheiro privativo': 'Private bathroom', 'Cama de casal': 'Double bed', 'Cama de solteiro': 'Single bed',
  'Ar-condicionado': 'Air conditioning', Quartos: 'Bedrooms',
};
function amenityEn(a: string): string {
  const m = a.match(/^(\d+)\s+(.+)$/);
  if (m && AMENITY_EN[m[2]]) return `${m[1]} ${AMENITY_EN[m[2]]}${Number(m[1]) > 1 && !/s$/.test(AMENITY_EN[m[2]]) ? 's' : ''}`;
  return AMENITY_EN[a] ?? a;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface CaRoom { name: string; text: string; amenities: string[] }

/** /en/rooms/: walk <h2> headings, text-editor paragraphs and icon-list items in document order up to "Contact". */
export function parseCaRooms(html: string): CaRoom[] {
  const root = parse(html);
  const out: CaRoom[] = [];
  let cur: CaRoom | null = null;
  for (const el of root.querySelectorAll('h2.elementor-heading-title, .elementor-widget-text-editor p, .elementor-icon-list-text')) {
    const t = collapse(el.text).replace(/​/g, '').trim();
    if (!t) continue;
    if (el.tagName === 'H2') {
      if (/^Contact|^Follow|^Visit/i.test(t)) break;
      cur = /our comfortable rooms/i.test(t) ? null : { name: t, text: '', amenities: [] };
      if (cur) out.push(cur);
    } else if (cur && el.tagName === 'P') {
      if (!/^Room amenities|^Apartment amenities/i.test(t)) cur.text = collapse(`${cur.text} ${t}`);
    } else if (cur) {
      const a = amenityEn(t);
      if (!cur.amenities.includes(a)) cur.amenities.push(a);
    }
  }
  return out;
}

/** Own photos (wp-content/uploads originals, JPEG only: PNGs are icons and badges), de-duplicated. */
export function caImages(pages: string[], max = 30): string[] {
  const out: string[] = [];
  for (const html of pages) {
    for (const m of html.matchAll(/https:\/\/www\.cantodasaguas\.com\/wp-content\/uploads\/[^"' )?,]+\.jpe?g/gi)) {
      const u = m[0].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      if (/\/(?:cropped-)?ico(-en)?\.jpg|logo|thumbs\//i.test(u) || out.includes(u)) continue;
      out.push(u);
    }
  }
  return out.slice(0, max);
}

export function caVisiblePrices(html: string): string[] {
  return [...caText(html).matchAll(/(?:R\$|€|US\$)\s?\d[\d.,]*/g)].map(m => m[0]);
}

export interface CaPages { home: string; rooms: string; kite: string }

export function parseCantoDasAguasContent(p: CaPages): OfferContent {
  const home = caText(p.home);
  const kite = caText(p.kite);
  const units = parseCaRooms(p.rooms);
  const since = home.match(/team in place since (\d{4})/)?.[1] ?? null;
  const peak = kite.match(/Maximum intensity from (\w+) to (\w+) with an average wind above (\d+) ?kn/);
  const wing = /our own Wing school\s*:?\s*Icarai Wing Academy/i.test(home) || /Icarai Wing Academy/i.test(kite);
  const canto = units.find(u => /canto mar/i.test(u.name));
  const bedrooms = canto?.text.match(/has (\d+) bedrooms/)?.[1] ?? null;
  // "Canto Rio - 1st floor" -> "30 m2, 1st floor"; "Canto Rio - Ground floor" -> "50 m2, ground floor, with kitchen and private balcony"
  const apts = units.filter(u => /canto rio/i.test(u.name)).map(u => {
    const size = u.amenities.map(a => a.match(/^(\d+) m²$/)?.[1]).find(Boolean);
    const floor = u.name.split(/\s+-\s+/)[1]?.toLowerCase() ?? '';
    const all = u.amenities.join(' ');
    const extras = [/kitchen/i.test(all) ? 'kitchen' : null, /private balcony/i.test(all) ? 'private balcony' : null].filter(Boolean);
    return [size ? `${size} m2` : null, floor || null, extras.length ? `with ${extras.join(' and ')}` : null].filter(Boolean).join(', ');
  });

  const rooms: ContentRoom[] = units.map(u => ({ name: u.name, description: u.text || null, features: u.amenities }));

  const summary = [
    `Canto das Águas is a beachfront pousada in the centre of Icaraizinho bay (Icaraí de Amontada, Ceará, Brazil), next to the village, with a lawn, a private pool and a large deck with direct access to the beach${since ? `; Nacélio and his team have run it since ${since}` : ''}.`,
    `Guests stay in ${units.length ? `${units.length} units: ` : ''}${canto ? `the Canto Mar house with ${bedrooms ?? 'five'} sea-view bedrooms` : 'sea-view rooms'}${apts.length ? ` and ${apts.length === 2 ? 'two' : apts.length} Canto Rio apartments (${apts.join('; ')})` : ''}, with private bathroom, air conditioning, TV and Wi-Fi.`,
    `Kiters, wingers and foilers get a dedicated rigging, launching and landing area with compressor and gear storage${wing ? ', and the pousada runs its own wing school, Icarai Wing Academy, with lessons and rental' : ''}${peak ? `; the north-east trade wind blows all year, strongest from ${peak[1]} to ${peak[2]} with an average above ${peak[3]} knots` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Canto das Águas',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Icaraí de Amontada, Ceará',
    spot: 'Icaraí de Amontada',
    spotCoords: null, // the site links a goo.gl short link only
    itinerarySpots: [],
    durationDays: null,
    // kite & wing: "the perfect place to be for learning and progression"; bay with flat lagoons, waves and downwinders
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: null, // lessons are offered for wing (Icarai Wing Academy); kite lessons not stated
    equipmentRental: /lessons and rental are available/i.test(kite) ? true : null,
    beginnerFriendly: /perfect place to be for learning/i.test(kite) ? true : null,
    includedServices: ['Kite / wing / foil area with landing zone, compressor and gear storage', 'Pool', 'Wi-Fi', 'Parking'],
    optionalServices: [
      wing ? 'Wing foil lessons and rental (Icarai Wing Academy, own school)' : 'Wing foil lessons and rental',
      'Up- and downwinders in Icaraizinho bay',
      'Kombi-bar with sunset debrief and video screen',
    ],
    accommodation: 'beach house rooms and apartments',
    mealPlan: null,
    languages: ['pt', 'en', 'fr'], // site languages (PT / EN / FR) and a French contact number
    rooms,
    imageUrls: caImages([p.home, p.rooms, p.kite]),
    heroVideoUrl: null,
    sourceUrl: CA_HOME_URL,
    bookingUrl: RESERVE_URL,
    sourceText: [
      `home: ${home}`,
      `rooms: ${units.map(u => `${u.name}: ${u.text} [${u.amenities.join(', ')}]`).join(' | ')}`,
      `kite & wing: ${kite}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const cantoDasAguasIcarai: OfferAdapter = {
  key: 'canto-das-aguas-icarai',
  name: 'Canto das Águas Icaraí de Amontada',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Canto das Águas',
    websiteUrl: SITE,
    rootDomain: 'cantodasaguas.com',
    contactEmail: 'cantodasaguas.br@gmail.com',
    phone: '+5588981319175',
    whatsapp: '+5588981319175',
  },
  url: CA_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // Aaron 2026-10-12: content-only, liveness from 2026 site edits only, no prices on the site
  async fetchContent() {
    const [home, rooms, kite] = [await page(CA_HOME_URL), await page(CA_ROOMS_URL), await page(CA_KITE_URL)];
    return parseCantoDasAguasContent({ home, rooms, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(CA_ROOMS_URL);
    if (parseCaRooms(html).length === 0) throw new Error('canto-das-aguas: room sections missing on /en/rooms/ (layout changed?)');
    const prices = caVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /en/rooms/ (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
