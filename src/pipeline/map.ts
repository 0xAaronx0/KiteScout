import 'dotenv/config';
import { writeFileSync } from 'fs';
import { supabase } from '../lib/supabase.js';

// Approximate centroids for every location in the seed matrix
const COORDS: Record<string, [number, number]> = {
  // North Africa & Middle East
  Morocco: [31.79, -7.09], Dakhla: [23.71, -15.94], Essaouira: [31.51, -9.77],
  'Moulay Bousselham': [34.88, -6.29], Egypt: [26.82, 30.80], Hurghada: [27.26, 33.81],
  'El Gouna': [27.40, 33.68], Dahab: [28.49, 34.52], 'Marsa Alam': [25.07, 34.89],
  Tunisia: [33.89, 9.54], Djibouti: [11.83, 42.59], Oman: [21.51, 55.92], UAE: [23.42, 53.85],

  // West & East Africa
  'Cape Verde': [16.00, -24.01], Sal: [16.74, -22.94], 'Boa Vista': [16.10, -22.82],
  Senegal: [14.50, -14.45], Ghana: [7.95, -1.02], Kenya: [-0.02, 37.91],
  Tanzania: [-6.37, 34.89], Zanzibar: [-6.16, 39.19], Mozambique: [-18.67, 35.53],
  Madagascar: [-18.77, 46.87], 'South Africa': [-30.56, 22.94],
  'Cape Town': [-33.93, 18.42], Langebaan: [-33.10, 18.03],
  Mauritius: [-20.35, 57.55], 'La Reunion': [-21.12, 55.54], Seychelles: [-4.68, 55.49],

  // Europe
  Spain: [40.46, -3.75], Tarifa: [36.01, -5.60], Fuerteventura: [28.36, -14.05],
  Lanzarote: [29.05, -13.64], 'Gran Canaria': [27.93, -15.38], Tenerife: [28.29, -16.63],
  'Canary Islands': [28.29, -15.63], Portugal: [39.40, -8.22], Algarve: [37.09, -8.30],
  Lagos: [37.10, -8.67], 'Viana do Castelo': [41.69, -8.83], Azores: [37.74, -25.67],
  Greece: [39.07, 21.82], Rhodes: [36.18, 28.05], Kos: [36.88, 27.28],
  Paros: [37.09, 25.14], Naxos: [37.10, 25.38], Lefkada: [38.71, 20.65],
  Thessaloniki: [40.64, 22.94], Croatia: [45.10, 15.20], Italy: [41.87, 12.57],
  Sardinia: [40.12, 9.07], 'Lake Garda': [45.63, 10.66], France: [46.23, 2.21],
  Leucate: [42.91, 3.04], Netherlands: [52.13, 5.29], Germany: [51.17, 10.45],
  Sylt: [54.91, 8.34], Denmark: [56.26, 9.50], Poland: [51.92, 19.15],
  Sweden: [60.13, 18.64], Ireland: [53.41, -8.24], 'United Kingdom': [55.38, -3.44],
  Cornwall: [50.40, -5.10], Malta: [35.94, 14.37], Montenegro: [42.71, 19.37],
  Bulgaria: [42.73, 25.49],

  // Americas
  Brazil: [-14.24, -51.93], Cumbuco: [-3.64, -38.71], Jericoacoara: [-2.80, -40.51],
  Fortaleza: [-3.72, -38.54], Natal: [-5.79, -35.21], 'São Luís': [-2.53, -44.30],
  'Florianópolis': [-27.60, -48.55], 'Dominican Republic': [18.74, -70.16],
  Cabarete: [19.76, -70.41], Mexico: [23.63, -102.55], 'La Ventana': [24.05, -109.97],
  'Los Barriles': [23.69, -109.68], 'Baja California': [30.37, -115.00],
  Aruba: [12.52, -69.97], Bonaire: [12.20, -68.26], Colombia: [4.57, -74.30],
  Cartagena: [10.39, -75.51], Argentina: [-38.42, -63.62], Patagonia: [-51.00, -71.00],
  Uruguay: [-32.52, -55.77], Venezuela: [6.42, -66.59], USA: [37.09, -95.71],
  'Cape Hatteras': [35.23, -75.54], 'Outer Banks': [35.56, -75.47],
  'Florida Keys': [24.85, -80.90], 'Key West': [24.56, -81.78], Hawaii: [19.90, -155.58],
  Canada: [56.13, -106.35], Antigua: [17.06, -61.80], Barbados: [13.19, -59.54],
  'Turks and Caicos': [21.69, -71.80], Bahamas: [25.03, -77.40], Cuba: [21.52, -77.78],
  'Saint Martin': [18.07, -63.08], Guadeloupe: [16.27, -61.55], Martinique: [14.64, -61.02],
  Grenadines: [12.90, -61.27], 'St Vincent and the Grenadines': [12.98, -61.29],

  // Asia Pacific
  Thailand: [15.87, 100.99], 'Hua Hin': [12.57, 99.96], Pranburi: [12.39, 99.91],
  Vietnam: [14.06, 108.28], 'Mui Ne': [10.93, 108.29], 'Sri Lanka': [7.87, 80.77],
  Kalpitiya: [8.23, 79.76], Philippines: [12.88, 121.77], Boracay: [11.97, 121.92],
  Indonesia: [-0.79, 113.92], Bali: [-8.34, 115.09], Australia: [-25.27, 133.78],
  Lancelin: [-31.02, 115.33], 'Margaret River': [-33.96, 115.08],
  'New Zealand': [-40.90, 174.89], India: [20.59, 78.96], Goa: [15.30, 73.98],
  Malaysia: [4.21, 108.00], Taiwan: [23.70, 121.00], China: [35.86, 104.20],
  Hainan: [20.02, 110.33],

  // Pacific & Indian Ocean
  Maldives: [3.20, 73.22], 'New Caledonia': [-20.90, 165.62],
  Tahiti: [-17.68, -149.41], Fiji: [-16.58, 179.42],
};

interface ProviderInfo {
  name: string | null;
  url: string | null;
  status: string;
}

interface MapGroup {
  label: string;
  coords: [number, number];
  count: number;
  providers: ProviderInfo[];
}

export async function generateMap(outputPath = 'map.html'): Promise<void> {
  console.log('Fetching providers…');
  const { data: providers, error: pErr } = await supabase
    .from('providers')
    .select('id, name, status, website_url, primary_country, primary_region')
    .not('status', 'in', '("dead","duplicate")');

  if (pErr) throw pErr;
  if (!providers || providers.length === 0) {
    console.log('No providers in the database yet.');
    return;
  }

  const providerById = new Map(providers.map(p => [p.id as string, p]));
  const ids = [...providerById.keys()];

  console.log(`Fetching locations for ${ids.length} providers…`);
  const CHUNK = 200;
  const allLocs: { provider_id: string; country: string; region: string | null; spot_name: string | null }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: chunk, error: lErr } = await supabase
      .from('provider_locations')
      .select('provider_id, country, region, spot_name')
      .in('provider_id', ids.slice(i, i + CHUNK));
    if (lErr) throw lErr;
    if (chunk) allLocs.push(...chunk as typeof allLocs);
  }
  const locs = allLocs;

  // Group by the most specific named location we have coordinates for
  const groups = new Map<string, MapGroup>();
  const noCoords = new Set<string>();

  for (const loc of (locs ?? [])) {
    // Try spot → region → country for coord lookup
    const candidates = [loc.spot_name, loc.region, loc.country].filter(Boolean) as string[];
    let resolvedLabel: string | null = null;
    let resolvedCoords: [number, number] | null = null;

    for (const c of candidates) {
      if (COORDS[c]) { resolvedLabel = c; resolvedCoords = COORDS[c]; break; }
    }

    if (!resolvedLabel || !resolvedCoords) {
      noCoords.add(loc.spot_name ?? loc.region ?? loc.country ?? '?');
      continue;
    }

    if (!groups.has(resolvedLabel)) {
      groups.set(resolvedLabel, { label: resolvedLabel, coords: resolvedCoords, count: 0, providers: [] });
    }

    const group = groups.get(resolvedLabel)!;
    const provider = providerById.get(loc.provider_id as string);
    if (!provider) continue;

    if (!group.providers.find(p => p.url === provider.website_url)) {
      group.providers.push({
        name: provider.name as string | null,
        url: provider.website_url as string | null,
        status: provider.status as string,
      });
      group.count++;
    }
  }

  // Fallback: providers with no location rows — place them at primary_country / primary_region
  const placedIds = new Set(allLocs.map(l => l.provider_id));
  for (const provider of providers) {
    if (placedIds.has(provider.id as string)) continue;
    const candidates = [
      provider.primary_region as string | null,
      provider.primary_country as string | null,
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (COORDS[c]) {
        if (!groups.has(c)) {
          groups.set(c, { label: c, coords: COORDS[c], count: 0, providers: [] });
        }
        const group = groups.get(c)!;
        if (!group.providers.find(p => p.url === provider.website_url)) {
          group.providers.push({
            name: provider.name as string | null,
            url: provider.website_url as string | null,
            status: provider.status as string,
          });
          group.count++;
        }
        break;
      }
    }
  }

  if (noCoords.size > 0) {
    console.log(`  No coordinates for: ${[...noCoords].join(', ')}`);
  }

  const mapData = [...groups.values()];
  const totalProviders = providers.length;
  const totalOnMap = new Set(mapData.flatMap(g => g.providers.map(p => p.url))).size;

  console.log(`Generating map — ${mapData.length} locations, ${totalOnMap}/${totalProviders} providers placed…`);

  const html = buildHtml(mapData, totalProviders);
  writeFileSync(outputPath, html, 'utf8');
  console.log(`Map saved to ${outputPath} — open it in your browser.`);
}

function buildHtml(groups: MapGroup[], totalProviders: number): string {
  const geojson = {
    type: 'FeatureCollection',
    features: groups.map(g => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.coords[1], g.coords[0]] },
      properties: {
        label: g.label,
        count: g.count,
        providers: g.providers.map(p => ({
          name: p.name ?? p.url ?? 'Unknown',
          url: p.url,
          status: p.status,
        })),
      },
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>KiteScout — Provider Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
  #map { width: 100vw; height: 100vh; }
  #info {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 1000; background: rgba(13,17,23,0.88); padding: 8px 18px;
    border-radius: 20px; font-size: 13px; color: #8b949e; backdrop-filter: blur(6px);
    border: 1px solid #30363d;
  }
  #info strong { color: #58a6ff; }
  .leaflet-popup-content-wrapper {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px; color: #e6edf3;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  }
  .leaflet-popup-tip { background: #161b22; }
  .popup-title { font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #58a6ff; }
  .popup-list { list-style: none; max-height: 220px; overflow-y: auto; }
  .popup-list li { padding: 3px 0; border-bottom: 1px solid #21262d; font-size: 13px; }
  .popup-list li:last-child { border-bottom: none; }
  .popup-list a { color: #79c0ff; text-decoration: none; }
  .popup-list a:hover { text-decoration: underline; }
  .badge-verified { color: #3fb950; font-size: 10px; margin-left: 4px; }
</style>
</head>
<body>
<div id="info">
  KiteScout &nbsp;·&nbsp; <strong>${totalProviders}</strong> providers discovered
  &nbsp;·&nbsp; Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
</div>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map', { zoomControl: false }).setView([20, 10], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO',
  maxZoom: 18,
}).addTo(map);

const data = ${JSON.stringify(geojson)};

data.features.forEach(f => {
  const { label, count, providers } = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const r = Math.max(6, Math.min(28, 5 + Math.sqrt(count) * 5));

  const circle = L.circleMarker([lat, lng], {
    radius: r,
    fillColor: '#58a6ff',
    color: '#1f6feb',
    weight: 1.5,
    fillOpacity: 0.75,
  }).addTo(map);

  const items = providers.map(p => {
    const badge = p.status === 'verified' ? '<span class="badge-verified">✓</span>' : '';
    const link = p.url
      ? \`<a href="\${p.url}" target="_blank" rel="noopener">\${p.name}</a>\${badge}\`
      : \`\${p.name}\${badge}\`;
    return \`<li>\${link}</li>\`;
  }).join('');

  circle.bindPopup(\`
    <div class="popup-title">\${label} &nbsp;<small style="font-weight:400;color:#8b949e">(\${count})</small></div>
    <ul class="popup-list">\${items}</ul>
  \`, { maxWidth: 280 });
});
</script>
</body>
</html>`;
}
