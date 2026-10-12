// ---------------------------------------------------------------------------
// Windhoek Boutique Resort, Kralendijk (Bonaire, Caribbean Netherlands) - Piet Boon designed villa resort
// (ten one-bedroom villas, two two-bedroom villas around a pool) co-owned by Roan Jaspers, who founded the
// Kiteboarding Bonaire school in 2002; secure kite gear storage, minutes from the Atlantis kite beach.
//
// Data path (checked 2026-10-12): Duda site builder, server-rendered, English pages under /en:
//   content  /en (resort intro), /en/kitesurfing (Atlantis kite beach, co-owner, gear storage, schools),
//            /en/one-bedroom-villa and /en/two-bedroom-villa (size, guests, layout); photos from the Duda CDN
//            (irp.cdn-website.com, 1920w variants). Duda "PublicationDate: 'Aug 28, 2026'" in every page
//            = the site was republished in 2026 (sign of life; the booking widget is on every page).
//   slots    none. Every "BOOK NOW" opens RoomRaccoon (booking.roomraccoon.nl/windhoek-resort/en/), whose
//            robots.txt disallows everything for non-Google agents (api.roomraccoon.com the same, checked
//            2026-10-12) -> not called. The own pages print no rates -> fetchSlots returns []
//            ("price on request").
// robots.txt (2026-10-12): www.windhoekbonaire.com allows all (only a Content-Signal line).
// Requests per run: content 4, slots 0.
// Known limits: no prices or availability until the resort publishes rates or grants RoomRaccoon API access.
//   No coordinates on the pages (no map embed), so no spotCoords.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.windhoekbonaire.com';
export const WH_HOME_URL = `${SITE}/en`;
export const WH_KITE_URL = `${SITE}/en/kitesurfing`;
export const WH_ONE_URL = `${SITE}/en/one-bedroom-villa`;
export const WH_TWO_URL = `${SITE}/en/two-bedroom-villa`;
const BOOKING_URL = 'https://booking.roomraccoon.nl/windhoek-resort/en/';

// --- local helpers ----------------------------------------------------------------------------
/** Visible text lines of a Duda page (scripts, styles, inline SVG dropped). */
export function whLines(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<noscript[\s\S]*?<\/noscript>/gi, '');
  return body.replace(/<br\s*\/?>/gi, ' ').split(/<\/?(?:p|h[1-6]|div|li|ul|section|a|button|header|footer|nav|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
const textOf = (html: string): string => whLines(html).join(' ').replace(/\s+([.,;:!?])/g, '$1');
/** first sentence(s) matching a pattern, or null */
const grab = (t: string, re: RegExp): string | null => t.match(re)?.[0]?.trim() ?? null;

/** Duda CDN photos, largest variant once each (no flags / logos). */
export function whImages(pages: Array<[string, string]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [html, base] of pages) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/\/\/l?irp\.cdn-website\.com\/5f5c5714\//.test(u) || /logo|icon|flag/i.test(u)) continue;
      const k = u.replace(/^https:\/\/l?irp\./, '').replace(/-\d+w(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(u.replace('//lirp.', '//irp.').replace(/-\d+w(?=\.[a-z]+$)/i, '-1920w'));
    }
  }
  return out;
}

/** "PublicationDate: 'Aug 28, 2026'" from the Duda runtime config. */
export function whPublicationDate(html: string): string | null {
  return html.match(/PublicationDate:\s*'([^']+)'/)?.[1] ?? null;
}

export interface WhPages { home: string; kite: string; one: string; two: string }

export function parseWindhoekContent(p: WhPages): OfferContent {
  const home = textOf(p.home);
  const kite = textOf(p.kite);
  const one = textOf(p.one);
  const two = textOf(p.two);

  const oneSize = one.match(/area of (\d+) m²/)?.[1] ?? null;
  const oneCount = one.match(/these (\w+) villas/)?.[1] ?? null;
  const oneGuests = one.match(/up to (\w+) guests/)?.[1] ?? null;
  const twoSize = two.match(/Both (\d+) m2 villas/)?.[1] ?? null;
  const twoGuests = two.match(/up to (\w+) people/)?.[1] ?? null;
  const twoCount = /Both \d+ m2 villas/.test(two) ? 'two' : null;
  const founder = grab(kite, /Roan Jaspers, co-owner of Windhoek Resort Bonaire, was one of the pioneers of kitesurfing on the island\?? As the founder of Kiteboarding Bonaire in (\d{4})/);
  const since = kite.match(/founder of Kiteboarding Bonaire in (\d{4})/)?.[1] ?? null;
  const storage = /secure gear storage/i.test(kite);
  const schools = kite.match(/including ([A-Z][\w ]+ and [A-Z][\w ]+?)\./)?.[1] ?? null;
  const discount = /ten percent discount/i.test(`${one} ${two}`);

  const rooms: ContentRoom[] = [
    {
      name: 'One-Bedroom Villa',
      description: grab(one, /Experience tranquility[^.]*\.[^.]*\./),
      features: [
        oneGuests ? `Up to ${oneGuests} guests` : null,
        oneSize ? `${oneSize} m²` : null,
        /air conditioning and a ceiling fan/i.test(one) ? 'Air conditioning and ceiling fan' : null,
        /rain shower/i.test(one) ? 'Bathroom with rain shower' : null,
        /fully equipped kitchen/i.test(one) ? 'Fully equipped kitchen' : null,
        /living room/i.test(one) ? 'Living room with sofa and dining table' : null,
        /French doors/i.test(one) ? 'French doors from the bedroom to the outside' : null,
      ].filter((x): x is string => !!x),
    },
    {
      name: 'Two-Bedroom Villa',
      description: grab(two, /Experience ultimate comfort[^.]*\.[^.]*\./),
      features: [
        twoGuests ? `Up to ${twoGuests} guests` : null,
        twoSize ? `${twoSize} m²` : null,
        /four-poster beds/i.test(two) ? 'Two bedrooms with double four-poster beds (convertible to two singles)' : null,
        /walk-in closets/i.test(two) ? 'Walk-in closets' : null,
        /rain shower/i.test(two) ? 'Shared en-suite bathroom with rain shower' : null,
        /fully equipped kitchen/i.test(two) ? 'Fully equipped kitchen' : null,
        /ceiling fans and air conditioning/i.test(two) ? 'Air conditioning and ceiling fans' : null,
        /terrace/i.test(two) ? 'Large terrace with lounge sofa' : null,
        /cot is also available/i.test(two) ? 'Cot on request' : null,
      ].filter((x): x is string => !!x),
    },
  ];

  const summary = [
    `Windhoek Boutique Resort is a villa resort in Kralendijk, Bonaire (Caribbean Netherlands), with ${oneCount ?? 'ten'} one-bedroom villas${oneSize ? ` (${oneSize} m², up to ${oneGuests ?? 'two'} guests)` : ''} and ${twoCount ? `${twoCount} ` : ''}two-bedroom villas${twoSize ? ` (${twoSize} m², up to ${twoGuests ?? 'four'} guests)` : ''} designed by Piet Boon around a pool with a palapa bar.`,
    `Co-owner Roan Jaspers founded the Kiteboarding Bonaire school${since ? ` in ${since}` : ''}; the resort offers ${storage ? 'secure kite gear storage and is ' : ''}minutes from the Atlantis kite beach on the south-west coast, where ${schools ?? 'local schools'} teach and rent gear.`,
    'Villas have full kitchens and are booked online through the resort\'s own engine' + (discount ? ', with a 10% discount for direct bookings.' : '.'),
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Windhoek Boutique Resort Bonaire',
    summary,
    continent: 'North America',
    country: 'Bonaire',
    region: 'Caribbean Netherlands',
    spot: 'Kralendijk',
    itinerarySpots: [],
    durationDays: null,
    // kitesurfing page: "ideal conditions for both beginners and experienced kitesurfers" (2026-10-12)
    skillLevels: /both beginners and experienced/i.test(kite) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: null, // lessons via the island schools, not the resort
    equipmentRental: null,
    beginnerFriendly: /both beginners and experienced/i.test(kite) ? true : null,
    includedServices: [
      ...(storage ? ['Secure kite gear storage'] : []),
      ...(/swimming pool|the pool/i.test(home) ? ['Swimming pool'] : []),
    ],
    optionalServices: [
      'Kite lessons and gear rental at Kiteboarding Bonaire or FX Kiteboarding (Atlantis beach)',
      'Car rental (bookable on the website)',
      'Massage, yoga, diving and snorkeling trips',
      'Honesty bar',
    ],
    accommodation: 'one- and two-bedroom boutique villas around a pool',
    mealPlan: 'self_catering',
    languages: ['en', 'nl', 'es', 'de', 'fr'],
    rooms,
    imageUrls: whImages([[p.home, WH_HOME_URL], [p.one, WH_ONE_URL], [p.two, WH_TWO_URL], [p.kite, WH_KITE_URL]]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WH_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${grab(home, /Windhoek Boutique Resort Bonaire is the perfect destination[^]*?relax\./) ?? ''}`,
      `kite: ${grab(kite, /Bonaire Offers Perfect Wind Conditions[^]*?kitesurfing session\./) ?? ''}`,
      `founder: ${founder ?? '-'}`,
      `one-bedroom: ${grab(one, /One-Bedroom Villa Experience[^]*?website today[^.]*\./) ?? ''}`,
      `two-bedroom: ${grab(two, /Two bedroom villa Experience[^]*?ten percent discount\./) ?? ''}`,
      `site published: ${whPublicationDate(p.home) ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const windhoekBoutiqueResortBonaire: OfferAdapter = {
  key: 'windhoek-boutique-resort-bonaire',
  name: 'Windhoek Boutique Resort, Bonaire',
  kind: 'accommodation',
  operator: {
    name: 'Windhoek Boutique Resort Bonaire',
    websiteUrl: SITE,
    rootDomain: 'windhoekbonaire.com',
    contactEmail: 'info@windhoekbonaire.com',
    phone: '+5997775483',
  },
  url: WH_KITE_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(WH_HOME_URL, { accept: 'text/html' });
    const kite = await fetchText(WH_KITE_URL, { accept: 'text/html' });
    const one = await fetchText(WH_ONE_URL, { accept: 'text/html' });
    const two = await fetchText(WH_TWO_URL, { accept: 'text/html' });
    return parseWindhoekContent({ home, kite, one, two });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    // RoomRaccoon robots.txt disallows all non-Google agents: never called.
    ctx.note('no slot source: RoomRaccoon robots.txt disallows our UA (2026-10-12) and the site prints no rates');
    return [];
  },
};
