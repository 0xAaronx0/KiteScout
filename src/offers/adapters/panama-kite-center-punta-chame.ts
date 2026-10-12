// ---------------------------------------------------------------------------
// Panama Kite Center, Punta Chame (Panama Oeste, Panama) - kite school with its own studios and glamping
// tents right behind the launching area of the Punta Chame lagoon, restaurant and beach club on site.
//
// BSTOKED SNAPSHOT, Aaron's exception 2026-10-12: the provider's own site (panamakitecenter.com) answers
// HTTP 403 to our bot, so the content comes from its bstoked.net listings (bstoked is Aaron's team's
// platform). The own site is never fetched (no retry, no bypass); it is only the sourceUrl a person opens.
//   bstoked ids: 7593 (studios + glamping, services, 21 photos, 2 videos) and 7908 (same business; on
//   2026-10-12 its partials were empty except one YouTube video "Introducing Panama Kite Center", so it is
//   not fetched). Both listings are inactive: the main page /listings/<id>/ answers 307, no Wayback snapshot
//   exists (CDX checked 2026-10-12) -> no bstoked title, summary or lat/lng; the title is the business name
//   from the listings' own YouTube channel "Panama Kite Center".
// Data path (checked 2026-10-12): the public GET partials of listing 7593 (robots.txt of bstoked.net only
//   disallows /error/):
//     /listings/accommodations/?id=7593  room cards (name, host text, photos ac-1522-* / ac-1523-*)
//     /listings/services/?id=7593        "Additional services" list
//     /listings/images/?id=7593          gallery (host photos l-7593-*, served by bstoked.azureedge.net)
//     /listings/videos/?id=7593          video captions ("We teach according to IKO and VDWS standards")
//     /listings/languages/?id=7593       badges
// Liveness (2026-10-12, search snippets): IKO school page lists the season 1 November 2025 - 15 May 2026 and
//   student reviews dated March 2026 (4.85 from 107 reviews); KiteWorldWide's listing says the new Studios XL
//   have been the center's top rooms since 2026. The bstoked texts themselves are older and do not mention
//   the Studios XL.
// Kite link: kite school (IKO / VDWS), beginner / advanced / hydrofoil lessons, rental, kite shop; studios
//   "right behind the launching area" (bstoked host texts).
// Slots: none. Prices are not taken from bstoked (they can be outdated) nor from portals -> fetchSlots
//   returns [] ("price on request"), confidence 'low'.
// Map pin: none (no bstoked lat/lng without the main page); the ingest geocodes the spot "Punta Chame".
// Requests per run: content 5 (bstoked.net), slots 0.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const BST = 'https://bstoked.net';
export const PKC_LISTING_ID = 7593;
export const PKC_SECOND_LISTING_ID = 7908;
export const PKC_SITE_URL = 'https://www.panamakitecenter.com/';
const CDN = 'https://bstoked.azureedge.net';

export const pkcPartialUrl = (part: 'accommodations' | 'services' | 'images' | 'videos' | 'languages', id = PKC_LISTING_ID): string =>
  `${BST}/listings/${part}/?id=${id}`;

const LANG: Record<string, string> = { english: 'en', german: 'de', spanish: 'es', portuguese: 'pt', french: 'fr', italian: 'it', dutch: 'nl' };

// --- pure parsers (bstoked partials) -------------------------------------------------------------------
export interface BstRoom { name: string; type: string | null; paragraphs: string[]; notes: string[]; photos: string[] }

/** Room cards: h5 name (icon title = type), host paragraphs, the "Walking distance to spot" line, carousel photos. */
export function parseBstRooms(html: string): BstRoom[] {
  return parse(html).querySelectorAll('div.card').map(card => {
    const h5 = card.querySelector('h5');
    const texts = card.querySelectorAll('.card-text');
    const paragraphs = (texts[0]?.querySelectorAll('p') ?? []).map(p => collapse(p.text)).filter(Boolean);
    const notes = texts.slice(1).flatMap(t => t.querySelectorAll('p').map(p => collapse(p.text))).filter(Boolean);
    const photos: string[] = [];
    for (const m of card.toString().matchAll(/ac-\d+-[A-Za-z0-9]+\.(?:jpe?g|png|webp)/gi)) {
      const u = `${CDN}/${m[0]}?width=1920`;
      if (!photos.includes(u)) photos.push(u);
    }
    return { name: collapse(h5?.text ?? ''), type: h5?.querySelector('i')?.getAttribute('title') ?? null, paragraphs, notes, photos };
  }).filter(r => r.name);
}

/** Service cards by id (Included-services / Optional-services / Extra-services), each a list of .py-05 rows. */
export function parseBstServices(html: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const card of parse(html).querySelectorAll('[id$="-services"]')) {
    const rows = card.querySelectorAll('.py-05').map(d => collapse(d.text)).filter(Boolean);
    out[card.getAttribute('id')!] = [...new Set(rows)];
  }
  return out;
}

/** Gallery photos of the listing in host order, full size, unique by file name. */
export function parseBstGallery(html: string, id = PKC_LISTING_ID): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`l-${id}-[A-Za-z0-9]+\\.(?:jpe?g|png|webp)`, 'gi'))) {
    const u = `${CDN}/${m[0]}?width=1920`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export function parseBstVideos(html: string): Array<{ youtubeId: string; caption: string | null }> {
  return parse(html).querySelectorAll('.carousel-item').map(item => {
    const src = item.querySelector('iframe')?.getAttribute('src') ?? '';
    const id = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/)?.[1];
    return id ? { youtubeId: id, caption: collapse(item.querySelector('.carousel-caption')?.text ?? '') || null } : null;
  }).filter((v): v is { youtubeId: string; caption: string | null } => !!v);
}

export function parseBstLanguages(html: string): string[] {
  return parse(html).querySelectorAll('.badge').map(b => LANG[collapse(b.text).toLowerCase()]).filter((x): x is string => !!x);
}

// --- content ----------------------------------------------------------------------------------------
const andList = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export interface PkcPartials { accommodations: string; services: string; images: string; videos: string; languages: string }

export function parsePanamaKiteCenterContent(p: PkcPartials): OfferContent {
  const rooms = parseBstRooms(p.accommodations);
  const services = parseBstServices(p.services);
  const optional = services['Optional-services'] ?? [];
  const included = services['Included-services'] ?? [];
  const gallery = parseBstGallery(p.images);
  const videos = parseBstVideos(p.videos);
  const languages = parseBstLanguages(p.languages);
  if (rooms.length === 0) throw new Error('panama-kite-center: no room cards in the bstoked accommodations partial (listing changed or removed)');

  const studio = rooms.find(r => /studio/i.test(r.name));
  const tent = rooms.find(r => /glamping|tent/i.test(r.name) || r.type === 'Tent');
  const standards = videos.map(v => v.caption).find(c => c && /IKO|VDWS/.test(c)) ?? null;
  const has = (re: RegExp) => optional.some(s => re.test(s));

  const summary = [
    `Panama Kite Center is a kite school with its own accommodation at Punta Chame, Panama${standards ? ', teaching to IKO and VDWS standards' : ''}.`,
    studio && tent
      ? 'Guests stay in remodeled studios right behind the launching area, with hot water, a private kitchen and fridge and a private terrace, or in glamping tents with real beds on wooden decks under the trees, with a shared bathroom a few steps from the launch area, the restaurant and the beach club.'
      : `Guests stay in ${rooms.map(r => r.name.toLowerCase()).join(' and ')} at the kite center.`,
    `The center offers ${andList([has(/beginner/i) && 'beginner', has(/advanced/i) && 'advanced', has(/hydrofoil/i) && 'hydrofoil'].filter((x): x is string => !!x))} lessons${has(/radio/i) ? ' with radio headsets' : ''}${has(/video/i) ? ' and video analysis' : ''}, equipment rental and a kite shop; prices are on request.`,
  ].join(' ');

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.paragraphs.join(' ') || null,
    features: [...(r.type ? [r.type] : []), ...r.notes],
  }));
  const imageUrls = [...new Set([...gallery, ...rooms.flatMap(r => r.photos)])];

  return {
    kind: 'accommodation',
    title: 'Panama Kite Center',
    summary,
    continent: 'North America',
    country: 'Panama',
    region: 'Panamá Oeste',
    spot: 'Punta Chame',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [has(/beginner/i) && 'beginner', has(/advanced/i) && 'advanced'].filter((x): x is string => !!x),
    kiteLessons: has(/lesson/i),
    equipmentRental: has(/rental/i),
    beginnerFriendly: has(/beginner/i) ? true : null,
    includedServices: included,
    optionalServices: optional,
    accommodation: 'studios with kitchen and glamping tents at the kite center',
    mealPlan: null, // restaurant and beach club on site; no board plan stated
    languages,
    rooms: contentRooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: PKC_SITE_URL, // the business's own site (403 to our bot, not fetched)
    bookingUrl: null,
    sourceText: [
      `BSTOKED SNAPSHOT (Aaron's exception 2026-10-12): listings ${PKC_LISTING_ID} + ${PKC_SECOND_LISTING_ID} on bstoked.net (inactive, partials public); own site ${PKC_SITE_URL} answers 403 to our bot`,
      ...rooms.map(r => `room ${r.name}${r.type ? ` (${r.type})` : ''}: ${r.paragraphs.join(' ')}${r.notes.length ? ` [${r.notes.join('; ')}]` : ''}`),
      `included services: ${included.join('; ') || '-'}`,
      `additional services: ${optional.join('; ') || '-'}`,
      `videos: ${videos.map(v => `https://www.youtube.com/watch?v=${v.youtubeId}${v.caption ? ` "${v.caption}"` : ''}`).join(' ')}`,
      `languages: ${languages.join(', ')}`,
      'liveness: IKO school page season 1 Nov 2025 - 15 May 2026, IKO reviews March 2026, Studios XL since 2026 (KiteWorldWide) - search snippets 2026-10-12',
    ].join('\n'),
  };
}

// --- adapter -----------------------------------------------------------------------------------------
export const panamaKiteCenterPuntaChame: OfferAdapter = {
  key: 'panama-kite-center-punta-chame',
  name: 'Panama Kite Center (Punta Chame)',
  kind: 'accommodation',
  operator: {
    name: 'Panama Kite Center',
    websiteUrl: 'https://www.panamakitecenter.com',
    rootDomain: 'panamakitecenter.com',
    // contact details only from the own site, which blocks us -> none
  },
  url: PKC_SITE_URL,
  slotMethod: 'platform', // bstoked listing data; no prices read -> always []
  fetchBudget: 5,
  confidence: 'low', // bstoked snapshot, no prices
  async fetchContent() {
    const get = (part: Parameters<typeof pkcPartialUrl>[0]) =>
      fetchText(pkcPartialUrl(part), { accept: 'text/html', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const accommodations = await get('accommodations');
    const services = await get('services');
    const images = await get('images');
    const videos = await get('videos');
    const languages = await get('languages');
    return parsePanamaKiteCenterContent({ accommodations, services, images, videos, languages });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('bstoked snapshot: no prices read (bstoked prices can be outdated, own site blocks our bot) - price on request');
    return [];
  },
};
