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
//   photos   (2026-10-21) /gallery adds the resort's own water-sports photos: kiters and a kite lesson on the Bay of
//            Puck, the SurfPoint group on the beach. Why only 1 photo was stored before: every candidate was a
//            /thumb?file=... URL and the shared image dedup keys a URL on its PATH only, so all 30 collapsed into
//            the first one. Each candidate now carries "&url=%2F<file>" (the server ignores it: identical bytes,
//            checked 2026-10-21), which the dedup reads as the photo's own key; and every candidate asks for the
//            same 1440x960 crop ("&w=1440&h=960", centre crop), so all have equal area and the vision QC's
//            "10 largest" are simply the first 10 in our order: og photo, then kite/beach photos interleaved with
//            the first photo of each unit type. The kite photos are named in PC_KITE_PHOTOS (checked by eye
//            2026-10-21); if the gallery renames them, the pool falls back to cottages + home photos.
//   slots    none. The site prints no prices ("Check prices and availability"). Booking runs on Bookassist
//            (hotel_id 4317, guide 823): the engine loads js.bookassist.com/scripts/BA/be.2-min.jsp and books
//            through www.bookassist.com/conduit/bookassist.do - robots.txt of both hosts disallows /scripts/ and
//            /conduit/ for every user agent except Googlebot, so we do not call it. The site's date picker
//            (bookassistpolska.pl/_rangepicker/podcyprysami) only builds the redirect form, no prices.
//            fetchSlots returns [] ("price on request") without a request.
// robots.txt (2026-10-12): podcyprysami.pl "Allow: /".
// Requests per run: content 4 (home, cottages, surf inclusive, gallery for photos; the gallery is best effort), slots 0.
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
export const PC_GALLERY_URL = `${SITE}/gallery`;
const BOOKING_URL = `${SITE}/bookassist-en`;
/** gallery photos that show kiting / the SurfPoint beach (file names, checked by eye 2026-10-21), best first */
export const PC_KITE_PHOTOS = ['54-DSC02354.jpg', '109-DSC06210.jpg', '86-Kopia+DSC07881.jpg', '70-DSC06706.jpg', '55-DSC02778.jpg', 'DJI_0044.jpg'];
const PC_MAX_PHOTOS = 24; // = the ingest's download cap

// --- local helpers ----------------------------------------------------------------------------
/** Visible text lines, split at block tags (scripts, styles, SVGs dropped). */
export function pcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|ol|section|a|button|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
/**
 * ZUU image file id -> photo candidate: a 1440x960 centre crop (equal area for every candidate, so the vision QC's
 * "10 largest" are the first 10 in order) plus "url=%2F<file>" - ignored by the server, but the shared image dedup
 * keys a URL on that path instead of the common "/thumb" path (which collapsed every candidate into one).
 */
export const pcPhoto = (file: string): string => `${SITE}/thumb?file=${file}&w=1440&h=960&url=%2F${file}`;
/** the file id of a /thumb?file=... URL (still percent-encoded, as the site writes it) */
export const pcFileOf = (url: string): string | null => url.match(/[?&]file=([^&"]+)/)?.[1] ?? null;

/** File ids of the /gallery cards tagged "attractions" (water sports, beach, events), page order. */
export function parsePcGalleryAttractions(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/class="[^"]*\btag-attractions\b[^"]*"/g)) {
    const f = pcFileOf(html.slice(m.index!, m.index! + 1500).match(/data-zuu-image-src="([^"]+)"/)?.[1] ?? '');
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Photo pool: og photo, kite/beach gallery photos interleaved with each unit's first photo, then the rest. */
export function pcPhotoCandidates(ogUrl: string | null, units: PcUnit[], galleryHtml: string | null, homeFiles: string[]): string[] {
  const gallery = galleryHtml ? parsePcGalleryAttractions(galleryHtml) : [];
  const kite = PC_KITE_PHOTOS.map(n => gallery.find(f => f.endsWith(`%2F${n}`))).filter((f): f is string => !!f);
  const firsts = units.map(u => (u.photos[0] ? pcFileOf(u.photos[0]) : null)).filter((f): f is string => !!f);
  const og = ogUrl ? pcFileOf(ogUrl) : null;
  const files: string[] = og ? [og] : [];
  for (let i = 0; i < Math.max(kite.length, firsts.length); i++) {
    if (kite[i]) files.push(kite[i]);
    if (firsts[i]) files.push(firsts[i]);
  }
  files.push(...units.flatMap(u => u.photos.slice(1, 3).map(pcFileOf).filter((f): f is string => !!f)), ...homeFiles);
  return [...new Set(files)].slice(0, PC_MAX_PHOTOS).map(pcPhoto);
}

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

export interface PcPages { home: string; cottages: string; surf: string; gallery?: string | null }

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

  const og = meta(p.home, 'og:image');
  const homeFiles = [...p.home.matchAll(/data-zuu-image-file="([^"]+)"/g)].map(m => m[1])
    .filter(f => /^domki-pod-cyprysami%2Fuser%2F(Atuty|Domki|Restauracja|Joga|Atrakcje|Galeria|temp)%2F/.test(f) && !/Ustronie|Ruciane|logo|\.svg/i.test(f));
  const imageUrls = pcPhotoCandidates(og ? og.replace(/&amp;/g, '&') : null, units, p.gallery ?? null, homeFiles);

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
    spotCoordsPrecise: true,
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
    imageUrls,
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
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low', // no prices or availability readable (Bookassist robots-blocked)
  async fetchContent(ctx) {
    const [home, cottages, surf] = [
      await fetchText(PC_HOME_URL, { accept: 'text/html' }),
      await fetchText(PC_COTTAGES_URL, { accept: 'text/html' }),
      await fetchText(PC_SURF_URL, { accept: 'text/html' }),
    ];
    const units = parsePcUnits(cottages);
    if (units.length < 5) throw new Error(`umili-pod-cyprysami: unit cards not found on /cottages (${units.length} parsed)`);
    let gallery: string | null = null;
    try { gallery = await fetchText(PC_GALLERY_URL, { accept: 'text/html' }); }
    catch (e) { ctx.note(`umili-pod-cyprysami: photo page ${PC_GALLERY_URL} failed (${(e as Error).message})`); }
    return parsePodCyprysamiContent({ home, cottages, surf, gallery });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('umili-pod-cyprysami: no prices on the site; Bookassist (/scripts/, /conduit/) is disallowed by robots.txt - price on request');
    return [];
  },
};

