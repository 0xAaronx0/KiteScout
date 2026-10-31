// ---------------------------------------------------------------------------
// Azul Beach Kite Resort, El Sargento (Playa Rasta, La Ventana bay, Baja California Sur, Mexico) - boutique
// beach hotel with 8 rooms (JSON-LD numberOfRooms), its own kitesurf school on the beach, the La Ventana
// Restaurant & Kite Bar and an infinity pool, facing Cerralvo Island.
//
// Data path (checked 2026-10-14): Mirai-built WordPress/Elementor site www.azulbeachkiteresort.com (/en/).
//   content  /en/ (intro; JSON-LD Hotel: phone, e-mail, numberOfRooms, geo 24.1032306,-109.9941647 ->
//            spotCoords; JSON-LD FAQPage: on-site kitesurf school, kite season November-March),
//            /en/rooms/ (3 room cards), /en/rooms/<room>-<id>/ (English "This room includes" list + photos).
//   slots    /en/rooms/ room cards: <div class="price-box">From<span>4275Mex $</span>per night</div> ->
//            one slot per room type, MXN per room per night, no dates, availability 'unknown'.
//            "Mex $" is printed on the card itself, so the currency is not inferred.
//   Not used: the Mirai booking engine (its index-price call answered 403 for us at another property; the
//            api.mirai.com calls need a Basic-auth credential baked into the widget -> never used), and
//            room-detail or offer URLs with query strings (robots "Disallow: /*?").
// robots.txt (2026-10-14): booking steps and every URL with "?" disallowed; the pages above are allowed.
// Requests per run: 5 (home, rooms, 3 room pages), the rooms page memoised for the slots.
// Known limits: "From" prices are the lowest nightly rate the site shows, not a dated rate; no season
//   table, no availability. The pages were last modified 2025-09/11 (Yoast dateModified); 2026/27 evidence
//   is the live site with its working booking widget and current "From" prices only (confidence medium).
//   The site's room texts are Spanish; descriptions here are composed from the English feature lists.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.azulbeachkiteresort.com';
export const AZUL_HOME_URL = `${SITE}/en/`;
export const AZUL_ROOMS_URL = `${SITE}/en/rooms/`;

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function visible(html: string): HTMLElement {
  const r = parse(html);
  for (const el of r.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  return r;
}

// --- rooms list (slots) -------------------------------------------------------------------
export interface AzulRoom { name: string; url: string; price: number | null; currency: string | null; priceText: string | null; descriptionEs: string | null }

/** "4275Mex $" / "MXN 4,275" -> MXN; a bare "$" stays unknown (never guessed). */
export function azulCurrency(t: string): string | null {
  if (/mex\s*\$|mxn|pesos?/i.test(t)) return 'MXN';
  if (/usd|us\s*\$/i.test(t)) return 'USD';
  return null;
}

export function parseAzulRooms(html: string, base = AZUL_ROOMS_URL): AzulRoom[] {
  const root = parse(html);
  return root.querySelectorAll('.room-box').map(box => {
    const a = box.querySelector('.room-name a');
    const name = collapse(a?.getAttribute('title') ?? txt(a));
    const pb = box.querySelector('.price-box');
    const priceBox = collapse((pb?.childNodes ?? []).map(n => n.text).join(' ')); // "From 4275Mex $ per night"
    const amount = box.querySelector('.price-box span') ? parseAmount(txt(box.querySelector('.price-box span'))) : null;
    return {
      name,
      url: new URL(a?.getAttribute('href') ?? '', base).toString(),
      price: amount,
      currency: amount !== null ? azulCurrency(priceBox) : null,
      priceText: priceBox || null,
      descriptionEs: txt(box.querySelector('.room-description')) || null,
    };
  }).filter(r => r.name);
}

export function buildAzulSlots(rooms: AzulRoom[]): Slot[] {
  return rooms.filter(r => r.price !== null && r.currency).map(r => ({
    key: slug(r.name),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.price,
    currency: r.currency,
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: null,
    availability: 'unknown' as const,
    availabilityText: r.priceText ? `${r.priceText} (lowest rate shown on the site; dates via the hotel's booking engine)` : null,
    spotsLeft: null,
  }));
}

// --- room detail pages --------------------------------------------------------------------
export interface AzulRoomDetail { features: string[]; images: string[] }
export function parseAzulRoomDetail(html: string): AzulRoomDetail {
  const root = parse(html);
  const features = root.querySelectorAll('.detail-room-list li.item-service').map(li => txt(li)).filter(Boolean);
  const images = [...new Set([...html.matchAll(/https:\/\/images\.mirai\.com\/INFOROOMS\/[^"'\s)&]+?_original\.(?:jpe?g|png|webp)/gi)].map(m => m[0]))];
  return { features, images };
}

// --- content ------------------------------------------------------------------------------
export interface AzulPages { home: string; rooms: string; details: Record<string, string> }

export function parseAzulContent(p: AzulPages): OfferContent {
  const home = visible(p.home);
  const homeText = txt(home.querySelector('main') ?? home.querySelector('body') ?? home);
  const hotel = ldOfType(p.home, 'Hotel').find(o => o.geo) ?? ldOfType(p.home, 'Hotel')[0] ?? {};
  const geo = hotel.geo as { latitude?: unknown; longitude?: unknown } | undefined;
  const lat = Number(geo?.latitude), lng = Number(geo?.longitude);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null;
  const nRooms = Number(hotel.numberOfRooms) || null;
  const faq = ldOfType(p.home, 'FAQPage').flatMap(f => (f.mainEntity as Array<{ name?: string; acceptedAnswer?: { text?: string } }>) ?? [])
    .map(q => `${q.name ?? ''} ${q.acceptedAnswer?.text ?? ''}`.trim());
  const faqText = faq.join(' ');
  const school = /kitesurf school|kite surfing school|kiteboarding at our professional school/i.test(`${homeText} ${faqText}`);
  const season = faqText.match(/runs from (\w+) through (\w+)/i);

  const rooms = parseAzulRooms(p.rooms);
  const contentRooms: ContentRoom[] = rooms.map(r => {
    const d = p.details[r.url] ? parseAzulRoomDetail(p.details[r.url]) : { features: [], images: [] };
    const extra: string[] = [];
    if (/palapa/i.test(r.descriptionEs ?? '')) extra.push('Palapa roof');
    if (/vista al mar/i.test(r.descriptionEs ?? '') && !d.features.some(f => /sea view/i.test(f))) extra.push('Sea view');
    if (/cerralvo/i.test(r.descriptionEs ?? '')) extra.push('View of Cerralvo Island');
    const beds = r.name.match(/2 Queen Beds|King Size/i)?.[0];
    return {
      name: r.name,
      description: `${beds ? `${beds.replace(/King Size/i, 'King-size bed').replace(/2 Queen Beds/i, 'Two queen beds')}, ` : ''}private terrace facing the sea and Cerralvo Island.`,
      features: [
        ...d.features,
        ...extra,
        ...(r.price !== null ? [`From ${r.currency ?? ''} ${r.price.toLocaleString('en-US')} per night`.replace(/\s+/g, ' ')] : []),
      ],
    };
  });
  const prices = rooms.map(r => r.price).filter((x): x is number => x !== null);
  const currency = rooms.find(r => r.currency)?.currency ?? null;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const detailImages = rooms.flatMap(r => (p.details[r.url] ? parseAzulRoomDetail(p.details[r.url]).images : []));
  for (const u of [...imageCandidates(p.home, AZUL_HOME_URL, null, 40), ...detailImages, ...imageCandidates(p.rooms, AZUL_ROOMS_URL, null, 20)]) {
    if (/logo|favicon|icon|\.svg|-\d+x\d+\.(?:webp|jpe?g|png)$/i.test(u)) continue;
    const k = u.replace(/_(?:large|original)\./, '.');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const offer = [p.home, p.rooms, ...Object.values(p.details)].map(h => collapse(parse(h).text).match(/-?\d+%\s*Exclusive Web Offer/i)?.[0]).find(Boolean) ?? null;
  const summary = [
    `Azul Beach Kite Resort is a boutique beach hotel${nRooms ? ` with ${nRooms} rooms` : ''} on Playa Rasta in El Sargento, on La Ventana bay in Baja California Sur, facing Cerralvo Island.`,
    `It has its own kitesurf school on the beach for beginners and experienced kiters, the La Ventana Restaurant & Kite Bar and an infinity pool; rooms have a private sea-view terrace, air conditioning, Wi-Fi, Smart TV and a coffee machine.`,
    `${prices.length && currency ? `Nightly room rates start at ${currency} ${Math.min(...prices).toLocaleString('en-US')} (${rooms.length} room types)` : 'Rates are on request'}${season ? `; the hotel names ${season[1]} to ${season[2]} as the main kite season` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Azul Beach Kite Resort',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'El Sargento, Baja California Sur',
    spot: 'El Sargento',
    ...(coords ? { spotCoords: coords } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: /beginners and experienced kiters/i.test(faqText) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: school || null,
    equipmentRental: null, // not stated on the site
    beginnerFriendly: /ideal for both beginners/i.test(faqText) || null,
    includedServices: ['Wi-Fi', 'Infinity pool'],
    optionalServices: [
      ...(school ? ['Kitesurf lessons at the on-site school'] : []),
      'La Ventana Restaurant & Kite Bar',
      'Airport transport on request (arranged by the front desk)',
      ...(offer ? [`${offer} (booking on the hotel's website)`] : []),
    ],
    accommodation: 'boutique beach hotel rooms with private sea-view terraces',
    mealPlan: null,
    languages: ['en', 'es'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: AZUL_HOME_URL,
    bookingUrl: AZUL_ROOMS_URL,
    sourceText: [
      `home: ${homeText}`,
      `faq: ${faq.join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.priceText ?? '-'} | ${r.descriptionEs ?? ''}`).join(' || ')}`,
      `hotel: ${JSON.stringify({ telephone: hotel.telephone ?? null, email: hotel.email ?? null, numberOfRooms: nRooms, geo: coords })}`,
    ].join('\n'),
  };
}

export const azulBeachKiteResortElSargento: OfferAdapter = {
  key: 'azul-beach-kite-resort-el-sargento',
  name: 'Azul Beach Kite Resort, El Sargento',
  kind: 'accommodation',
  operator: {
    name: 'Azul Beach Kite Resort',
    websiteUrl: AZUL_HOME_URL,
    rootDomain: 'azulbeachkiteresort.com',
    contactEmail: 'reservas@azulbeachkiteresort.com',
    phone: '+52 612 221 3355',
  },
  url: AZUL_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'medium',
  async fetchContent(ctx) {
    const [home, rooms] = [await page(AZUL_HOME_URL), await page(AZUL_ROOMS_URL)];
    const details: Record<string, string> = {};
    for (const r of parseAzulRooms(rooms)) {
      try { details[r.url] = await page(r.url); } catch (e) { ctx.note(`azul: room page ${r.url} failed (${(e as Error).message})`); }
    }
    return parseAzulContent({ home, rooms, details });
  },
  async fetchSlots() {
    const rooms = parseAzulRooms(await page(AZUL_ROOMS_URL));
    if (rooms.length === 0) throw new Error('azul: no room cards on /en/rooms/ (layout changed?)');
    return buildAzulSlots(rooms);
  },
};
