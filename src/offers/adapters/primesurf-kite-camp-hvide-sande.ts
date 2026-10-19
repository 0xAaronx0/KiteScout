// ---------------------------------------------------------------------------
// Primesurf Denmark Kite Camp, Hvide Sande (West Jutland, Denmark) - the German kite/surf travel school's autumn
// camp: 6 days of intensive group coaching (4-5 hours a day, 4-6 riders per VDWS coach, Core / Duotone / Cube gear,
// fjord for beginners and freestyle, North Sea waves for wave riders) and a week in the dune house it uses "starting
// in 2026" in partnership with Drivethru (35,000 m² garden, sauna, hot tub, private fjord access). Kind 'camp'.
// Same property as the Drivethru stay listing (drivethru-kite-surf-camp-hvide-sande); separate product and operator.
//
// Data path (checked 2026-10-19): WordPress (Uncode), server-rendered:
//   slots    /destinations/denmark/accommodation/ "Price Infos": "Dorm 1 + 2 990 € / Person", "Room 3 + 4 1090 € /
//            Person", "Room 5 + 6 As single room / As double Room 1490 € / Person 1190 € / Person", "Camper 990 € /
//            Person", "Prices per person", "Prices already include the kite camp as well", food fee EUR 350 a week
//            optional (7 breakfasts, 4 lunch snacks, 7 dinners). One undated slot per room option, EUR per person
//            for the camp week (priceUnit 'package', packageNights 7 - inferred from the weekly food plan of 7
//            breakfasts / 7 dinners, the page does not print the nights), availability 'unknown'.
//   content  /destinations/denmark/kite-camps/ (camp details), the accommodation page (house, rooms) and
//            /destinations/denmark/ (Hvide Sande, autumn season from early September).
// Booking engine: primesurf.tideforce.app (Tideforce): a static Next.js shell (empty __NEXT_DATA__) whose data
//   comes from Firebase / Firestore through the browser SDK (API key + identity-toolkit session); the camp
//   schedule on /camp-schedule/ is the same widget behind a consent blocker. Not used (needs a client-side session;
//   rules: never build one) -> no dates and no live availability; printed prices only.
// robots.txt primesurf.com (2026-10-19): none (404 = allow all); primesurf.tideforce.app: none (404 page).
// Requests per run: content 3, slots 1 (accommodation page memoised).
// Flags: instantBooking unset (Tideforce may take paid bookings, not verified); liveAvailability false.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://primesurf.com';
export const PS_CAMP_URL = `${SITE}/destinations/denmark/kite-camps/`;
export const PS_ACCOMMODATION_URL = `${SITE}/destinations/denmark/accommodation/`;
export const PS_DENMARK_URL = `${SITE}/destinations/denmark/`;
const BOOKING_URL = 'https://primesurf.tideforce.app/book?location=denmark';
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

export interface PsPrice { group: string | null; label: string; variant: string | null; price: number }
export interface PsPrices { rows: PsPrice[]; food: number | null; perPerson: boolean; includesCamp: boolean }

/** "Price Infos" block of the accommodation page. */
export function parsePsPrices(html: string): PsPrices {
  const lines = blockLines(html);
  const i0 = lines.findIndex(l => /^Price Infos$/i.test(l));
  const i1 = lines.findIndex((l, i) => i > i0 && /^Prices per person/i.test(l));
  const rows: PsPrice[] = [];
  if (i0 >= 0) {
    let group: string | null = null;
    let label: string | null = null;
    let variants: string[] = [];
    for (const l of lines.slice(i0 + 1, i1 > i0 ? i1 : i0 + 20)) {
      const m = l.match(/^([\d.,]+)\s*€\s*\/\s*Person/i);
      if (m) {
        const price = parseAmount(m[1]);
        if (price && label) rows.push({ group, label, variant: variants.shift() ?? null, price });
        continue;
      }
      if (/^(Shared|Private) Rooms?$/i.test(l)) { group = l; continue; }
      if (/^As (single|double)/i.test(l)) { variants.push(l.replace(/^As\s+/i, '').toLowerCase()); continue; }
      label = l; variants = [];
    }
  }
  const tail = lines.slice(Math.max(i1, 0), Math.max(i1, 0) + 4).join(' ');
  const food = tail.match(/food fee per week is\s*([\d.,]+)\s*€/i);
  return {
    rows,
    food: food ? parseAmount(food[1]) : null,
    perPerson: /^Prices per person/i.test(lines[i1] ?? ''),
    includesCamp: /include the kite camp/i.test(tail),
  };
}

function unitOf(r: PsPrice): { unit: string; occupancy: number | null } {
  if (/camper/i.test(r.label)) return { unit: 'Own camper van on the camp grounds', occupancy: 1 };
  if (/dorm/i.test(r.label)) return { unit: `${r.label} (shared dorm, bunk beds, shared bathroom)`, occupancy: null };
  if (r.variant) return { unit: `${r.label} (private room with bathroom, as ${r.variant})`, occupancy: /double/.test(r.variant) ? 2 : 1 };
  return { unit: `${r.label} (shared room with private bathroom)`, occupancy: null };
}

export function buildPsSlots(p: PsPrices): Slot[] {
  return p.rows.map(r => {
    const u = unitOf(r);
    return {
      key: slug(`${r.label} ${r.variant ?? ''}`),
      startDate: null,
      endDate: null,
      unit: u.unit,
      price: r.price,
      currency: 'EUR',
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: u.occupancy,
      availability: 'unknown',
      availabilityText: `EUR ${r.price} per person for the camp week incl. the kite camp${p.food ? `; optional food package EUR ${p.food} payable on site` : ''}; dates and booking in the online booking app (not read)`,
      spotsLeft: null,
      packageNights: NIGHTS,
    };
  });
}

export interface PsPages { camp: string; accommodation: string; denmark: string }

export function parsePsContent(p: PsPages): OfferContent {
  const camp = blockLines(p.camp);
  const acc = blockLines(p.accommodation);
  const dk = blockLines(p.denmark);
  const prices = parsePsPrices(p.accommodation);
  const min = prices.rows.length ? Math.min(...prices.rows.map(r => r.price)) : null;
  const details = camp.filter(l => l.startsWith('✓')).map(l => l.replace(/^✓\s*/, ''));
  const rooms: ContentRoom[] = [];
  for (let i = 0; i < acc.length; i++) {
    const m = acc[i].match(/^((?:Dorm|Room) \d+) - (.+)$/);
    if (m) rooms.push({ name: `${m[1]} - ${m[2]}`, description: acc[i + 1] ?? null, features: [] });
  }
  // the theme serves photos twice (original + an "-uai" copy): one per photo, the original when the page links it
  const candidates = [...imageCandidates(p.camp, PS_CAMP_URL, null, 60), ...imageCandidates(p.accommodation, PS_ACCOMMODATION_URL, null, 60)];
  const html = p.camp + p.accommodation;
  const imageUrls: string[] = [];
  for (const u of candidates) {
    if (/cropped-android|logo|-\d{2,4}x\d{2,4}\.(jpe?g|png|webp)$/i.test(u)) continue;
    const orig = u.replace(/-uai(\.\w+)$/, '$1');
    const pick = orig !== u && html.includes(orig) ? orig : u;
    const same = (x: string) => x.replace(/-scaled(\.\w+)$/, '$1') === pick.replace(/-scaled(\.\w+)$/, '$1');
    if (!imageUrls.some(same)) imageUrls.push(pick);
  }
  const autumn = dk.some(l => /autumn storms arrive in beginning of September/i.test(l));
  const summary = [
    'Primesurf, a German kite and surf travel school, runs an autumn kite camp near Hvide Sande on the Danish west coast: 6 days of intensive group coaching (4-5 hours a day, 4-6 riders per VDWS-licensed coach, Core, Duotone and Cube gear) on the shallow Ringkøbing Fjord for beginners and freestylers and in the North Sea waves behind the house for wave riders.',
    'Guests stay in a dune house between fjord and sea with a 35,000 m² garden, sauna, hot tub and private fjord access, in dorms, shared rooms or private rooms (camper vans welcome).',
    `${min ? `Prices start at EUR ${min} per person for the week including the kite camp` : 'Prices are per person and week'}${prices.food ? `; a food package (EUR ${prices.food}) is optional` : ''}.${autumn ? ' The season starts with the autumn winds in early September; dates are published in the booking app.' : ''}`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Primesurf Denmark Kite Camp, Hvide Sande',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Hvide Sande, West Jutland',
    spot: 'Hvide Sande',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights in the dune house (dorm, shared or private room; or own camper van)',
      ...details.filter(d => /course|coach|equipment|theory|surf activities|instructors|participants/i.test(d)),
      'Sauna, hot tub, guest kitchen, workout room',
    ],
    optionalServices: [
      prices.food ? `Food package EUR ${prices.food} per week, payable on site (7 breakfasts, 4 lunch snacks, 7 dinners)` : null,
      'Massages; wetsuit and harness rental on request',
    ].filter((x): x is string => !!x),
    accommodation: 'dune house with dorms, shared and private rooms, camper spots',
    mealPlan: 'self_catering',
    languages: ['en', 'de'],
    rooms,
    imageUrls: imageUrls.slice(0, 25),
    heroVideoUrl: null,
    sourceUrl: PS_CAMP_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `kite-camps: ${camp.join('\n')}`,
      `accommodation: ${acc.join('\n')}`,
      `parsed: ${prices.rows.map(r => `${r.label}${r.variant ? ` ${r.variant}` : ''} ${r.price}`).join('; ')}; food ${prices.food}`,
    ].join('\n'),
  };
}

export async function fetchPsSlots(): Promise<Slot[]> {
  const prices = parsePsPrices(await page(PS_ACCOMMODATION_URL));
  if (!prices.rows.length || !prices.perPerson) throw new Error('primesurf: "Price Infos" block not found or no longer "per person" (layout changed?)');
  return buildPsSlots(prices);
}

export const primesurfKiteCampHvideSande: OfferAdapter = {
  key: 'primesurf-kite-camp-hvide-sande',
  name: 'Primesurf Denmark Kite Camp, Hvide Sande',
  kind: 'camp',
  operator: {
    name: 'Primesurf',
    websiteUrl: SITE,
    rootDomain: 'primesurf.com',
    phone: '+49 173 2969105',
  },
  url: PS_CAMP_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  fetchBudget: 4,
  confidence: 'medium', // no dates on the site, 7 nights inferred
  async fetchContent() {
    const camp = await page(PS_CAMP_URL);
    const accommodation = await page(PS_ACCOMMODATION_URL);
    const denmark = await page(PS_DENMARK_URL);
    return parsePsContent({ camp, accommodation, denmark });
  },
  fetchSlots: () => fetchPsSlots(),
};
