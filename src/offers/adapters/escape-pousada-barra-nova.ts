// ---------------------------------------------------------------------------
// Escape Kiteboarding Pousada, Barra Nova (Cascavel, Ceara, Brazil) - 12-room pousada on the flat-water lagoon at
// the mouth of the Rio Choro, pousada and kite school there since 2009; kite gear shed "The Quiver" with an air
// compressor, pool, restaurant. Found via bstoked listing 6808 ("Yoga & Lagoon Kite Camp", inactive) - bstoked
// is a hint only: the property has its own, current website, so nothing is read from bstoked.
//
// Data path (checked 2026-10-12), static site escape-kiteboarding.com.br (Portuguese; EN/DE are client-side
// translations of the same pages):
//   content  / (JSON-LD LodgingBusiness: rooms, geo, phone, e-mail, amenities), /pousada.html (12 room cards,
//            policies, facilities), /kite-barra-nova.html (spot guide), /faq.html (minimum stay, kite lessons,
//            languages), /galeria.html (photos).
//   slots    the site's own availability calendar on /pousada.html loads
//              GET https://escape-disponibilidade.vercel.app/api/disponibilidade?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
//            -> [{ quarto: "01".."12", checkin, checkout }] (booked stays, checkout night not counted; the page
//            comment says the endpoint is public and carries no guest data). One call covers the whole window.
//            Prices: none on the site ("Consulte disponibilidade e valores") -> price null (on request).
// Liveness: sitemap lastmod 2026-09-30 (blog posts dated 2026-08/09), page version v2.26.4, bookings in the
//   calendar for Oct-Dec 2026. The older escape-kiteboarding.com (German WordPress, last edited 2020) still
//   shows 2020 EUR prices - not used (stale; the new site says prices on request).
// robots.txt (2026-10-12): escape-kiteboarding.com.br "Allow: /"; escape-disponibilidade.vercel.app has none
//   (404 = allow all).
// Requests per run: content 5, slots 2 (pousada page for the room list + one availability call).
// Parsed: bands per room category (Suite: 7 rooms for 2-3 guests, Family room: 5 rooms for 4-6 guests) where the
//   number of free rooms changes (runsOf), 180 nights ahead; available / limited (1-2 rooms free) / sold_out;
//   spotsLeft = free rooms; minNights 2 (FAQ; "may be 3" in July-December, not applied).
// Known limits: kite lessons are paused ("Nosso instrutor certificado IKO esta temporariamente indisponivel",
//   FAQ 2026-10-12) -> kiteLessons false until the FAQ changes. Contact e-mail = the JSON-LD address.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, ldOfType, parse, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://escape-kiteboarding.com.br';
export const EP_HOME_URL = `${SITE}/`;
export const EP_POUSADA_URL = `${SITE}/pousada.html`;
export const EP_SPOT_URL = `${SITE}/kite-barra-nova.html`;
export const EP_FAQ_URL = `${SITE}/faq.html`;
export const EP_GALLERY_URL = `${SITE}/galeria.html`;
export const EP_AVAIL_URL = 'https://escape-disponibilidade.vercel.app/api/disponibilidade';
const CONTACT_URL = `${SITE}/contato.html`;
const WINDOW_DAYS = 180;
const MIN_NIGHTS = 2;

export type EpCategory = 'suite' | 'family';
export interface EpRoom { code: string; name: string; category: EpCategory; maxGuests: number | null; view: string | null; amenities: string[]; photo: string | null }
export interface EpBooking { room: string; checkin: string; checkout: string }

const UNIT: Record<EpCategory, string> = { suite: 'Suite', family: 'Family room' };
const VIEW_EN: Array<[RegExp, string]> = [
  [/2º Andar/i, 'sea / lagoon view, 2nd floor'], [/Lateral/i, 'side sea / lagoon view'],
  [/Mar|Lagoa/i, 'sea / lagoon view'], [/Frente Jardim/i, 'garden front'], [/Jardim/i, 'garden'],
];
const AMENITY_EN: Record<string, string> = { Frigobar: 'Minibar', 'Ducha ♨': 'Hot shower', WiFi: 'Wi-Fi', AC: 'Air conditioning' };
const LD_AMENITY_EN: Record<string, string> = {
  'Wi-Fi gratuito': 'Wi-Fi', 'Ar-condicionado': 'Air conditioning', Piscina: 'Pool', 'Estacionamento grátis': 'Free parking',
  'Café da manhã incluso': 'Breakfast', Restaurante: 'Restaurant (The Pit Stop)',
  'Guarda-equipamentos': 'Kite gear storage (The Quiver, with air compressor)', 'Transfer aeroporto': 'Airport transfer',
};

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const viewEn = (v: string | null): string | null => (v ? VIEW_EN.find(([re]) => re.test(v))?.[1] ?? v : null);

// --- pure parsers -----------------------------------------------------------------------------------
/** /pousada.html room cards: <div class="room-card" data-quarto="01"> name "FAMILIA 1" / "SUITE 2", "ate 6 hospedes". */
export function parseEpRooms(html: string): EpRoom[] {
  return parse(html).querySelectorAll('.room-card[data-quarto]').map(card => {
    const name = collapse(card.querySelector('.room-name')?.text ?? '');
    const cap = collapse(card.querySelector('.rm-cap')?.text ?? '').match(/(\d+)/)?.[1];
    const src = card.querySelector('.room-thumb img')?.getAttribute('src') ?? null;
    return {
      code: card.getAttribute('data-quarto')!,
      name,
      category: (/fam/i.test(name) ? 'family' : 'suite') as EpCategory,
      maxGuests: cap ? Number(cap) : null,
      view: collapse(card.querySelector('.rm-vista')?.text ?? '') || null,
      amenities: card.querySelectorAll('.room-tag').map(t => collapse(t.text)).filter(Boolean),
      photo: src ? new URL(src, EP_POUSADA_URL).toString() : null,
    };
  }).filter(r => r.name);
}

/** Availability endpoint answer -> booked stays (room code, checkin, checkout exclusive). */
export function parseEpBookings(json: string): EpBooking[] {
  const rows = JSON.parse(json) as Array<{ quarto?: string; checkin?: string; checkout?: string }>;
  if (!Array.isArray(rows)) throw new Error('escape: availability answer is not a list');
  return rows.filter(r => r.quarto && /^\d{4}-\d{2}-\d{2}$/.test(r.checkin ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(r.checkout ?? ''))
    .map(r => ({ room: String(r.quarto), checkin: r.checkin!, checkout: r.checkout! }));
}

export function epAvailUrl(today: string, days = WINDOW_DAYS): string {
  return `${EP_AVAIL_URL}?inicio=${today}&fim=${addDays(today, days)}`;
}

/**
 * Bands per room category: nights from `today` for `days` nights, state = number of free rooms of the category
 * (a room is taken on [checkin, checkout)). The band ends where that number changes.
 */
export function buildEpSlots(rooms: EpRoom[], bookings: EpBooking[], today: string, days = WINDOW_DAYS): Slot[] {
  const out: Slot[] = [];
  for (const category of ['suite', 'family'] as EpCategory[]) {
    const codes = rooms.filter(r => r.category === category).map(r => r.code);
    if (codes.length === 0) continue;
    const nights: Array<{ date: string; free: number }> = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(today, i);
      const taken = new Set(bookings.filter(b => codes.includes(b.room) && b.checkin <= date && date < b.checkout).map(b => b.room));
      nights.push({ date, free: codes.length - taken.size });
    }
    for (const run of runsOf(nights, n => String(n.free))) {
      const free = run.first.free;
      const availability: Availability = free === 0 ? 'sold_out' : free <= 2 ? 'limited' : 'available';
      out.push({
        key: `${category}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: UNIT[category],
        price: null,
        currency: null,
        priceUnit: null,
        priceBasis: 'room',
        occupancy: null,
        availability,
        availabilityText: free === 0 ? `all ${codes.length} ${UNIT[category].toLowerCase()}s booked` : `${free} of ${codes.length} ${UNIT[category].toLowerCase()}s free`,
        spotsLeft: free,
        minNights: MIN_NIGHTS,
      });
    }
  }
  return out;
}

export interface EpPages { home: string; pousada: string; spot: string; faq: string; gallery: string }

export function parseEscapeContent(p: EpPages): OfferContent {
  const lodging = ldOfType(p.home, 'LodgingBusiness')[0] ?? {};
  const geo = (lodging.geo ?? {}) as Record<string, unknown>;
  const lat = Number(geo.latitude);
  const lng = Number(geo.longitude);
  const rooms = parseEpRooms(p.pousada);
  const pousada = pageText(p.pousada);
  const spot = pageText(p.spot);
  const faq = pageText(p.faq);
  const nRooms = Number(lodging.numberOfRooms) || rooms.length;

  const lessonsPaused = /instrutor certificado IKO está temporariamente indisponível/i.test(faq);
  const lagoon = spot.match(/Lagoa\s*(\d+)\s*×\s*(\d+)\s*m,\s*([\d,]+)\s*a\s*([\d,]+)\s*m de profundidade/);
  const wind = spot.match(/Vento\s*(\d+)\s*a\s*(\d+)\s*nós,\s*de\s*(\w+)\s*a\s*(\w+)/i);
  const since = spot.match(/desde\s+(\d{4})/)?.[1] ?? null;
  const minStay = faq.match(/Mínimo de (\d+) noites/)?.[1] ?? null;

  const amenities = ((lodging.amenityFeature ?? []) as Array<Record<string, unknown>>)
    .filter(a => a.value === true).map(a => String(a.name ?? '')).filter(Boolean);
  const included = amenities.filter(a => a !== 'Transfer aeroporto').map(a => LD_AMENITY_EN[a] ?? a);

  const grouped = (['suite', 'family'] as EpCategory[]).map((cat): ContentRoom | null => {
    const list = rooms.filter(r => r.category === cat);
    if (list.length === 0) return null;
    const caps = list.map(r => r.maxGuests).filter((n): n is number => n !== null);
    const views = [...new Set(list.map(r => viewEn(r.view)).filter((v): v is string => !!v))];
    const amen = [...new Set(list.flatMap(r => r.amenities))].map(a => AMENITY_EN[a] ?? a);
    return {
      name: UNIT[cat],
      description: `${list.length} ${cat === 'suite' ? 'suites' : 'family rooms'} for ${Math.min(...caps)}-${Math.max(...caps)} guests (${list.map(r => r.name.replace(/^\S+\s/, '#')).join(', ')}), private bathroom, breakfast included`,
      features: [`Up to ${Math.max(...caps)} guests`, ...views.map(v => `View: ${v}`), ...amen],
    };
  }).filter((r): r is ContentRoom => r !== null);

  // photos: share image, pousada page, one photo per room card, then the gallery
  const imgs: string[] = [];
  const add = (u: string | null | undefined, base: string) => {
    if (!u || /logo|favicon|icon/i.test(u)) return;
    const abs = new URL(u, base).toString();
    if (!imgs.includes(abs)) imgs.push(abs);
  };
  add(typeof lodging.image === 'string' ? lodging.image : null, EP_HOME_URL);
  for (const m of p.pousada.matchAll(/src="(img\/[^"]+\.(?:jpe?g|png|webp))"/gi)) add(m[1], EP_POUSADA_URL);
  for (const r of rooms) add(r.photo, EP_POUSADA_URL);
  for (const m of p.gallery.matchAll(/src="(img\/[^"]+\.(?:jpe?g|png|webp))"/gi)) add(m[1], EP_GALLERY_URL);

  const lagoonText = lagoon ? `about ${lagoon[1]} x ${lagoon[2]} m and ${lagoon[3].replace(',', '.')}-${lagoon[4].replace(',', '.')} m deep` : 'shallow';
  const windText = wind ? `${wind[1]}-${wind[2]} knots from July to December` : 'steady trade wind from July to December';
  const summary = [
    `Escape Kiteboarding Pousada has ${nRooms} rooms (suites for 2-3 guests and family rooms for up to 6) a few metres from the flat-water lagoon at the mouth of the Rio Choró in Barra Nova, Cascavel (Ceará), about 76 km from Fortaleza${since ? `; it has been a pousada and kite school there since ${since}` : ''}.`,
    `The lagoon is ${lagoonText}, with ${windText}.`,
    `Breakfast, Wi-Fi and air conditioning are included, and the pousada has a pool, a restaurant and a kite gear shed (The Quiver) with an air compressor.`,
    lessonsPaused ? 'Kite lessons are paused while the IKO instructor is unavailable.' : 'Kite lessons are given at the pousada.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Escape Kiteboarding Pousada',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Barra Nova',
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    itinerarySpots: [],
    durationDays: null,
    // spot guide "Para quem e o spot": iniciantes, intermediarios, avancados e freestyle
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: !lessonsPaused,
    equipmentRental: null, // the current site names no kite rental
    beginnerFriendly: /Barra Nova é boa para iniciantes\?\s*Sim/i.test(spot),
    includedServices: included,
    optionalServices: [
      'Airport transfer from Fortaleza (private, on request)',
      ...(/Wingfoil e passeio de barco/i.test(faq) ? ['Wingfoil (on request)', 'Boat trip on the lagoon and river'] : []),
      ...(/BUGGY/i.test(pousada) ? ['Buggy tour'] : []),
      ...(/DAY USE/i.test(pousada) ? ['Day use for non-guests'] : []),
      'Barbecue area The Pit Stop (on reservation, fee on request)',
    ],
    accommodation: 'pousada rooms on the kite lagoon (suites and family rooms)',
    mealPlan: 'breakfast',
    languages: /Idiomas Português · Inglês · Espanhol · Alemão/.test(pousada) ? ['pt', 'en', 'es', 'de'] : ['pt', 'en', 'de'],
    rooms: grouped,
    imageUrls: imgs.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: EP_POUSADA_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `lodging (JSON-LD): ${collapse(String(lodging.description ?? ''))} rooms ${nRooms}; geo ${geo.latitude},${geo.longitude}; amenities ${amenities.join(', ')}; rating ${JSON.stringify(lodging.aggregateRating ?? null)}`,
      `rooms: ${rooms.map(r => `${r.code} ${r.name} (${r.maxGuests} pax, ${r.view}, ${r.amenities.join('/')})`).join('; ')}`,
      `policies: ${pousada.match(/POLÍTICAS & SERVIÇOS.*$/)?.[0] ?? ''}`,
      `spot: ${lagoon?.[0] ?? ''} | ${wind?.[0] ?? ''} | since ${since ?? '?'}`,
      `faq: minimum stay ${minStay ?? '?'} nights; lessons ${lessonsPaused ? 'paused (IKO instructor temporarily unavailable)' : 'offered'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------------
export const escapePousadaBarraNova: OfferAdapter = {
  key: 'escape-pousada-barra-nova',
  name: 'Escape Kiteboarding Pousada (Barra Nova)',
  kind: 'accommodation',
  operator: {
    name: 'Escape Pousada Kiteschool',
    websiteUrl: SITE,
    rootDomain: 'escape-kiteboarding.com.br',
    contactEmail: 'contato@escapekite.com.br', // JSON-LD on the home page, 2026-10-12
    whatsapp: '+5585999271489',
    phone: '+5585999271489',
  },
  url: EP_POUSADA_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,
  fetchBudget: 7,
  confidence: 'medium', // live availability, no prices
  async fetchContent() {
    const home = await fetchText(EP_HOME_URL, { accept: 'text/html' });
    const pousada = await fetchText(EP_POUSADA_URL, { accept: 'text/html' });
    const spot = await fetchText(EP_SPOT_URL, { accept: 'text/html' });
    const faq = await fetchText(EP_FAQ_URL, { accept: 'text/html' });
    const gallery = await fetchText(EP_GALLERY_URL, { accept: 'text/html' });
    return parseEscapeContent({ home, pousada, spot, faq, gallery });
  },
  async fetchSlots(ctx) {
    const rooms = parseEpRooms(await fetchText(EP_POUSADA_URL, { accept: 'text/html' }));
    if (rooms.length === 0) throw new Error('escape: no room cards on /pousada.html');
    const today = todayIso();
    const bookings = parseEpBookings(await fetchText(epAvailUrl(today), { accept: 'application/json' }));
    ctx.note(`${bookings.length} booked stays in the next ${WINDOW_DAYS} nights; prices on request (none on the site)`);
    return buildEpSlots(rooms, bookings, today);
  },
};
