// ---------------------------------------------------------------------------
// Wind Adventures Studio, Orient Bay (Saint Martin, French side) - top-floor studio in the Orient Beach Resort,
// two minutes' walk from the Orient Bay kite beach, rented by Emmanuel ("Manu") of Wind Adventures, the Orient
// Bay kite / water-sports centre (lessons, Cabrinha rental, boat trips to kite in Anguilla).
//
// BSTOKED SNAPSHOT, Aaron's exception 2026-10-12: the stay has no page of its own - wind-adventures.com (live,
// "(c) 2026", shared kite/wingfoil charters to Anguilla announced for 8 Nov and 5 Dec 2026, seen 2026-10-12) now
// sells boat trips and kite trips only and does not list the studio. Content therefore comes from the host's
// own texts on bstoked listing 6831 ("Oceanside Studio Accomodation", active), read live at run time:
//   GET https://bstoked.net/listings/6831/                      title, summary, spot text, trip data, map pin
//   GET https://bstoked.net/listings/accommodations/?id=6831    studio card (+ its photos)
//   GET https://bstoked.net/listings/services/?id=6831          lessons, rental, Anguilla trip
//   GET https://bstoked.net/listings/images/?id=6831            host photos (l-6831-*)
// robots.txt (bstoked.net, 2026-10-12): disallows only /error/. Honest UA via http.ts, 1.5 s per host.
// Identity + liveness (search, 2026-10-12): the bstoked video is "Come to Ride with Us... Wind Adventures in
//   St Martin"; iksurfmag names Emmanuel Demanez as the Wind Adventures manager; an Airbnb studio in Orient Bay
//   ("STUDIO AU COEUR D'ORIENT BAY", rooms/4125603) is offered by the Wind Adventures host (search snippet only,
//   review dates not visible - never fetched). Business live: own site above.
// sourceUrl = the business's own site (not bstoked: the app labels bstoked-sourced listings "bSTOKED").
// Prices: none (bstoked prices can be outdated, never from Airbnb) -> fetchSlots returns [] ("price on request").
// Requests per run: content 4 (all bstoked), slots 0.
// Known limits: the studio count is not stated ("one of our top floor studios"); the bstoked texts date from
//   2017-2019 and may lag the current offer.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const BST = 'https://bstoked.net';
export const WA_BSTOKED_ID = '6831';
export const WA_LISTING_URL = `${BST}/listings/${WA_BSTOKED_ID}/`;
export const WA_ROOMS_URL = `${BST}/listings/accommodations/?id=${WA_BSTOKED_ID}`;
export const WA_SERVICES_URL = `${BST}/listings/services/?id=${WA_BSTOKED_ID}`;
export const WA_IMAGES_URL = `${BST}/listings/images/?id=${WA_BSTOKED_ID}`;
export const WA_SITE_URL = 'https://wind-adventures.com/';

// --- local bstoked readers (same markup as src/pipeline/bstoked-packages.ts) --------------------------
export interface BstListing {
  title: string; location: string | null; summary: string | null; conditions: string | null;
  skillLevels: string[]; kiteServices: string[]; spot: string[]; trip: Record<string, string>;
  accommodation: string | null; lat: number | null; lng: number | null;
}
export interface BstServices { included: string[]; optional: Array<{ group: string | null; item: string }>; extra: string[] }

const lineBreakText = (s: string | undefined): string => collapse((s ?? '').replace(/&#xD;&#xA;|\r?\n/g, ' '));

export function parseBstListing(html: string): BstListing {
  const root = parse(html);
  const main = root.querySelector('main') ?? root;
  const structured = (label: string): HTMLElement | undefined =>
    main.querySelectorAll('div.b-b.block').find(b => collapse(b.querySelector('.col-md-3')?.text ?? '').toLowerCase().includes(label));
  const cond = structured('conditions');
  const tripBlock = structured('trip characteristics');
  const items = (b: HTMLElement | undefined) => (b?.querySelectorAll('.listing-structured > div') ?? []).map(it => ({
    icon: (it.querySelector('i')?.getAttribute('title') ?? '').toLowerCase(),
    label: collapse(it.querySelector('.text-muted')?.text ?? '').replace(/:$/, '').toLowerCase(),
    value: collapse(it.text).replace(collapse(it.querySelector('.text-muted')?.text ?? ''), '').trim(),
  }));
  const condItems = items(cond);
  const trip: Record<string, string> = {};
  for (const it of items(tripBlock)) if (it.label && it.value) trip[it.label] = it.value;
  const h4 = (title: string) => main.querySelectorAll('h4').find(h => collapse(h.text) === title);
  const lat = Number(html.match(/data-lat="(-?\d+\.\d+)"/)?.[1] ?? html.match(/center=(-?\d+\.\d+),/)?.[1]);
  const lng = Number(html.match(/data-lng="(-?\d+\.\d+)"/)?.[1] ?? html.match(/center=-?\d+\.\d+,(-?\d+\.\d+)/)?.[1]);
  return {
    title: collapse(root.querySelector('header h1')?.text ?? ''),
    location: collapse(root.querySelector('header .lead .text-m')?.text ?? '') || null,
    summary: lineBreakText(h4('Summary')?.parentNode?.querySelector('.line-break')?.text) || null,
    conditions: lineBreakText(cond?.querySelector('.line-break')?.text) || null,
    skillLevels: (condItems.find(i => i.icon === 'skill level')?.value ?? '').split(',').map(s => collapse(s).toLowerCase()).filter(Boolean),
    kiteServices: condItems.filter(i => /gear rental|gear storage|lessons or coaching|spot guidance|rescue service/.test(i.icon)).map(i => i.icon),
    spot: (condItems.find(i => i.label === 'spot')?.value ?? '').split(',').map(s => collapse(s)).filter(Boolean),
    trip,
    accommodation: lineBreakText(h4('Accommodation')?.parentNode?.querySelector('.line-break')?.text) || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

/** Accommodation cards: name, description paragraphs, feature lines, room photos (ac-<id>-*). */
export function parseBstRooms(html: string): Array<ContentRoom & { photos: string[] }> {
  return parse(html).querySelectorAll('div.card').map(card => {
    const body = card.querySelector('.card-body');
    const paras = (body?.querySelectorAll('.card-text p') ?? []).filter(p => !/\bmb-0\b/.test(p.getAttribute('class') ?? '')).map(p => collapse(p.text)).filter(Boolean);
    const photos = [...new Set((card.toString().match(/ac-\d+-[A-Za-z0-9]+\.(?:jpe?g|png|webp)/gi) ?? []))].map(f => `https://bstoked.azureedge.net/${f}?width=1920`);
    return {
      name: collapse(body?.querySelector('h5')?.text ?? ''),
      description: paras[0] ?? null,
      features: [...paras.slice(1), ...(body?.querySelectorAll('.card-text p.mb-0') ?? []).map(p => collapse(p.text))].filter(Boolean),
      photos,
    };
  }).filter(r => r.name);
}

export function parseBstServices(html: string): BstServices {
  const root = parse(html);
  const list = (id: string) => (root.querySelector(`#${id}`)?.querySelectorAll('.py-05') ?? []).map(d => collapse(d.text)).filter(Boolean);
  const optional: BstServices['optional'] = [];
  let group: string | null = null;
  for (const el of root.querySelector('#Optional-services')?.querySelectorAll('h6, .py-05') ?? []) {
    if (el.tagName === 'H6') group = collapse(el.text);
    else if (collapse(el.text)) optional.push({ group, item: collapse(el.text) });
  }
  return { included: list('Included-services'), optional, extra: list('Extra-services') };
}

/** Host gallery photos in host order, full size (the gallery repeats thumbnails). */
export function parseBstImages(html: string, id: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`l-${id}-[A-Za-z0-9]+\\.(?:jpe?g|png|webp)`, 'gi'))) {
    const u = `https://bstoked.azureedge.net/${m[0]}?width=1920`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

// --- content ------------------------------------------------------------------------------------------
export interface WaPages { listing: string; rooms: string; services: string; images: string }

export function parseWindAdventuresContent(p: WaPages): OfferContent {
  const l = parseBstListing(p.listing);
  const rooms = parseBstRooms(p.rooms);
  const svc = parseBstServices(p.services);
  const cond = l.conditions ?? '';
  const studio = rooms[0];

  const kn = cond.match(/average of (\d+)-(\d+) knots/);
  const knots = kn ? `${kn[1]}-${kn[2]}` : null;
  const waters = [
    /flat water in the lagoon/i.test(cond) ? 'flat water in the lagoon' : null,
    /chop/i.test(cond) ? 'chop' : null,
    /swell/i.test(cond) ? 'swell' : null,
    /wave riding at the reef/i.test(cond) ? 'a reef wave' : null,
  ].filter((x): x is string => !!x);
  const width = cond.match(/The bay is ([\d.]+ miles) wide/)?.[1] ?? null;
  const upwind = /ride upwind 80m/.test(cond);
  const lessons = svc.optional.filter(s => /lessons|coaching/i.test(s.group ?? ''));
  const rental = svc.optional.filter(s => /rental/i.test(s.group ?? ''));
  const anguilla = svc.optional.some(s => /Anguilla/i.test(s.item));
  const studioBits = studio?.description ?? '';
  const has = (re: RegExp) => re.test(studioBits);

  const summary = [
    `Studio${has(/king size bed/i) ? ' with a king-size bed' : ''}${has(/kitchenette/i) ? ', kitchenette' : ''}${has(/air conditioning/i) ? ', air conditioning' : ''}${has(/balcony/i) ? ' and a balcony' : ''} on the top floor of the Orient Beach Resort on the windward coast of Saint Martin, two minutes' walk from the Orient Bay kite beach; the host runs the Wind Adventures kite and water-sports centre in the bay.`,
    `The bay${width ? ` is ${width} wide and` : ''} offers ${waters.length > 1 ? `${waters.slice(0, -1).join(', ')} and ${waters.at(-1)}` : waters[0] ?? 'flat water and waves'}, with ${knots ? `${knots} knots` : 'trade wind'} most of the year${upwind ? '; riders must go 80 m upwind to reach the kiting area outside the swimming zone, so the spot suits independent riders' : ''}.`,
    `${lessons.length ? 'Private lessons' : 'Coaching'}${rental.length ? ', weekly Cabrinha gear rental' : ''}${anguilla ? ' and boat day trips to kite in Anguilla' : ''} are offered as extras.`,
  ].join(' ');

  const photos = [...parseBstImages(p.images, WA_BSTOKED_ID), ...rooms.flatMap(r => r.photos)];
  return {
    kind: 'accommodation',
    title: 'Wind Adventures Studio',
    summary,
    continent: 'North America',
    country: 'Saint Martin',
    region: 'Saint Martin (French side)',
    spot: 'Orient Bay',
    spotCoords: l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: l.skillLevels.filter(s => ['beginner', 'intermediate', 'advanced'].includes(s)),
    kiteLessons: lessons.length > 0 || l.kiteServices.includes('lessons or coaching'),
    equipmentRental: rental.length > 0 || l.kiteServices.includes('gear rental'),
    // lessons for all levels, but the spot text says the kiting area is for advanced riders (80 m upwind)
    beginnerFriendly: upwind ? false : null,
    includedServices: svc.included,
    optionalServices: svc.optional.map(s => (s.group && !/other/i.test(s.group) ? `${s.group}: ${s.item}` : s.item)).concat(svc.extra),
    accommodation: 'studio in a beach resort (kitchenette, balcony, pool)',
    mealPlan: has(/kitchenette/i) ? 'self_catering' : null,
    languages: [],
    rooms: rooms.map(({ photos: _p, ...r }) => r),
    imageUrls: photos,
    heroVideoUrl: null,
    sourceUrl: WA_SITE_URL,
    bookingUrl: null,
    sourceText: [
      `BSTOKED SNAPSHOT (Aaron's exception 2026-10-12), listing ${WA_LISTING_URL}, host emmanuel (Wind Adventures)`,
      `title: ${l.title} | ${l.location ?? ''}`,
      `summary: ${l.summary ?? ''}`,
      `kite conditions: skill ${l.skillLevels.join(', ')}; spot ${l.spot.join(', ')}; services ${l.kiteServices.join(', ')}; ${cond}`,
      `liveness: wind-adventures.com live 2026-10-12 ("(c) 2026", shared charters 8 Nov / 5 Dec 2026); studio not listed there`,
      `trip: ${Object.entries(l.trip).map(([k, v]) => `${k}: ${v}`).join('; ')}`,
      `accommodation: ${l.accommodation ?? ''}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.description ?? ''} ${r.features.join('; ')}`).join(' | ')}`,
      `services: included ${svc.included.join('; ') || '-'}; optional ${svc.optional.map(s => `${s.group ?? ''}: ${s.item}`).join('; ')}; extra ${svc.extra.join('; ') || '-'}`,
      `map pin (bstoked): ${l.lat},${l.lng}`,
    ].join('\n'),
  };
}

// --- adapter ------------------------------------------------------------------------------------------
const xhr = { accept: 'text/html', headers: { 'X-Requested-With': 'XMLHttpRequest' } };

export const windAdventuresStudioOrientBay: OfferAdapter = {
  key: 'wind-adventures-studio-orient-bay',
  name: 'Wind Adventures Studio (Orient Bay, Saint Martin)',
  kind: 'accommodation',
  operator: {
    name: 'Wind Adventures',
    websiteUrl: 'https://wind-adventures.com',
    rootDomain: 'wind-adventures.com',
    contactEmail: 'info@wind-adventures.com', // own site, 2026-10-12
    phone: '+590690362736',                  // own site, 2026-10-12
  },
  url: WA_SITE_URL,
  slotMethod: 'platform', // bstoked listing data; no prices read
  fetchBudget: 4,
  confidence: 'low', // bstoked snapshot, no prices
  async fetchContent() {
    const listing = await fetchText(WA_LISTING_URL, { accept: 'text/html' });
    const rooms = await fetchText(WA_ROOMS_URL, xhr);
    const services = await fetchText(WA_SERVICES_URL, xhr);
    const images = await fetchText(WA_IMAGES_URL, xhr);
    return parseWindAdventuresContent({ listing, rooms, services, images });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('bstoked snapshot: no prices read (bstoked prices can be outdated) - price on request');
    return [];
  },
};
