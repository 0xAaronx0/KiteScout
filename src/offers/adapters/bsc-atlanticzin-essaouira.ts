// ---------------------------------------------------------------------------
// Offer adapter: Atlanticzin Watersports "8 Day Beginner or Intermediate Pack Kitesurf Camp",
// Essaouira (Morocco), listed on BookSurfCamps.com (Tripaneer marketplace).
//
// BLOCKED (2026-10-09): www.booksurfcamps.com answers HTTP 403 (Cloudflare) to our honest
//   KiteScoutBot User-Agent, although robots.txt allows the listing path. We never spoof a browser
//   UA or bypass the challenge, so fetch() throws a clear error. Honest access would need the
//   platform's partner/affiliate feed. The parsers below are written and tested against a fixture
//   captured with the built-in browser (raw server HTML re-fetched in-page, reduced to the parts the
//   parser reads, whitespace collapsed, non-ASCII as numeric entities; SHA-256 verified on transfer).
// Data path (when access exists): ONE listing page. Each package radio input
//   (input.package-selection-item) carries data-nr-persons, data-title and data-availability, a
//   per-arrival-date calendar string. Format, from the site's own decoder in /static/js/listing.js:
//     "YYMMDD<type>[<slots:2>]<price>#<discountedPrice>[-<repeat>]" for the first entry, then
//     "<dayOffset:4><type>[<slots:2>]<price>#<discountedPrice>[-<repeat>]" for each next run
//     (offset counted from the day after the previous entry). type 1 + slots > 0 = "guaranteed"
//     (slots left); type 0 = bookable on request. Seen in the browser 2026-10-09: Oct 2026 cells
//     (type 0) render "day available" with the CTA "Request to book", Jan 2027 cells (type 1, slots 6)
//     render "day available guaranteed". Dates not listed = not bookable.
//   Prices are package totals for data-nr-persons people ("EUR 890 Total price" for 2 persons).
// robots.txt www.booksurfcamps.com (checked 2026-10-09): "User-Agent: * Allow: /" for listings;
//   */json/*, */sr, query filters and */affiliates are disallowed (not used).
// Requests per run: 1 (content + slots share one memoised fetch) - currently answered with 403.
// Slots: month bands (key `<room option>|YYYY-MM`) for 6 months from the first calendar date, one per
//   package option; price = lowest total in the band / persons (per person, occupancy = persons),
//   priceUnit 'per_week' (8-day package, daily arrival), availability from the calendar types.
// Operator: Atlanticzin Watersports. atlanticzin.com is a parked domain (2026-10-09); the camp is run
//   from "Riad Inna & Watersports Center" (same address, 30 Rue/Ave Sidi Mohamed Ben Abdellah,
//   Essaouira), whose own site is riadinna.com -> used as operator domain (inferred, see report).
// ---------------------------------------------------------------------------
import { BlockedByHost, fetchText, HttpStatusError } from '../http.js';
import { parse, collapse, ldOfType, iso, imageCandidates, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

export const BSC_URL = 'https://www.booksurfcamps.com/atlanticzin-watersports/8-day-beginner-or-intermediate-pack-kitesurf-camp-in-essaouira-marrakesh-safi';
const DAY = 86_400_000;
const HORIZON_MONTHS = 6;

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url).catch((e: unknown) => {
    if (e instanceof BlockedByHost || (e instanceof HttpStatusError && e.status === 503)) {
      const why = e instanceof BlockedByHost ? e.reason : `HTTP ${e.status}`;
      throw new Error(`booksurfcamps.com refuses KiteScoutBot (${why}, Cloudflare bot protection) for ${url}; `
        + 'no honest access without a BookSurfCamps/Tripaneer partner feed - adapter blocked, not bypassed', { cause: e });
    }
    throw e;
  });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const round2 = (n: number): number => Math.round(n * 100) / 100;

// --- calendar decoding (port of listing.js) -----------------------------------------
export interface BscDay { date: string; type: number; slots: number | null; price: number; discountedPrice: number | null }

export function decodeBscAvailability(attr: string): BscDay[] {
  const out: BscDay[] = [];
  let cur = 0;
  const entries = attr.split(',');
  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i].trim();
    if (!raw) continue;
    const hash = raw.indexOf('#');
    if (hash < 0) throw new Error(`bsc: calendar entry without "#": ${raw}`);
    const [g, rep] = raw.split('-');
    const repeat = rep !== undefined ? parseInt(rep, 10) : 1;
    const disc = parseInt(g.slice(hash + 1), 10);
    let type: number; let price: number; let slots: number | null = null;
    if (i > 0) {
      cur += parseInt(g.slice(0, 4), 10) * DAY;
      type = parseInt(g.slice(4, 5), 10);
      if (type === 1) { slots = parseInt(g.slice(5, 7), 10); price = parseInt(g.slice(7, hash), 10); }
      else price = parseInt(g.slice(5, hash), 10);
    } else {
      cur = Date.UTC(2000 + parseInt(g.slice(0, 2), 10), parseInt(g.slice(2, 4), 10) - 1, parseInt(g.slice(4, 6), 10));
      type = parseInt(g.slice(6, 7), 10);
      if (type === 1) { slots = parseInt(g.slice(7, 9), 10); price = parseInt(g.slice(9, hash), 10); }
      else price = parseInt(g.slice(7, hash), 10);
    }
    if (!Number.isFinite(cur) || !Number.isFinite(price)) throw new Error(`bsc: undecodable calendar entry ${raw}`);
    for (let q = 0; q < (Number.isFinite(repeat) && repeat > 0 ? repeat : 1); q++) {
      out.push({ date: isoOf(cur), type, slots, price, discountedPrice: Number.isFinite(disc) ? disc : null });
      cur += DAY;
    }
  }
  return out;
}

export interface BscPackage { id: string; title: string; persons: number; personsTitle: string; subtitle: string; facilities: string[]; images: string[]; accommodation: string; days: BscDay[] }

export function bscPackages(html: string): BscPackage[] {
  const root = parse(html);
  return root.querySelectorAll('input.package-selection-item[data-availability]').map(el => ({
    id: el.getAttribute('data-id') ?? el.getAttribute('value') ?? '',
    title: collapse(el.getAttribute('data-title') ?? ''),
    persons: Number(el.getAttribute('data-nr-persons') ?? NaN),
    personsTitle: collapse(el.getAttribute('data-nr-persons-title') ?? ''),
    subtitle: collapse(el.getAttribute('data-subtitle') ?? ''),
    facilities: (el.getAttribute('data-room-facilities') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    images: (el.getAttribute('data-package-images') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    accommodation: collapse(el.getAttribute('data-accommodation-description') ?? ''),
    days: decodeBscAvailability(el.getAttribute('data-availability') ?? ''),
  }));
}

function productLd(html: string): Record<string, unknown> | null {
  return ldOfType(html, 'Product')[0] ?? null;
}

// --- slots ------------------------------------------------------------------------
export function parseBscSlots(html: string, months = HORIZON_MONTHS): Slot[] {
  const pkgs = bscPackages(html);
  if (pkgs.length === 0) throw new Error('bsc: no package options with data-availability (page layout changed?)');
  const offer = productLd(html)?.offers as Record<string, unknown> | undefined;
  const currency = typeof offer?.priceCurrency === 'string' ? offer.priceCurrency : null;
  if (!currency) throw new Error('bsc: no JSON-LD priceCurrency');

  const slots: Slot[] = [];
  for (const p of pkgs) {
    if (!p.days.length || !Number.isFinite(p.persons) || p.persons < 1) continue;
    const unit = `${p.title} (${p.personsTitle})`;
    const first = p.days[0].date;
    const last = p.days[p.days.length - 1].date;
    let y = Number(first.slice(0, 4)); let m = Number(first.slice(5, 7));
    for (let k = 0; k < months; k++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const monthStart = iso(y, m, 1);
      const monthEnd = iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
      if (monthStart > last) break;
      const band = p.days.filter(d => d.date.startsWith(ym));
      const key = `${slug(unit)}|${ym}`;
      if (band.length === 0) {
        slots.push({ key, startDate: monthStart < first ? first : monthStart, endDate: monthEnd, unit, price: null, currency: null,
          priceUnit: null, priceBasis: null, occupancy: p.persons, availability: 'closed', availabilityText: 'no arrival dates', spotsLeft: null });
      } else {
        const eff = (d: BscDay) => (d.discountedPrice && d.discountedPrice > 0 && d.discountedPrice < d.price ? d.discountedPrice : d.price);
        const total = Math.min(...band.map(eff));
        const instant = band.filter(d => d.type === 1 && (d.slots ?? 0) > 0);
        const maxSlots = instant.length ? Math.max(...instant.map(d => d.slots ?? 0)) : null;
        slots.push({
          key,
          startDate: band[0].date,
          endDate: band[band.length - 1].date,
          unit,
          price: round2(total / p.persons),
          currency,
          priceUnit: 'per_week',
          priceBasis: 'person',
          occupancy: p.persons,
          availability: instant.length ? (maxSlots! <= 2 ? 'limited' : 'available') : 'on_request',
          availabilityText: instant.length ? 'Guaranteed availability' : 'Request to book', // calendar cell class "guaranteed" vs CTA "Request to book"
          spotsLeft: maxSlots,
        });
      }
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return slots;
}

// --- content ----------------------------------------------------------------------
const LANG: Record<string, string> = { english: 'en', arabic: 'ar', french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', italian: 'it', dutch: 'nl' };

export function parseBscContent(html: string, url = BSC_URL): OfferContent {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  const title = txt(root.querySelector('h1'));
  const intro = txt(root.querySelector('.listing-overview__introduction'));
  const summary = (intro.match(/[^.!?]+[.!?]/g) ?? [intro]).slice(0, 3).join(' ').replace(/\s+/g, ' ').trim();
  const list = (sel: string) => root.querySelectorAll(`${sel} li`).map(li => txt(li)).filter(Boolean);
  const listAfter = (heading: RegExp) => {
    const h = root.querySelectorAll('h3').find(x => heading.test(txt(x)));
    const ul = h?.nextElementSibling;
    return ul?.tagName === 'UL' ? ul.querySelectorAll('li').map(li => txt(li)) : [];
  };
  const skills = listAfter(/^skill level/i).map(s => s.toLowerCase()).filter(s => ['beginner', 'intermediate', 'advanced'].includes(s));
  const included = list('[data-attr="lp-whats-included"]');
  const meals = listAfter(/meals are included/i).map(s => s.toLowerCase());
  const duration = txt(root.querySelector('.listing-query-box__duration'));       // "8 days / 7 nights"
  const days = Number(duration.match(/(\d+)\s*days/i)?.[1] ?? NaN);
  const transfers = root.querySelectorAll('.listing-overview__airport').map(d => txt(d).replace(/^Airport transfer available:\s*/i, 'Airport transfer: '));
  const pkgs = bscPackages(html);
  const rooms: ContentRoom[] = pkgs.map(p => ({ name: `${p.title} (${p.personsTitle})`, description: p.subtitle || null, features: p.facilities }));

  const instruction = txt(root.querySelector('.listing-overview_languages')).match(/instruction in\s+(\w+)/i)?.[1];
  const alsoSpeaks = (txt(root.querySelector('.listing-overview__notes')).match(/also speaks:\s*([A-Za-z ,]+?)(?:\s+Group size|$)/i)?.[1] ?? '').split(',');
  const languages = [...new Set([instruction ?? '', ...alsoSpeaks].map(s => LANG[s.trim().toLowerCase()]).filter((x): x is string => !!x))];

  const crumbs = ldOfType(html, 'BreadcrumbList')[0]?.itemListElement as Array<{ item?: { name?: string } }> | undefined;
  const country = crumbs?.find(c => /morocco/i.test(c.item?.name ?? ''))?.item?.name ?? (title.split(',').pop()?.trim() || 'Morocco');
  const region = title.match(/,\s*([^,]+),\s*[^,]+$/)?.[1]?.trim() ?? null;          // "..., Essaouira, Marrakesh-Safi, Morocco"

  const ld = productLd(html);
  const ldImages = Array.isArray(ld?.image) ? (ld!.image as string[]) : [];
  const imageUrls = [...new Set([...ldImages, ...pkgs.flatMap(p => p.images), ...imageCandidates(html, url, null, 40)])]
    .filter(u => !/\/static\/|unpkg\.com/.test(u));

  const accommodationFirst = pkgs[0]?.accommodation.match(/^[^.]+\./)?.[0] ?? null;

  return {
    kind: 'camp',
    title,
    summary,
    continent: 'Africa',
    country,
    region,
    spot: /Essaouira/i.test(title) ? 'Essaouira bay' : null,
    itinerarySpots: [],
    durationDays: Number.isFinite(days) ? days : null,
    skillLevels: skills,
    kiteLessons: true,
    equipmentRental: included.some(i => /equipment rental/i.test(i)),
    beginnerFriendly: skills.includes('beginner'),
    includedServices: included,
    optionalServices: transfers,
    accommodation: accommodationFirst ? `${accommodationFirst} Private double or triple rooms with bathroom.` : null,
    mealPlan: meals.length === 1 && meals[0] === 'breakfast' ? 'breakfast' : (meals.join(', ') || null),
    languages,
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: url,
    bookingUrl: url,
    sourceText: [txt(root.querySelector('.listing-title')), txt(root.querySelector('.listing-overview')), txt(root.querySelector('#accordion')),
      txt(root.querySelector('.listing-organizer-card')), txt(root.querySelector('.listing-primary-cta-box'))].filter(Boolean).join('\n\n'),
  };
}

export const bscAtlanticzinEssaouira: OfferAdapter = {
  key: 'bsc-atlanticzin-essaouira',
  name: 'Atlanticzin Watersports - 8 Day Kitesurf Camp Essaouira (BookSurfCamps)',
  kind: 'camp',
  operator: {
    name: 'Atlanticzin Watersports',
    websiteUrl: 'https://www.riadinna.com/', // inferred operator site, see header
    rootDomain: 'riadinna.com',
  },
  url: BSC_URL,
  slotMethod: 'platform',
  fetchBudget: 2,
  async fetchContent() {
    return parseBscContent(await page(BSC_URL), BSC_URL);
  },
  async fetchSlots() {
    return parseBscSlots(await page(BSC_URL));
  },
};
