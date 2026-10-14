// ---------------------------------------------------------------------------
// WestPoint Dakhla, Foum Labouir (Atlantic side of the Dakhla peninsula, Morocco) - eco-lodge hotel of the
// Dakhla Hospitality Group: 40 two-storey bungalows (Jungle Lodge, Waves View Lodge) facing an Atlantic point
// break, full board and airport transfers included; surf, kite and wingfoil academy on site, kite and wing
// lessons in front of the hotel or on the lagoon at the group's Dakhla Attitude / PK25 bases (free "Drifter"
// shuttle).
//
// Data path (checked 2026-10-12): WordPress/Elementor site westpointdakhla.ma (French).
//   slots    /jungle-lodge/ and /ocean-lodge/: per lodge a rate block "Basse Saison" / "Haute Saison" with
//            lines "Single occupation - 1 pax" + "1100 MAD" .. "Quadruple occupation - 4 pax" (MAD per
//            bungalow per night, full board + airport transfers; each block is printed twice for desktop
//            and mobile), then "Saisons" with "HAUTE SAISON" / "BASSE SAISON" and ranges
//            ("15/09 au 30/11/2026", "23/12/2026 au 17/02/2027"). A second block "** Tarifs 2027 Applicables
//            à compter du 9 novembre 2026 **" (the Waves View page says "2027", a typo) carries the 2027 rates
//            and the 2026/27 + 2027/28 seasons.
//   content  / (hotel, lodges, academy, restaurants; Cloudflare-obfuscated booking e-mail decoded from
//            data-cfemail), /kitesurf-academy/ (kite and wing coaching, Drifter), the two lodge pages.
// Booking engine: eZee / Yanolja (live.ipms247.com/booking/book-rooms-westpointdakhla) - live.ipms247.com
//   answers HTTP 403 to our user agent (2026-10-12) -> not used; slots stay 'unknown'.
// robots.txt (2026-10-12): "Allow: /*" for every agent (crawl-delay 3 only for Googlebot).
// Requests per run: content 4, slots 2 (the lodge pages are memoised for 10 minutes, so a full run makes 4).
// Parsed: slot = lodge x season band ("jungle-lodge-2p|2027-03-20"), MAD per bungalow per night for 2 guests
//   (double occupancy); band model, clipping and slot builder are shared with dakhla-attitude-dakhla.ts
//   (dhgBands / dhgSlots): the 2026 grid runs until the day before the 2027 grid's first season band
//   (2026-11-30), bands that ended before today are dropped. 1-4 guest prices go into the room features.
// Known limits: the 2027 rates equal the 2026 rates on both pages (2026-10-12), so the 9 Nov 2026 switch
//   date does not change a price. The 2027 season list repeats "18/02/2027 au 19/03/2027" (deduplicated).
//   Kite / wing lesson prices are published only as images on /kitesurf-academy/ (not read).
// ---------------------------------------------------------------------------
import { iso, meta, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';
import { dhgFetch, dhgLevel, dhgLines, dhgPriceFeatures, dhgSlots, type DhgBand, type DhgTable } from './dakhla-attitude-dakhla.js';

const SITE = 'https://westpointdakhla.ma';
export const WP_HOME_URL = `${SITE}/`;
const KITE_URL = `${SITE}/kitesurf-academy/`;
export const WP_LODGES: Array<{ unit: string; url: string }> = [
  { unit: 'Jungle Lodge', url: `${SITE}/jungle-lodge/` },
  { unit: 'Waves View Lodge', url: `${SITE}/ocean-lodge/` },
];
const BOOKING_URL = 'https://live.ipms247.com/booking/book-rooms-westpointdakhla';
const PAX: Record<string, number> = { single: 1, double: 2, triple: 3, quadruple: 4 };

// --- pure parsers -----------------------------------------------------------------------------
/** "19/03 au 31/08/2026" (start without year), "23/12/25 au 17/02/2026", "01/12/2026 au 22/12/2026". */
export function wpRange(line: string): { start: string; end: string } | null {
  const m = line.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+au\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!m) return null;
  const y = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));
  const ey = y(m[6]);
  const sy = m[3] ? y(m[3]) : (Number(m[2]) > Number(m[5]) ? ey - 1 : ey);
  const start = iso(sy, Number(m[2]), Number(m[1]));
  const end = iso(ey, Number(m[5]), Number(m[4]));
  return end >= start ? { start, end } : null;
}

/** Rate grids of one lodge page: the current grid, then the "Tarifs 2027 ..." grid, each with its seasons. */
export function parseWpTables(html: string, unit: string): DhgTable[] {
  const ls = dhgLines(html);
  const cuts = [0, ...ls.map((l, i) => (/tarifs 20\d\d/i.test(l) ? i : -1)).filter(i => i > 0), ls.length];
  const out: DhgTable[] = [];
  for (let s = 0; s < cuts.length - 1; s++) {
    const seg = ls.slice(cuts[s], cuts[s + 1]);
    const split = seg.findIndex(l => /^saisons$/i.test(l));
    if (split < 0) continue;
    const prices: DhgTable['prices'] = {};
    let level = null as ReturnType<typeof dhgLevel>;
    for (let i = 0; i < split; i++) {
      if (/^(basse|haute|moyenne|interm\w*) saison$/i.test(seg[i])) { level = dhgLevel(seg[i]); continue; }
      const occ = seg[i].match(/^(single|double|triple|quadruple) occupation/i);
      const amount = seg[i + 1]?.match(/^(\d[\d .,]*)\s*MAD$/i);
      if (occ && amount && level) {
        const pax = PAX[occ[1].toLowerCase()];
        const row = (prices[level] ??= {});
        if (row[pax] === undefined) row[pax] = Number(amount[1].replace(/[ .,]/g, ''));
      }
    }
    const seasons: DhgBand[] = [];
    let sl = null as ReturnType<typeof dhgLevel>;
    for (let i = split + 1; i < seg.length; i++) {
      if (/^conditions d/i.test(seg[i])) break;
      if (/^(basse|haute) saison$/i.test(seg[i])) { sl = dhgLevel(seg[i]); continue; }
      const r = wpRange(seg[i]);
      if (r && sl && !seasons.some(b => b.start === r.start)) seasons.push({ level: sl, ...r });
    }
    if (Object.keys(prices).length && seasons.length) out.push({ unit, prices, seasons });
  }
  return out;
}

export function wpTablesByUnit(pages: Array<{ unit: string; html: string }>): Map<string, DhgTable[]> {
  return new Map(pages.map(p => [p.unit, parseWpTables(p.html, p.unit)] as const).filter(([, t]) => t.length > 0));
}

/** Cloudflare email protection: data-cfemail hex = key byte + XOR-ed characters. */
export function wpCfEmail(html: string): string | null {
  const hex = html.match(/data-cfemail="([0-9a-f]+)"/)?.[1];
  if (!hex) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out) ? out : null;
}

const PHOTO_JUNK = /logo|cropped|My-project|PosterImage|Group-\d|Capture|badge|Tripadvisor|chef|shutterstock|KITSURF|WINGFOIL|lesson|elementor\/thumbs|hero|red-|waves-\./i;

/** Photos per page (og:image + uploads WebP/JPEG in document order), size variants folded, pages interleaved. */
export function wpImages(pages: string[], max = 30): string[] {
  const seen = new Set<string>();
  const perPage = pages.map(html => {
    const list: string[] = [];
    const og = meta(html, 'og:image');
    for (const u of [og ?? '', ...[...html.matchAll(/https:\/\/westpointdakhla\.ma\/wp-content\/uploads\/[^"'()\s]+?\.(?:webp|jpe?g)/gi)].map(m => m[0])]) {
      const url = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (!url || PHOTO_JUNK.test(url) || seen.has(url)) continue;
      seen.add(url); list.push(url);
    }
    return list;
  });
  const out: string[] = [];
  for (let i = 0; out.length < max && perPage.some(l => l.length > i); i++) for (const l of perPage) if (l[i] && out.length < max) out.push(l[i]);
  return out;
}

export interface WpPages { home: string; kite: string; lodges: Array<{ unit: string; html: string }> }

const WP_ROOM_TEXT: Record<string, string> = {
  'Jungle Lodge': 'Two-storey bungalow with a private terrace and small private garden facing the ocean: queen-size bed on the ground floor, two sofa beds on the mezzanine, flat-screen TV, private bathroom; up to 4 guests.',
  'Waves View Lodge': 'Two-storey bungalow on the cliff edge in front of the wave ("you can surf at the foot of your bungalow"): queen-size bed on the ground floor, two sofa beds on the mezzanine, flat-screen TV, private bathroom, private terrace and garden; up to 4 guests.',
};

export function parseWestpointContent(p: WpPages): OfferContent {
  const home = dhgLines(p.home);
  const kite = dhgLines(p.kite);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  const byUnit = wpTablesByUnit(p.lodges);
  const nLodges = homeText.match(/hôtel écologique de (\d+) bungalows/i)?.[1] ?? '40';
  const rooms: ContentRoom[] = [...byUnit.entries()].map(([unit, tables]) => ({
    name: unit,
    description: WP_ROOM_TEXT[unit] ?? null,
    features: ['Full board (breakfast, lunch, dinner; drinks extra), airport transfers and Wi-Fi included', ...dhgPriceFeatures(tables)],
  }));
  const latest2 = [...byUnit.values()].map(ts => ts[ts.length - 1]).flatMap(t => Object.values(t.prices).map(x => x?.[2]).filter((n): n is number => typeof n === 'number'));

  const summary = [
    `WestPoint Dakhla is an eco-lodge hotel of the Dakhla Hospitality Group with ${nLodges} two-storey bungalows for up to 4 guests on the Atlantic side of the Dakhla peninsula in southern Morocco, facing the long wave of Foum Labouir at the tip of the sand point.`,
    `Stays are full board with airport transfers${latest2.length ? `; 2 guests pay from MAD ${Math.min(...latest2).toLocaleString('en-US')} per bungalow per night` : ''}; the hotel has a pool, a main restaurant and the Pescador fish restaurant.`,
    'Its surf, kite and wingfoil academy (IKO or VDWS instructors) teaches in front of the hotel or on the flat-water lagoon at the group\'s Dakhla Attitude and PK25 bases, reached with the free Drifter service.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'WestPoint Dakhla',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Dakhla-Oued Ed-Dahab',
    spot: 'Foum Labouir, Dakhla',
    itinerarySpots: [],
    durationDays: null,
    // academy page: "que vous soyez débutant ou confirmé", beginner courses
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /cours débutants kitesurf/i.test(kiteText),
    equipmentRental: /matériel de qualité|location/i.test(`${homeText} ${kiteText}`),
    beginnerFriendly: /débutant/i.test(kiteText),
    includedServices: ['Full board (breakfast, lunch, dinner; drinks extra)', 'Airport transfers', 'Wi-Fi', 'Drifter shuttle to the group\'s lagoon sports centers'],
    optionalServices: [
      'Kitesurf and wingfoil courses and private coaching (IKO / VDWS)',
      'Strapless kite coaching',
      'Surf coaching and surf trips',
      'Equipment rental (surf, kite, wingfoil, SUP, wetsuits)',
    ],
    accommodation: 'two-storey eco-lodge bungalows (Jungle Lodge, Waves View Lodge)',
    mealPlan: 'full_board',
    // home page: "Nos cours sont dispensés en français, anglais ou arabe"
    languages: ['fr', 'en', 'ar'],
    rooms,
    imageUrls: wpImages([p.home, ...p.lodges.map(l => l.html), p.kite]),
    heroVideoUrl: null,
    sourceUrl: WP_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${homeText}`,
      `kitesurf academy: ${kiteText}`,
      ...p.lodges.map(l => `${l.unit}: ${dhgLines(l.html).join(' ')}`),
      `contact e-mail (data-cfemail): ${wpCfEmail(p.home) ?? 'none'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function wpLodgePages(): Promise<Array<{ unit: string; html: string }>> {
  const out: Array<{ unit: string; html: string }> = [];
  for (const l of WP_LODGES) out.push({ unit: l.unit, html: await dhgFetch(l.url) });
  return out;
}

export async function fetchWpSlots(today = todayIso()): Promise<Slot[]> {
  const byUnit = wpTablesByUnit(await wpLodgePages());
  const missing = WP_LODGES.filter(l => !byUnit.has(l.unit)).map(l => l.unit);
  if (missing.length) throw new Error(`westpoint-dakhla: no rate grid with season list for ${missing.join(', ')} (layout changed?)`);
  return dhgSlots(byUnit, today);
}

export const westpointDakhla: OfferAdapter = {
  key: 'westpoint-dakhla',
  name: 'WestPoint Dakhla',
  kind: 'accommodation',
  operator: {
    name: 'WestPoint Dakhla (Dakhla Hospitality Group)',
    websiteUrl: SITE,
    rootDomain: 'westpointdakhla.ma',
    contactEmail: 'booking@westpointdakhla.ma',
    phone: '+212537864467',
  },
  url: WP_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 5,
  async fetchContent() {
    const home = await dhgFetch(WP_HOME_URL);
    const kite = await dhgFetch(KITE_URL);
    return parseWestpointContent({ home, kite, lodges: await wpLodgePages() });
  },
  async fetchSlots() {
    return fetchWpSlots();
  },
};
