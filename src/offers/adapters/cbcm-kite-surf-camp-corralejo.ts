// ---------------------------------------------------------------------------
// CBCM Fuerteventura "Kitesurf & Surf Training Camp", Corralejo (Fuerteventura, Canary Islands, Spain) - the school's
// one-week camp: 7 nights in one of its houses (Surf Hostal, an apartment or the "CBCM Rider Palace" sea-view studios)
// + 5 coaching sessions of 3 hours of kitesurf or surf (by conditions), gear and wetsuit, radio coaching, breakfast in
// the Surf Hostal. Kind 'camp' (one place, stay + coaching sold as one package).
//
// Data path (checked 2026-10-19): WordPress.com blog post, server-rendered, ONE page:
//   https://cbcmfuerteventura.com/2026/02/19/kitesurf-surf-camps/ (published / modified 2026-02-19). Three blocks
//   "KITESURF & SURF TRAINING CAMP", each with price lines ("890 € 1 pers / 1430 € 2 pers : Double room shared
//   Bathroom + Breakfast + Kite & surf", "Studio Sea View 1 1010 € 2 pers / 1500 € 1 pers") and an
//   "Accommodation : <house>" line. "Buy now and enjoy it (voucher valid for 1 year) subject to availability" links a
//   Stripe payment link (buy.stripe.com) for the EUR 890 package: a dated-less voucher, the week is agreed afterwards.
// robots.txt cbcmfuerteventura.com (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Parsed: one undated slot per house x room x guest count, EUR for the 7-night package (priceUnit 'package',
//   packageNights 7), availability 'on_request' (voucher / booking "subject to availability", no inventory shown).
//   Price basis (inferred, the page does not say "per person"): on a line where the 2-person price is ABOVE the
//   1-person price (Surf Hostal: 890 / 1430) the 2-person figure is the room total for two -> priceBasis 'room',
//   occupancy 2; on lines where it is below (apartment 770 / 980, Rider Palace 887 / 1255) the figures are per person.
// Flags: instantBooking left unset - the Stripe link sells a voucher at once, but the camp week is confirmed later
//   "subject to availability" (not an immediate date confirmation). liveAvailability: no engine.
// Known limits: no season dates; private double room "under request" is not priced.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://cbcmfuerteventura.com';
export const CBCM_CAMP_URL = `${SITE}/2026/02/19/kitesurf-surf-camps/`;
const NIGHTS = 7;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface CbcmPrice { persons: number; amount: number }
export interface CbcmRow { room: string; prices: CbcmPrice[] }
export interface CbcmBlock { house: string; rows: CbcmRow[] }

/** Title-case the shouted house names ("SURF HOSTAL" -> "Surf Hostal"), drop the quotes. */
function houseName(raw: string): string {
  const s = raw.replace(/[“”"]/g, '').trim();
  if (/^cbcm rider palace/i.test(s)) return 'CBCM Rider Palace (sea view)';
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/** The three "KITESURF & SURF TRAINING CAMP" blocks: price lines + "Accommodation : <house>". */
export function parseCbcmBlocks(html: string): CbcmBlock[] {
  const lines = blockLines(html);
  const out: CbcmBlock[] = [];
  let cur: CbcmBlock | null = null;
  for (const l of lines) {
    if (/^KITESURF & SURF TRAINING CAMP/i.test(l)) { cur = { house: '', rows: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (/^\+\d/.test(l) || /^SURF ART EXPO/i.test(l)) { cur = null; continue; }
    const acc = l.match(/Accommodation\s*:\s*(.+)$/i);
    if (acc) { cur.house = houseName(acc[1]); continue; }
    const prices = [...l.matchAll(/(\d[\d.,]*)\s*€\s*(\d)\s*pers/gi)]
      .map(m => ({ persons: Number(m[2]), amount: parseAmount(m[1]) }))
      .filter((p): p is CbcmPrice => p.amount !== null);
    if (!prices.length) continue;
    // the Rider Palace table's column head "Room" is glued to its first row ("Room Villa 887 € 2 pers")
    const before = l.slice(0, l.search(/\d[\d.,]*\s*€/)).trim().replace(/^Room\s+(?=[A-Z][a-z])/, '');
    const after = l.match(/pers\s*:\s*([^+(]+)/i)?.[1]?.trim() ?? '';
    cur.rows.push({ room: before || after, prices });
  }
  return out.filter(b => b.house && b.rows.length);
}

/** 2-person price above the 1-person price on the same line = room total for two; else per person (see header). */
export function cbcmRowIsRoomTotal(r: CbcmRow): boolean {
  const one = r.prices.find(p => p.persons === 1)?.amount;
  const two = r.prices.find(p => p.persons === 2)?.amount;
  return one !== undefined && two !== undefined && two > one;
}

export function buildCbcmSlots(blocks: CbcmBlock[]): Slot[] {
  const out: Slot[] = [];
  for (const b of blocks) {
    for (const r of b.rows) {
      const roomTotal = cbcmRowIsRoomTotal(r);
      const unitBase = r.room ? `${b.house} - ${r.room}` : b.house;
      for (const p of r.prices) {
        const basis = p.persons > 1 && roomTotal ? 'room' : 'person';
        out.push({
          key: `${slug(b.house)}|${slug(r.room || 'unit')}|${p.persons}p`,
          startDate: null,
          endDate: null,
          unit: `${unitBase} (${p.persons} ${p.persons === 1 ? 'guest' : 'guests'})`,
          price: p.amount,
          currency: 'EUR',
          priceUnit: 'package',
          priceBasis: basis,
          occupancy: p.persons,
          availability: 'on_request',
          availabilityText: `EUR ${p.amount} ${basis === 'room' ? `for the room with ${p.persons} guests` : 'per person'} for 7 nights + 5 kite/surf coaching sessions; voucher valid 1 year, dates subject to availability`,
          spotsLeft: null,
          packageNights: NIGHTS,
        });
      }
    }
  }
  return out;
}

const JUNK_IMG = /logo|book-now|mapa|airush|cropped-cbcm_t-shirt|squash|functional-training|el-patio/i;

export function parseCbcmContent(html: string): OfferContent {
  const lines = blockLines(html);
  const blocks = parseCbcmBlocks(html);
  const slots = buildCbcmSlots(blocks);
  const min = slots.length ? Math.min(...slots.filter(s => s.priceBasis === 'person').map(s => s.price!)) : null;
  const voucher = lines.some(l => /voucher valid for 1 year/i.test(l));
  const extras = lines.filter(l => /^(Stretching|Tuning|Video Correction|Art Workshop|Waterman Training)\b.*\d+\s*€/i.test(l));
  const summary = [
    'CBCM, a kitesurf, surf and sailing school in Corralejo on the north tip of Fuerteventura, sells a one-week Kitesurf & Surf Training Camp: 7 nights in one of its houses plus 5 coaching sessions of 3 hours, kitesurfing on windy days and surfing when the waves are better.',
    'Coaching uses helmet radios in winter; gear and wetsuit are supplied. Guests pick the Surf Hostal (bunk-bed or double rooms, breakfast), an apartment or a sea-view studio in the CBCM Rider Palace.',
    `${min ? `Prices start at EUR ${min} per person for the week` : 'Prices are per week'}${voucher ? '; the camp can be bought online as a voucher valid for one year, with the week subject to availability' : ''}. Flights are not included.`,
  ].join(' ');
  const imageUrls = imageCandidates(html, CBCM_CAMP_URL, null, 60).filter(u => !JUNK_IMG.test(u));

  return {
    kind: 'camp',
    title: 'CBCM Kitesurf & Surf Training Camp Corralejo',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Canary Islands',
    spot: 'Corralejo, Fuerteventura',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights accommodation (Surf Hostal, apartment or Rider Palace studio)',
      '5 coaching sessions of 3 hours (kitesurf or surf, by conditions) with a certified instructor',
      'Radio coaching (helmet radios, winter season)',
      'Kite / surf gear and wetsuit',
      'Breakfast, Wi-Fi and towels in the Surf Hostal',
    ],
    optionalServices: extras.map(e => e.replace(/(\d+)\s*€/, 'EUR $1')),
    accommodation: 'surf hostel rooms, apartments or sea-view studios of the school',
    mealPlan: 'breakfast',
    languages: ['en', 'fr', 'es'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CBCM_CAMP_URL,
    bookingUrl: CBCM_CAMP_URL,
    sourceText: [
      lines.join('\n'),
      `parsed: ${blocks.map(b => `${b.house}: ${b.rows.map(r => `${r.room || '-'} ${r.prices.map(p => `${p.amount}/${p.persons}p`).join(' ')}`).join('; ')}`).join(' | ')}`,
    ].join('\n'),
  };
}

export async function fetchCbcmSlots(): Promise<Slot[]> {
  const blocks = parseCbcmBlocks(await page(CBCM_CAMP_URL));
  if (blocks.length === 0) throw new Error('cbcm: no "KITESURF & SURF TRAINING CAMP" price blocks found (layout changed?)');
  return buildCbcmSlots(blocks);
}

export const cbcmKiteSurfCampCorralejo: OfferAdapter = {
  key: 'cbcm-kite-surf-camp-corralejo',
  name: 'CBCM Kitesurf & Surf Training Camp, Corralejo',
  kind: 'camp',
  operator: {
    name: 'CBCM Fuerteventura Kitesurf & Watersports School',
    websiteUrl: SITE,
    rootDomain: 'cbcmfuerteventura.com',
    contactEmail: 'kiteschool-cbcm@live.com',
    phone: '+34 659 203 656',
  },
  url: CBCM_CAMP_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  fetchBudget: 2,
  confidence: 'medium', // price basis per line inferred (see header)
  async fetchContent() { return parseCbcmContent(await page(CBCM_CAMP_URL)); },
  fetchSlots: () => fetchCbcmSlots(),
};
