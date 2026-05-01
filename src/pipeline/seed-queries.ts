import { supabase } from '../lib/supabase.js';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const EN_CATEGORIES = [
  'kite camp',
  'kitesurfing camp',
  'kiteboarding camp',
  'kite safari',
  'kite cruise',
  'kitesurfing cruise',
  'kiteboarding cruise',
  'kite liveaboard',
  'kitesurfing liveaboard',
  'kite sailing trip',
  'kite tour',
  'kitesurfing tour',
  'kiteboarding tour',
  'kite holiday',
  'kitesurfing holiday',
  'kiteboarding holiday',
  'kite school',
  'kitesurfing school',
  'kiteboarding school',
  'kitesurfing lessons',
  'kiteboarding lessons',
  'kite rental',
  'kitesurfing rental',
  'kiteboarding rental',
  'kite equipment rental',
  'kitesurfing equipment rental',
  'kiteboarding equipment rental',
  'kite travel',
  'kitesurfing travel',
];

const DE_CATEGORIES = [
  'Kite Camp',
  'Kitesurfen Camp',
  'Kiteboarding Camp',
  'Kite Safari',
  'Kite Kreuzfahrt',
  'Kitesurfen Kreuzfahrt',
  'Kite Liveaboard',
  'Kitesurfen Segelreise',
  'Kite Tour',
  'Kitesurfen Tour',
  'Kiteboarding Tour',
  'Kitesurfen Urlaub',
  'Kiteboarding Urlaub',
  'Kiteschule',
  'Kitesurfen Schule',
  'Kitesurfen Kurs',
  'Kiteboarding Kurs',
  'Kite Verleih',
  'Kitesurfen Verleih',
  'Kiteboarding Verleih',
  'Kite Equipment Verleih',
  'Kite Ausrüstung Verleih',
  'Kitesurfen Reise',
  'Kite Reiseveranstalter',
];

// The most commercially distinct EN categories — used to identify "must run first" queries.
// Each one maps to a clear, separate product type.
const TOP_EN_CATEGORIES = new Set([
  'kite camp',
  'kite cruise',
  'kite liveaboard',
  'kite school',
  'kite rental',
  'kite safari',
  'kite travel',
]);

const TOP_DE_CATEGORIES = new Set([
  'Kite Camp',
  'Kite Kreuzfahrt',
  'Kite Liveaboard',
  'Kiteschule',
  'Kite Verleih',
  'Kite Safari',
  'Kitesurfen Reise',
]);

// ---------------------------------------------------------------------------
// Locations — countries, regions, and well-known spots
// ---------------------------------------------------------------------------

const LOCATIONS = [
  // North Africa & Middle East
  'Morocco', 'Dakhla', 'Essaouira', 'Moulay Bousselham',
  'Egypt', 'Hurghada', 'El Gouna', 'Dahab', 'Marsa Alam',
  'Tunisia',
  'Djibouti',
  'Oman',
  'UAE',

  // West & East Africa
  'Cape Verde', 'Sal', 'Boa Vista',
  'Senegal',
  'Ghana',
  'Kenya',
  'Tanzania', 'Zanzibar',
  'Mozambique',
  'Madagascar',
  'South Africa', 'Cape Town', 'Langebaan',
  'Mauritius',
  'La Reunion',
  'Seychelles',

  // Europe
  'Spain', 'Tarifa', 'Fuerteventura', 'Lanzarote', 'Gran Canaria', 'Tenerife',
  'Portugal', 'Algarve', 'Lagos', 'Viana do Castelo',
  'Greece', 'Rhodes', 'Kos', 'Paros', 'Naxos', 'Lefkada', 'Thessaloniki',
  'Croatia',
  'Italy', 'Sardinia', 'Lake Garda',
  'France', 'Leucate',
  'Netherlands',
  'Germany', 'Sylt',
  'Denmark',
  'Poland',
  'Sweden',
  'Ireland',
  'United Kingdom', 'Cornwall',
  'Malta',
  'Montenegro',
  'Bulgaria',

  // Atlantic
  'Canary Islands',
  'Azores',

  // Americas
  'Brazil', 'Cumbuco', 'Jericoacoara', 'Fortaleza', 'Natal', 'São Luís', 'Florianópolis',
  'Dominican Republic', 'Cabarete',
  'Mexico', 'La Ventana', 'Los Barriles', 'Baja California',
  'Aruba',
  'Bonaire',
  'Colombia', 'Cartagena',
  'Argentina', 'Patagonia',
  'Uruguay',
  'Venezuela',
  'USA', 'Cape Hatteras', 'Outer Banks', 'Florida Keys', 'Key West', 'Hawaii',
  'Canada',
  'Antigua',
  'Barbados',
  'Turks and Caicos',
  'Bahamas',
  'Cuba',
  'Saint Martin',
  'Guadeloupe',
  'Martinique',
  'Grenadines', 'St Vincent and the Grenadines',

  // Asia Pacific
  'Thailand', 'Hua Hin', 'Pranburi',
  'Vietnam', 'Mui Ne',
  'Sri Lanka', 'Kalpitiya',
  'Philippines', 'Boracay',
  'Indonesia', 'Bali',
  'Australia', 'Lancelin', 'Margaret River',
  'New Zealand',
  'India', 'Goa',
  'Malaysia',
  'Taiwan',
  'China', 'Hainan',

  // Pacific
  'Maldives',
  'New Caledonia',
  'Tahiti',
  'Fiji',
];

// Country-level entries only (not specific regions/spots within a country).
// These get higher priority than spot-level queries.
const COUNTRY_LOCATIONS = new Set([
  'Morocco', 'Egypt', 'Tunisia', 'Djibouti', 'Oman', 'UAE',
  'Cape Verde', 'Senegal', 'Ghana', 'Kenya', 'Tanzania', 'Mozambique',
  'Madagascar', 'South Africa', 'Mauritius', 'La Reunion', 'Seychelles',
  'Spain', 'Portugal', 'Greece', 'Croatia', 'Italy', 'France',
  'Netherlands', 'Germany', 'Denmark', 'Poland', 'Sweden', 'Ireland',
  'United Kingdom', 'Malta', 'Montenegro', 'Bulgaria',
  'Canary Islands', 'Azores',
  'Brazil', 'Dominican Republic', 'Mexico', 'Aruba', 'Bonaire',
  'Colombia', 'Argentina', 'Uruguay', 'Venezuela', 'USA', 'Canada',
  'Antigua', 'Barbados', 'Turks and Caicos', 'Bahamas', 'Cuba',
  'Saint Martin', 'Guadeloupe', 'Martinique', 'Grenadines',
  'St Vincent and the Grenadines',
  'Thailand', 'Vietnam', 'Sri Lanka', 'Philippines', 'Indonesia',
  'Australia', 'New Zealand', 'India', 'Malaysia', 'Taiwan', 'China',
  'Maldives', 'New Caledonia', 'Tahiti', 'Fiji',
]);

// ---------------------------------------------------------------------------
// Global / non-location-specific queries
// ---------------------------------------------------------------------------

const GLOBAL_EN = [
  'kite camp worldwide',
  'kitesurfing camp worldwide',
  'kite safari worldwide',
  'kitesurfing tour operators worldwide',
  'kite cruise worldwide',
  'kitesurfing liveaboard worldwide',
  'kite liveaboard trip',
  'kitesurfing sailing trip',
  'kite boat trip',
  'kite cruise operator',
  'kitesurfing catamaran trip',
  'best kite schools worldwide',
  'kite rental worldwide',
  'kite travel agency',
  'kitesurfing travel operator',
  'kiteboarding travel provider',
  'list of kite camps worldwide',
  'kitesurfing camp directory',
  'kite travel package',
  'kite holiday package',
  'kitesurfing adventure travel',
  'kite school worldwide',
];

const GLOBAL_DE = [
  'Kite Camp weltweit',
  'Kitesurfen Camp weltweit',
  'Kite Safari weltweit',
  'Kitesurfen Reiseveranstalter weltweit',
  'Kite Kreuzfahrt weltweit',
  'Kitesurfen Liveaboard weltweit',
  'Kite Segelreise',
  'Kitesurfen Katamaranreise',
  'beste Kiteschule weltweit',
  'Kite Verleih weltweit',
  'Kitesurfen Reisebüro',
  'Kitesurfen Reise Anbieter',
  'Kite Urlaub buchen',
  'Kitesurfen Reisepakete',
];

// ---------------------------------------------------------------------------
// Priority scheme
// ---------------------------------------------------------------------------
//
//  1  global EN queries
//  2  global DE queries
//  3  country × top EN categories    ← "full initial coverage" target
//  4  spot   × top EN categories
//  5  country × remaining EN categories
//  6  spot   × remaining EN categories
//  7  country × top DE categories
//  8  spot   × top DE categories
//  9  country × remaining DE categories
// 10  spot   × remaining DE categories

function locationPriority(location: string, isTopCat: boolean, language: 'en' | 'de'): number {
  const isCountry = COUNTRY_LOCATIONS.has(location);
  if (language === 'en') {
    if (isCountry && isTopCat) return 3;
    if (!isCountry && isTopCat) return 4;
    if (isCountry && !isTopCat) return 5;
    return 6;
  } else {
    if (isCountry && isTopCat) return 7;
    if (!isCountry && isTopCat) return 8;
    if (isCountry && !isTopCat) return 9;
    return 10;
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface SeedQuery {
  query: string;
  language: string;
  priority: number;
}

export function buildQueryMatrix(): SeedQuery[] {
  const queries: SeedQuery[] = [];

  // Global queries — run first
  for (const q of GLOBAL_EN) queries.push({ query: q, language: 'en', priority: 1 });
  for (const q of GLOBAL_DE) queries.push({ query: q, language: 'de', priority: 2 });

  // Location × category matrix
  for (const location of LOCATIONS) {
    for (const cat of EN_CATEGORIES) {
      queries.push({
        query: `${cat} ${location}`,
        language: 'en',
        priority: locationPriority(location, TOP_EN_CATEGORIES.has(cat), 'en'),
      });
    }
    for (const cat of DE_CATEGORIES) {
      queries.push({
        query: `${cat} ${location}`,
        language: 'de',
        priority: locationPriority(location, TOP_DE_CATEGORIES.has(cat), 'de'),
      });
    }
  }

  return queries;
}

export async function seedQueries(): Promise<void> {
  const queries = buildQueryMatrix();
  console.log(`Generated ${queries.length} seed queries`);

  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < queries.length; i += BATCH) {
    const batch = queries.slice(i, i + BATCH);
    const { error } = await supabase
      .from('discovery_queries')
      .upsert(
        batch.map(q => ({ query: q.query, language: q.language, priority: q.priority })),
        { onConflict: 'query,language,search_engine,page' },
      );

    if (error) throw error;
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${queries.length} queries upserted`);
  }

  console.log(`\nDone — ${inserted} queries seeded (priority updated for existing rows).`);
}
