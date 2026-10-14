// ---------------------------------------------------------------------------
// AlvorKiteCenter Guesthouse, Alvor (Algarve, Portugal) - the guesthouse of the AlvorKiteCenter kitesurf school
// (school at the Alvor harbour, guesthouse in the village, the school's "Pull the Bar" around the corner).
//
// Liveness (re-check 2026-10-12): the guesthouse has guest reviews from June and July 2026 (Expedia listing, seen
//   only as web-search snippets - hint, not data); own sites: alvorkitecenter.com pages edited 2025-06-19 (home)
//   to 2025-07-31 (WordPress REST `modified`), photo uploads 2025-02..2025-06; guesthousepull.com home 2025-06-10.
//   Verdict LIVE (a 2026 summer with guests; the sites themselves were last edited in summer 2025).
// Data path (checked 2026-10-12):
//   content  alvorkitecenter.com/ (single-page site: school, lessons, kite packs, guesthouse block with room
//            options + facilities, contact block), guesthousepull.com/ (guesthouse home), guesthousepull.com/
//            guesthouse/ (Smart Slider gallery, 35 photos). alvorkitecenter.com/guesthousealvor/ answers an empty
//            body, so it is not read.
//   slots    none. The guesthouse's own engine (alvorkitecenter-guesthouse.amenitiz.io, linked from guesthousepull.
//            com/booking/) answers HTTP 403 to non-browser clients - not used, never bypassed. The site prints no room
//            rates; the kite packs ("7 nights Premium Room" + lessons/rental, "Starting from 290/800/910/935 euros",
//            VAT not included) are undated and sit on pages last edited in 2025 (kite-packs 2025-03-07, home
//            2025-06-19), so they are not taken as next-season prices. fetchSlots returns [] ("price on request").
// robots.txt (2026-10-12): alvorkitecenter.com and guesthousepull.com "Allow: /".
// Requests per run: content 3, slots 0.
// Known limits: the kite center pages carry injected spam (a "toto123" gambling line + an unrelated link at the page
//   end, seen 2026-10-12); the parser reads only named blocks, so it never reaches the content. No coordinates on
//   either site (only a street address). Room types are names only (no sizes, no prices).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://alvorkitecenter.com';
export const AKC_HOME_URL = `${SITE}/`;
export const AKC_GH_HOME_URL = 'https://guesthousepull.com/';
export const AKC_GH_GALLERY_URL = 'https://guesthousepull.com/guesthouse/';
const BOOKING_URL = 'https://guesthousepull.com/booking/';

// --- pure parsers -----------------------------------------------------------------------------
/** Items of the <p> that starts with `label` (lines separated by <br>), leading dashes stripped. */
export function akcList(html: string, label: RegExp): string[] {
  for (const p of parse(html).querySelectorAll('p')) {
    const parts = p.innerHTML.split(/<br\s*\/?>/i).map(x => clean(x).replace(/^[-–—\s]+/, '').trim()).filter(Boolean);
    if (parts.length > 1 && label.test(parts[0])) return parts.slice(1);
  }
  return [];
}

/** First <p>/<h6> text matching `re` (single-line facts like the guesthouse intro). */
function firstText(html: string, re: RegExp): string | null {
  for (const el of parse(html).querySelectorAll('h1, h2, h3, h4, h5, h6, p, small')) {
    const t = collapse(el.text);
    if (re.test(t)) return t;
  }
  return null;
}

export interface AkcPack { level: string; audience: string | null; includes: string[] }

/** Kite packs: "Package / Level n" headline, then "For ..." and the "– ..." include list (prices left out on purpose). */
export function parseAkcPacks(html: string): AkcPack[] {
  const out: AkcPack[] = [];
  for (const m of html.matchAll(/<span>Package\s*\/\s*Level\s*(\d)<\/span>[\s\S]*?<div[^>]*class="bt_bb_text"[^>]*>([\s\S]*?)<\/div>/g)) {
    const block = m[2];
    const audience = clean(block.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] ?? '') || null;
    // the include list is its own <p> (levels 1-3) or follows the <strong> audience line (level 4)
    const listP = [...block.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(x => x[1]).find(x => /Transfer|nights/i.test(x) && !/Prices/i.test(x)) ?? '';
    const includes = listP.replace(/<strong>[\s\S]*?<\/strong>/, '').split(/<br\s*\/?>/i)
      .map(x => clean(x).replace(/^[-–—\s]+/, '').replace(/\.$/, '').trim()).filter(Boolean);
    out.push({ level: `Level ${m[1]}`, audience, includes });
  }
  return out.sort((a, b) => a.level.localeCompare(b.level));
}

export interface AkcPages { home: string; ghHome: string; gallery: string }

export function parseAlvorContent(p: AkcPages): OfferContent {
  const roomNames = akcList(p.home, /^Room Options:?$/i);
  const facilities = akcList(p.home, /^Facilities:?$/i).map(x => x.replace(/\.$/, ''));
  const intro = firstText(p.home, /^Stay at our AlvorKiteCenter Guesthouse/i);
  const welcome = firstText(p.home, /^Welcome to AlvorKiteCenter/i);
  const location = firstText(p.home, /^[-–\s]*Location: Perfectly located/i)?.replace(/^[-–\s]*Location:\s*/, '') ?? null;
  const rental = firstText(p.home, /Eleveight kites/i);
  const packs = parseAkcPacks(p.home);
  const ghIntro = firstText(p.ghHome, /^Welcome to Guesthouse Alvor/i);

  // "Air conditioning, Wi-Fi, satellite TV, and mini-bars in each room" -> per-room features
  const roomFeatures = facilities.filter(f => /in each room/i.test(f))
    .flatMap(f => f.replace(/\s*in each room$/i, '').split(/,\s*(?:and\s+)?|\s+and\s+/))
    .map(x => x.trim()).filter(Boolean)
    .map(x => x.replace(/^mini-bars?$/i, 'Minibar').replace(/^./, c => c.toUpperCase()));
  const shared = facilities.filter(f => !/in each room/i.test(f)).map(f => f
    .replace(/^Fully equipped shared kitchen.*$/i, 'Shared kitchen')
    .replace(/^Spacious veranda.*$/i, 'Veranda')
    .replace(/^Jacuzzi and lounge area.*$/i, 'Jacuzzi and lounge area'));
  const rooms: ContentRoom[] = roomNames.map(name => ({ name, description: null, features: roomFeatures }));
  const plain = roomNames.filter(r => !/suite/i.test(r)).map(r => r.toLowerCase().replace(/ room$/, ''));
  const roomPhrase = roomNames.length
    ? `${plain.join(', ').replace(/, ([^,]*)$/, ' and $1')} rooms${roomNames.some(r => /suite/i.test(r)) ? ' and a suite' : ''}`
    : 'family, double and triple rooms and a suite';

  // room photos (2025 uploads on the kite center page) first, then kite photos, then the guesthouse gallery
  const imgs: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    const k = u.replace(/^.*\//, '').replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) return;
    seen.add(k); imgs.push(u);
  };
  const home = imageCandidates(p.home, AKC_HOME_URL, null, 80).filter(u => /\.jpe?g$/i.test(u) && !/logo|burguer|burger|bar|pull|sup-|stand-|sslvor/i.test(u));
  home.filter(u => /room|guesthouse|jacuzzi/i.test(u)).forEach(add);
  home.filter(u => !/room|guesthouse|jacuzzi/i.test(u)).forEach(add);
  imageCandidates(p.gallery, AKC_GH_GALLERY_URL, null, 120).filter(u => /\/EST\d+/.test(u)).forEach(add);

  const packNights = packs.some(x => x.includes.some(i => /7 nights Premium Room/i.test(i)));
  const summary = [
    `AlvorKiteCenter Guesthouse is the guesthouse of the AlvorKiteCenter kitesurf school in the fishing village of Alvor in the Algarve, Portugal, within walking distance of the beach, the Alvor lagoon, bars and restaurants.`,
    `It has ${roomPhrase} with air conditioning, Wi-Fi, satellite TV and a minibar, plus a shared kitchen, a veranda and a jacuzzi and lounge area.`,
    `The school at the Alvor harbour teaches beginners to advanced riders with boat transport and a rescue boat, rents Eleveight equipment and runs ${packNights ? 'weekly kite packs with 7 nights in the guesthouse, airport transfer from Faro and lessons or rental' : 'weekly kite packs'}.`,
    'The site publishes no room rates; stays are requested from the guesthouse.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'AlvorKiteCenter Guesthouse',
    summary,
    continent: 'Europe',
    country: 'Portugal',
    region: 'Algarve',
    spot: 'Alvor',
    itinerarySpots: [],
    durationDays: null,
    // home page: "Kitesurfing lessons for all levels" + Beginner / Intermediate / Advanced lessons (2025-06)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kitesurfing lessons for all levels|BEGINNER COURSE/i.test(collapse(parse(p.home).text)),
    equipmentRental: !!rental,
    beginnerFriendly: true,
    includedServices: [...roomFeatures, ...shared],
    optionalServices: [
      'Kitesurf lessons (private, group, multi-day camps)',
      'Kite equipment rental (Eleveight)',
      'Boat transport to the kite spot (advanced riders)',
      'Wingfoil lessons',
      'Stand up paddle rental and tours',
      ...packs.map(x => `Kite pack ${x.level}${x.audience ? ` (${x.audience.replace(/^For\s+/i, '').toLowerCase()})` : ''}: ${x.includes.join(', ')}`),
    ],
    accommodation: 'guesthouse rooms and a suite run by the kite school',
    mealPlan: null, // kite packs include breakfast + 1 group dinner; plain room stays: not stated on the site
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: AKC_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `welcome: ${welcome ?? ''}`,
      `guesthouse: ${intro ?? ''}`,
      `room options: ${roomNames.join('; ')}`,
      `facilities: ${facilities.join('; ')}`,
      `location: ${location ?? ''}`,
      `rental: ${rental ?? ''}`,
      `kite packs: ${packs.map(x => `${x.level} (${x.audience ?? ''}): ${x.includes.join('; ')}`).join(' | ')}`,
      `guesthousepull.com: ${ghIntro ?? ''}`,
      'addresses: school Alvor Harbour Warehouse nr. 1; guesthouse R. Marquês de Pombal 2, 8500-021 Alvor',
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const alvorkitecenterGuesthouseAlvor: OfferAdapter = {
  key: 'alvorkitecenter-guesthouse-alvor',
  name: 'AlvorKiteCenter Guesthouse Alvor',
  kind: 'accommodation',
  operator: {
    name: 'AlvorKiteCenter',
    websiteUrl: SITE,
    rootDomain: 'alvorkitecenter.com',
    contactEmail: 'info@alvorkitecenter.com',
    phone: '+351914020502', // "Kite Guesthouse (+351) 914 020 502"
  },
  url: AKC_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const [home, ghHome, gallery] = [
      await fetchText(AKC_HOME_URL, { accept: 'text/html' }),
      await fetchText(AKC_GH_HOME_URL, { accept: 'text/html' }),
      await fetchText(AKC_GH_GALLERY_URL, { accept: 'text/html' }),
    ];
    return parseAlvorContent({ home, ghHome, gallery });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no room rates on the site and the Amenitiz engine answers 403 (2026-10-12): offer stays "price on request"');
    return [];
  },
};
