// ---------------------------------------------------------------------------
// Surfers Residence (Freeride Tarifa Kite House), Tarifa (Cadiz, Andalusia, Spain) - the kite school Freeride Tarifa's
// kite house in a quiet street of the historic old town: private rooms only (apartments with a small kitchen and
// private bathroom, en-suite rooms, double/twin rooms with a shared bathroom), shared kitchen, storage space,
// TV/games room and a rooftop terrace with a weekly BBQ. Freeride Tarifa (French, English, Spanish) teaches kite and
// wing, rents gear and runs kite camps; its base is the school's other lodge, Hostal Africa.
// This file also holds the parser shared with Kite Hostel Africa (kite-hostel-africa-tarifa.ts): both lodge pages
// use the same WordPress (Euthemians "eut-*") layout.
//
// Data path (checked 2026-10-12): ONE page, https://freeridetarifa.com/tarifa-kite-house/
//   slots    the header subtitle "FROM 40€/Night" -> one slot without dates (the site prints no room or season table).
//   content  the same page: header (h1 + text blocks), "Highlights." list, "Common areas" / "Nearby" boxes, footer
//            (school, phones, e-mail, "Find Us In Hostal Africa, Calle María Antonia Toledo, 12"), gallery.
// No booking engine: "Book Now" is a request form (accommodation type, dates) -> 'on_request'.
// Liveness (rule 5b): page dateModified 2026-02-19 (JSON-LD WebPage); the home page shows Google reviews dated
//   October 2026 (checked 2026-10-12).
// robots.txt (2026-10-12): Yoast block, "User-agent: *" disallows only /wp-json/ and /?rest_route=.
// Requests per run: 1 (content and slots share one memoised fetch).
// Parsed: slot "private-room-from" = EUR per night, no dates, availability 'on_request'.
// Known limits: "FROM 40€/Night" does not say per room or per person; we read it as per room (private rooms only,
//   "Solo travellers will benefit of 10% discount" - inferred, not stated). No address of the residence itself and
//   no map, so no spotCoords. The page's distances ("6 km ... from Los Lances beach") are not repeated in the summary.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, ldOfType, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

export const FR_SITE = 'https://freeridetarifa.com';
export const SR_URL = `${FR_SITE}/tarifa-kite-house/`;
export const FR_BOOKING_URL = `${FR_SITE}/book-kitesurfing-lessons-in-tarifa/`;
export const FR_OPERATOR = {
  name: 'Freeride Tarifa',
  websiteUrl: `${FR_SITE}/`,
  rootDomain: 'freeridetarifa.com',
  contactEmail: 'info@freeridetarifa.com',
  phone: '+34601655993',
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
export function frPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- shared pure parsers (Surfers Residence + Hostel Africa) ------------------------------------------
export interface FrLodge {
  price: { amount: number; currency: string; raw: string } | null;
  heading: string;
  /** header text blocks in order (slogan paragraph + text elements) */
  texts: string[];
  highlights: string[];
  /** "Common areas", "Nearby the residence", ... (deduplicated: the page repeats them for mobile) */
  boxes: Array<{ title: string; text: string }>;
  /** footer "About Us" line, phones, address */
  school: string | null;
  address: string | null;
  dateModified: string | null;
}

export function parseFrLodge(html: string): FrLodge {
  const root = parse(html);
  const sub = root.querySelectorAll('.eut-subtitle').find(el => /from\s*\d/i.test(el.text));
  const section = sub?.closest('.eut-section') ?? null;
  const rawPrice = sub ? collapse(sub.text) : '';
  const amount = rawPrice ? parseAmount(rawPrice) : null;
  const heading = collapse(section?.querySelector('.eut-slogan-title')?.text ?? ''); // h1 or h2 depending on the page
  const texts = section
    ? section.querySelectorAll('.eut-slogan p, .eut-text p').map(p => collapse(p.text)).filter(Boolean)
    : [];
  const highlights = section ? section.querySelectorAll('.eut-list li').map(li => collapse(li.text)).filter(Boolean) : [];
  const boxes: Array<{ title: string; text: string }> = [];
  for (const box of root.querySelectorAll('.eut-box-content')) {
    const title = collapse(box.querySelector('.eut-box-title')?.text ?? '');
    const text = collapse(box.querySelector('p')?.text ?? '');
    if (title && text && !boxes.some(b => b.title === title)) boxes.push({ title, text });
  }
  const body = collapse(root.querySelector('footer')?.text ?? root.text);
  const school = body.match(/Freeride Tarifa is a kitesurfing school[^.]*\.[^.]*\./)?.[0] ?? null;
  const address = body.match(/Find Us\s*(In Hostal Africa\s*Calle[^©]+?Cádiz)/i)?.[1]?.replace(/\s+/g, ' ') ?? null;
  const wp = ldOfType(html, 'WebPage').find(o => typeof o.dateModified === 'string');
  return {
    price: amount ? { amount, currency: detectCurrency(rawPrice) ?? 'EUR', raw: rawPrice } : null,
    heading,
    texts: [...new Set(texts)],
    highlights: [...new Set(highlights)],
    boxes,
    school,
    address,
    dateModified: (wp?.dateModified as string | undefined)?.slice(0, 10) ?? null,
  };
}

/** One "from" slot per lodge: the site's only price, no dates. */
export function buildFrSlots(lodge: FrLodge, unit: string): Slot[] {
  if (!lodge.price) return [];
  return [{
    key: 'private-room-from',
    startDate: null,
    endDate: null,
    unit,
    price: lodge.price.amount,
    currency: lodge.price.currency,
    priceUnit: 'per_night',
    priceBasis: 'room', // inferred: private rooms only; the page says "FROM 40€/Night" without a basis
    occupancy: null,
    availability: 'on_request',
    availabilityText: lodge.price.raw,
    spotsLeft: null,
  }];
}

/** Gallery photos: one URL per file (WordPress -WxH thumbnails and -e<timestamp> edits are the same photo). */
export function frImages(html: string, base: string): string[] {
  const seen = new Map<string, string>();
  for (const u of imageCandidates(html, base, null, 80)) {
    if (/logo|icon|\.svg|favicon|flag/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|e\d{10,})(?=\.)/g, '').replace(/\.webp$/, '');
    const prev = seen.get(k);
    if (!prev || (/-\d+x\d+\./.test(prev) && !/-\d+x\d+\./.test(u))) seen.set(k, u);
  }
  return [...seen.values()];
}

export function frSourceText(l: FrLodge): string {
  return [
    `price: ${l.price?.raw ?? '-'}`,
    `heading: ${l.heading}`,
    `text: ${l.texts.join(' | ')}`,
    `highlights: ${l.highlights.join(', ')}`,
    ...l.boxes.map(b => `${b.title}: ${b.text}`),
    `school: ${l.school ?? '-'}; ${l.address ?? '-'}`,
    `dateModified: ${l.dateModified ?? '-'}`,
  ].join('\n');
}

// --- Surfers Residence ------------------------------------------------------------------------------
/** "Find 3 types of rooms in the residence. Apartments with ... Ensuite rooms and ... Double/twin rooms with ..." */
export function parseSrRooms(lodge: FrLodge): ContentRoom[] {
  const t = lodge.texts.find(x => /types of rooms/i.test(x)) ?? '';
  const sentences = t.split(/(?<=\.)\s+/).map(s => s.trim());
  const shared = sentences.filter(s => /^All rooms/i.test(s)).map(s => s.replace(/\.$/, ''));
  const out: ContentRoom[] = [];
  for (const s of sentences) {
    const m = s.match(/^(Apartments?|Ensuite rooms?|Double\/twin rooms?)\s+(?:with|and)\s+(.+?)\.?$/i);
    if (!m) continue;
    const name = /^apart/i.test(m[1]) ? 'Apartment' : /^ensuite/i.test(m[1]) ? 'Ensuite room' : 'Double/twin room';
    const what = m[2].replace(/^(?:its|their) own/i, 'own').replace(/^a /i, '');
    out.push({ name, description: `${m[1]} with ${what}`, features: [what.charAt(0).toUpperCase() + what.slice(1), ...shared] });
  }
  return out;
}

export function parseSurfersResidenceContent(html: string): OfferContent {
  const l = parseFrLodge(html);
  const rooms = parseSrRooms(l);
  const hl = l.highlights;
  const has = (re: RegExp) => hl.some(h => re.test(h));
  const common = l.boxes.find(b => /common areas/i.test(b.title))?.text ?? '';
  const solo = l.texts.join(' ').match(/Solo travellers will benefit of (\d+)% discount/i)?.[1];

  const summary = [
    `Surfers Residence is the Freeride Tarifa kite school's kite house in a quiet street of the historic old town of Tarifa, Spain: a kite hostel with private rooms only (${rooms.length ? rooms.map(r => r.description!.toLowerCase()).join(', ') : 'apartments, ensuite rooms and double/twin rooms'}) and a fully equipped shared kitchen.`,
    `Guests share ${[has(/storage/i) ? 'storage space for gear' : null, has(/TV|games/i) ? 'a TV/games room' : null, /rooftop/i.test(common) ? 'a rooftop terrace with a sea view to Morocco' : null].filter(Boolean).join(', ')}${/BBQ/i.test(common) ? ', with a BBQ party once a week' : ''}${solo ? `; solo travellers get ${solo}% off` : ''}.`,
    `Freeride Tarifa (French, English, Spanish) runs kite and wing lessons, rental and kite camps${l.price ? `; rooms from EUR ${l.price.amount} per night` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Surfers Residence (Freeride Tarifa Kite House)',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Tarifa town',
    spot: 'Tarifa',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // school menu: lessons, kitefoil training, rental
    kiteLessons: /Kite lessons/i.test(html),
    equipmentRental: /Kitesurf Rental/i.test(html),
    beginnerFriendly: true,
    includedServices: hl.filter(h => !/^(Old Town|Close to parking|Private rooms)$/i.test(h)),
    optionalServices: ['Kite and wing lessons (Freeride Tarifa)', 'Kitesurf and kitefoil rental', 'Kitesurfing camp and Kite & Yoga camp packages'],
    accommodation: 'kite hostel with private rooms and apartments',
    mealPlan: 'self_catering',
    languages: ['fr', 'en', 'es'],
    rooms,
    imageUrls: frImages(html, SR_URL).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SR_URL,
    bookingUrl: FR_BOOKING_URL,
    sourceText: frSourceText(l),
  };
}

export const surfersResidenceTarifa: OfferAdapter = {
  key: 'surfers-residence-tarifa',
  name: 'Surfers Residence (Freeride Tarifa Kite House)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: FR_OPERATOR,
  url: SR_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  async fetchContent() {
    return parseSurfersResidenceContent(await frPage(SR_URL));
  },
  async fetchSlots() {
    const l = parseFrLodge(await frPage(SR_URL));
    if (!l.heading) throw new Error('surfers-residence: lodge header not found on /tarifa-kite-house/ (layout changed?)');
    return buildFrSlots(l, 'Private room');
  },
};
