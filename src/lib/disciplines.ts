// ---------------------------------------------------------------------------
// Disciplines of a cruise offer (cruise_offers.disciplines). Package offers get theirs from the adapter
// (OfferAdapter.disciplines); cruises have no adapter, so the extractor derives them from the operator's own
// trip description. On a kite cruise every wing mention in title / summary / services is something done from
// the boat (wing sessions, coaching, lessons or gear aboard), so a mention is enough here - unlike a hotel page,
// where "the spot suits wing foiling" does not make the stay a wing offer.
// ---------------------------------------------------------------------------
import type { Discipline } from '../offers/types.js';

/** wing foil / wingsurf / "Kite & Wing" / "kite/wing course"; not "sub-wing" (an underwater tow toy) */
const WING_RX = /\bwing[ -]?(?:foil|surf)\w*|\bwingfoil\w*|(?<!sub-)\bwing(?:s|ing)?\b/i;

export interface CruiseDisciplineInput {
  title?: string | null;
  summary?: string | null;
  included_services?: string[] | null;
  optional_services?: string[] | null;
}

/** cruises are water trips: always kitesurf, plus wingfoil when the trip offers it */
export function cruiseDisciplines(o: CruiseDisciplineInput): Discipline[] {
  const text = [o.title, o.summary, ...(o.included_services ?? []), ...(o.optional_services ?? [])]
    .filter(Boolean).join(' | ');
  return WING_RX.test(text) ? ['kitesurf', 'wingfoil'] : ['kitesurf'];
}
