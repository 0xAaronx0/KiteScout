// ---------------------------------------------------------------------------
// Pousada Portal do Vento, Tatajuba (Camocim, Ceará, Brazil) - pousada about 100 m from the beach with
// pool and restaurant, three unit types (palafita stilt houses, kitehouses, bungalows); the site is run
// by KiteWorldWide GmbH (footer) and the contact is the local KiteWorldWide station manager.
//
// Data path (checked 2026-10-12):
//   content  pousada-tatajuba.com (WordPress/Divi, the property's own site; the older own domain
//            pousadaportaldovento.com.br no longer resolves): /en/ (unit teaser cards with "From 800 RBL
//            per night", facilities, host) + /en/accommodation/ (unit texts, galleries) + the property's
//            own Guesty booking pages tatajuba-portal-do-vento.guestybookings.com/en/properties/<id>
//            (server-rendered og:title, description and og:images; the listing body is client-rendered).
//   slots    the three "From <n> RBL per night" prices on /en/ ("RBL" is the site's typo for BRL / R$).
//            No dates, no season, no inventory -> one slot per unit type, availability 'unknown'.
// Booking engine: Guesty booking site. Its data API (/pm-websites-backend behind Guesty's API gateway)
//   needs a Bearer token plus a browser-generated, HMAC-signed X-Request-Context header (UA hash + time
//   window) - an anti-automation measure we do not reproduce, so there is no live availability.
// robots.txt (2026-10-12): pousada-tatajuba.com disallows only /wp-admin/; the Guesty booking host
//   "Disallow:" (empty) = allow all.
// Requests per run: content 5 (2 own pages + 3 Guesty property pages), slots 1.
// Known limits: "From" prices (lowest rate, no dates); whether the kitehouse price is per room or per
//   house is not stated (stored per room, occupancy unknown). The footer address ("Rua Da Praia, Lucena -
//   Paraíba") is a template error: Tatajuba is a village of Camocim in Ceará; the map embed is a Google
//   My Maps iframe without coordinates, so no spotCoords. The accommodation page intro names "Tatajuba
//   Pousada - Casa de Praia" (KiteWorldWide's sister pousada) - that sentence is not used.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://pousada-tatajuba.com';
export const PDV_HOME_URL = `${SITE}/en/`;
export const PDV_ACCOMMODATION_URL = `${SITE}/en/accommodation/`;
const GUESTY = 'https://tatajuba-portal-do-vento.guestybookings.com';
export const PDV_BOOKING_URL = `${GUESTY}/en/properties`;
/** Guesty listing ids of the three unit types (teaser links on /en/, 2026-10-12). */
export const PDV_LISTINGS = ['64b96b7e346c0f0028f3928c', '64b96cd8965a550029cae640', '64b96e8a897be7003f48ee8c'];
export const pdvListingUrl = (id: string): string => `${GUESTY}/en/properties/${id}`;

export interface PdvUnit { name: string; teaser: string; listingId: string | null; price: number | null; currency: string | null; from: boolean }
export interface PdvRoomText { name: string; text: string }
export interface PdvListingMeta { id: string; title: string; description: string; images: string[] }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "800 RBL" (site typo), "R$ 800", "800 BRL", "800 reais" -> BRL; anything else -> null (never guessed). */
export function pdvCurrency(text: string): string | null {
  return /\bRBL\b|R\$|\bBRL\b|\breais\b/i.test(text) ? 'BRL' : null;
}

// --- pure parsers -----------------------------------------------------------------------------
/** Unit teaser cards on /en/: h4 name (linking the Guesty listing), one-line text, "From <n> RBL per night". */
export function parsePdvUnits(homeHtml: string): PdvUnit[] {
  const out: PdvUnit[] = [];
  for (const card of parse(homeHtml).querySelectorAll('.accommodation-teaser')) {
    const h4 = card.querySelector('h4');
    const name = collapse(h4?.text ?? '');
    if (!name) continue;
    const href = h4?.querySelector('a')?.getAttribute('href') ?? card.querySelector('a[href*="guestybookings"]')?.getAttribute('href') ?? '';
    const priceText = collapse(card.querySelector('.teaser-price')?.text ?? '');
    const currency = priceText ? pdvCurrency(priceText) : null;
    const price = currency ? parseAmount(priceText) : null;
    out.push({
      name,
      teaser: collapse(card.querySelector('.teaser-text p')?.text ?? ''),
      listingId: href.match(/properties\/([0-9a-f]{24})/)?.[1] ?? null,
      price,
      currency: price !== null ? currency : null,
      from: /\bfrom\b/i.test(priceText),
    });
  }
  return out;
}

/** /en/accommodation/: each unit is an <h3> followed by its description paragraph. */
export function parsePdvRoomTexts(accHtml: string): PdvRoomText[] {
  const out: PdvRoomText[] = [];
  for (const inner of parse(accHtml).querySelectorAll('.et_pb_text_inner')) {
    const h3 = inner.querySelector('h3');
    if (!h3) continue;
    const name = collapse(h3.text);
    const text = inner.querySelectorAll('p').map(p => collapse(p.text)).filter(Boolean).join(' ');
    if (name && text) out.push({ name, text });
  }
  return out;
}

/** Server-rendered metadata of a Guesty listing page (title before " | ", description, og:images). */
export function parseGuestyListingMeta(id: string, html: string): PdvListingMeta {
  const root = parse(html);
  const metaOf = (sel: string) => root.querySelector(sel)?.getAttribute('content') ?? '';
  return {
    id,
    title: clean(metaOf('meta[property="og:title"]')).split(' | ')[0].trim(),
    description: clean(metaOf('meta[name="description"]')).replace(/\.\.\.$/, '…'),
    images: root.querySelectorAll('meta[property="og:image"]').map(m => m.getAttribute('content') ?? '').filter(u => /^https:\/\//.test(u)),
  };
}

/** One slot per unit type with a published "From" price: no dates, BRL per room per night. */
export function buildPdvSlots(units: PdvUnit[]): Slot[] {
  return units.filter(u => u.price !== null && u.currency).map(u => ({
    key: keyPart(u.name),
    startDate: null,
    endDate: null,
    unit: u.name,
    price: u.price,
    currency: u.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: null,
    availability: 'unknown',
    availabilityText: u.from ? 'from-price on the own site; availability only in the Guesty booking engine' : null,
    spotsLeft: null,
  }));
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, iframe')) el.remove();
  return collapse((root.querySelector('#main-content') ?? root.querySelector('body') ?? root).text);
}

const ROOM_FEATURES: Record<string, string[]> = {
  bungalow: ['King-size bed', 'Air conditioning', 'Minibar', 'Electronic safe', 'Hot shower', 'Private terrace with hammock (garden view)'],
  palafita: ['On stilts 4 m above the ground', 'King-size double bed', 'Hot shower', 'Minibar', 'Electric safe', 'Sofa and work desk', 'Swing hammock (garden and river view)'],
  kitehouse: ['Two independent rooms', 'Shared bathroom', 'Electric safe', 'Minibar', 'Common room with sofa and table', 'Hammock (river and garden view)'],
};
const roomKind = (name: string): string => (/palafita/i.test(name) ? 'palafita' : /kite\s*house/i.test(name) ? 'kitehouse' : /bungal/i.test(name) ? 'bungalow' : keyPart(name));

export interface PdvPages { home: string; accommodation: string; listings: Array<{ id: string; html: string }> }

export function parsePortalDoVentoContent(p: PdvPages): OfferContent {
  const home = pageText(p.home);
  const acc = pageText(p.accommodation);
  const units = parsePdvUnits(p.home);
  const texts = parsePdvRoomTexts(p.accommodation);
  const listings = p.listings.map(l => parseGuestyListingMeta(l.id, l.html));
  const enDesc = listings.map(l => l.description).find(d => /about 100 m from the beach/i.test(d)) ?? '';

  const rooms: ContentRoom[] = units.map(u => {
    const kind = roomKind(u.name);
    const text = texts.find(t => roomKind(t.name) === kind)?.text ?? u.teaser;
    return {
      name: u.name,
      description: text || null,
      features: [...(ROOM_FEATURES[kind] ?? []), ...(u.price !== null ? [`From BRL ${u.price} per night (own site)`] : [])],
    };
  });

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const push = (u: string) => {
    if (/\.svg|favicon|logo|pattern|icon/i.test(u)) return;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) return;
    seen.add(k); imageUrls.push(u);
  };
  for (const u of [...imageCandidates(p.home, PDV_HOME_URL, null, 40), ...imageCandidates(p.accommodation, PDV_ACCOMMODATION_URL, null, 40)]) {
    if (/pousada-tatajuba\.com\/wp-content\/uploads\//.test(u)) push(u);
  }
  for (const l of listings) for (const u of l.images) push(u);

  const prices = units.filter(u => u.price !== null).sort((a, b) => a.price! - b.price!);
  const nearBeach = /about 100 m from the beach/i.test(enDesc);
  const pool = /pool/i.test(enDesc);
  const summary = [
    `Pousada Portal do Vento is a guesthouse in the village of Tatajuba, Brazil${nearBeach ? ', about 100 m from the beach' : ''}${pool ? ', with a pool, a restaurant and chill-out areas' : ''}; its website is run by KiteWorldWide GmbH, addresses kitesurfers ("Perfect for kitesurfers") and names a station manager as host.`,
    `Guests stay in palafitas (stilt houses four meters above the ground with a king-size bed, sofa and desk), kitehouses split into two rooms with a shared bathroom and a common room, or bungalows with king-size bed, air conditioning and a private terrace with hammock.`,
    prices.length ? `The own website lists prices from ${prices.map(u => `BRL ${u.price} (${u.name.toLowerCase()})`).join(', ')} per night; bookings run through the pousada's online booking engine.` : null,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada Portal do Vento',
    summary,
    continent: 'South America',
    country: 'Brazil',
    // Tatajuba is a village of Camocim, Ceará; the site's footer address (Lucena - Paraíba) is a template error
    region: 'Ceará',
    spot: 'Tatajuba',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,     // the site names a station manager but no lessons, rental or prices
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: /Free Wi-Fi/i.test(home) ? ['Free Wi-Fi'] : [],
    optionalServices: pool ? ['Restaurant'] : [],
    accommodation: 'palafita stilt houses, kitehouses and bungalows',
    mealPlan: null, // a restaurant exists; the site does not say what a rate includes
    languages: ['en', 'pt'], // site + booking pages in English and Portuguese (2026-10-12)
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PDV_HOME_URL,
    bookingUrl: PDV_BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `accommodation: ${acc}`,
      `units: ${units.map(u => `${u.name} [${u.listingId}] ${u.from ? 'from ' : ''}${u.price ?? '-'} ${u.currency ?? ''}`).join('; ')}`,
      ...listings.map(l => `guesty ${l.id}: ${l.title} - ${l.description}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaPortalDoVentoTatajuba: OfferAdapter = {
  key: 'pousada-portal-do-vento-tatajuba',
  name: 'Pousada Portal do Vento Tatajuba',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Portal do Vento',
    websiteUrl: SITE,
    rootDomain: 'pousada-tatajuba.com',
    contactEmail: 'osvaldo@kiteworldwide.com',
    phone: '+558892232032',
  },
  url: PDV_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'medium',
  async fetchContent() {
    const home = await fetchText(PDV_HOME_URL, { accept: 'text/html' });
    const accommodation = await fetchText(PDV_ACCOMMODATION_URL, { accept: 'text/html' });
    const listings: Array<{ id: string; html: string }> = [];
    for (const id of PDV_LISTINGS) listings.push({ id, html: await fetchText(pdvListingUrl(id), { accept: 'text/html' }) });
    return parsePortalDoVentoContent({ home, accommodation, listings });
  },
  async fetchSlots(ctx) {
    const units = parsePdvUnits(await fetchText(PDV_HOME_URL, { accept: 'text/html' }));
    if (units.length === 0) throw new Error('portal-do-vento: no unit teaser cards on /en/ (layout changed?)');
    const unpriced = units.filter(u => u.price === null);
    if (unpriced.length) ctx.note(`no price parsed for ${unpriced.map(u => u.name).join(', ')}`);
    return buildPdvSlots(units);
  },
};
