// ---------------------------------------------------------------------------
// Kite Thailand - "Package B [ Koh Phangan ]": a kite package at the school's Koh Phangan centres (two locations on the
// island, used by season): 7 nights accommodation, 5 days of kitesurf lessons, 1 day supervised rental, 10 meals,
// IKO licence + insurance, a daily SUP hour. One place, stay + lessons -> KIND = 'camp'.
//
// DOUBTS (Aaron 2026-10-21: build anyway): the package text matches an old kiteboardingasia.com page, and the Koh
// Phangan location page itself says "our Kiteboarding Asia Koh Phangan center" (the two brands are probably one
// business); no hotel is named. The product is a copy of the Hua Hin Package B (same prices, same text, even
// "OPTIONAL: Transfer from BKK airport to Hua Hin THB 2,000"): that Hua Hin transfer line is left out of the optional
// services here (kept in sourceText). Which of the two island centres the package uses is not said.
//
// Data path, flags, robots and helpers: see kite-thailand-package-b-hua-hin.ts (shared Kite Thailand helpers).
//   slots    WooCommerce variation data of the product page (undated, THB, package of 7 nights, per person inferred).
//   content  product description + location page /2018/06/19/kiteboarding-koh-phangan/.
// Requests per run: 2 (product page + location page; slots only the product page).
// ---------------------------------------------------------------------------
import { KT_SITE, makeKtAdapter, type KtConfig } from './kite-thailand-package-b-hua-hin.js';
import type { OfferAdapter } from '../types.js';

export const KT_KOH_PHANGAN: KtConfig = {
  key: 'kite-thailand-package-b-koh-phangan',
  name: 'Kite Thailand Package B, Koh Phangan',
  place: 'Koh Phangan',
  productUrl: `${KT_SITE}/product/package-b-koh-phangan/`,
  placeUrl: `${KT_SITE}/2018/06/19/kiteboarding-koh-phangan/`,
  region: 'Surat Thani',
  spot: 'Koh Phangan',
  spotFacts: 'Koh Phangan lies in the Gulf of Thailand between Koh Samui and Koh Tao; the school runs two centres on the island and opens the one that suits the season, so kiting is possible all year.',
  dropOptional: /Hua Hin/i,
};

export const kiteThailandPackageBKohPhangan: OfferAdapter = makeKtAdapter(KT_KOH_PHANGAN);
