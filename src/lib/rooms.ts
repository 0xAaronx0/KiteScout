// ---------------------------------------------------------------------------
// Room / cabin types, shared by package_offers and cruise_offers (`rooms` jsonb,
// migrations 20260925120000 + 20260930120000), and their ready-to-show photo captions.
// ---------------------------------------------------------------------------
export type PriceUnit = 'package' | 'per_night' | 'per_day' | 'other';
/** Rooms can also be priced per cabin (cruises); listing-level price_unit has a DB check without it. */
export type RoomPriceUnit = PriceUnit | 'per_cabin';

/** A room / cabin type. bstoked: price = lowest of 12 monthly samples, 2 guests; cruises from text: as stated there. */
export interface Room {
  name: string;
  description: string | null;
  features: string[];
  price_from: number | null;          // null = price on request
  price_currency: string | null;
  price_unit: RoomPriceUnit | null;
  /** where price_from comes from; cruise prices are monitored only on the provider site */
  price_source?: 'bstoked' | 'provider_site' | null;
  priced_months: number[];            // bstoked: months (1-12) with a sampled price; [] = not sampled
  image_sort: number | null;          // sort of this room's captioned photo in `images` (null = none)
  /** scrape-time only: the room's first photo on bstoked; replaced by image_sort on seed */
  photo_url?: string | null;
}

export function roomCaption(r: Room): string {
  if (r.price_from === null) return `${r.name} · price on request`;
  const unit = r.price_unit === 'per_night' ? ' / night p.p.' : r.price_unit === 'per_day' ? ' / day p.p.'
    : r.price_unit === 'per_cabin' ? ' per cabin' : ' p.p.';
  return `${r.name} · from ${r.price_currency ?? 'EUR'} ${r.price_from.toLocaleString('en-US')}${unit}`;
}
