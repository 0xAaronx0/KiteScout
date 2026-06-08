// AUTO-GENERATED — country-level kite wind statistics scraped from
// bstoked.net/locations/map/ (the #svg-map `data-data` payload).
// Each array is 12 monthly values (Jan–Dec) = percent of "windy days"
// (>=3h in a row of >=12kn) at a good local spot, per bstoked's model.
// Values come from their precise `flyableDays` figure where available,
// otherwise the midpoint of the wind-probability tier the country sits in
// for that month. Regenerate by re-scraping the map page's data-data attr.

// Keyed by bstoked's country name (see ALIASES for provider-name variants).
export const WIND_BY_COUNTRY: Record<string, number[]> = {
  'Albania': [30, 30, 60, 60, 90, 90, 90, 90, 90, 60, 30, 30],
  'Argentina': [60, 60, 30, 10, 10, 10, 30, 60, 90, 90, 90, 90],
  'Armenia': [30, 30, 30, 60, 60, 90, 90, 90, 90, 60, 30, 30],
  'Australia': [90, 90, 90, 60, 30, 10, 10, 10, 30, 60, 90, 90],
  'Austria': [10, 10, 30, 60, 90, 90, 60, 60, 60, 30, 10, 10],
  'Belize': [50, 70, 70, 70, 50, 70, 70, 50, 50, 50, 50, 50],
  'Bonaire': [70, 90, 90, 90, 90, 90, 90, 70, 50, 50, 50, 70],
  'Brazil': [90, 90, 90, 60, 30, 10, 10, 30, 30, 60, 90, 90],
  'British Virgin Islands': [70, 90, 90, 70, 70, 70, 90, 70, 50, 50, 70, 90],
  'Bulgaria': [10, 10, 30, 60, 90, 90, 90, 90, 90, 60, 30, 10],
  'Canada': [10, 10, 30, 60, 90, 90, 90, 90, 60, 30, 10, 10],
  'Cape Verde': [70, 70, 90, 90, 90, 70, 50, 50, 50, 50, 50, 70],
  'Chile': [90, 60, 30, 30, 30, 10, 10, 10, 60, 90, 90, 90],
  'China': [60, 60, 60, 60, 30, 30, 10, 10, 30, 90, 90, 60],
  'Colombia': [90, 90, 90, 60, 30, 30, 30, 60, 60, 60, 60, 90],
  'Costa Rica': [90, 90, 90, 90, 70, 50, 50, 50, 50, 50, 90, 90],
  'Croatia': [10, 10, 30, 60, 90, 90, 60, 60, 90, 60, 30, 10],
  'Cuba': [70, 70, 70, 70, 50, 50, 50, 50, 50, 50, 70, 70],
  'Denmark': [20, 20, 20, 50, 70, 70, 70, 70, 70, 70, 20, 20],
  'Dominican Republic': [90, 90, 90, 60, 60, 30, 60, 30, 10, 10, 30, 60],
  'Ecuador': [50, 50, 50, 50, 50, 70, 70, 70, 70, 70, 70, 70],
  'Egypt': [70, 70, 70, 70, 70, 90, 90, 90, 90, 70, 50, 70],
  'El Salvador': [60, 90, 90, 90, 30, 30, 30, 10, 10, 10, 60, 60],
  'Estonia': [20, 20, 20, 20, 50, 50, 50, 50, 50, 20, 20, 20],
  'Fiji': [50, 50, 50, 50, 50, 50, 50, 70, 70, 50, 50, 50],
  'Finland': [20, 20, 20, 20, 50, 50, 50, 50, 50, 20, 20, 20],
  'France': [10, 30, 60, 90, 90, 90, 90, 90, 60, 30, 30, 10],
  'Germany': [10, 10, 30, 60, 90, 90, 60, 60, 30, 30, 10, 10],
  'Greece': [10, 10, 30, 60, 90, 90, 90, 90, 90, 60, 30, 10],
  'Guadeloupe': [90, 70, 70, 70, 70, 90, 90, 70, 50, 50, 50, 90],
  'Guatemala': [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
  'Honduras': [50, 50, 50, 70, 70, 70, 50, 50, 50, 50, 50, 50],
  'India': [10, 30, 60, 60, 60, 30, 10, 10, 30, 90, 90, 30],
  'Indonesia': [10, 30, 30, 30, 60, 60, 90, 90, 90, 90, 60, 10],
  'Iran': [30, 30, 60, 90, 60, 30, 30, 30, 30, 60, 90, 60],
  'Ireland': [20, 20, 20, 50, 50, 50, 50, 50, 70, 70, 20, 20],
  'Israel': [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  'Italy': [10, 10, 30, 30, 60, 30, 90, 90, 90, 90, 60, 30],
  'Japan': [50, 50, 70, 70, 50, 50, 50, 50, 50, 50, 70, 70],
  'Kenya': [90, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 60],
  'Latvia': [20, 20, 20, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  'Lebanon': [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  'Lithuania': [20, 20, 20, 20, 50, 50, 50, 50, 50, 20, 20, 20],
  'Macedonia': [10, 10, 30, 30, 60, 90, 90, 90, 90, 60, 30, 10],
  'Madagascar': [50, 50, 50, 50, 70, 90, 90, 90, 90, 90, 70, 50],
  'Maldives': [60, 60, 90, 90, 60, 10, 10, 10, 30, 30, 30, 60],
  'Martinique': [90, 70, 70, 70, 70, 90, 70, 70, 50, 50, 50, 70],
  'Mauritius': [50, 50, 50, 50, 70, 70, 70, 70, 70, 70, 50, 50],
  'Mexico': [90, 90, 60, 30, 30, 10, 10, 10, 30, 30, 60, 90],
  'Montenegro': [20, 20, 20, 20, 50, 70, 90, 70, 50, 50, 20, 20],
  'Morocco': [60, 60, 90, 90, 60, 60, 30, 30, 60, 90, 90, 60],
  'Mozambique': [50, 50, 50, 50, 50, 70, 70, 70, 70, 70, 70, 70],
  'Namibia': [70, 70, 70, 70, 50, 20, 20, 70, 70, 70, 90, 90],
  'Nepal': [60, 90, 90, 60, 30, 10, 10, 10, 30, 90, 90, 60],
  'Netherlands': [20, 20, 20, 70, 70, 70, 50, 50, 50, 70, 20, 20],
  'New Zealand': [90, 90, 60, 30, 30, 30, 30, 30, 30, 60, 60, 90],
  'Nicaragua': [70, 70, 50, 50, 50, 50, 50, 50, 50, 50, 50, 70],
  'Norway': [10, 10, 10, 30, 60, 90, 90, 60, 30, 10, 10, 10],
  'Oman': [50, 50, 50, 50, 70, 90, 90, 90, 70, 50, 50, 50],
  'Panama': [90, 90, 90, 70, 50, 50, 50, 50, 50, 50, 50, 70],
  'Papua New Guinea': [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
  'Peru': [10, 10, 30, 60, 90, 90, 90, 90, 90, 90, 60, 30],
  'Philippines': [90, 90, 90, 50, 50, 50, 50, 50, 50, 50, 70, 90],
  'Poland': [20, 20, 20, 50, 50, 50, 50, 50, 50, 50, 20, 20],
  'Puerto Rico': [70, 70, 50, 50, 50, 70, 70, 50, 50, 50, 50, 50],
  'Romania': [30, 30, 10, 30, 90, 90, 90, 90, 90, 60, 10, 10],
  'Russia': [10, 10, 10, 10, 30, 30, 60, 60, 60, 30, 10, 10],
  'Saint Lucia': [70, 70, 70, 70, 70, 70, 70, 50, 50, 50, 50, 70],
  'Saint Vincent and the Grenadines': [90, 90, 90, 70, 90, 90, 70, 70, 50, 50, 70, 90],
  'Senegal': [50, 70, 70, 70, 50, 50, 50, 50, 50, 50, 50, 50],
  'Slovenia': [10, 10, 30, 60, 90, 90, 60, 60, 90, 30, 10, 10],
  'South Africa': [90, 90, 60, 30, 10, 10, 10, 10, 10, 10, 60, 90],
  'South Korea': [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  'Spain': [30, 30, 60, 60, 90, 90, 90, 90, 90, 60, 60, 30],
  'Sri Lanka': [70, 70, 50, 50, 70, 90, 90, 90, 70, 50, 50, 70],
  'Sweden': [20, 20, 20, 50, 50, 50, 50, 50, 50, 20, 20, 20],
  'Switzerland': [10, 10, 30, 60, 60, 90, 90, 90, 90, 60, 10, 10],
  'Taiwan': [90, 90, 70, 70, 50, 50, 50, 50, 50, 70, 90, 90],
  'Tanzania': [70, 70, 50, 50, 50, 70, 70, 70, 70, 50, 50, 50],
  'Thailand': [50, 70, 70, 50, 50, 50, 50, 50, 50, 50, 50, 70],
  'Tunisia': [20, 20, 50, 50, 70, 70, 50, 50, 50, 50, 50, 20],
  'Turkey': [10, 10, 30, 60, 90, 90, 60, 60, 90, 90, 60, 30],
  'Ukraine': [10, 10, 10, 30, 60, 90, 90, 90, 60, 30, 10, 10],
  'United Kingdom': [10, 10, 10, 60, 60, 60, 60, 60, 30, 10, 10, 10],
  'United States': [10, 10, 30, 60, 90, 90, 60, 60, 90, 90, 30, 10],
  'Venezuela': [80, 80, 80, 60, 30, 30, 30, 30, 60, 60, 60, 80],
  'Vietnam': [90, 90, 70, 50, 50, 50, 50, 50, 50, 50, 70, 90],
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
