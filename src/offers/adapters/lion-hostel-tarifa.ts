// ---------------------------------------------------------------------------
// Lion Hostel Tarifa by Rebels, Tarifa (Cadiz, Andalusia, Spain) - the Rebels Tarifa kite school's hostel in a
// renovated 19th-century house in the historic centre, in front of the Puerta de Jerez: three dorms for ten guests and
// two rooms for four, a 360° solarium with a guests' bar and views to Morocco, dining room, kitchen and lockers.
// Rebels sells kitesurf + accommodation packs (3, 5 or 7 days) with the stay in its hostel.
//
// Data path (checked 2026-10-12): WordPress (Flatsome), two pages
//   content  https://rebelstarifa.com/tarifa-hostel/ (description, rooms, services, FAQ, room photos, map embed).
//   slots    https://rebelstarifa.com/packs-kitesurf-accommodation/: three cards "PACK 3 DAYS" / "PACKS 5 DAYS" /
//            "PACKS 7 DAYS", each "Price per person" with "(199€- 3 px min- 3h/day)", "(299€- 2 px min- 3h/day)",
//            "(345€- 1 px min- 2h/day)" and "(Shared room Accommodation)"; lessons, full equipment, rescue boat and
//            insurance included. The hostel page sells these packs ("Stay in our Tarifa Hostel ... Book Packs").
//   photos   (2026-10-21) the hostel page's gallery is 2018 uploads of 420-600 px (most fail the 500x330 floor), and its
//            hero photo (2024, 2560 px) sits in a Flatsome <style> rule ("#banner-... .bg.bg-loaded {background-image:
//            url(...)}") that the generic image discovery does not read: this adapter reads it. More hostel photos come
//            from the site's own WordPress media library, /wp-json/wp/v2/media?search=hostel (titles "kite hostel en
//            tarifa", alt "habitaciones hostel en tarifa": the 2024 room photos, 1365-2560 px, and the larger 2018
//            ones), taken largest first and only when >= 500x330 per the library's own media_details. Order: library
//            photos, the page's style backgrounds (the hero is also in the library; the other style backgrounds are
//            small 2018 strips), then the page gallery; capped at 24 (the ingest's download cap). Best effort.
// Kind 'accommodation': the hostel takes stay-only guests (FAQ: check-in times, cancellation of "your booking"), but
//   the site prints prices only for the packs, so the slots are the packs (stay + lessons), per person.
// No booking engine: contact form / e-mail / WhatsApp ("CONTACT US") -> 'on_request'.
// Liveness (rule 5b): hostel page dateModified 2026-04-10, packs page 2026-02-21 (JSON-LD), footer "Copyright 2026".
// robots.txt (2026-10-12): Yoast block, "User-Agent: * / Disallow:" (allow all).
// Requests per run: content 3 (hostel page, packs page, media-library search for photos), slots 1 (memoised: 3 in total).
// Parsed: 9 slots = pack length x lesson format ("pack-3-days|3p"), EUR per person, priceUnit 'package',
//   packageNights = the pack's days of accommodation (inferred: "3 Days of accommodation" read as 3 nights),
//   occupancy = the minimum group size the price assumes (3 / 2 / 1 people), no dates, availability 'on_request'.
// Map pin: the hostel page's own Google Maps embed, place label 36°00'51.6"N 5°36'14.3"W (decoded from its !2z field).
// ---------------------------------------------------------------------------
import { fetchJson, fetchText } from '../http.js';
import { clean, collapse, imageCandidates, ldOfType, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://rebelstarifa.com';
export const LION_URL = `${SITE}/tarifa-hostel/`;
export const LION_PACKS_URL = `${SITE}/packs-kitesurf-accommodation/`;
export const LION_MEDIA_URL = `${SITE}/wp-json/wp/v2/media?search=hostel&per_page=50&_fields=source_url,media_details`;
const LION_MAX_PHOTOS = 24;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text split at block tags (script/style bodies dropped). */
export function lionLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -------------------------------------------------------------------------------------
export interface LionPackOption { amount: number; persons: number; hoursPerDay: number }
export interface LionPack { days: number; from: number | null; includes: string[]; options: LionPackOption[]; room: string | null }

/** Pack cards (.col-inner with "PACK(S) N DAYS"). */
export function parseLionPacks(html: string): LionPack[] {
  const out: LionPack[] = [];
  for (const card of parse(html).querySelectorAll('.col-inner')) {
    const lines = card.querySelectorAll('h5, p').map(el => collapse(el.text).replace(/>$/, '').trim()).filter(Boolean);
    const days = lines.map(l => l.match(/^PACKS? (\d+) DAYS$/i)?.[1]).find(Boolean);
    if (!days || out.some(p => p.days === Number(days))) continue;
    const options: LionPackOption[] = [];
    for (const l of lines) {
      const m = l.match(/^\(\s*([\d.,]+)\s*€\s*-\s*(\d+)\s*px min\s*-\s*(\d+)\s*h\/day\s*\)$/i);
      if (m) options.push({ amount: parseAmount(m[1])!, persons: Number(m[2]), hoursPerDay: Number(m[3]) });
    }
    const from = lines.map(l => l.match(/^FROM\s*([\d.,]+)\s*€/i)?.[1]).find(Boolean);
    out.push({
      days: Number(days),
      from: from ? parseAmount(from) : null,
      includes: lines.filter(l => !/^PACKS?\s|^KITESURF\+ACCOMMODATION$|^FROM\s|^Price per person$|^\(|^CONTACT US$/i.test(l)),
      options,
      room: lines.map(l => l.match(/^\((.*accommodation)\)$/i)?.[1]).find(Boolean) ?? null,
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

const FORMAT: Record<number, string> = { 1: 'private lessons', 2: 'semi-private lessons', 3: 'group lessons' };

export function buildLionSlots(packs: LionPack[]): Slot[] {
  const out: Slot[] = [];
  for (const p of packs) {
    for (const o of p.options) {
      out.push({
        key: `pack-${p.days}-days|${o.persons}p`,
        startDate: null,
        endDate: null,
        unit: `${p.days}-day kite + accommodation pack, ${FORMAT[o.persons] ?? `${o.persons} people`} (min. ${o.persons} ${o.persons === 1 ? 'person' : 'people'}, ${o.hoursPerDay} h/day), ${(p.room ?? 'shared room accommodation').toLowerCase()}`,
        price: o.amount,
        currency: 'EUR',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: o.persons,
        availability: 'on_request',
        availabilityText: 'Contact us for packs',
        spotsLeft: null,
        packageNights: p.days, // inferred: "N Days of accommodation"
      });
    }
  }
  return out;
}

/** "36°00'51.6"N 5°36'14.3"W" from a Google Maps embed's !2z (base64) field; falls back to the embed centre. */
export function lionCoords(html: string): { lat: number; lng: number } | null {
  const embed = html.match(/google\.com\/maps\/embed\?pb=([^"'\s]+)/)?.[1];
  if (!embed) return null;
  const z = embed.match(/!2z([A-Za-z0-9+/=_-]+)/)?.[1];
  if (z) {
    const label = Buffer.from(z.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const m = label.match(/(\d+)°(\d+)'([\d.]+)"([NS])\s+(\d+)°(\d+)'([\d.]+)"([EW])/);
    if (m) {
      const dms = (d: string, mi: string, s: string, h: string) => (Number(d) + Number(mi) / 60 + Number(s) / 3600) * (/[SW]/.test(h) ? -1 : 1);
      return { lat: Math.round(dms(m[1], m[2], m[3], m[4]) * 1e6) / 1e6, lng: Math.round(dms(m[5], m[6], m[7], m[8]) * 1e6) / 1e6 };
    }
  }
  const c = embed.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  return c ? { lat: Number(c[2]), lng: Number(c[1]) } : null;
}

export function parseLionRooms(lines: string[]): ContentRoom[] {
  const t = lines.find(l => /distributed in/i.test(l)) ?? '';
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10 };
  const n = (w: string) => words[w.toLowerCase()] ?? Number(w);
  const out: ContentRoom[] = [];
  const dorm = t.match(/(\w+) rooms of (\w+) guests each/i);
  const small = t.match(/we have (\w+) rooms of (\w+) guests? each/i);
  if (dorm) out.push({ name: `Dorm for ${n(dorm[2])}`, description: `${n(dorm[1])} rooms of ${n(dorm[2])} guests each`, features: ['Shared room', 'Private trunk/cabinet with locker'] });
  if (small) out.push({ name: `Room for ${n(small[2])}`, description: `${n(small[1])} rooms of ${n(small[2])} guests each, for more privacy (family option)`, features: ['Private trunk/cabinet with locker'] });
  return out;
}

export interface LionPages { hostel: string; packs: string; media?: LionMedia[] | null }
export interface LionMedia { source_url?: string; media_details?: { width?: number; height?: number } }

/** Background photos set in the page's <style> rules (the Flatsome hero banner). */
export function lionStyleBackgrounds(html: string): string[] {
  const out: string[] = [];
  for (const st of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const m of st[1].matchAll(/background-image:\s*url\((['"]?)(https:\/\/rebelstarifa\.com\/wp-content\/uploads\/[^'")]+\.(?:jpe?g|webp))\1\)/gi)) {
      if (!out.includes(m[2])) out.push(m[2]);
    }
  }
  return out;
}

/** Media-library photos of the hostel, largest first, only those >= 500x330 (the ingest's floor). */
export function lionMediaPhotos(media: LionMedia[]): string[] {
  return media
    .filter(m => typeof m.source_url === 'string' && /\/wp-content\/uploads\/[^?]+\.(?:jpe?g|webp)$/i.test(m.source_url)
      && (m.media_details?.width ?? 0) >= 500 && (m.media_details?.height ?? 0) >= 330)
    .sort((a, b) => (b.media_details!.width! * b.media_details!.height!) - (a.media_details!.width! * a.media_details!.height!))
    .map(m => m.source_url!)
    .filter((u, i, all) => all.indexOf(u) === i);
}

/** Media-library photos (largest first), the page's style backgrounds (hero), then its gallery; one per photo, capped. */
export function lionPhotoCandidates(hostelHtml: string, media: LionMedia[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const page = imageCandidates(hostelHtml, LION_URL, null, 60);
  for (const u of [...(media ? lionMediaPhotos(media) : []), ...lionStyleBackgrounds(hostelHtml), ...page]) {
    if (/\.svg|\.png$|logo|special-offer|unidad|icon/i.test(u)) continue;
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); out.push(u);
  }
  return out.slice(0, LION_MAX_PHOTOS);
}

export function parseLionContent(p: LionPages): OfferContent {
  const lines = lionLines(p.hostel);
  const packs = parseLionPacks(p.packs);
  const start = lines.findIndex(l => /^Services and facilities/i.test(l));
  const services = start >= 0 ? lines.slice(start + 2, lines.findIndex((l, i) => i > start && /^Contact us$/i.test(l))) : [];
  const desc = lines.filter(l => /Lion Hostel Tarifa by Rebels is located|breaks into an old house|focused on those guests|solarium, there is a bar/i.test(l));
  const faq = lines.filter(l => /^(What is a Hostel|What do I need|Check in and check out|What kind of security|Is it wheelchair|Cancellation policy)/i.test(l));
  const rooms = parseLionRooms(lines);
  const cheapest = packs[0]?.options.length ? Math.min(...packs[0].options.map(o => o.amount)) : null;
  const ld = ldOfType(p.hostel, 'WebPage').find(o => typeof o.dateModified === 'string');

  const imageUrls = lionPhotoCandidates(p.hostel, p.media ?? null);

  const summary = [
    `Lion Hostel Tarifa by Rebels is the Rebels Tarifa kite school's hostel in a renovated 19th-century house in the historic centre of Tarifa, Spain, in front of the Puerta de Jerez and a few minutes' walk from the beaches.`,
    `It has ${rooms.length ? 'three dorms for ten guests and two rooms for four' : 'dorms and private rooms'}, a 360° solarium with a bar for guests and views to Morocco, a dining room, a kitchen, free Wi-Fi, lockers and rooms for guests with reduced mobility.`,
    `Rebels sells kitesurf + accommodation packs of ${packs.map(x => x.days).join(', ').replace(/, (\d+)$/, ' or $1')} days with lessons, full equipment, rescue boat and insurance${cheapest !== null ? `, from EUR ${cheapest} per person in a shared room` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Lion Hostel Tarifa by Rebels',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Tarifa town',
    spot: 'Tarifa',
    spotCoords: lionCoords(p.hostel),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // private, semi-private and group lessons; "Describe your level"
    kiteLessons: /Kitesurfing lessons/i.test(services.join(' ')) || packs.length > 0,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: services.filter(s => /WIFI|Kitchen|dining room|sol[aá]rium|bar only|Express Check|locker|reduced mobility/i.test(s) && !/Happy Hours/i.test(s)),
    optionalServices: [
      ...services.filter(s => /Towel|Laundry|Transport|Lunch|Bicycle|Kitesurfing lessons|Happy Hours|Reception/i.test(s)),
      ...packs.map(x => `Kitesurf + accommodation pack ${x.days} days: ${x.options.map(o => `EUR ${o.amount} p.p. (min. ${o.persons}, ${o.hoursPerDay} h/day)`).join(', ')}; ${x.includes.join(', ')}`),
    ],
    accommodation: 'hostel with dorms and rooms for four',
    mealPlan: 'self_catering',
    languages: [],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: LION_URL,
    bookingUrl: LION_PACKS_URL,
    sourceText: [
      `hostel: ${desc.join(' ')}`,
      `rooms: ${lines.find(l => /distributed in/i.test(l)) ?? '-'}`,
      `services: ${services.join(' | ')}`,
      `faq: ${faq.join(' | ')}`,
      `packs: ${packs.map(x => `${x.days} days from ${x.from}: ${x.options.map(o => `${o.amount}/${o.persons}px/${o.hoursPerDay}h`).join(', ')} (${x.room ?? '-'})`).join(' | ')}`,
      `dateModified: ${String(ld?.dateModified ?? '-')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------------
export const lionHostelTarifa: OfferAdapter = {
  key: 'lion-hostel-tarifa',
  name: 'Lion Hostel Tarifa by Rebels',
  kind: 'accommodation',
  operator: {
    name: 'Rebels Tarifa',
    websiteUrl: `${SITE}/`,
    rootDomain: 'rebelstarifa.com',
    contactEmail: 'info@rebelstarifa.com',
    phone: '+34628480100',
  },
  url: LION_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent(ctx) {
    const hostel = await page(LION_URL);
    const packs = await page(LION_PACKS_URL);
    let media: LionMedia[] | null = null;
    try { media = await fetchJson<LionMedia[]>(LION_MEDIA_URL); }
    catch (e) { ctx.note(`lion-hostel: media-library search failed (${(e as Error).message}); page photos only`); }
    return parseLionContent({ hostel, packs, media: Array.isArray(media) ? media : null });
  },
  async fetchSlots() {
    const packs = parseLionPacks(await page(LION_PACKS_URL));
    if (packs.length === 0 || packs.every(p => p.options.length === 0)) throw new Error('lion-hostel: no kitesurf + accommodation pack prices on /packs-kitesurf-accommodation/ (layout changed?)');
    return buildLionSlots(packs);
  },
};
