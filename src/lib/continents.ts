// ---------------------------------------------------------------------------
// Country → continent resolution.
//
// Deterministic lookup (no AI guess) so the same country always maps to the
// same continent. Keyed on a normalized country name; covers the kite-cruise
// destination countries plus common aliases. Returns null for unknowns so the
// caller can leave `continent` empty rather than store a wrong guess.
// ---------------------------------------------------------------------------

const CONTINENT_BY_COUNTRY: Record<string, string> = {};

function register(continent: string, countries: string[]): void {
  for (const c of countries) CONTINENT_BY_COUNTRY[c] = continent;
}

register('Africa', [
  'cape verde', 'cabo verde', 'egypt', 'tanzania', 'zanzibar', 'kenya',
  'mozambique', 'madagascar', 'morocco', 'tunisia', 'south africa',
  'mauritius', 'seychelles', 'namibia', 'djibouti', 'sudan', 'somalia',
  'comoros', 'mayotte', 'reunion', 'réunion', 'senegal',
]);

register('Europe', [
  'greece', 'turkey', 'türkiye', 'turkiye', 'croatia', 'italy', 'spain',
  'portugal', 'france', 'montenegro', 'malta', 'cyprus', 'sardinia',
  'sicily', 'canary islands', 'balearic islands', 'germany', 'netherlands',
  'denmark', 'sweden', 'norway', 'united kingdom', 'uk', 'ireland', 'albania',
  'slovenia', 'bulgaria', 'poland', 'switzerland', 'belgium', 'iceland', 'finland',
]);

register('Asia', [
  'thailand', 'philippines', 'indonesia', 'sri lanka', 'vietnam', 'malaysia',
  'maldives', 'india', 'oman', 'united arab emirates', 'uae', 'qatar',
  'saudi arabia', 'jordan', 'israel', 'china', 'japan', 'south korea',
  'cambodia', 'myanmar', 'bahrain', 'kuwait', 'lebanon', 'taiwan',
]);

register('North America', [
  'mexico', 'cuba', 'dominican republic', 'jamaica', 'bahamas', 'belize',
  'united states', 'usa', 'us', 'canada', 'costa rica', 'panama', 'nicaragua',
  'guatemala', 'honduras', 'haiti', 'aruba', 'curacao', 'curaçao',
  'turks and caicos', 'british virgin islands', 'us virgin islands',
  'puerto rico', 'antigua and barbuda', 'antigua', 'st kitts and nevis',
  'saint kitts and nevis', 'guadeloupe', 'martinique', 'dominica',
  'st lucia', 'saint lucia', 'st vincent and the grenadines',
  'saint vincent and the grenadines', 'grenadines', 'grenada', 'barbados',
  'trinidad and tobago', 'anguilla', 'saint martin', 'st martin', 'sint maarten',
  'turks and caicos islands', 'saint barthélemy', 'saint barthelemy', 'st barts', 'caribbean', 'greenland',
]);

register('South America', [
  'brazil', 'venezuela', 'colombia', 'ecuador', 'peru', 'chile', 'argentina',
  'uruguay', 'suriname', 'guyana', 'bonaire',
]);

register('Oceania', [
  'australia', 'new zealand', 'fiji', 'french polynesia', 'tahiti',
  'new caledonia', 'vanuatu', 'tonga', 'samoa', 'cook islands',
  'papua new guinea', 'solomon islands', 'micronesia', 'palau', 'kiribati',
]);

register('Antarctica', ['antarctica']);

/** Normalize a country name for lookup. */
function normalize(country: string): string {
  return country
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve a country name to its continent, or null if unknown. */
export function countryToContinent(country: string | null | undefined): string | null {
  if (!country) return null;
  return CONTINENT_BY_COUNTRY[normalize(country)] ?? null;
}

/**
 * Continent of an offer: its main country, else the one continent all its `countries` share
 * (a multi-continent trip, e.g. Greece + Caribbean, stays null).
 */
export function continentForOffer(country: string | null | undefined, countries: readonly string[] | null | undefined): string | null {
  const own = countryToContinent(country);
  if (own) return own;
  const all = new Set((countries ?? []).map(c => countryToContinent(c)));
  if (all.size !== 1) return null;
  return [...all][0];
}
