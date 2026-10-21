// ---------------------------------------------------------------------------
// Kite Thailand - "Package A [ Pranburi ]": a kite package at the school's Pranburi facility (lessons on Pak Nam Pran
// beach, about 30 km south of Hua Hin): 5 nights accommodation, 3 days of kitesurf lessons, 1 day supervised rental,
// 10 meals, IKO licence + insurance, a daily SUP hour. One place, stay + lessons -> KIND = 'camp'.
//
// DOUBTS (Aaron 2026-10-21: build anyway): the package text matches an old kiteboardingasia.com page (the two brands
// may be one business) and no hotel is named. The location page prints Package A at 26,500 THB, the shop sells it at
// 29,000 THB: the shop variation is used. The shop's "Additional information" tab lists three standards, but only the
// "With 2-4 Star Accomodation" variation exists -> one slot.
//
// Data path, flags, robots and helpers: see kite-thailand-package-b-hua-hin.ts (shared Kite Thailand helpers).
//   slots    WooCommerce variation data of the product page (undated, THB, package of 5 nights, per person inferred).
//   content  product description + location page /2018/06/19/kiteboarding-pranburi/.
// Requests per run: 2 (product page + location page; slots only the product page).
// Region / spot: as the Praseban Resort adapter for the same beach ('Prachuap Khiri Khan' / 'Pak Nam Pran, Pranburi').
// ---------------------------------------------------------------------------
import { KT_SITE, makeKtAdapter, type KtConfig } from './kite-thailand-package-b-hua-hin.js';
import type { OfferAdapter } from '../types.js';

export const KT_PRANBURI: KtConfig = {
  key: 'kite-thailand-package-a-pranburi',
  name: 'Kite Thailand Package A, Pranburi',
  place: 'Pranburi',
  productUrl: `${KT_SITE}/product/package-a-pranburi/`,
  placeUrl: `${KT_SITE}/2018/06/19/kiteboarding-pranburi/`,
  region: 'Prachuap Khiri Khan',
  spot: 'Pak Nam Pran, Pranburi',
  spotCoords: { lat: 12.3482, lng: 99.9974 }, // same beach pin as praseban-resort-pak-nam-pran, set by the lead 2026-10-21
  spotFacts: 'The lessons take place on Pak Nam Pran beach in Pranburi, about 30 km south of Hua Hin near Sam Roi Yot National Park, on wide and uncrowded beaches.',
};

export const kiteThailandPackageAPranburi: OfferAdapter = makeKtAdapter(KT_PRANBURI);
