// ---------------------------------------------------------------------------
// Latitudes Nord tour (kind 'tour', itinerarySpots = the route): Snowkite exploration on the Nordkinn and Varanger peninsulas (Finnmark); the route order follows the title, the trip sheet fixes no daily program.
// Listing row = journey 46 on www.latitudes-nord.fr/prochains-voyages; facts hand-read from its trip-sheet PDF.
// State 2026-10-19: only the 2026 date is listed (22 Mar - 1 Apr 2026, past) -> 0 slots, summary "2027 dates not yet published".
// Photos: listing vignette + 11 picks from the own report "Snowkite en Péninsule du Varanger" (+1 request, LN_STORIES).
// Parser, product data, robots / request notes and limits: latitudes-nord-finse-snowkite-weeks.ts (shared, memoised:
// the five Latitudes Nord adapters need 1 request per run together).
// ---------------------------------------------------------------------------
import type { OfferAdapter } from '../types.js';
import { LN_PRODUCTS, lnAdapter } from './latitudes-nord-finse-snowkite-weeks.js';

export const latitudesNordSnowkiteNordkinnVaranger: OfferAdapter = lnAdapter(LN_PRODUCTS.varanger);
