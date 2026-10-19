// AUTO-GENERATED — country-level kite wind statistics scraped from
// bstoked.net/locations/map/ (the #svg-map `data-data` payload).
// Each array is 12 monthly values (Jan–Dec) = percent of "windy days"
// (>=3h in a row of >=12kn) at a good local spot, per bstoked's model.
// Values are bstoked's `windProbability` (the figure the map colours by and
// that their country pages call "% windy days"); months without one sit
// below the map's 40% threshold and get 10. Do NOT use `flyableDays`: it is
// coarse and partly 0-placeholders (Kenya Mar-Nov). Countries bstoked has no
// data for keep older estimates. Re-synced 2026-10-19; the live Supabase
// `wind_stats` table is what the product reads - keep both in step.

// Keyed by bstoked's country name (see ALIASES for provider-name variants).
export const WIND_BY_COUNTRY: Record<string, number[]> = {
  'Albania': [30, 30, 60, 60, 90, 90, 90, 90, 90, 60, 30, 30],
  'Argentina': [49, 49, 49, 49, 49, 49, 10, 10, 49, 49, 49, 49],
  'Armenia': [30, 30, 30, 60, 60, 90, 90, 90, 90, 60, 30, 30],
  'Australia': [90, 90, 70, 50, 50, 50, 50, 50, 55, 65, 85, 85],
  'Austria': [10, 10, 55, 55, 55, 30, 30, 30, 50, 50, 10, 10],
  'Belize': [50, 65, 65, 65, 50, 61, 61, 50, 50, 30, 35, 50],
  'Bonaire': [78, 82, 90, 90, 90, 90, 90, 70, 50, 50, 58, 70],
  'Brazil': [79, 61, 39, 30, 39, 59, 70, 90, 95, 95, 95, 95],
  'British Virgin Islands': [70, 81, 81, 70, 65, 65, 81, 61, 30, 45, 61, 85],
  'Bulgaria': [10, 10, 30, 60, 90, 90, 90, 90, 90, 60, 30, 10],
  'Canada': [10, 10, 30, 60, 90, 90, 90, 90, 60, 30, 10, 10],
  'Cape Verde': [70, 65, 81, 81, 81, 61, 39, 45, 50, 50, 59, 65],
  'Chile': [70, 49, 49, 49, 49, 49, 49, 49, 49, 49, 70, 70],
  'China': [60, 60, 60, 60, 30, 30, 10, 10, 30, 90, 90, 60],
  'Colombia': [90, 90, 90, 90, 81, 90, 90, 70, 61, 50, 61, 79],
  'Costa Rica': [90, 90, 81, 81, 61, 50, 50, 50, 30, 30, 81, 81],
  'Croatia': [10, 10, 10, 30, 50, 70, 79, 61, 50, 39, 10, 10],
  'Cuba': [70, 61, 61, 61, 49, 49, 49, 30, 30, 30, 61, 61],
  'Denmark': [10, 10, 10, 59, 61, 70, 61, 61, 70, 70, 10, 10],
  'Dominican Republic': [56, 62, 62, 50, 50, 61, 81, 81, 41, 19, 21, 41],
  'Ecuador': [49, 49, 49, 49, 49, 70, 70, 70, 70, 70, 70, 70],
  'Egypt': [65, 65, 65, 66, 66, 90, 81, 81, 81, 61, 50, 61],
  'El Salvador': [60, 90, 90, 90, 30, 30, 30, 10, 10, 10, 60, 60],
  'Estonia': [10, 10, 10, 10, 49, 49, 49, 49, 49, 10, 10, 10],
  'Fiji': [49, 49, 49, 49, 49, 49, 49, 70, 70, 49, 49, 49],
  'Finland': [10, 10, 10, 10, 49, 49, 49, 49, 49, 10, 10, 10],
  'France': [10, 10, 10, 59, 70, 70, 70, 70, 70, 70, 10, 10],
  'Germany': [10, 10, 10, 55, 55, 55, 50, 50, 70, 70, 10, 10],
  'Greece': [10, 10, 39, 50, 59, 70, 81, 81, 62, 61, 10, 10],
  'Guadeloupe': [81, 79, 65, 65, 65, 85, 85, 65, 35, 35, 45, 85],
  'Guatemala': [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
  'Honduras': [49, 49, 49, 70, 70, 70, 49, 49, 49, 49, 49, 49],
  'India': [49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49],
  'Indonesia': [19, 19, 39, 49, 75, 81, 81, 75, 49, 21, 19, 19],
  'Iran': [30, 30, 60, 90, 60, 30, 30, 30, 30, 60, 90, 60],
  'Ireland': [10, 10, 10, 49, 49, 49, 49, 49, 70, 70, 10, 10],
  'Israel': [49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49],
  'Italy': [10, 10, 65, 65, 70, 70, 70, 70, 65, 70, 70, 10],
  'Japan': [49, 49, 70, 70, 49, 49, 49, 49, 49, 49, 70, 70],
  'Kenya': [90, 79, 50, 30, 30, 70, 79, 79, 70, 30, 30, 61],
  'Latvia': [10, 10, 10, 49, 49, 39, 39, 39, 49, 49, 49, 49],
  'Lebanon': [49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49],
  'Lithuania': [10, 10, 10, 10, 49, 49, 49, 49, 49, 10, 10, 10],
  'Macedonia': [10, 10, 30, 30, 60, 90, 90, 90, 90, 60, 30, 10],
  'Madagascar': [39, 39, 50, 50, 65, 85, 85, 85, 85, 81, 70, 50],
  'Maldives': [60, 60, 90, 90, 60, 10, 10, 10, 30, 30, 30, 60],
  'Martinique': [81, 79, 71, 65, 71, 81, 79, 61, 35, 35, 50, 79],
  'Mauritius': [39, 39, 50, 55, 70, 70, 70, 75, 75, 62, 50, 50],
  'Mexico': [65, 61, 61, 61, 61, 50, 41, 39, 39, 41, 65, 70],
  'Montenegro': [10, 10, 10, 10, 55, 75, 85, 75, 50, 50, 10, 10],
  'Morocco': [55, 61, 70, 85, 90, 90, 90, 81, 81, 78, 61, 50],
  'Mozambique': [50, 50, 50, 55, 55, 61, 61, 70, 75, 75, 65, 65],
  'Namibia': [61, 61, 61, 61, 50, 10, 10, 65, 75, 75, 82, 82],
  'Nepal': [60, 90, 90, 60, 30, 10, 10, 10, 30, 90, 90, 60],
  'Netherlands': [10, 10, 10, 61, 61, 61, 50, 50, 50, 70, 10, 10],
  'New Zealand': [49, 49, 49, 49, 10, 10, 10, 10, 49, 70, 70, 70],
  'Nicaragua': [70, 70, 49, 49, 49, 49, 49, 49, 49, 49, 49, 70],
  'Norway': [10, 10, 10, 49, 49, 49, 49, 49, 49, 10, 10, 10],
  'Oman': [19, 21, 21, 50, 70, 90, 95, 95, 70, 21, 21, 19],
  'Panama': [81, 81, 81, 61, 21, 21, 19, 19, 19, 19, 21, 61],
  'Papua New Guinea': [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
  'Peru': [49, 49, 49, 49, 49, 70, 90, 90, 90, 90, 82, 70],
  'Philippines': [90, 84, 81, 59, 19, 19, 19, 19, 19, 19, 61, 84],
  'Poland': [10, 10, 10, 49, 49, 49, 49, 49, 49, 49, 10, 10],
  'Puerto Rico': [61, 61, 50, 30, 30, 61, 61, 50, 30, 30, 30, 50],
  'Romania': [30, 30, 10, 30, 90, 90, 90, 90, 90, 60, 10, 10],
  'Russia': [10, 10, 10, 10, 30, 30, 60, 60, 60, 30, 10, 10],
  'Saint Lucia': [70, 70, 70, 70, 70, 70, 70, 30, 30, 30, 30, 61],
  'Saint Vincent and the Grenadines': [90, 90, 90, 70, 90, 90, 79, 75, 45, 45, 79, 81],
  'Senegal': [49, 70, 70, 70, 49, 49, 49, 49, 49, 49, 49, 49],
  'Slovenia': [10, 10, 30, 60, 90, 90, 60, 60, 90, 30, 10, 10],
  'South Africa': [82, 79, 79, 50, 50, 10, 10, 59, 59, 61, 79, 81],
  'South Korea': [49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49, 49],
  'Spain': [59, 59, 65, 65, 65, 79, 85, 81, 65, 61, 50, 59],
  'Sri Lanka': [70, 70, 50, 30, 70, 90, 90, 90, 70, 50, 30, 70],
  'Sweden': [10, 10, 10, 49, 49, 49, 49, 49, 49, 10, 10, 10],
  'Switzerland': [10, 10, 30, 60, 60, 90, 90, 90, 90, 60, 10, 10],
  'Taiwan': [84, 81, 69, 61, 49, 19, 19, 19, 49, 70, 90, 90],
  'Tanzania': [70, 61, 21, 30, 59, 79, 79, 70, 70, 59, 19, 39],
  'Thailand': [49, 65, 65, 49, 49, 49, 49, 49, 49, 49, 49, 61],
  'Tunisia': [10, 10, 49, 49, 65, 65, 49, 49, 49, 49, 49, 10],
  'Turkey': [10, 10, 49, 49, 70, 70, 90, 90, 78, 49, 10, 10],
  'Ukraine': [10, 10, 10, 30, 60, 90, 90, 90, 60, 30, 10, 10],
  'United Kingdom': [10, 10, 10, 60, 60, 60, 60, 60, 30, 10, 10, 10],
  'United States': [50, 65, 70, 79, 75, 79, 79, 70, 70, 70, 70, 50],
  'Venezuela': [79, 82, 85, 85, 85, 85, 62, 45, 45, 45, 62, 72],
  'Vietnam': [81, 81, 65, 39, 19, 19, 19, 19, 19, 19, 74, 81],
};

// Map common provider/DB country-name variants onto bstoked's spelling.
const ALIASES: Record<string, string> = {
  'usa': 'United States',
  'united states of america': 'United States',
  'us': 'United States',
  'uk': 'United Kingdom',
  'great britain': 'United Kingdom',
  'england': 'United Kingdom',
  'cabo verde': 'Cape Verde',
  'the bahamas': 'Bahamas',
  'türkiye': 'Turkey',
  // Grenada isn't in bstoked; it sits at the south end of the Grenadines chain,
  // so reuse Saint Vincent and the Grenadines as a close geographic proxy.
  'grenada': 'Saint Vincent and the Grenadines',
};

const LOWER_INDEX: Record<string, number[]> = Object.fromEntries(
  Object.entries(WIND_BY_COUNTRY).map(([k, v]) => [k.toLowerCase(), v]),
);

/**
 * Look up the 12-month wind-probability series for a country name.
 * Case-insensitive, with a small alias table. Returns undefined when the
 * country isn't covered by bstoked — callers fall back to estimated data.
 */
export function windMonthsForCountry(country?: string | null): number[] | undefined {
  if (!country) return undefined;
  const key = country.trim().toLowerCase();
  return LOWER_INDEX[key] ?? LOWER_INDEX[ALIASES[key]?.toLowerCase() ?? ''];
}
