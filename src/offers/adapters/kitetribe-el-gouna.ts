// ---------------------------------------------------------------------------
// Kite Tribe, El Gouna (Red Sea, Egypt) - kitesurfing courses at the Kitepower station: group courses
// (2-3 students per instructor) and private courses (1 student per instructor). Replaces the bstoked
// listing 6955 "Kitesurfing Private and Partner Training" (host "Mia"; the listing names www.kitetribe.org).
//
// Data path (checked 2026-10-12): WordPress + Divi, server-rendered.
//   slots    /lessons/kitesurfing/ - "Our Prices for Kitesurfing Courses": Divi pricing cards
//            (.et_pb_pricing_table): title "Group Course" / "Private Course", subtitle
//            ".et_pb_best_value" ("Basic Beginner - 8h", "3 hour Refresher"), price ".et_pb_sum" with the
//            sign in ".et_pb_dollar_sign" (EUR), bullets (students per instructor, hours, inclusions).
//            No dates, no year, no booking engine: requests go through a contact form, e-mail or WhatsApp.
//   content  the same page (levels, spot, inclusions) + /contact-us/ ("Location: Kitepower, El Gouna",
//            e-mail, phone/WhatsApp).
//   photos   (2026-10-21) the lessons page only carries one real photo (the rest are 512x512 skill-level
//            icons), so photo candidates also come from three own pages that show the El Gouna station and
//            its lessons: / (private coaching, teaching on the beach, students jumping, team banner),
//            /about-us/why-kite-tribe/ (beginner course, lesson splashes, station beach) and
//            /about-us/el-gouna/ (Kitepower station, kite launch), plus the contact page's beach photo.
//            Kite-safari / camp / girls-trip / wing-foil teasers, staff headshots, skill icons and the
//            weather chart are dropped (other products or not photos). Best effort: a failed photo page
//            only costs its photos.
// Current operation: page dateModified 2026-03-05 (JSON-LD WebPage); the site's kite safari page lists
//   "2026 Safari Dates" up to 3-10 October (not read per run).
// robots.txt www.kitetribe.org (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 5 (lessons, contact, 3 photo pages), slots 1 (pages memoised for 10 minutes).
// Parsed: 10 slots = one per course card, EUR per student for the whole course (priceUnit 'package',
//   priceBasis 'person'), occupancy 1 for private courses, no dates, availability 'on_request'.
// Known limits:
//   - The bstoked title says "partner" training; the own site has no 2-person partner rate, only group
//     (2-3 students per instructor) and private (1 student) cards - both are emitted.
//   - The "3 hour Refresher" group card lists "8 hours" in its bullets (page error); the hours come from
//     the card subtitle.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitetribe.org';
export const KT_LESSONS_URL = `${SITE}/lessons/kitesurfing/`;
export const KT_CONTACT_URL = `${SITE}/contact-us/`;
/** own pages with El Gouna station / lesson photos (the lessons page has only one) */
export const KT_PHOTO_URLS = [`${SITE}/`, `${SITE}/about-us/why-kite-tribe/`, `${SITE}/about-us/el-gouna/`];

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Parse and drop script/style/template bodies (node-html-parser's .text includes them). */
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  return root;
}

export interface KtCourse {
  kind: 'Group' | 'Private';
  name: string;            // "Basic Beginner - 8h"
  hours: number | null;
  price: number;
  currency: string;
  students: string | null; // "2-3 students per instructor"
  bullets: string[];
}

/** Divi pricing cards of the lessons page. */
export function parseKtCourses(html: string): KtCourse[] {
  const root = visible(html);
  const out: KtCourse[] = [];
  for (const card of root.querySelectorAll('.et_pb_pricing_table')) {
    const title = txt(card.querySelector('.et_pb_pricing_title'));
    const kind = /private/i.test(title) ? 'Private' : /group/i.test(title) ? 'Group' : null;
    const name = txt(card.querySelector('.et_pb_best_value'));
    const sign = txt(card.querySelector('.et_pb_dollar_sign'));
    const price = parseAmount(txt(card.querySelector('.et_pb_sum')));
    const currency = detectCurrency(sign);
    if (!kind || !name || price === null || !currency) continue;
    const bullets = card.querySelectorAll('ul.et_pb_pricing li').map(li => txt(li)).filter(Boolean);
    const h = name.match(/(\d+)\s*(?:h\b|hours?)/i);
    out.push({
      kind, name,
      hours: h ? Number(h[1]) : null,
      price, currency,
      students: bullets.find(b => /students? per instructor/i.test(b)) ?? null,
      bullets,
    });
  }
  return out;
}

export function buildKtSlots(courses: KtCourse[]): Slot[] {
  return courses.map(c => ({
    key: slug(`${c.kind} ${c.name}`),
    startDate: null,
    endDate: null,
    unit: `${c.kind} course: ${c.name}${c.students ? ` (${c.students})` : ''}`,
    price: c.price,
    currency: c.currency,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: c.kind === 'Private' ? 1 : null,
    availability: 'on_request',
    availabilityText: 'Request via contact form, e-mail or WhatsApp (no online booking)',
    spotsLeft: null,
  }));
}

export interface KtContact { location: string | null; email: string | null; phone: string | null }
export function parseKtContact(html: string): KtContact {
  const t = txt(visible(html));
  return {
    location: t.match(/Location:\s*([^📩📞]+?)(?=\s*(?:📩|Email:|📞|Phone:|$))/u)?.[1]?.trim() ?? null,
    email: t.match(/Email:\s*([\w.+-]+@[\w.-]+\.[a-z]{2,})/i)?.[1] ?? null,
    phone: t.match(/Phone:\s*(\+[\d\s]{8,}\d)/)?.[1]?.replace(/\s+/g, '') ?? null,
  };
}

// --- content ----------------------------------------------------------------------
/**
 * Photo candidates across the own pages. Dropped: the "Explore your options" teasers (kite safari boat,
 * group travel, girls trip, camps), wing-foil photos, the 512x512 skill-level icons (Kite_beginner /
 * Kite_intermediate / Kite_advanced), staff headshots named after a person only, testimonials, the
 * weather chart and site chrome.
 */
export function ktPhotoCandidates(pages: Array<{ html: string; url: string }>): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (!p.html) continue;
    for (const u of imageCandidates(p.html, p.url, null, 40)) {
      if (/logo|trustindex|hyperdrop|gravatar|googleusercontent|\.svg|cropped-|safari|grouptravel|girlstrip|zodiac|ocean-dream|kite-camp|wing-?foil|testimonial|weather-chart|\/Kite_(?:beginner|intermediate|advanced)\.|\/(?:Ursi|Mia|Wael|naquib|Abdallah)\.|Kitetribe_team_|Kite-Tribe-Team-/i.test(u)) continue;
      if (!out.includes(u)) out.push(u);
    }
  }
  return out;
}

export function parseKtContent(lessonsHtml: string, contactHtml: string, photoPages: Array<{ html: string; url: string }> = []): OfferContent {
  const root = visible(lessonsHtml);
  const main = root.querySelector('#main-content') ?? root.querySelector('main') ?? root;
  const text = txt(main);
  const courses = parseKtCourses(lessonsHtml);
  const contact = parseKtContact(contactHtml);
  if (courses.length === 0) throw new Error('kitetribe: no course price cards found (page layout changed?)');

  const fmt = (n: number) => n.toLocaleString('en-US');
  const minOf = (k: KtCourse['kind']) => {
    const xs = courses.filter(c => c.kind === k);
    return xs.length ? xs.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  };
  const group = minOf('Group');
  const priv = minOf('Private');
  const cur = courses[0].currency;
  const beginner = courses.filter(c => /beginner/i.test(c.name)).map(c => c.hours).filter((h): h is number => h !== null);
  const refresher = courses.filter(c => /refresher/i.test(c.name)).map(c => c.hours).filter((h): h is number => h !== null);
  const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
  const list = (xs: number[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : String(xs[0] ?? ''));

  const location = contact.location ?? 'El Gouna, Egypt';
  const station = /kitepower/i.test(location) ? 'the Kitepower station' : 'its station';
  const summary = [
    `Kite Tribe teaches kitesurfing from ${station} at the northern end of El Gouna on the Egyptian Red Sea, where flat, shallow water and side-shore wind suit beginners and all other levels.`,
    `Group courses have 2-3 students per instructor and private courses one; all equipment in every kite size and its insurance are included, and beginner courses end with an IKO licence.`,
    `Beginner courses run ${list(uniq(beginner))} hours and refreshers ${list(uniq(refresher))} hours${group && priv ? `, from ${cur} ${fmt(group.price)} (group) and ${cur} ${fmt(priv.price)} (private) per student` : ''}.`,
    'Courses are booked by request through the contact form, e-mail or WhatsApp.',
  ].join(' ');

  const included = new Set<string>();
  for (const c of courses) for (const b of c.bullets) {
    if (/equipment and kite sizes/i.test(b)) included.add('All kite equipment and kite sizes');
    if (/insurance/i.test(b)) included.add('Insurance of all kite equipment');
    if (/IKO Li[cs]en[cs]e/i.test(b)) included.add('IKO licence after successful completion (beginner courses)');
  }

  const imageUrls = ktPhotoCandidates([
    { html: lessonsHtml, url: KT_LESSONS_URL },
    ...photoPages,
    { html: contactHtml, url: KT_CONTACT_URL },
  ]);

  return {
    kind: 'course',
    title: `Kite Tribe - ${txt(main.querySelector('h1')) || 'Kitesurfing Lessons in El Gouna'}`,
    summary,
    continent: 'Africa',
    country: 'Egypt',
    region: 'Red Sea Governorate',
    spot: 'El Gouna',
    itinerarySpots: [],
    durationDays: null,
    // page: "Beginner Lessons / Intermediate Lessons / Advanced Lessons" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'].filter(l => new RegExp(`${l} lessons`, 'i').test(text)),
    kiteLessons: true,
    // contact page: "assistance with lessons, gear rental, accommodation" (2026-10-12)
    equipmentRental: /gear rental/i.test(txt(visible(contactHtml))) ? true : null,
    beginnerFriendly: /absolute beginners|beginner lessons/i.test(text),
    includedServices: [...included],
    optionalServices: [],
    accommodation: null,
    mealPlan: null,
    languages: ['en', 'de'], // site hreflang en/de (2026-10-12); instruction languages not stated
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: KT_LESSONS_URL,
    bookingUrl: KT_CONTACT_URL,
    sourceText: [
      `lessons: ${text}`,
      `contact: location ${contact.location ?? '-'}; e-mail ${contact.email ?? '-'}; phone ${contact.phone ?? '-'}`,
      `courses: ${courses.map(c => `${c.kind} ${c.name} ${c.currency} ${c.price} (${c.students ?? '-'})`).join('; ')}`,
    ].join('\n'),
  };
}

export const kitetribeElGouna: OfferAdapter = {
  key: 'kitetribe-el-gouna',
  name: 'Kite Tribe - Kitesurfing Lessons El Gouna',
  kind: 'course',
  operator: {
    name: 'Kite Tribe',
    websiteUrl: `${SITE}/`,
    rootDomain: 'kitetribe.org',
    contactEmail: 'info@kitetribe.org', // /contact-us/, 2026-10-12
    whatsapp: '+201220172192',          // /contact-us/ "WhatsApp: +20 12 20172192", 2026-10-12
    phone: '+201220172192',
  },
  url: KT_LESSONS_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent(ctx) {
    const lessons = await page(KT_LESSONS_URL);
    const contact = await page(KT_CONTACT_URL);
    const photoPages: Array<{ html: string; url: string }> = [];
    for (const url of KT_PHOTO_URLS) {
      try { photoPages.push({ html: await page(url), url }); }
      catch (e) { ctx.note(`kitetribe: photo page ${url} failed (${(e as Error).message})`); }
    }
    return parseKtContent(lessons, contact, photoPages);
  },
  async fetchSlots() {
    const courses = parseKtCourses(await page(KT_LESSONS_URL));
    if (courses.length < 4) throw new Error(`kitetribe: course price cards not found or changed (${courses.length} parsed)`);
    return buildKtSlots(courses);
  },
};
