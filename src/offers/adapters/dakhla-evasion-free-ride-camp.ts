// ---------------------------------------------------------------------------
// Dakhla Evasion "Free Ride & Bien être" kite camp, Dakhla lagoon (Morocco) - the resort's all-inclusive kite week:
// 7 nights in a private bungalow facing the lagoon, full board, airport transfers, pool / gym / yoga room, one 75-min
// massage and one 60-min hammam, plus the kite part of the chosen offer:
//   free-ride       "Offre Free Ride & Bien être" - beginners, 16 h semi-private kitesurf lessons (EUR 1,550 pp)
//   ride-evolution  "Offre Ride Evolution & Bien être" - intermediates, 12 h semi-private lessons + 3 days unlimited
//                   gear rental (EUR 1,500 pp)
//   freedom-ride    "Freedom Ride Pack & Bien être" - independent riders with their own gear: storage, boat
//                   assistance, downwinders to the Dune Blanche and the Speed Spot with 4x4 return, supervised riding
//                   at the Secret Spot (EUR 990 pp)
// All three are also sold for wing foil. The page's fourth pack (Wave Escape, surf lessons) is not a kite product.
//
// Data path (checked 2026-10-19): WordPress / Avada, one page /resort-dakhla-evasion/offres-de-stage-tout-compris/
//   (robots.txt: /wp-admin only). Each offer is an <h2> block "L'offre ... à partir de 1 550 € par personne ... 7 nuits
//   ...". The intro says the offers are valid "du 21/11/2026 au 13/03/2027"; "toute réservation s'effectue selon
//   disponibilité sur la base de 7 nuits". "RÉSERVER" goes to /reservation/ (a MisterBooking room engine iframe +
//   forms; packages are paid "via un lien de paiement sécurisé" after the request) -> availability 'on_request',
//   instantBooking left unset (the room engine may confirm instantly; for the packages it is not shown).
// Slots: one season band per offer (datePrecision 'season', the validity window; any 7-night stay inside it),
//   EUR per person, "à partir de" price, package of 7 nights; dropped once the window has ended. A new window printed
//   on the page is picked up by the daily run.
// Photos: the offers page (5) + the resort's Logements page (bungalows, 21).
// Requests per run: content 2, slots 1 (offers page memoised).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const DEV_URL = 'https://www.dakhla-evasion.com/resort-dakhla-evasion/offres-de-stage-tout-compris/';
const BOOKING_URL = 'https://www.dakhla-evasion.com/reservation/';
export const DEV_LODGING_URL = 'https://www.dakhla-evasion.com/resort-dakhla-evasion/logements/';
export const DEV_OPERATOR: OperatorRef = {
  name: 'Dakhla Evasion',
  websiteUrl: 'https://www.dakhla-evasion.com',
  rootDomain: 'dakhla-evasion.com',
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface DevUnitDef { id: string; label: string; title: RegExp }
export const DEV_UNITS: DevUnitDef[] = [
  { id: 'free-ride', label: 'Free Ride & Bien-être (beginners, 16 h semi-private lessons)', title: /^Offre Free Ride\b/i },
  { id: 'ride-evolution', label: 'Ride Evolution & Bien-être (intermediates, 12 h semi-private lessons + 3 days rental)', title: /Ride Evolution/i },
  { id: 'freedom-ride', label: 'Freedom Ride Pack & Bien-être (independent riders, own gear, downwinders)', title: /Freedom Ride/i },
];

export interface DevOffer { id: string; label: string; heading: string; price: number | null; nights: number | null; hours: number | null; text: string }
export interface DevPage { validFrom: string | null; validTo: string | null; offers: DevOffer[]; missing: string[]; text: string }

const dmy = (s: string): string => { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; };

export function parseDevPage(html: string): DevPage {
  const blocks = html.split(/(?=<h2[\s>])/i).slice(1);
  const offers: DevOffer[] = [];
  const missing: string[] = [];
  for (const u of DEV_UNITS) {
    const b = blocks.find(x => u.title.test(collapse(parse(x.slice(0, x.indexOf('</h2>') + 5)).text)));
    if (!b) { missing.push(u.id); continue; }
    const root = parse(b);
    const heading = collapse(root.querySelector('h2')?.text ?? '');
    const text = collapse(root.text);
    const price = text.match(/à partir de\s*([\d\s.,]+?)\s*€\s*par personne/i);
    const nights = text.match(/(\d+)\s*nuits/i);
    const hours = text.match(/(\d+)\s*heures de cours de kitesurf/i);
    offers.push({
      id: u.id, label: u.label, heading,
      price: price ? parseAmount(price[1]) : null,
      nights: nights ? Number(nights[1]) : null,
      hours: hours ? Number(hours[1]) : null,
      text: text.slice(0, 2500),
    });
  }
  const root = parse(html);
  root.querySelectorAll('script, style, noscript').forEach(e => e.remove());
  const all = collapse((root.querySelector('main') ?? root).text);
  const v = all.match(/valables? du (\d{2}\/\d{2}\/\d{4}) au (\d{2}\/\d{2}\/\d{4})/i);
  return { validFrom: v ? dmy(v[1]) : null, validTo: v ? dmy(v[2]) : null, offers, missing, text: all };
}

export function buildDevSlots(p: DevPage, today: string): Slot[] {
  if (p.validTo && p.validTo < today) return [];
  return p.offers.filter(o => o.price !== null).map(o => {
    const nights = o.nights ?? 7;
    const window = p.validFrom && p.validTo ? `valid ${p.validFrom} to ${p.validTo}` : 'validity not printed';
    return {
      key: `${o.id}|${p.validFrom ?? 'undated'}`,
      startDate: p.validFrom,
      endDate: p.validTo,
      unit: o.label,
      price: o.price,
      currency: 'EUR',
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: null,
      availability: 'on_request',
      availabilityText: `from EUR ${o.price} per person for ${nights} nights (${window}); booked subject to availability, paid via a payment link`,
      spotsLeft: null,
      datePrecision: 'season',
      packageNights: nights,
    } satisfies Slot;
  });
}

export async function fetchDevSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const p = parseDevPage(await page(DEV_URL));
  if (p.offers.length === 0) throw new Error('dakhla-evasion: none of the kite offers found (layout changed?)');
  if (p.missing.length) ctx?.note(`offers not found on the page: ${p.missing.join(', ')}`);
  for (const o of p.offers) if (o.price === null) ctx?.note(`${o.id}: no "à partir de ... € par personne" price`);
  if (!p.validTo) ctx?.note('validity window ("valables du ... au ...") not found; slots are undated');
  const slots = buildDevSlots(p, today);
  if (p.validTo && p.validTo < today) ctx?.note(`validity window ${p.validFrom}..${p.validTo} has ended; no new window printed yet`);
  return slots;
}

function devImages(html: string, base: string): string[] {
  return imageCandidates(html, base, null, 40)
    .filter(u => !/\.svg(\?|$)|logo|favicon|motifs|fusion-gfonts/i.test(u));
}

/** `lodging` = the resort's Logements page (bungalow photos; the offers page has only 5 photos). */
export function parseDevContent(html: string, lodging: string | null = null): OfferContent {
  const p = parseDevPage(html);
  if (p.offers.length === 0) throw new Error('dakhla-evasion: none of the kite offers found (layout changed?)');
  const by = (id: string) => p.offers.find(o => o.id === id);
  const fr = by('free-ride');
  const re = by('ride-evolution');
  const prices = p.offers.map(o => `${o.heading.replace(/^Offre\s+/i, '')} EUR ${o.price?.toLocaleString('en-US') ?? '?'}`).join(', ');
  const summary = [
    `Dakhla Evasion's all-inclusive kite weeks on the Dakhla lagoon: 7 nights in a private bungalow facing the lagoon, full board, airport transfers, pool, gym and yoga room, one 75-minute massage and one 60-minute hammam.`,
    `Free Ride is for beginners (${fr?.hours ?? 16} hours of semi-private kite lessons), Ride Evolution for intermediates (${re?.hours ?? 12} hours of semi-private lessons plus 3 days of unlimited gear rental), and Freedom Ride for independent riders with their own gear (storage, boat assistance, downwinders to the Dune Blanche and the Speed Spot with 4x4 return); each is also sold for wing foil.`,
    `Prices per person ("from"): ${prices}${p.validFrom && p.validTo ? `, for stays between ${p.validFrom} and ${p.validTo}` : ''}; booking on request.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Dakhla Evasion Free Ride & Wellness Kite Camp',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Dakhla-Oued Ed-Dahab',
    spot: 'Dakhla Lagoon',
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      '7 nights in a private bungalow facing the lagoon',
      'Full board',
      'Airport transfers',
      'One 75-minute massage and one 60-minute hammam session',
      'Pool, gym, yoga room and Wi-Fi',
      `Free Ride: ${fr?.hours ?? 16} h semi-private kitesurf lessons`,
      `Ride Evolution: ${re?.hours ?? 12} h semi-private lessons + 3 days unlimited gear rental`,
      'Freedom Ride: gear storage, boat assistance, downwinders (Dune Blanche, Speed Spot) with 4x4 return, supervised riding at the Secret Spot',
    ],
    optionalServices: [
      'Extra equipment rental (e.g. a second kite), at the listed rates',
      'Mandatory Christmas (EUR 38) and New Year (EUR 65) dinners for stays over those dates',
      'Tourist tax (not included)',
    ],
    accommodation: 'private bungalow facing the lagoon',
    mealPlan: 'full_board',
    languages: ['fr', 'en'],
    rooms: [],
    imageUrls: [...new Set([...devImages(html, DEV_URL), ...(lodging ? devImages(lodging, DEV_LODGING_URL) : [])])].slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: DEV_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `validity: ${p.validFrom ?? '-'}..${p.validTo ?? '-'}`,
      ...p.offers.map(o => `${o.heading} (EUR ${o.price}, ${o.nights} nights, ${o.hours ?? '-'} h): ${o.text}`),
    ].join('\n\n'),
  };
}

export const dakhlaEvasionFreeRideCamp: OfferAdapter = {
  key: 'dakhla-evasion-free-ride-camp',
  name: 'Dakhla Evasion Free Ride & Bien-être kite camp, Dakhla',
  kind: 'camp',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: DEV_OPERATOR,
  url: DEV_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent(ctx) {
    const html = await page(DEV_URL);
    const lodging = await page(DEV_LODGING_URL).catch(e => { ctx.note(`lodging page: ${(e as Error).message}`); return null; });
    return parseDevContent(html, lodging);
  },
  fetchSlots: ctx => fetchDevSlots(todayIso(), ctx),
};
