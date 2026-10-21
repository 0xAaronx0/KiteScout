// ---------------------------------------------------------------------------
// Latitudes Nord tour (kind 'tour', itinerarySpots = the route): Snowkite itinerant "LIGHT", hut to hut on the Ryfylke and Setesdal plateaus (southern Norway).
// Listing row = journey 45 on www.latitudes-nord.fr/prochains-voyages; facts hand-read from its trip-sheet PDF.
// State 2026-10-19: only the 2026 date is listed (24 Feb - 8 Mar 2026, past) -> 0 slots, summary "2027 dates not yet published".
// Photos: listing vignette + 9 picks from the own trip report "Nomads of the wind !" (+1 request, LN_STORIES).
// Parser, product data, robots / request notes and limits: latitudes-nord-finse-snowkite-weeks.ts (shared, memoised:
// the five Latitudes Nord adapters need 1 request per run together).
// ---------------------------------------------------------------------------
import type { OfferAdapter } from '../types.js';
import { LN_PRODUCTS, lnAdapter } from './latitudes-nord-finse-snowkite-weeks.js';

export const latitudesNordSnowkiteLightRyfylkeSetesdal: OfferAdapter = lnAdapter(LN_PRODUCTS.light);
