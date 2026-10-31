// ---------------------------------------------------------------------------
// Le Papayer Ecolodge "Kitesurf Camp", Cap Skirring (Casamance, Senegal): an off-grid ecolodge (solar + wind, own well)
// right on the beach at Cap Skirring that markets itself to experienced, self-sufficient kiters as "Kitesurf Paradise
// Spot" on its kite site becapkite.com. Explicitly NO lessons and NO gear rental: what it sells is the stay, airport
// transfers (10 minutes) and 4x4 / pirogue excursions to other spots (Nikine, Boudédiète, Carabane, Pointe
// Saint-Georges). Side-on wind 10-20 knots, gusts to 25, best January to April (February and March best).
//
// Kind 'accommodation' (a kite stay for experienced riders; the operator calls it a "camp").
// Data path (checked 2026-10-21):
//   content  becapkite.com home (kite rules, season table, FAQ, photos; JSON-LD SportsActivityLocation + FAQPage) and
//            lepapayer.com home (the hotel: rooms, board options, capacity, JSON-LD Hotel with geo and contactPoint).
//   slots    NONE: neither site prints a price ("contact us for rates", "Demander un devis de séjour" -> quote form on
//            lepapayer.com, answer in 24-48 h). The JSON-LD "priceRange": "€25–€100" is a schema.org range with no
//            basis, not a price, and is deliberately not used. fetchSlots reads the becapkite home on every run and
//            returns [] (price on request); if a per-night / per-week amount ever appears in the visible text it only
//            writes a note so the adapter can be extended.
//   coordinates  spotCoords from the own JSON-LD geo (12.435368, -16.7803266; the lodge on the beach).
// Capacity: becapkite says "jusqu'à 18 personnes", lepapayer.com says "capacité d'accueil totale de 16 personnes"
//   (the newer hotel text); the summary uses 16.
// Rooms (lepapayer.com text, no rates): double rooms with private bathroom, two more rooms with bathrooms upstairs in the
//   big hut, and a private beachfront bungalow. Board: B&B, half board, full board, "all inclusive" (drinks package);
//   breakfast is free on direct booking. Open all year.
// robots.txt (2026-10-21): becapkite.com disallows only /cgi-bin and /error pages; lepapayer.com has no rules.
// Requests per run: content 2 (both homes), slots 1 (becapkite home, memoised).
// Flags: liveAvailability no, instantBooking false (quote request form + WhatsApp; no engine on the own sites).
// Photos: becapkite's own gallery (the "-1200x66x" originals: kite jumps and rides on the beach, the beach and gate,
//   sunset, the garden and terrace) + 2 lodge photos from lepapayer.com; checked by eye 2026-10-21. Not used: the
//   transparent PNG cut-outs, the logo-overlay header, food and bird photos, the "-800x445" duplicates. lepapayer.com
//   tags its images "tous droits réservés" with a licence page (doubt for the lead; becapkite photos carry no such tag).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, ldOfType, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const PAP_KITE_URL = 'https://www.becapkite.com/';
export const PAP_HOTEL_URL = 'https://www.lepapayer.com/';
export const PAP_QUOTE_URL = 'https://www.lepapayer.com/#reservation-ecolodge-casamance-hotel-cap-skirring';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export function papLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/[​ ]/g, ' ')).replace(/[–—]/g, '-')).filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface PapFacts {
  noLessons: boolean;
  noRental: boolean;
  confirmedOnly: boolean;
  bestPeriod: string | null;   // "janvier à avril"
  bestMonths: string | null;   // "février et mars"
  windKnots: string | null;    // "10 à 20"
  gustKnots: string | null;    // "25"
  excursionSpots: string[];
  capacityKite: number | null;
}

/** becapkite.com home: kite rules, wind season, excursion spots, capacity. */
export function parsePapKite(html: string): PapFacts {
  const t = papLines(html).join('\n');
  // "spots inédits, totalement authentiques et sauvages (île de Carabane, Pointe Saint-Georges, Boudédiète, Nikine...)"
  const spotsLine = t.match(/spots inédits[^(\n]*\(([^)\n]+)\)/i)?.[1] ?? t.match(/Excursions Kitesurf mer & mangroves\s*:\s*([^\n]+)/i)?.[1] ?? '';
  return {
    noLessons: /Pas de cours de kitesurf/i.test(t) || /ne donne aucun cours/i.test(t),
    noRental: /Pas de location de mat[ée]riel/i.test(t) || /ne louons pas de mat[ée]riel/i.test(t),
    confirmedOnly: /kiters confirm[ée]s/i.test(t),
    bestPeriod: t.match(/meilleure p[ée]riode (?:est|s'[ée]tend) de ([a-zéû]+ à [a-zéû]+)/i)?.[1] ?? null,
    bestMonths: t.match(/meilleurs mois (?:sont|:)\s*([a-zéû]+ et [a-zéû]+)/i)?.[1] ?? null,
    windKnots: t.match(/vents? constants? de (\d+ à \d+) n/i)?.[1] ?? t.match(/(\d+ à \d+) n(?:œ|oe)uds en saison/i)?.[1] ?? null,
    gustKnots: t.match(/pointes jusqu'à (\d+) n/i)?.[1] ?? null,
    excursionSpots: spotsLine.replace(/(\.{2,}|…).*$/, '').split(/\s*,\s*/)
      .map(s => collapse(s.replace(/^île de\s+/i, '').replace(/^pointe\b/i, 'Pointe').replace(/Saint-George$/i, 'Saint-Georges'))).filter(Boolean),
    capacityKite: Number(t.match(/Jusqu'à (\d+) personnes/i)?.[1] ?? 0) || null,
  };
}

export interface PapHotel {
  capacity: number | null;
  boards: string[];
  rooms: ContentRoom[];
  geo: { lat: number; lng: number } | null;
  email: string | null;
  phone: string | null;
  languages: string[];
  openAllYear: boolean;
  freeBreakfastDirect: boolean;
}

const LANG: Record<string, string> = { french: 'fr', english: 'en', spanish: 'es', italian: 'it', dutch: 'nl', portuguese: 'pt' };

/** lepapayer.com home: rooms, board options, capacity, JSON-LD geo + contact point. */
export function parsePapHotel(html: string): PapHotel {
  const t = papLines(html).join('\n');
  const hotel = ldOfType(html, 'Hotel')[0] as Record<string, any> | undefined;
  const org = ldOfType(html, 'Organization').find(o => (o as Record<string, any>).contactPoint) as Record<string, any> | undefined;
  const lat = Number(hotel?.geo?.latitude);
  const lng = Number(hotel?.geo?.longitude);
  const cp = org?.contactPoint ?? {};
  const boards: string[] = [];
  if (/Pension simple\s*:/i.test(t)) boards.push('Bed and breakfast');
  if (/Demi-pension\s*:/i.test(t)) boards.push('Half board (breakfast + lunch or dinner)');
  if (/Pension compl[èe]te\s*:/i.test(t)) boards.push('Full board');
  if (/All inclusive\s*:/i.test(t)) boards.push('All inclusive (full board + drinks package)');
  const rooms: ContentRoom[] = [];
  if (/chambres doubles/i.test(t)) {
    rooms.push({
      name: 'Double room',
      description: 'Spacious double room with private bathroom (hot water), mosquito nets and fans',
      features: ['Private bathroom', 'Hot water', 'Mosquito net', 'Fan'],
    });
  }
  if (/deux chambres suppl[ée]mentaires/i.test(t)) rooms.push({ name: 'Upstairs room', description: 'One of two extra rooms with bathroom on the upper floor of the big hut', features: ['Private bathroom'] });
  if (/bungalow privatif les pieds dans l'eau|Bungalow bord de mer/i.test(t)) rooms.push({ name: 'Beachfront bungalow', description: 'Private bungalow on the beach with its own solar production', features: ['Beachfront', 'Private'] });
  return {
    capacity: Number(t.match(/capacit[ée] d'accueil totale de (\d+) personnes/i)?.[1] ?? t.match(/limit[ée]e à (\d+) personnes/i)?.[1] ?? 0) || null,
    boards,
    rooms,
    geo: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    email: typeof cp.email === 'string' ? cp.email : null,
    phone: typeof cp.telephone === 'string' ? cp.telephone : null,
    languages: (Array.isArray(cp.availableLanguage) ? cp.availableLanguage : []).map((l: string) => LANG[String(l).toLowerCase()]).filter(Boolean),
    openAllYear: /ouvert toute l'ann[ée]e/i.test(t),
    freeBreakfastDirect: /petit-d[ée]jeuner (?:gourmand )?est offert|petits d[ée]jeuners sont offerts/i.test(t),
  };
}

/** A printed amount with a stay basis ("75 € / nuit", "450 € la semaine", "30 000 FCFA par nuit"); null when none. */
export function papPrintedPrice(html: string): string | null {
  const t = papLines(html).join(' ');
  const m = t.match(/\d[\d\s.,]*\s?(?:€|EUR|euros?|F?CFA|XOF)\s*(?:\/|par|la|le)\s*(?:nuit|nuitée|personne|semaine|séjour|jour)/i);
  return m ? m[0] : null;
}

const MONTHS_FR: Record<string, string> = {
  janvier: 'January', février: 'February', fevrier: 'February', mars: 'March', avril: 'April', mai: 'May', juin: 'June',
  juillet: 'July', août: 'August', aout: 'August', septembre: 'September', octobre: 'October', novembre: 'November', décembre: 'December',
};
const en = (fr: string | null): string | null => fr ? fr.replace(/[a-zéû]+/gi, w => MONTHS_FR[w.toLowerCase()] ?? (w === 'à' ? 'to' : w === 'et' ? 'and' : w)).replace(/ à /g, ' to ') : null;

/** Kite photos from becapkite's gallery (the 1200 px originals). */
export function papImages(kiteHtml: string, hotelHtml: string): string[] {
  const out: string[] = [];
  const add = (u: string) => { if (!out.includes(u)) out.push(u); };
  for (const m of kiteHtml.matchAll(/(?:src|href|data-src)="([^"]*assets\/images\/kitesurf-cap-skirring-senegal-hotel-lepapayer-ecolodge(?:-[a-z0-9]+)?-1200x66\d\.(?:jpe?g|webp))"/gi)) {
    add(new URL(m[1], PAP_KITE_URL).toString());
  }
  for (const m of kiteHtml.matchAll(/(?:src|href|data-src)="([^"]*assets\/images\/kitesurf-cap-skirring-senegal-hotel-lepapayer-ecolodge-kitecamp-plage\.jpe?g)"/gi)) {
    add(new URL(m[1], PAP_KITE_URL).toString());
  }
  // No lepapayer.com photos: that site tags its images "tous droits réservés" with a licence page (Aaron 2026-10-21:
  // image rights first), so only the becapkite.com gallery is used.
  void hotelHtml;
  return out;
}

export function parsePapContent(kiteHtml: string, hotelHtml: string): OfferContent {
  const k = parsePapKite(kiteHtml);
  const h = parsePapHotel(hotelHtml);
  if (!k.noLessons && !k.noRental && !k.confirmedOnly) throw new Error('le-papayer: kite rules block not found on becapkite.com (layout changed?)');
  const period = en(k.bestPeriod) ?? 'January to April';
  const best = en(k.bestMonths);
  const cap = h.capacity ?? k.capacityKite;

  const summary = [
    `Le Papayer Ecolodge is an off-grid ecolodge (solar and wind power, its own well) directly on the beach at Cap Skirring in Casamance, southern Senegal, 10 minutes from the airport, that hosts experienced kiters who travel with their own gear${cap ? `; it takes up to ${cap} guests` : ''}.`,
    `There are no lessons and no gear rental: the lodge provides the stay, airport transfers and 4x4 or pirogue trips to other spots in the river mouths and mangroves${k.excursionSpots.length ? ` (${k.excursionSpots.join(', ')})` : ''}.`,
    `The wind is side-on, ${k.windKnots ? `${k.windKnots.replace(' à ', '-')} knots` : 'moderate'}${k.gustKnots ? ` with gusts to ${k.gustKnots}` : ''}, best from ${period}${best ? ` (best months ${best})` : ''}.`,
    `Rooms come with breakfast, half board, full board or all inclusive; no prices are published, stays are priced on request through the lodge's quote form or WhatsApp${h.freeBreakfastDirect ? ', and breakfast is free when booking direct' : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Le Papayer Ecolodge Kitesurf Camp, Cap Skirring',
    summary,
    continent: 'Africa',
    country: 'Senegal',
    region: 'Cap Skirring, Casamance',
    spot: 'Cap Skirring',
    spotCoords: h.geo,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['advanced'],
    kiteLessons: k.noLessons ? false : null,
    equipmentRental: k.noRental ? false : null,
    beginnerFriendly: false,
    includedServices: [
      ...(h.freeBreakfastDirect ? ['Breakfast (free on direct booking)'] : []),
      'Airport transfers with kite gear (Cap Skirring airport, 10 minutes)',
      'Direct beach access',
      'Wi-Fi',
    ],
    optionalServices: [
      ...h.boards.filter(b => !/^Bed and breakfast/.test(b)),
      `Kite excursions by 4x4 or pirogue${k.excursionSpots.length ? ` (${k.excursionSpots.join(', ')})` : ''}`,
      'Casamance excursions for non-kiting companions (islands, villages, no-kill fishing)',
    ],
    accommodation: 'off-grid beachfront ecolodge: double rooms with private bathroom in and around a large traditional thatched hut, plus a private beachfront bungalow',
    mealPlan: 'breakfast',
    languages: h.languages.length ? h.languages : ['fr'],
    rooms: h.rooms,
    imageUrls: papImages(kiteHtml, hotelHtml),
    heroVideoUrl: null, // YouTube embed only
    sourceUrl: PAP_KITE_URL,
    bookingUrl: PAP_QUOTE_URL,
    sourceText: [
      `becapkite: ${papLines(kiteHtml).filter(l => /kite|vent|cours|location|saison|p[ée]riode|excursion|personnes/i.test(l) && l.length > 40).slice(0, 25).join(' ')}`,
      `lepapayer: ${papLines(hotelHtml).filter(l => /chambre|bungalow|pension|capacit|ouvert/i.test(l)).join(' ')}`,
      `parsed: no lessons ${k.noLessons}, no rental ${k.noRental}, period ${k.bestPeriod}, best ${k.bestMonths}, capacity ${h.capacity}/${k.capacityKite}, geo ${JSON.stringify(h.geo)}`,
    ].join('\n'),
  };
}

export async function fetchPapSlots(ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(PAP_KITE_URL);
  const printed = papPrintedPrice(html);
  ctx?.note(printed
    ? `a price now appears on becapkite.com ("${printed}"): extend the adapter`
    : 'no price published on becapkite.com (quote on request); priceRange in the JSON-LD is not used');
  return [];
}

export const lePapayerEcolodgeKitesurfCampCapSkirring: OfferAdapter = {
  key: 'le-papayer-ecolodge-kitesurf-camp-cap-skirring',
  name: 'Le Papayer Ecolodge Kitesurf Camp (Cap Skirring)',
  kind: 'accommodation',
  operator: {
    name: 'Le Papayer Ecolodge',
    websiteUrl: PAP_HOTEL_URL,
    rootDomain: 'lepapayer.com',
    contactEmail: 'opapayer@gmail.com', // business contact in the lepapayer.com JSON-LD contactPoint, 2026-10-21
    whatsapp: '+221780157342',          // becapkite.com footer
    phone: '+221 77 169 06 49',
  },
  url: PAP_KITE_URL,
  slotMethod: 'price_table',
  instantBooking: false, // quote request form / WhatsApp
  fetchBudget: 3,
  confidence: 'low', // no price published
  async fetchContent() {
    const kite = await page(PAP_KITE_URL);
    const hotel = await page(PAP_HOTEL_URL);
    return parsePapContent(kite, hotel);
  },
  fetchSlots: ctx => fetchPapSlots(ctx),
};
