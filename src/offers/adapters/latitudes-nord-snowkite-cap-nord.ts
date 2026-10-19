// ---------------------------------------------------------------------------
// Latitudes Nord tour (kind 'tour', itinerarySpots = the route): Snowkite exploration at the North Cape: Alta, Magerøya, Porsanger peninsula, Kvaløya (Finnmark).
// Listing row = journey 28 on www.latitudes-nord.fr/prochains-voyages; facts hand-read from its trip-sheet PDF.
// State 2026-10-19: only the 2026 date is listed (10 - 20 Mar 2026, past) -> 0 slots, summary "2027 dates not yet published".
// Parser, product data, robots / request notes and limits: latitudes-nord-finse-snowkite-weeks.ts (shared, memoised:
// the five Latitudes Nord adapters need 1 request per run together).
// ---------------------------------------------------------------------------
import type { OfferAdapter } from '../types.js';
import { LN_PRODUCTS, lnAdapter } from './latitudes-nord-finse-snowkite-weeks.js';

export const latitudesNordSnowkiteCapNord: OfferAdapter = lnAdapter(LN_PRODUCTS.capnord);
