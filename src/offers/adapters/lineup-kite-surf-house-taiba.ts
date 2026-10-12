// ---------------------------------------------------------------------------
// Lineup Kite & Surf House (Pousada Lineup), Taíba (São Gonçalo do Amarante, Ceará, Brazil) - pousada of
// Soraya Bonfim and Julien Zgraggen 150 m from the beach: 8 double rooms, 1 triple room, 2 dormitories,
// pool with hot tub and bar, own kite school (radio-assisted lessons), gear rental, kite storage, downwinders.
//
// Liveness (re-check 2026-10-12, verdict LIVE): the home page was saved on 2026-02-13 (WordPress REST
//   /wp-json/wp/v2/pages modified 2026-02-13T11:42:24, also the AIOSEO sitemap lastmod); Worldpackers lists
//   "Lineup Pousada" as a Top Host (5.0, 17 reviews, relative review ages "6/9 months ago", search snippets
//   2026-10-12). No 2026-dated social post or review was found in search snippets. Kite link on the own
//   site: own "Lineup Kiteschool", gear rental, "Kite storage is provided".
//
// Data path (checked 2026-10-12): lineup-pousada.com, WordPress one-pager (Tatsu builder), English version
//   (French /fr/ and Portuguese /pt/ exist):
//   content  / only: intro, Taíba, rooms, kitesurf spot (wind July-January, 18-32 knots), downwind, gear
//            rental, surf, kite school, about us. Photos are CSS background images in the page's <style>
//            blocks (2021 uploads), plus a self-hosted mp4 (hero video).
//   slots    none: the site prints no price ("Need a price or a question ?" -> WhatsApp). fetchSlots
//            re-reads the home page (memoised) and returns [] (offer = "price on request"); it notes when
//            an amount shows up so the adapter can be extended.
// robots.txt (2026-10-12): disallows /wp-admin/ only (admin-ajax allowed).
// Requests per run: content 1, slots 1 (0 extra when content ran in the same process).
// Known limits: no map/coordinates on the site (spot geocoded from "Taíba"); room equipment "can vary"
//   (fan or air conditioning); the site does not say whether the dormitories are mixed.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, findPrices } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://lineup-pousada.com';
export const LINEUP_HOME_URL = `${SITE}/`;
const WHATSAPP = '+5585991431583';
const BOOKING_URL = 'https://api.whatsapp.com/send?phone=5585991431583';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text of the one-pager: scripts, styles, SVGs dropped; stops before the cookie/GDPR overlays. */
export function lineupText(html: string): string {
  const body = html.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<noscript[\s\S]*?<\/noscript>/gi, '');
  const lines = body.split(/<[^>]+>/).map(s => clean(s)).filter(Boolean);
  const start = lines.findIndex(l => /^Kite & Surf House$/i.test(l));
  const end = lines.findIndex((l, i) => i > start && /^FACEBOOK$/.test(l));
  return collapse(lines.slice(Math.max(0, start), end > start ? end : undefined).join(' '))
    .replace(/Your consent is required to display this content from youtube - Privacy Settings/gi, '')
    .replace(/\s{2,}/g, ' ');
}

export interface LineupFacts {
  doubles: number | null; triples: number | null; dorms: number | null;
  verandaM2: number | null;
  windMonths: number | null; windMin: number | null; windMax: number | null; windFrom: string | null; windTo: string | null;
  swellFrom: string | null; swellTo: string | null;
  kmFromFortaleza: number | null;
}

export function parseLineupFacts(text: string): LineupFacts {
  const rooms = text.match(/has (\d+) double rooms?, (\d+) triple rooms? and (\d+) dormitor(?:y|ies)/i);
  const wind = text.match(/almost (\d+) months of steady wind conditions \(ranging from (\d+) to (\d+) knots\), from ([A-Z][a-z]+) to ([A-Z][a-z]+)/);
  const swell = text.match(/from ([A-Z][a-z]+) to ([A-Z][a-z]+) you can get a really good swell/);
  const n = (s: string | undefined) => (s ? Number(s) : null);
  return {
    doubles: n(rooms?.[1]), triples: n(rooms?.[2]), dorms: n(rooms?.[3]),
    verandaM2: n(text.match(/common (\d+)\s?m2 veranda/i)?.[1]),
    windMonths: n(wind?.[1]), windMin: n(wind?.[2]), windMax: n(wind?.[3]), windFrom: wind?.[4] ?? null, windTo: wind?.[5] ?? null,
    swellFrom: swell?.[1] ?? null, swellTo: swell?.[2] ?? null,
    kmFromFortaleza: n(text.match(/about (\d+) kms? north of Fortaleza/i)?.[1]),
  };
}

/** Photos: CSS background images (in <style>) and <img> tags from the uploads folder; logos and the Instagram teaser dropped. */
export function lineupImages(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?:background-image:\s*url\(\s*['"]?|<img[^>]+src=["'])(https?:\/\/(?:www\.)?lineup-pousada\.com\/wp-content\/uploads\/[^"')\s]+\.(?:jpe?g|png|webp))/gi;
  for (const m of html.matchAll(re)) {
    const u = m[1];
    if (/logo|intragram|instagram|icon|-\d+x\d+\.[a-z]+$/i.test(u)) continue;
    const k = u.replace(/^https?:\/\/(?:www\.)?/, '').replace(/-scaled(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out;
}

/** The self-hosted house video (mp4), if the page still embeds it. */
export function lineupVideo(html: string): string | null {
  return html.match(/https?:\/\/(?:www\.)?lineup-pousada\.com\/wp-content\/uploads\/[^"'\s]*LINEUP[^"'\s]*\.mp4/i)?.[0] ?? null;
}

export function parseLineupContent(home: string): OfferContent {
  const text = lineupText(home);
  const f = parseLineupFacts(text);
  const intro = text.match(/(located in Taiba village[\s\S]*?Kite storage is provided\.)/i)?.[1] ?? '';
  const roomsText = text.match(/(Lineup kite & Surf house has[\s\S]*?around the house\.)/i)?.[1] ?? '';
  const spotText = text.match(/(Taiba kite conditions are just perfect\.[\s\S]*?super flat lagoon\.)/i)?.[1] ?? '';
  const schoolText = text.match(/(Our goal is that you can actually practice independently[\s\S]*?(?:upwelling|upwind)\.)/i)?.[1] ?? '';
  const breakfast = /breakfast/i.test(intro);
  const pool = /swimming pool area with hot tub and bar/i.test(intro);

  const roomFeatures = [
    'Comfortable beds',
    /fan or \*?air conditioning/i.test(roomsText) ? 'Fan or air conditioning (equipment varies by room)' : null,
    /mini bar/i.test(roomsText) ? 'Mini bar in some rooms' : null,
    /free wifi/i.test(roomsText) ? 'Free Wi-Fi' : null,
    f.verandaM2 ? `Shared ${f.verandaM2} m2 veranda with sea view` : null,
  ].filter((x): x is string => !!x);
  const rooms: ContentRoom[] = ([
    f.doubles ? { name: 'Double room', description: `${f.doubles} double rooms.`, features: roomFeatures } : null,
    f.triples ? { name: 'Triple room', description: `${f.triples} triple room${f.triples > 1 ? 's' : ''}.`, features: roomFeatures } : null,
    f.dorms ? { name: 'Dormitory', description: `${f.dorms} dormitories.`, features: roomFeatures.filter(x => !/mini bar/i.test(x)) } : null,
  ] as Array<ContentRoom | null>).filter((x): x is ContentRoom => !!x);

  const wind = f.windFrom && f.windTo
    ? `steady trade winds of ${f.windMin}-${f.windMax} knots from ${f.windFrom} to ${f.windTo}`
    : 'steady trade winds in the second half of the year';
  const summary = [
    `Lineup Kite & Surf House is a pousada in the fishing village of Taíba${f.kmFromFortaleza ? `, about ${f.kmFromFortaleza} km north of Fortaleza` : ''} in Ceará, Brazil, 150 m from the beach and a few minutes from the lagoon; it is run by Soraya Bonfim and Julien Zgraggen.`,
    `It has ${f.doubles ?? 8} double rooms, ${f.triples ?? 1} triple room and ${f.dorms ?? 2} dormitories${pool ? ', a pool area with hot tub and bar' : ''}; breakfast is served daily and lunch or dinner several times a week.`,
    `The house runs its own kite school (radio-assisted lessons in shallow water, beginner to advanced), rents full kite and surf gear, organises guided downwinders and stores guests' kites; Taíba has ${wind}, waves on the beach and a flat lagoon.`,
    'Stays are booked on request by WhatsApp or e-mail; the site publishes no prices.',
  ].join(' ');

  const video = lineupVideo(home);
  return {
    kind: 'accommodation',
    title: 'Lineup Kite & Surf House',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Taíba',
    itinerarySpots: [],
    durationDays: null,
    // kite school: beginners "from initiation to autonomy", "Intermediate & Advanced" courses (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kiteschool/i.test(text),
    equipmentRental: /Full equipment can be rented/i.test(text),
    beginnerFriendly: /Teaching in shallow water/i.test(text),
    includedServices: [
      breakfast ? 'Breakfast (local style)' : null,
      /Kite storage is provided/i.test(intro) ? 'Kite storage' : null,
      /free wifi/i.test(roomsText) ? 'Free Wi-Fi' : null,
      pool ? 'Swimming pool with hot tub and bar' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [
      'Lunch and dinner (fresh local produce, several times a week)',
      'Kitesurf lessons with radio coaching (beginner, intermediate and advanced)',
      'Kite and surf gear rental',
      /guided downwind/i.test(text) ? 'Guided one-day downwinder' : null,
    ].filter((x): x is string => !!x),
    accommodation: 'pousada with double and triple rooms and dormitories',
    mealPlan: 'breakfast',
    languages: ['en', 'fr', 'pt'],
    rooms,
    imageUrls: lineupImages(home).slice(0, 30),
    heroVideoUrl: video,
    sourceUrl: LINEUP_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `intro: ${intro}`,
      `rooms: ${roomsText}`,
      `spot: ${spotText}`,
      `school: ${schoolText}`,
      `facts: ${JSON.stringify(f)}`,
      `page: ${text}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the page starts printing some. */
export function lineupVisiblePrices(homeHtml: string): string[] {
  return findPrices(lineupText(homeHtml)).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const lineupKiteSurfHouseTaiba: OfferAdapter = {
  key: 'lineup-kite-surf-house-taiba',
  name: 'Lineup Kite & Surf House Taíba',
  kind: 'accommodation',
  operator: {
    name: 'Lineup Kite & Surf House',
    websiteUrl: SITE,
    rootDomain: 'lineup-pousada.com',
    contactEmail: 'info@lineup-pousada.com',
    whatsapp: WHATSAPP,
    phone: WHATSAPP,
  },
  url: LINEUP_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'low', // no prices or dates on the site; inquiry only
  async fetchContent() {
    return parseLineupContent(await page(LINEUP_HOME_URL));
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(LINEUP_HOME_URL);
    if (!/Kiteschool/i.test(html)) throw new Error('lineup: kite school section missing on the home page (layout changed?)');
    const prices = lineupVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on the home page (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
