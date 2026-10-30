// ---------------------------------------------------------------------------
// KiteMotion "Kurs kitesurf + nocleg" (kite course + accommodation), Diani Beach (Kenya) - the Polish-run IKO school's
// package: 6 hours of private (1:1) kite lessons with gear and rescue boat, plus either 7 nights in a private room in
// one of the school's Kite Houses (a second, non-kiting person stays free) or 10 nights in a shared dorm; beachfront
// villa with pool, cleaning and security. Breakfast optional (EUR 5 per day and person).
//
// Data path (checked 2026-10-19): WordPress (Gutenberg / Getwid), ONE page in Polish,
//   https://kitemotion.pl/kurs-kitesurf-wraz-z-noclegiem/ (dateModified 2026-05-18). The block under the heading
//   "Cena 650€ / osobę" lists "6 godzin prywatnych lekcji kitesurfingu", "7 noclegów w jednym z naszych Kite House +
//   pobyt dla drugiej osoby gratis (pokój prywatny) lub;", "10 noclegów w pokoju wieloosobowym ..." and the validity
//   "lekcje kitesurfingu realizowane w terminie 01.06.2026 – 05.03.2028". Booking: WhatsApp / e-mail / form
//   ("we check room availability and send the prepayment instructions") -> on_request, no engine.
// robots.txt kitemotion.pl (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Slots: 2 bands over the printed validity (private room 7 nights / dorm 10 nights), EUR per person (the kiter; the
//   free second person in the private room is in the slot text), priceUnit 'package', packageNights 7 / 10. A band
//   whose end has passed is dropped.
// Known limits: "liczba miejsc ograniczona" (limited places) is generic sales copy, not a shortage signal.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const KM_URL = 'https://kitemotion.pl/kurs-kitesurf-wraz-z-noclegiem/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  return root;
}
const dmy = (s: string): string => { const [d, m, y] = s.split('.'); return `${y}-${m}-${d}`; };

export interface KmPackage {
  price: number | null;
  currency: string | null;
  hours: number | null;
  privateNights: number | null;
  dormNights: number | null;
  validFrom: string | null;
  validTo: string | null;
  items: string[];
}

export function parseKmPackage(html: string): KmPackage {
  const root = visible(html);
  const head = root.querySelectorAll('h2').find(h => /Cena\s*\d/i.test(h.text));
  const block = head?.parentNode as HTMLElement | undefined;
  const items = (block?.querySelectorAll('li') ?? []).map(li => collapse(li.text)).filter(Boolean);
  const all = items.join(' | ');
  const headText = collapse(head?.text ?? '');
  const valid = all.match(/(\d{2}\.\d{2}\.\d{4})\s*[–—-]\s*(\d{2}\.\d{2}\.\d{4})/);
  return {
    price: head ? parseAmount(headText) : null,
    currency: /€|EUR/i.test(headText) ? 'EUR' : null,
    hours: Number(all.match(/(\d+)\s*godzin\S*\s+prywatnych lekcji/i)?.[1]) || null,
    privateNights: Number(all.match(/(\d+)\s*nocleg\S*\s+w jednym z naszych Kite House/i)?.[1]) || null,
    dormNights: Number(all.match(/(\d+)\s*nocleg\S*\s+w pokoju wieloosobowym/i)?.[1]) || null,
    validFrom: valid ? dmy(valid[1]) : null,
    validTo: valid ? dmy(valid[2]) : null,
    items,
  };
}

export function buildKmSlots(p: KmPackage, today: string): Slot[] {
  if (p.validTo && p.validTo < today) return [];
  const rows = [
    { key: 'private-room', nights: p.privateNights, unit: `Private room in a Kite House, ${p.privateNights} nights (a second, non-kiting person stays free)` },
    { key: 'dorm', nights: p.dormNights, unit: `Shared dorm, ${p.dormNights} nights (kite course participants only)` },
  ].filter(r => r.nights);
  return rows.map(r => ({
    key: r.key,
    startDate: p.validFrom,
    endDate: p.validTo,
    // A validity window, not a departure: it stays bookable until it ends (as a 'day' slot it dropped out on validFrom).
    datePrecision: 'season' as const,
    unit: r.unit,
    price: p.price,
    currency: p.price !== null ? p.currency ?? 'EUR' : null,
    priceUnit: p.price !== null ? 'package' as const : null,
    priceBasis: p.price !== null ? 'person' as const : null,
    occupancy: 1,
    availability: 'on_request' as const,
    availabilityText: `${p.hours ?? 6} h private lessons + ${r.nights} nights; book via WhatsApp or e-mail (room availability checked, then prepayment)`,
    spotsLeft: null,
    packageNights: r.nights,
  }));
}

export function parseKmContent(html: string): OfferContent {
  const p = parseKmPackage(html);
  const text = collapse(visible(html).structuredText);
  const summary = [
    `KiteMotion, a Polish-run IKO kite school at Diani Beach on Kenya's south coast, sells a course-and-stay package: ${p.hours ?? 6} hours of private one-to-one kite lessons with all gear and a rescue boat, plus ${p.privateNights ?? 7} nights in a private room in one of the school's Kite Houses (a second, non-kiting person stays free) or ${p.dormNights ?? 10} nights in a shared dorm.`,
    `The beachfront villa has a pool, cleaning and security; breakfast is optional (EUR 5 per day).`,
    p.price ? `Price EUR ${p.price} per person${p.validFrom && p.validTo ? `, lessons between ${p.validFrom} and ${p.validTo}` : ''}; booking by WhatsApp or e-mail.` : 'Price on request.',
  ].join(' ');
  return {
    kind: 'camp',
    title: 'KiteMotion Kite Course + Accommodation, Diani Beach',
    summary,
    continent: 'Africa',
    country: 'Kenya',
    region: 'Kwale County (South Coast)',
    spot: 'Diani Beach',
    itinerarySpots: [],
    durationDays: (p.privateNights ?? 7) + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: [
      `${p.hours ?? 6} hours of private (1:1) kite lessons with an IKO instructor`,
      `${p.privateNights ?? 7} nights in a private room (second person free) or ${p.dormNights ?? 10} nights in a shared dorm`,
      'Kite equipment during the lessons',
      'Rescue boat',
      'IKO certificate after the course',
      'Villa with pool, cleaning, security and direct beach access',
      'Wi-Fi',
    ],
    optionalServices: ['Breakfast (EUR 5 per day and person)', 'Airport transfer from Mombasa or Ukunda (price on request)', 'Laundry'],
    accommodation: 'beachfront kite villa with pool (private rooms or shared dorm)',
    mealPlan: 'self_catering',
    languages: ['pl', 'en'],
    rooms: [],
    imageUrls: imageCandidates(html, KM_URL, null, 30).filter(u => !/logo|fav|cta-bg|ADHD_SHINN|svgrepo|\.svg$/i.test(u)),
    heroVideoUrl: null,
    sourceUrl: KM_URL,
    bookingUrl: KM_URL,
    sourceText: text,
  };
}

export async function fetchKmSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const p = parseKmPackage(await page(KM_URL));
  if (p.price === null || (!p.privateNights && !p.dormNights)) throw new Error('kitemotion: "Cena ... / osobę" package block not found (layout changed?)');
  const slots = buildKmSlots(p, today);
  if (slots.length === 0) ctx?.note(`package validity ended ${p.validTo}; no new period printed yet`);
  return slots;
}

export const kitemotionCourseStayDiani: OfferAdapter = {
  key: 'kitemotion-course-stay-diani',
  name: 'KiteMotion Kite Course + Accommodation, Diani Beach',
  kind: 'camp',
  operator: {
    name: 'KiteMotion',
    websiteUrl: 'https://kitemotion.pl/',
    rootDomain: 'kitemotion.pl',
    contactEmail: 'kontakt@kitemotion.pl',
    whatsapp: '+254792443761',
    phone: '+254792443761',
  },
  url: KM_URL,
  slotMethod: 'price_table',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseKmContent(await page(KM_URL));
  },
  fetchSlots: ctx => fetchKmSlots(new Date().toISOString().slice(0, 10), ctx),
};
