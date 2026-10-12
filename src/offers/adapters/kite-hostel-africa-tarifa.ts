// ---------------------------------------------------------------------------
// Kite Hostel Africa (Hostal Africa, Freeride Tarifa), Tarifa (Cadiz, Andalusia, Spain) - the hostel in the old town
// between Puerta de Jerez and the theatre (Calle María Antonia Toledo 12) where the kite school Freeride Tarifa is
// based: private rooms with bathroom, a shared kitchen, a rooftop apartment, co-working, storage space and a rooftop
// with yoga and reiki classes; home of the school's Kite & Yoga Camp.
//
// Data path (checked 2026-10-12): ONE page, https://freeridetarifa.com/kite-hostel-tarifa/ (same WordPress layout as
//   the Surfers Residence page; the parser lives in surfers-residence-tarifa.ts).
//   slots    header subtitle "FROM 45€/Night" -> one slot without dates.
//   content  the same page: header (h1 + text), "Highlights." list, "Common areas" / "Nearby the kite hostel" boxes,
//            footer ("Find Us In Hostal Africa, Calle María Antonia Toledo, 12"), gallery.
// No booking engine: "Book Now" is a request form -> 'on_request'.
// Liveness (rule 5b): this page's dateModified is 2025-02-21, but the school's footer on every page places it "In
//   Hostal Africa" and the home page shows Google reviews dated October 2026 (checked 2026-10-12).
// robots.txt (2026-10-12): disallows only /wp-json/ and /?rest_route= for "*".
// Requests per run: 1 (content and slots share one memoised fetch).
// Parsed: slot "private-room-from" = EUR per night, no dates, availability 'on_request'.
// Known limits: "FROM 45€/Night" has no stated basis; read as per room (inferred). No map on the site.
// ---------------------------------------------------------------------------
import { buildFrSlots, FR_BOOKING_URL, FR_OPERATOR, FR_SITE, frImages, frPage, frSourceText, parseFrLodge } from './surfers-residence-tarifa.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';

export const KHA_URL = `${FR_SITE}/kite-hostel-tarifa/`;

/** "The kite hostel offers private rooms with bathroom and a shared kitchen plus a rooftop apartment." */
export function parseKhaRooms(texts: string[]): ContentRoom[] {
  const t = texts.find(x => /offers private rooms/i.test(x)) ?? '';
  const out: ContentRoom[] = [];
  if (/private rooms with bathroom/i.test(t)) out.push({ name: 'Private room', description: 'Private room with bathroom; shared kitchen', features: ['Private bathroom', 'Shared kitchen'] });
  if (/rooftop apartment/i.test(t)) out.push({ name: 'Rooftop apartment', description: 'Apartment on the rooftop of the hostel', features: [] });
  return out;
}

export function parseKiteHostelAfricaContent(html: string): OfferContent {
  const l = parseFrLodge(html);
  const rooms = parseKhaRooms(l.texts);
  const hl = l.highlights;
  const has = (re: RegExp) => hl.some(h => re.test(h));
  const nearby = l.boxes.find(b => /nearby/i.test(b.title))?.text ?? '';
  const walk = nearby.match(/(\d+) minutes walk from the beach/i)?.[1];
  const where = l.texts.find(x => /Located in the old town/i.test(x))?.match(/between (.+?)\./)?.[1]?.replace(/[“”"]/g, '') ?? null;

  const summary = [
    `Kite Hostel Africa (Hostal Africa) is the hostel in the old town of Tarifa, Spain${where ? `, between ${where}` : ''}, where the kite school Freeride Tarifa is based${walk ? `, ${walk} minutes' walk from the beach` : ''}.`,
    `It has ${rooms.length ? 'private rooms with bathroom and a rooftop apartment' : 'private rooms'}, a shared kitchen, ${[has(/co-?working/i) ? 'a co-working space' : null, has(/storage/i) ? 'storage space' : null, has(/laundry/i) ? 'laundry' : null].filter(Boolean).join(', ')} and a rooftop with ${[has(/yoga/i) ? 'yoga' : null, has(/reiki/i) ? 'reiki' : null].filter(Boolean).join(' and ')} classes${has(/massage/i) ? ' and holistic massage' : ''}.`,
    `It is the base of Freeride Tarifa's Kite & Yoga Camp; the school (French, English, Spanish) also runs kite and wing lessons and rental${l.price ? `; rooms from EUR ${l.price.amount} per night` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Hostel Africa (Freeride Tarifa)',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Tarifa town',
    spot: 'Tarifa',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kite lessons/i.test(html),
    equipmentRental: /Kitesurf Rental/i.test(html),
    beginnerFriendly: true,
    includedServices: hl.filter(h => !/^(Old Town|Close to parking|Private rooms|Yoga Classes|Reiki Classes|Holistic Massage)$/i.test(h)),
    optionalServices: [
      ...hl.filter(h => /yoga|reiki|massage/i.test(h)),
      'Kite & Yoga Camp (Freeride Tarifa)',
      'Kite and wing lessons, kitesurf and kitefoil rental (Freeride Tarifa)',
    ],
    accommodation: 'hostel with private rooms and a rooftop apartment',
    mealPlan: 'self_catering',
    languages: ['fr', 'en', 'es'],
    rooms,
    imageUrls: frImages(html, KHA_URL).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KHA_URL,
    bookingUrl: FR_BOOKING_URL,
    sourceText: frSourceText(l),
  };
}

export const kiteHostelAfricaTarifa: OfferAdapter = {
  key: 'kite-hostel-africa-tarifa',
  name: 'Kite Hostel Africa (Freeride Tarifa)',
  kind: 'accommodation',
  operator: FR_OPERATOR,
  url: KHA_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  async fetchContent() {
    return parseKiteHostelAfricaContent(await frPage(KHA_URL));
  },
  async fetchSlots() {
    const l = parseFrLodge(await frPage(KHA_URL));
    if (!l.heading) throw new Error('kite-hostel-africa: lodge header not found on /kite-hostel-tarifa/ (layout changed?)');
    return buildFrSlots(l, 'Private room');
  },
};
