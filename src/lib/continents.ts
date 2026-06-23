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
  'comoros', 'mayotte', 'reunion', 'réunion',
]);

register('Europe', [
  'greece', 'turkey', 'türkiye', 'turkiye', 'croatia', 'italy', 'spain',
  'portugal', 'france', 'montenegro', 'malta', 'cyprus', 'sardinia',
  'sicily', 'canary islands', 'balearic islands', 'germany', 'netherlands',
  'denmark', 'sweden', 'norway', 'united kingdom', 'uk', 'ireland', 'albania',
  'slovenia', 'bulgaria',
]);

register('Asia', [
  'thailand', 'philippines', 'indonesia', 'sri lanka', 'vietnam', 'malaysia',
  'maldives', 'india', 'oman', 'united arab emirates', 'uae', 'qatar',
  'saudi arabia', 'jordan', 'israel', 'china', 'japan', 'south korea',
  'cambodia', 'myanmar', 'bahrain', 'kuwait', 'lebanon',
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
