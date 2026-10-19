// ---------------------------------------------------------------------------
// WAVE CULTURE Tenerife Surf Camp - kite week: the camp's "Base Pack" (a week in the surf camp house in La Mareta:
// shared or private rooms / dorms, daily breakfast, yoga three times a week) + its "Kite Pack" (3 or 5 days, 2 hours
// a day with IKO coaches at the school in El Médano, 5 minutes by car; board, kite, bar and wetsuit, radios, jet-ski
// safety). Kind 'camp': the Extra Packs "are available exclusively with the Base Pack", so a kite week is always
// Base Pack + Kite Pack.
//
// Data path (checked 2026-10-19): WordPress (Elementor), server-rendered, English pages at the root, German under /de/.
//   slots    /booking: "BASE PACK" room cards (name, "1 person" / "1-4 persons", "€ 609 per week / person", bathroom)
//            and "02 Kite Packs" ("3 DAYS PACK" "€ 420 3 days / person" "6 hours with full equipment"). One undated
//            slot per room card x kite pack. price = Base Pack week + Kite Pack, both "per person" as printed; the SUM
//            is ours (the page prints the two parts, see availabilityText). EUR, priceUnit 'package', packageNights 7,
//            priceBasis 'person', availability 'on_request' ("request your booking. We will send you an offer").
//   content  /kitesurf-school (school, spot, wind) + /booking (packs) + /surf-and-yoga-camp (house photos).
// robots.txt tenerife-surfcamp.com (2026-10-19): Yoast default "Disallow:" (everything allowed).
// Requests per run: content 3, slots 1 (booking page memoised).
// Known limits: the Base Pack is "per week" with a 3-night minimum (shorter stays not priced); children discounts and
//   the Family / Ocean & Glow weeks (surf / wellness themed) are text only; "Just kite material" rental (EUR 110 a day,
//   EUR 450 a week) goes into optionalServices.
// Flags: request form + bank transfer -> instantBooking false; no engine -> liveAvailability false.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { blockLines } from './jaguaribe-lodge-fortim.js';

const SITE = 'https://tenerife-surfcamp.com';
export const WC_BOOKING_URL = `${SITE}/booking`;
export const WC_KITE_URL = `${SITE}/kitesurf-school`;
export const WC_CAMP_URL = `${SITE}/surf-and-yoga-camp`;
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
const title = (s: string): string => s.toLowerCase().replace(/^\w/, c => c.toUpperCase());

export interface WcRoom { name: string; persons: string; maxPersons: number | null; price: number; bathroom: string | null }
export interface WcKitePack { days: number; price: number; hours: number | null }
export interface WcPacks { rooms: WcRoom[]; kite: WcKitePack[]; rental: string | null }

/** Base Pack room cards and Kite Packs of /booking. */
export function parseWcPacks(html: string): WcPacks {
  const lines = blockLines(html);
  const iBase = lines.findIndex(l => /^BASE PACK$/i.test(l));
  const iExtra = lines.findIndex(l => /^EXTRA PACKS$/i.test(l));
  const iKite = lines.findIndex(l => /Kite Packs$/i.test(l));
  const iMaterial = lines.findIndex((l, i) => i > iKite && /^JUST KITE MATERIAL$/i.test(l));
  const rooms: WcRoom[] = [];
  if (iBase >= 0 && iExtra > iBase) {
    const base = lines.slice(iBase, iExtra);
    for (let i = 0; i < base.length; i++) {
      const pm = base[i].match(/^€\s*([\d.,]+)\s*per week\s*\/\s*person/i);
      if (!pm || i < 2) continue;
      const persons = base[i - 1];
      const name = base[i - 2];
      if (!/person/i.test(persons)) continue;
      const price = parseAmount(pm[1]);
      if (!price) continue;
      const max = persons.match(/(\d+)\s*persons?$/i);
      const bathroom = base.slice(i + 1, i + 4).find(l => /bathroom/i.test(l)) ?? null;
      rooms.push({ name: title(name), persons, maxPersons: max ? Number(max[1]) : null, price, bathroom });
    }
  }
  const kite: WcKitePack[] = [];
  if (iKite >= 0) {
    for (const l of lines.slice(iKite, iMaterial > iKite ? iMaterial : undefined)) {
      const m = l.match(/^€\s*([\d.,]+)\s*(\d+)\s*days?\s*\/\s*person/i);
      if (!m) continue;
      const price = parseAmount(m[1]);
      const idx = lines.indexOf(l);
      const hours = lines[idx + 1]?.match(/(\d+)\s*hours/i);
      if (price) kite.push({ days: Number(m[2]), price, hours: hours ? Number(hours[1]) : null });
    }
  }
  let rental: string | null = null;
  if (iMaterial > 0) {
    const day = lines[iMaterial + 2]?.match(/€\s*([\d.,]+)\s*1 day/i);
    const week = lines.slice(iMaterial, iMaterial + 6).join(' ').match(/1 week\s*€\s*([\d.,]+)/i);
    if (day) rental = `Kite gear rental without lessons (RRD): EUR ${parseAmount(day[1])} a day${week ? `, EUR ${parseAmount(week[1])} a week` : ''}`;
  }
  return { rooms, kite, rental };
}

export function buildWcSlots(p: WcPacks): Slot[] {
  const out: Slot[] = [];
  for (const r of p.rooms) {
    for (const k of p.kite) {
      const price = r.price + k.price;
      out.push({
        key: `${slug(`${r.name} ${r.persons}`)}|kite-${k.days}d`,
        startDate: null,
        endDate: null,
        unit: `${r.name}, ${r.persons}${r.bathroom ? ` (${r.bathroom.replace(/\s*\(.*\)$/, '')})` : ''} + ${k.days}-day kite pack`,
        price,
        currency: 'EUR',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: r.maxPersons,
        availability: 'on_request',
        availabilityText: `Base Pack EUR ${r.price} per week per person + Kite Pack ${k.days} days${k.hours ? ` (${k.hours} h)` : ''} EUR ${k.price} per person; booking request, offer by e-mail`,
        spotsLeft: null,
        packageNights: NIGHTS,
      });
    }
  }
  return out;
}

export interface WcPages { booking: string; kite: string; camp: string }

export function parseWcContent(p: WcPages): OfferContent {
  const packs = parseWcPacks(p.booking);
  const kiteLines = blockLines(p.kite);
  const slots = buildWcSlots(packs);
  const min = slots.length ? Math.min(...slots.map(s => s.price!)) : null;
  const cheapRoom = packs.rooms.length ? packs.rooms.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const cheapKite = packs.kite.length ? packs.kite.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.kite, WC_KITE_URL), ...imageCandidates(p.camp, WC_CAMP_URL), ...imageCandidates(p.booking, WC_BOOKING_URL)]) {
    if (!/logo|favi/i.test(u) && !imageUrls.includes(u)) imageUrls.push(u);
  }
  const summary = [
    'WAVE CULTURE runs the Tenerife Surf Camp in La Mareta on the south coast of Tenerife, 5 minutes by car from El Médano, the island\'s kitesurf hotspot, where its IKO kite school teaches.',
    'A kite week combines the camp\'s Base Pack (a week in a shared or private room or dorm with daily breakfast and yoga three times a week, garden, roof terrace and shared kitchen) with a 3-day or 5-day Kite Pack (2 hours a day with full gear, radios and jet-ski safety).',
    `${min && cheapRoom && cheapKite ? `A week starts at EUR ${min} per person (${cheapRoom.name.toLowerCase()} EUR ${cheapRoom.price} + ${cheapKite.days}-day Kite Pack EUR ${cheapKite.price})` : 'Prices are per person and week'}; bookings are made by request and confirmed with an offer by e-mail.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'WAVE CULTURE Tenerife Kite Week, El Médano',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Canary Islands',
    spot: 'El Médano, Tenerife',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights in the surf camp house in La Mareta (shared or private room, or dorm)',
      'Daily breakfast, linens and towels, shared kitchen',
      'Yoga three times a week (Mon, Wed, Fri)',
      'Kite Pack: 3 days (6 h) or 5 days (10 h) of lessons with IKO-certified coaches in El Médano',
      'Board, kite, bar and wetsuit; BBtalkin radios; jet ski on standby',
    ],
    optionalServices: [packs.rental, 'Surf Packs: 3, 5 or 7 days of surf lessons'].filter((x): x is string => !!x),
    accommodation: 'surf camp house with shared and private rooms and dorms',
    mealPlan: 'breakfast',
    languages: ['en', 'de'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: WC_BOOKING_URL,
    bookingUrl: WC_BOOKING_URL,
    sourceText: [
      `kitesurf-school: ${kiteLines.join('\n')}`,
      `booking: ${blockLines(p.booking).join('\n')}`,
      `parsed: rooms ${packs.rooms.map(r => `${r.name} ${r.persons} ${r.price}`).join('; ')}; kite ${packs.kite.map(k => `${k.days}d ${k.price}`).join('; ')}`,
    ].join('\n'),
  };
}

export async function fetchWcSlots(): Promise<Slot[]> {
  const packs = parseWcPacks(await page(WC_BOOKING_URL));
  if (!packs.rooms.length || !packs.kite.length) {
    throw new Error(`wave-culture: Base Pack rooms (${packs.rooms.length}) or Kite Packs (${packs.kite.length}) not found on /booking (layout changed?)`);
  }
  return buildWcSlots(packs);
}

export const waveCultureKiteCampElMedano: OfferAdapter = {
  key: 'wave-culture-kite-camp-el-medano',
  name: 'WAVE CULTURE Tenerife Kite Week, El Médano',
  kind: 'camp',
  operator: {
    name: 'WAVE CULTURE Tenerife Surf Camp',
    websiteUrl: SITE,
    rootDomain: 'tenerife-surfcamp.com',
    contactEmail: 'info@tenerife-surfcamp.com',
    phone: '+34 679 533 220',
  },
  url: WC_BOOKING_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 4,
  confidence: 'medium', // the package price is the sum of two printed parts
  async fetchContent() {
    const booking = await page(WC_BOOKING_URL);
    const kite = await page(WC_KITE_URL);
    const camp = await page(WC_CAMP_URL);
    return parseWcContent({ booking, kite, camp });
  },
  fetchSlots: () => fetchWcSlots(),
};
