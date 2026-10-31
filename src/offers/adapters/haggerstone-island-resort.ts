// ---------------------------------------------------------------------------
// Haggerstone Island Resort (Great Barrier Reef off Cape York, Queensland): a remote private-island resort with five
// individually designed beachfront villas (Haus Mawu, Lagoon Hut, Kwilla Hut, Beach Hut, The Light-House in
// development), run by the owners. Its own page "Kiteboarding the Great Barrier Reef" says it is the only resort on
// the reef to formally offer kiteboarding: launches from the beach or jetty, Duotone gear on the island, trade winds
// April to November (15-30 knots), safety boats when a group books the whole island -> KIND = 'accommodation'.
//
// Data path (checked 2026-10-19): custom CMS ("taipan"), static pages:
//   content  /adventure/kiteboarding-the-great-barrier-reef (kite text, hero + panel photos as CSS background
//            images), /stay (the villas with their descriptions + photos), /contact (booking: enquiry form, reply
//            within a day; reduced deposits for early bookings).
//   slots    the rates exist only as a ~28 MB PDF (/files/media/original/05e/bb7/c20/Haggerstone-Rates-Page.pdf),
//            which robots.txt disallows ("Disallow: /*.pdf$"), so it is never fetched. Aaron found it on the site and
//            the 2027 rates were copied from it by hand on 2026-10-31 (HAGG_RATES below). Re-check the PDF by hand
//            each year: the daily monitor cannot see a change.
//            The contact page embeds a third-party availability calendar (www.availabilitycalendar.com/embed/...,
//            green = room for at least two people, whole island, not per villa). That host's robots.txt disallows
//            /embed/ for Googlebot and ia_archiver and has no rule for other agents; formally allowed for us, but
//            the intent is unclear and it is not the resort's own system -> not read (Aaron's call, see report).
// robots.txt (2026-10-19): www.haggerstoneisland.com.au disallows only *.pdf.
// Requests per run: content 3 (kite page, stay, contact), slots 0 (hand-copied rates).
// Flags: liveAvailability / instantBooking unset (enquiry only, no inventory read).
// spotCoords: none on the site ("Haggerstone Island, Queensland" is left to the geocoder).
// ---------------------------------------------------------------------------
import type { ContentRoom, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { memoPage, wpLines } from './kite-republic-aitutaki-winter-escape.js';

export const HAGG_SITE = 'https://www.haggerstoneisland.com.au';
export const HAGG_KITE_URL = `${HAGG_SITE}/adventure/kiteboarding-the-great-barrier-reef`;
export const HAGG_STAY_URL = `${HAGG_SITE}/stay`;
export const HAGG_CONTACT_URL = `${HAGG_SITE}/contact`;

export const HAGG_OPERATOR: OperatorRef = {
  name: 'Haggerstone Island Resort',
  websiteUrl: HAGG_SITE,
  rootDomain: 'haggerstoneisland.com.au',
  contactEmail: 'info@haggerstoneisland.com.au', // printed obfuscated as "email/info)(haggerstoneisland.com.au"
  phone: '+61740603399',
};

/** Page body between the "Enquire" menu entry and the footer menu ("Accommodation" / "Rates"). */
export function haggBody(html: string): string[] {
  const lines = wpLines(html);
  const s = lines.findIndex(l => /^Enquire$/i.test(l));
  const e = lines.findIndex((l, k) => k > s && /^Accommodation$/i.test(l) && /^Rates$/i.test(lines[k + 1] ?? ''));
  return lines.slice(s + 1, e > s ? e : undefined).filter(l => !/^Arrow Down$/i.test(l));
}

/** /stay: "Haus" "Mawu" <description> "More" blocks; villas still "in development" (sic "developement") are left out. */
export function parseHaggVillas(html: string): ContentRoom[] {
  const body = haggBody(html);
  const out: ContentRoom[] = [];
  let block: string[] = [];
  for (const l of body) {
    if (/^More$/i.test(l)) {
      // the block ends with the description (long lines); the name is the run of short lines right before it
      const isShort = (b: string): boolean => b.length < 30 && !/[.!?]$/.test(b);
      let d = block.length;
      while (d > 0 && !isShort(block[d - 1])) d--;
      let n = d;
      while (n > 0 && isShort(block[n - 1])) n--;
      const name = block.slice(n, d).join(' ').trim();
      const description = block.slice(d).join(' ');
      if (name && description && !/in develop/i.test(description)) out.push({ name, description, features: [] });
      block = [];
    } else {
      block.push(l);
    }
  }
  return out;
}

/** Hero / panel photos: the CMS sets them as CSS background images ("files/media/thumbcache/.../<name>.jpg"). */
export function haggImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/background-image:\s*url\(['"]?([^'")]+\.(?:jpe?g|png|webp))['"]?\)/gi)) {
    const u = new URL(encodeURI(decodeURI(m[1])), HAGG_SITE + '/').toString();
    if (/logo|icon|screen-?shot|lighthouse/i.test(u)) continue; // the Light-House villa is still being built
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface HaggPages { kite: string; stay: string | null; contact: string | null }

export function parseHaggContent(p: HaggPages): OfferContent {
  const kite = haggBody(p.kite);
  if (!kite.some(l => /kiteboard/i.test(l))) throw new Error('haggerstone: kiteboarding text not found (layout changed?)');
  const villas = p.stay ? parseHaggVillas(p.stay) : [];
  const contact = p.contact ? haggBody(p.contact) : [];
  const total = Number((p.stay ? haggBody(p.stay).join(' ') : '').match(/our (\d+) beach ?front villa/i)?.[1] ?? 0) || villas.length;
  const building = total - villas.length;
  const winds = kite.join(' ').match(/trade winds blow from ([A-Z][a-z]+ to [A-Z][a-z]+)[^.]*?winds of (\d+ to \d+ knots)/i);

  const summary = [
    `Haggerstone Island is a remote private-island resort on the Great Barrier Reef off Cape York, Queensland, with ${total || 'a handful of'} individually designed beachfront villas${building > 0 ? ` (${building === 1 ? 'one' : building} still in development)` : ''} and tailored daily excursions.`,
    'Its own kiteboarding page says it is the only resort on the reef that formally offers kiteboarding: launches from the beach or the jetty, cross-shore wind over the reef with reduced waves, Duotone gear kept on the island, and guests of all levels welcome.',
    `${winds ? `Trade winds blow from ${winds[1]} at ${winds[2]}` : 'The trade wind season runs from April to November'}; for a tailored kite schedule with safety boats and staff the resort recommends a group booking of the whole island.`,
    'Villa rates (2027, all meals included) come from the resort\'s rate sheet; bookings are made through the enquiry form.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Haggerstone Island Resort',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Cape York, Queensland',
    spot: 'Haggerstone Island',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: null,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [],
    optionalServices: ['Kiteboarding with Duotone gear held on the island (enquire for stock)', 'Exclusive use of the whole island for groups', 'Fishing, snorkelling and spearfishing, helicopter trips'],
    accommodation: 'individually designed beachfront villas on a private island',
    mealPlan: null,
    languages: ['en'],
    rooms: villas,
    imageUrls: [...new Set([...haggImages(p.kite), ...(p.stay ? haggImages(p.stay) : [])])].slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: HAGG_KITE_URL,
    bookingUrl: HAGG_CONTACT_URL,
    sourceText: [
      `kiteboarding: ${kite.join('\n')}`,
      villas.length ? `villas: ${villas.map(v => `${v.name}: ${v.description}`).join('\n')}` : '',
      contact.length ? `contact: ${contact.slice(0, 6).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
  };
}

// 2027 rate sheet (AUD, per night, all meals included), copied by hand from the resort's PDF on 2026-10-31.
// "LOW / HIGH" per person for the huts (minimum dual occupancy); Haus Mawu per house for 4 or 6 persons.
export const HAGG_RATES_CHECKED = '2026-10-31';
const HAGG_HIGH_2027: [string, string][] = [['2027-03-28', '2027-04-26'], ['2027-06-25', '2027-07-19'], ['2027-09-18', '2027-10-10']];
const HAGG_HUTS = ['Lagoon Hut', 'Kwilla Hut', 'Beach Hut'];

export function haggRateSlots(): Slot[] {
  const base = { currency: 'AUD', priceUnit: 'per_night' as const, availability: 'on_request' as const, spotsLeft: null };
  const huts = HAGG_HUTS.flatMap((hut): Slot[] => [
    { ...base, key: `${hut}:low`, startDate: null, endDate: null, unit: hut, price: 1500, priceBasis: 'person', occupancy: 2,
      availabilityText: 'AUD 1,500 per person per night, low season 2027, minimum dual occupancy; all meals included (rate sheet)' },
    ...HAGG_HIGH_2027.map(([startDate, endDate]): Slot => ({ ...base, key: `${hut}:high:${startDate}`, startDate, endDate, unit: hut, price: 1700,
      priceBasis: 'person', occupancy: 2, availabilityText: 'AUD 1,700 per person per night, high season 2027, minimum dual occupancy (rate sheet)' })),
  ]);
  const mawu = ([[4, 6500], [6, 8000]] as const).map(([persons, price]): Slot => ({ ...base, key: `Haus Mawu:${persons}`, startDate: null, endDate: null,
    unit: 'Haus Mawu', price, priceBasis: 'room', occupancy: persons,
    availabilityText: `AUD ${price.toLocaleString('en-US')} per night for the house, ${persons} persons, 3 bedrooms (rate sheet 2027)` }));
  return [...huts, ...mawu];
}

export const haggerstoneIslandResort: OfferAdapter = {
  key: 'haggerstone-island-resort',
  name: 'Haggerstone Island Resort',
  kind: 'accommodation',
  operator: HAGG_OPERATOR,
  url: HAGG_KITE_URL,
  slotMethod: 'price_table', // rates hand-copied from a robots-disallowed PDF (see HAGG_RATES)
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const kite = await memoPage(HAGG_KITE_URL);
    const stay = await memoPage(HAGG_STAY_URL).catch(() => null);
    const contact = await memoPage(HAGG_CONTACT_URL).catch(() => null);
    return parseHaggContent({ kite, stay, contact });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note(`rates hand-copied on ${HAGG_RATES_CHECKED} from the rate PDF (robots-disallowed, never fetched)`);
    return haggRateSlots();
  },
};
