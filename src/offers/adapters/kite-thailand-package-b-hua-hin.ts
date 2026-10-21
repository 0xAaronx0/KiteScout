// ---------------------------------------------------------------------------
// Kite Thailand (kite school, shop and rental, headquarters 143/8 Soi 67, Hua Hin) - "Package B [ Hua Hin ]": a kite
// package at the Hua Hin school: 7 nights accommodation, 5 days of kitesurf lessons, 1 day supervised rental, meals,
// IKO licence + insurance and a daily SUP hour. One place, stay + lessons sold together -> KIND = 'camp'.
//
// This file also holds the shared Kite Thailand helpers (the Pranburi and Koh Phangan package adapters import them).
//
// DOUBTS (Aaron 2026-10-21: build anyway, keep the doubts visible):
//   - The package text is word for word the "Package B" of an old kiteboardingasia.com page, and the Koh Phangan
//     location page of this site says "our Kiteboarding Asia Koh Phangan center": the two brands are probably the same
//     or a related business (not confirmed).
//   - No hotel is named anywhere: the variants are only "With Basic / 2-4 Star / 5 Star Accomodation"; the two room
//     photos in the product gallery do not say which hotel they show.
//   - The location pages (/2018/06/19/kiteboarding-<place>/) print an older package table that disagrees with the shop:
//     Package A 26,500 THB (shop: 29,000), Package B "14 meals" (shop: "10 meals"). The shop product is what a guest can
//     buy, so its variation prices and description are used; the location page is read for the place facts and photos.
//   - The meal count ("10 meals + soft drink") is not split into breakfasts / dinners -> mealPlan stays free text.
//
// Data path (checked 2026-10-21): WordPress + WooCommerce variable product.
//   slots    the product form's own variation data (`data-product_variations`, the JSON the add-to-cart form uses;
//            helpers imported from kite-republic-aitutaki-winter-escape.ts): attribute "Prices" = accommodation
//            standard, per variation `display_price` and `is_in_stock`. Currency THB from the Product JSON-LD
//            (`priceCurrency`; the page prints "฿"). The package is undated (no dates, no season in the shop): one
//            undated slot per variation, priceUnit 'package' with packageNights from the description ("7 nights
//            accommodation"). priceBasis 'person' is INFERRED (a lesson package is sold per learner; the page does not
//            say "per person"). Out-of-stock variation -> 'sold_out'.
//   content  the product description (inclusions) + the location page (spot facts, photos).
// Flags: instantBooking yes (WooCommerce add to cart + checkout; the page loads the Omise card gateway; payment step not
//   tested). liveAvailability no: the shop does not manage stock for the packages (no stock count, no stock text; every
//   variation is simply "in stock"), and there are no dates to be available on.
// robots.txt (2026-10-21): only /wp-admin/ disallowed.
// Requests per run: 2 (product page + location page; memoised for content + slots, slots need only the product page).
// spotCoords: none (no coordinates on the site); the geocoder pins the place name.
// ---------------------------------------------------------------------------
import { memoPage, parseWooVariations, wooCurrency, wooOptionLabels, wpLines, type WooVariation } from './kite-republic-aitutaki-winter-escape.js';
import { clean, ldOfType, parse } from '../parse.js';
import type { OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const KT_SITE = 'https://www.kitethailand.com';

export const KT_OPERATOR: OperatorRef = {
  name: 'Kite Thailand',
  websiteUrl: `${KT_SITE}/`,
  rootDomain: 'kitethailand.com',
  contactEmail: 'info@kitethailand.com',
  phone: '+66815981253',
};

export interface KtConfig {
  key: string;
  name: string;
  /** "Hua Hin" - the place in the product title "[ Hua Hin ]" */
  place: string;
  productUrl: string;
  /** the site's location page for the place (spot facts + photos) */
  placeUrl: string;
  region: string;
  spot: string;
  /** pin when the geocoder cannot find the spot name (taken from another listing on the same beach) */
  spotCoords?: { lat: number; lng: number };
  /** one factual sentence about the spot, taken from the location page (checked 2026-10-21) */
  spotFacts: string;
  /** optional extras copied from another place's product that do not apply here */
  dropOptional?: RegExp;
}

// --- product page ---------------------------------------------------------------------------------
export interface KtProduct {
  name: string;
  /** "Hua Hin" from "Package B [ Hua Hin ]" */
  place: string | null;
  nights: number | null;
  lessonDays: number | null;
  meals: number | null;
  included: string[];
  optional: string[];
  currency: string | null;
  variations: Array<WooVariation & { option: string; label: string }>;
}

/** Description lines: from "N nights accommodation" (right after the "Description" heading) to "Additional information". */
function descriptionLines(lines: string[]): string[] {
  let from = lines.findIndex((l, i) => /nights? accommodation/i.test(l) && /^Description$/i.test(lines[i - 1] ?? ''));
  if (from < 0) from = lines.findIndex(l => /nights? accommodation/i.test(l));
  if (from < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(from)) {
    if (/^Additional information$/i.test(l)) break;
    out.push(l);
  }
  return out;
}

export function parseKtProduct(html: string): KtProduct {
  const lines = wpLines(html);
  const product = ldOfType(html, 'Product')[0];
  const name = clean(String(product?.name ?? parse(html).querySelector('h1.product_title')?.text ?? '')).replace(/\[\s*(.*?)\s*\]/, '[ $1 ]');
  const place = name.match(/\[\s*(.*?)\s*\]/)?.[1] ?? null;
  const desc = descriptionLines(lines);
  const optAt = desc.findIndex(l => /^OPTIONAL:?$/i.test(l));
  const included = (optAt >= 0 ? desc.slice(0, optAt) : desc).map(l => l.replace(/^\+\s*bonus:\s*/i, 'Bonus: ').replace(/\s+/g, ' '));
  const optional = optAt >= 0 ? desc.slice(optAt + 1) : [];
  const num = (re: RegExp) => { const m = desc.join('\n').match(re); return m ? Number(m[1]) : null; };
  const labels = new Map<string, string>();
  for (const sel of parse(html).querySelectorAll('select[name^="attribute_"]')) {
    const attr = sel.getAttribute('name')!.replace(/^attribute_/, '');
    for (const [v, l] of wooOptionLabels(html, attr)) labels.set(v, l);
  }
  const variations = parseWooVariations(html).map(v => {
    const option = Object.values(v.attributes)[0] ?? '';
    return { ...v, option, label: labels.get(option) ?? option.replace(/-/g, ' ') };
  });
  return {
    name,
    place,
    nights: num(/(\d+)\s*nights?\s+accommodation/i),
    lessonDays: num(/(\d+)\s*days?\s+of\s+kite\s*surfing\s+lessons/i),
    meals: num(/(\d+)\s*meals/i),
    included,
    optional,
    currency: wooCurrency(html),
    variations,
  };
}

/** "With 2-4 Star Accomodation" -> "2-4 star accommodation" (the shop misspells "accommodation"). */
export const ktUnit = (label: string): string =>
  label.replace(/^with\s+/i, '').replace(/accomodation/i, 'accommodation').replace(/\bStar\b/, 'star').replace(/\bBasic\b/, 'basic');

export function buildKtSlots(p: KtProduct): Slot[] {
  const out: Slot[] = [];
  for (const v of p.variations) {
    if (v.price === null || !p.currency) continue;
    const unit = ktUnit(v.label);
    const ok = v.inStock && v.purchasable;
    out.push({
      key: v.option || `variation-${v.id}`,
      startDate: null,
      endDate: null,
      unit,
      price: v.price,
      currency: p.currency,
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: null,
      availability: ok ? 'available' : 'sold_out',
      availabilityText: ok
        ? 'In stock in the Kite Thailand online shop (undated package; dates arranged with the school)'
        : (v.stockText ?? 'Out of stock in the online shop'),
      spotsLeft: null,
      packageNights: p.nights,
    });
  }
  return out;
}

// --- images -----------------------------------------------------------------------------------------
const SKIP_IMG = /logo|cropped-|icon|kids|placeholder/i;
const MIN_W = 500;

/** Photo URLs of the site's own uploads: product gallery (full size) + location page photos at least 500 px wide. */
export function ktImages(productHtml: string, placeHtml: string | null): string[] {
  const own = (u: string) => /^https:\/\/www\.kitethailand\.com\/wp-content\/uploads\//.test(u) && /\.(jpe?g|png|webp)$/i.test(u) && !SKIP_IMG.test(u);
  const gallery: string[] = [];
  for (const el of parse(productHtml).querySelectorAll('.woocommerce-product-gallery__image')) {
    const u = el.querySelector('img')?.getAttribute('data-large_image') ?? el.querySelector('a')?.getAttribute('href') ?? '';
    if (own(u) && !gallery.includes(u)) gallery.push(u);
  }
  const place: string[] = [];
  if (placeHtml) {
    const root = parse(placeHtml);
    // the post's own photo sits in <header class="entry-header">: drop only the site header
    for (const el of root.querySelectorAll('header#masthead,.site-header,footer,nav,#secondary,.widget-area')) el.remove();
    for (const img of root.querySelectorAll('img')) {
      const u = (img.getAttribute('data-src') ?? img.getAttribute('src') ?? '').replace(/-\d{2,4}x\d{2,4}(\.[a-z]+)$/i, '$1');
      const w = Number(img.getAttribute('width') ?? 0);
      if (own(u) && w >= MIN_W && !place.includes(u)) place.push(u);
    }
  }
  // best first: the product's main photo, then the place, then the remaining gallery (room photos)
  const out: string[] = [];
  for (const u of [...gallery.slice(0, 1), ...place, ...gallery.slice(1)]) if (!out.includes(u)) out.push(u);
  return out;
}

// --- content ---------------------------------------------------------------------------------------
const fmt = (n: number) => n.toLocaleString('en-US');

export function parseKtContent(cfg: KtConfig, productHtml: string, placeHtml: string | null): OfferContent {
  const p = parseKtProduct(productHtml);
  if (!p.nights) throw new Error(`${cfg.key}: no "N nights accommodation" line in the product description (layout changed?)`);
  const slots = buildKtSlots(p).sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const cur = p.currency ?? 'THB';
  // the Koh Phangan product copies the Hua Hin text ("Transfer from BKK airport to Hua Hin"): cfg.dropOptional
  const optional = p.optional.filter(l => !cfg.dropOptional?.test(l));
  const priceText = slots.length === 0
    ? 'The shop shows no price for it at the moment.'
    : slots.length === 1
      ? `It costs ${cur} ${fmt(slots[0].price!)} with ${slots[0].unit} (price per person inferred, undated: dates are arranged with the school).`
      : `Prices by accommodation standard: ${slots.map(s => `${cur} ${fmt(s.price!)} with ${s.unit}`).join(', ')} (per person inferred, undated: dates are arranged with the school).`;
  const pkg = p.name.replace(/\s*\[.*$/, '');
  const summary = [
    `Kite Thailand's ${pkg} at ${cfg.place} is a kitesurf package of ${p.nights} nights accommodation with ${p.lessonDays ?? 'several'} days of kitesurf lessons, one day of supervised rental, ${p.meals ? `${p.meals} meals with soft drinks` : 'meals'}, the IKO licence and insurance and a daily hour of stand up paddling.`,
    cfg.spotFacts,
    priceText,
    slots.length > 1 ? 'The shop does not name the hotel; you choose the accommodation standard.' : 'The shop does not name the hotel.',
  ].join(' ');
  const placeLines = placeHtml ? wpLines(placeHtml) : [];
  return {
    kind: 'camp',
    title: `Kite Thailand ${pkg}, ${cfg.place}`,
    summary,
    continent: 'Asia',
    country: 'Thailand',
    region: cfg.region,
    spot: cfg.spot,
    ...(cfg.spotCoords ? { spotCoords: cfg.spotCoords } : {}),
    itinerarySpots: [],
    durationDays: p.nights + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: p.included,
    optionalServices: optional,
    accommodation: `Hotel or guesthouse near the school (not named; ${slots.map(s => s.unit).join(' / ') || 'standard on request'})`,
    mealPlan: p.meals ? `${p.meals} meals + soft drinks during the stay` : null,
    languages: ['en'],
    rooms: [],
    imageUrls: ktImages(productHtml, placeHtml).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: cfg.productUrl,
    bookingUrl: cfg.productUrl,
    sourceText: [
      `product: ${p.name}`,
      `included: ${p.included.join(' | ')}`,
      `optional (as printed): ${p.optional.join(' | ')}`,
      `variations: ${p.variations.map(v => `${v.label}=${v.price}${v.inStock ? '' : ' (out of stock)'}`).join(', ')}; currency ${p.currency}`,
      `location page ${cfg.placeUrl}: ${placeLines.join('\n')}`,
    ].join('\n'),
  };
}

export async function fetchKtSlots(cfg: KtConfig, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const p = parseKtProduct(await memoPage(cfg.productUrl));
  if (!p.variations.length) throw new Error(`${cfg.key}: no variation data on the product page (layout changed?)`);
  if (!p.currency) throw new Error(`${cfg.key}: no priceCurrency in the Product JSON-LD`);
  if (p.place && p.place !== cfg.place) ctx?.note(`product title names "${p.place}", expected "${cfg.place}"`);
  return buildKtSlots(p);
}

export function makeKtAdapter(cfg: KtConfig): OfferAdapter {
  return {
    key: cfg.key,
    name: cfg.name,
    kind: 'camp',
    operator: KT_OPERATOR,
    url: cfg.productUrl,
    slotMethod: 'booking_engine',
    instantBooking: true,       // WooCommerce add to cart + checkout (Omise card gateway)
    fetchBudget: 3,
    async fetchContent(ctx) {
      const product = await memoPage(cfg.productUrl);
      let place: string | null = null;
      try { place = await memoPage(cfg.placeUrl); } catch (e) { ctx.note(`location page ${cfg.placeUrl}: ${(e as Error).message}`); }
      return parseKtContent(cfg, product, place);
    },
    fetchSlots: ctx => fetchKtSlots(cfg, ctx),
  };
}

// --- Package B, Hua Hin -------------------------------------------------------------------------------
export const KT_HUA_HIN: KtConfig = {
  key: 'kite-thailand-package-b-hua-hin',
  name: 'Kite Thailand Package B, Hua Hin',
  place: 'Hua Hin',
  productUrl: `${KT_SITE}/product/package-b-hua-hin/`,
  placeUrl: `${KT_SITE}/2018/06/19/kiteboarding-hua-hin/`,
  region: 'Prachuap Khiri Khan',
  spot: 'Hua Hin',
  spotFacts: 'Hua Hin, a seaside town on the Gulf of Thailand about three hours south of Bangkok, is the school\'s first location and headquarters, on a 6 km sandy beach with side-shore winds; the main season runs from October to May.',
};

export const kiteThailandPackageBHuaHin: OfferAdapter = makeKtAdapter(KT_HUA_HIN);
