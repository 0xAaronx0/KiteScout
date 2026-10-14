// ---------------------------------------------------------------------------
// Umili Pod Cyprysami, Jastarnia (Hel Peninsula, Poland) - surf & family resort of cottages, rooms, an
// apartment and a hostel room between the Baltic beach and the Bay of Puck; the SurfPoint windsurf and
// kitesurf school (kids and adults, all levels, equipment rental) has its base at the resort.
//
// Data path (checked 2026-10-12), ZUU Works site, server-rendered:
//   content  /en (home: SurfPoint block "Windsurfing and kitesurfing training for kids and adults of all skill
//            levels", the resort map pin data-lat/data-lng of the "home" marker, contacts, packages incl.
//            "Holidays 2027 SURF INCLUSIVE"), /cottages (12 unit cards: m², max persons, gallery photos
//            /thumb?file=...&w=1440, common equipment) and /holidays-surf-inclusive (2027 package: 25 Jun - 31 Aug,
//            breakfast + dinner, daily 2 h water sports training "at our base SurfPoint").
//   slots    none. The site prints no prices ("Check prices and availability"). Booking runs on Bookassist
//            (hotel_id 4317, guide 823): the engine loads js.bookassist.com/scripts/BA/be.2-min.jsp and books
//            through www.bookassist.com/conduit/bookassist.do - robots.txt of both hosts disallows /scripts/ and
//            /conduit/ for every user agent except Googlebot, so we do not call it. The site's date picker
//            (bookassistpolska.pl/_rangepicker/podcyprysami) only builds the redirect form, no prices.
//            fetchSlots returns [] ("price on request") without a request.
// robots.txt (2026-10-12): podcyprysami.pl "Allow: /".
// Requests per run: content 3, slots 0.
// 2026/27 operation: offers "May Weekend 2027" (30.04 - 03.05), "June long weekend 2027" (26.05 - 30.05) and
//   "Holidays 2027 SURF INCLUSIVE" (25 Jun - 31 Aug) on the home page.
// Known limits: the Surf Inclusive package lists windsurfing, surfing, skimboard and SUP, not kite lessons;
//   kite training is a separate SurfPoint service. No prices, no availability.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, meta } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://podcyprysami.pl';
export const PC_HOME_URL = `${SITE}/en`;
export const PC_COTTAGES_URL = `${SITE}/cottages`;
export const PC_SURF_URL = `${SITE}/holidays-surf-inclusive`;
const BOOKING_URL = `${SITE}/bookassist-en`;

// --- local helpers ----------------------------------------------------------------------------
/** Visible text lines, split at block tags (scripts, styles, SVGs dropped). */
export function pcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|ol|section|a|button|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
/** ZUU image file id -> the site's own 1440 px rendition. */
const thumb = (file: string): string => `${SITE}/thumb?file=${file}&w=1440`;

// --- pure parsers -----------------------------------------------------------------------------
export interface PcUnit { id: string; name: string; group: string; areaM2: number | null; maxPersons: number | null; photos: string[] }

/** Unit cards on /cottages: <div class="list--bordered tag-<group>" id="<slug>"> with "14 m²", "max 3 os.", <h3>, gallery. */
export function parsePcUnits(html: string): PcUnit[] {
  const out: PcUnit[] = [];
  const starts = [...html.matchAll(/<div class="list--bordered (tag-[a-z-]+)[^"]*" id="([^"]+)"/g)];
  starts.forEach((m, i) => {
    const seg = html.slice(m.index!, starts[i + 1]?.index ?? html.length);
    const name = clean(seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '');
    if (!name) return;
    const area = seg.match(/(\d+(?:[.,]\d+)?)\s*m<sup>2<\/sup>/);
    const max = seg.match(/max\s+(\d+)\s+os\./);
    const photos = [...seg.matchAll(/data-src-full="([^"]+)"/g)].map(x => new URL(x[1].replace(/&amp;/g, '&'), SITE).toString());
    out.push({
      id: m[2],
      name,
      group: m[1].replace(/^tag-/, ''),
      areaM2: area ? Number(area[1].replace(',', '.')) : null,
      maxPersons: max ? Number(max[1]) : null,
      photos: [...new Set(photos)],
    });
  });
  return out;
}

/** Equipment every cottage has (the four labelled blocks above the cards). */
export function parsePcEquipment(html: string): string[] {
  const ls = pcLines(html);
  const out: string[] = [];
  for (const label of ['Cottages', 'Bathroom', 'Kitchenette', 'Terrace']) {
    const i = ls.findIndex((l, k) => l === label && k + 1 < ls.length && ls[k + 1].length > 8);
    if (i >= 0) out.push(`${label}: ${ls[i + 1]}`);
  }
  return out;
}

/** The resort's own map pin: the "home" marker of the home page map. */
export function parsePcCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/data-lat="(-?\d+\.\d+)" data-lng="(-?\d+\.\d+)" class="MapLocation">\s*<div>\s*<div class="MapPoint"><\/div>\s*<div class="MapPoint MapPointPulsate"><\/div>\s*<div class="MapLabel MapLabel--home">/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Package titles with year and dates on the home page ("May Weekend 2027 - HB & BBQ party!" + "30.04 - 03.05"). */
export function parsePcPackages(html: string): string[] {
  const ls = pcLines(html);
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    if (!/\b20\d{2}\b/.test(ls[i]) || ls[i].length > 80 || /©/.test(ls[i])) continue;
    const next = ls[i + 1] ?? '';
    const label = /^\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.\d{2}$/.test(next) || /^[A-Z ]{4,}$/.test(next) ? `${ls[i]} ${next}` : ls[i];
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** "Package 2027 includes:" block of the Surf Inclusive page: the season line and the included items. */
export function parsePcSurfInclusive(html: string): { season: string | null; items: string[] } {
  const ls = pcLines(html);
  const i = ls.findIndex(l => /^SURF INCLUSIVE$/i.test(l));
  const season = i >= 0 && /\d/.test(ls[i + 1] ?? '') ? ls[i + 1] : null;
  const items = ls.filter(l => /^(accommodation|meals:|daily 2h water sports)/i.test(l)).map(l => l.replace(/,$/, ''));
  return { season, items };
}

export interface PcPages { home: string; cottages: string; surf: string }

export function parsePodCyprysamiContent(p: PcPages): OfferContent {
  const home = pcLines(p.home);
  const surfLines = pcLines(p.surf);
  const units = parsePcUnits(p.cottages);
  const equipment = parsePcEquipment(p.cottages);
  const coords = parsePcCoords(p.home);
  const packages = parsePcPackages(p.home);
  const surf = parsePcSurfInclusive(p.surf);
  const surfpoint = home.find(l => /^Windsurfing and kitesurfing training/i.test(l)) ?? null;
  const school = home.find(l => /^One of the largest schools of windsurfing/i.test(l)) ?? null;
  const cottages = units.filter(u => u.group === 'lodges');
  const areas = cottages.map(u => u.areaM2).filter((x): x is number => x !== null);
  const persons = cottages.map(u => u.maxPersons).filter((x): x is number => x !== null);

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: [u.areaM2 ? `${u.areaM2} m²` : null, u.maxPersons ? `up to ${u.maxPersons} persons` : null].filter(Boolean).join(', ') || null,
    features: u.group === 'lodges' ? equipment : [],
  }));

  const imageUrls: string[] = [];
  const og = meta(p.home, 'og:image');
  const homeFiles = [...p.home.matchAll(/data-zuu-image-file="([^"]+)"/g)].map(m => m[1])
    .filter(f => /^domki-pod-cyprysami%2Fuser%2F(Atuty|Domki|Restauracja|Joga|Atrakcje|Galeria|temp)%2F/.test(f) && !/Ustronie|Ruciane|logo|\.svg/i.test(f));
  for (const u of [og ? og.replace(/&amp;/g, '&') : null, ...units.flatMap(x => x.photos.slice(0, 3)), ...homeFiles.map(thumb)]) {
    if (u && !imageUrls.includes(u)) imageUrls.push(u);
  }

  const summary = [
    `Umili Pod Cyprysami is a surf and family resort in Jastarnia on the Hel Peninsula in northern Poland, close to the Baltic beach and the Bay of Puck, with ${cottages.length || 9} types of heated, air-conditioned cottages${areas.length ? ` (${Math.min(...areas)}-${Math.max(...areas)} m², up to ${Math.max(...persons)} persons)` : ''} with terrace or garden, plus double rooms, a 6-bed apartment and a 6-bed hostel room.`,
    'The SurfPoint school has its base at the resort and offers windsurfing and kitesurfing training for kids and adults of all skill levels and water sports equipment rental.',
    `The resort has the Ale Fale restaurant, daily children's animation, yoga and a coworking space${surf.season ? `; its "Holidays 2027 Surf Inclusive" package (${surf.season}) adds breakfast, dinner and 2 hours of daily water sports training (windsurfing, surfing, skimboard, SUP)` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Umili Pod Cyprysami',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Jastarnia, Hel Peninsula',
    spot: 'Jastarnia',
    spotCoords: coords, // the "home" marker of the site's own resort map
    itinerarySpots: [],
    durationDays: null,
    // home: "Windsurfing and kitesurfing training for kids and adults of all skill levels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurfing training/i.test(surfpoint ?? ''),
    equipmentRental: /equipment rental/i.test(surfpoint ?? ''),
    beginnerFriendly: /all skill levels/i.test(surfpoint ?? ''),
    includedServices: [
      ...equipment.filter(e => /^(Cottages|Bathroom):/.test(e)),
      'Wi-Fi in common areas', '1 parking space', 'Children\'s animations', 'Bonfire area and grill', 'Playground',
    ],
    optionalServices: [
      'Windsurfing and kitesurfing training at SurfPoint (kids and adults, all levels)',
      'Water sports equipment rental (SurfPoint)',
      surf.season ? `Holidays 2027 Surf Inclusive package (${surf.season}): breakfast and dinner buffet, daily 2 h water sports training (windsurfing, surfing, skimboard, SUP safari)` : 'Surf Inclusive package (breakfast, dinner, daily water sports training)',
      'Ale Fale restaurant', 'Sauna and hot tub', 'Coworking space', 'Massages and physiotherapy',
    ],
    accommodation: 'cottages with terrace or garden, rooms, an apartment and a hostel room',
    mealPlan: null, // room-only by default; breakfast a la carte, half board in packages
    languages: ['pl', 'en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PC_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `surfpoint: ${surfpoint ?? '-'} | ${school ?? '-'}`,
      `packages: ${packages.join(' | ')}`,
      `surf inclusive: season ${surf.season ?? '-'}; ${surf.items.join(' | ')}`,
      `surf inclusive page: ${surfLines.filter(l => l.length > 40).slice(0, 12).join(' | ')}`,
      `units: ${units.map(u => `${u.name} (${u.group}, ${u.areaM2 ?? '?'} m², max ${u.maxPersons ?? '?'})`).join('; ')}`,
      `equipment: ${equipment.join(' | ')}`,
      `coords (resort map pin): ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
      `home: ${home.filter(l => l.length > 30).slice(0, 40).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const umiliPodCyprysamiJastarnia: OfferAdapter = {
  key: 'umili-pod-cyprysami-jastarnia',
  name: 'Umili Pod Cyprysami Jastarnia',
  kind: 'accommodation',
  operator: {
    name: 'Umili Pod Cyprysami',
    websiteUrl: PC_HOME_URL,
    rootDomain: 'podcyprysami.pl',
    contactEmail: 'kontakt@podcyprysami.pl',
    phone: '+48221857532',
  },
  url: PC_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 3,
  confidence: 'low', // no prices or availability readable (Bookassist robots-blocked)
  async fetchContent() {
    const [home, cottages, surf] = [
      await fetchText(PC_HOME_URL, { accept: 'text/html' }),
      await fetchText(PC_COTTAGES_URL, { accept: 'text/html' }),
      await fetchText(PC_SURF_URL, { accept: 'text/html' }),
    ];
    const units = parsePcUnits(cottages);
    if (units.length < 5) throw new Error(`umili-pod-cyprysami: unit cards not found on /cottages (${units.length} parsed)`);
    return parsePodCyprysamiContent({ home, cottages, surf });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('umili-pod-cyprysami: no prices on the site; Bookassist (/scripts/, /conduit/) is disallowed by robots.txt - price on request');
    return [];
  },
};

