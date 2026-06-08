import type { AvailabilityResult, ProviderResult } from './types';

// "Data richness" scoring used to order the deck so cruises with the most
// useful info show first. Availability + prices are weighted well above the
// static DB fields, per the product intent (reviews can join later).

/** Signal from the data a provider already carries (instant, no fetch). */
export function staticRichness(p: ProviderResult): number {
  let s = 0;
  if (p.pricePerPersonEur) s += 3;                       // a price is the strongest static signal
  if (p.durationDays) s += 2;
  if (p.vesselName || p.vesselType) s += 2;
  if (p.description && p.description.length > 60) s += 1;
  if (p.contact_email || p.contact_form_url || p.whatsapp || p.phone) s += 1;
  if (p.locations && p.locations.length > 1) s += 1;
  if (typeof p.lat === 'number' && typeof p.lng === 'number') s += 1;
  return s;
}

/** Signal from live availability scraped per provider (0 until it resolves). */
export function availabilityRichness(a?: AvailabilityResult): number {
  if (!a || !a.found) return 0;
  let s = 0;
  if (a.departures && a.departures.length) s += 2;       // concrete open dates
  if (a.pricePerPerson) s += 1;
  if (a.pricePerCabin) s += 1;
  if (a.priceWholeBoat) s += 1;
  if (a.places != null) s += 1;
  if (a.cabins != null) s += 1;
  if (a.bookingOptions && a.bookingOptions.length) s += 1;
  return s;
}

/**
 * Combined score, lexicographic: live availability/prices ALWAYS rank above
 * providers without them (×1000 ≫ any static total), static fields break ties.
 * `availability` is the resolved result for this provider, if any.
 */
export function providerScore(p: ProviderResult, availability?: AvailabilityResult): number {
  return availabilityRichness(availability) * 1000 + staticRichness(p);
}
