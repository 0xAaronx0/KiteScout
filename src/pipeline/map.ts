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

  // Additional countries
  Turkey: [38.96, 35.24], Cyprus: [35.13, 33.43], Qatar: [25.35, 51.18],
  'United Arab Emirates': [23.42, 53.85], 'Trinidad and Tobago': [10.69, -61.22],
  Grenada: [12.12, -61.68], Dominica: [15.41, -61.37], 'Costa Rica': [9.75, -83.75],
  Panama: [8.54, -80.78], Belize: [17.19, -88.50], Peru: [-9.19, -75.02],
  Chile: [-35.68, -71.54], Namibia: [-22.96, 18.49], Singapore: [1.35, 103.82],
  Japan: [36.20, 138.25], Georgia: [42.32, 43.36], Iceland: [64.96, -19.02],
  Austria: [47.52, 14.55], Switzerland: [46.82, 8.23], Albania: [41.15, 20.17],
  Norway: [60.47, 8.47], Finland: [61.92, 25.75], 'Saudi Arabia': [23.89, 45.08],
  Jordan: [30.59, 36.24], 'British Virgin Islands': [18.43, -64.62],
  'Virgin Islands': [18.34, -64.90], 'Saint Lucia': [13.91, -60.98],
  'Saint Vincent and the Grenadines': [12.98, -61.29],
  'Antigua and Barbuda': [17.06, -61.80], 'French Polynesia': [-17.68, -149.41],
  'Trinidad': [10.65, -61.52], Gambia: [13.44, -15.31],

  // Additional spots / resorts
  'Alacati': [38.27, 26.37], 'Alaçatı': [38.27, 26.37], 'Gokova': [37.07, 28.40],
  'Gökova': [37.07, 28.40], 'Istanbul': [41.01, 28.95],
  Dubai: [25.20, 55.27], 'Ras Al Khaimah': [25.68, 55.94], 'Jebel Ali': [24.99, 55.03],
  Musandam: [26.20, 56.25], 'Walvis Bay': [-22.96, 14.51], 'Sossusvlei': [-24.73, 15.34],
  'Union Island': [12.59, -61.44], Canouan: [12.71, -61.33], Mayreau: [12.64, -61.39],
  'Tobago Cays': [12.63, -61.36], 'Petit Saint Vincent': [12.54, -61.38],
  'Punta Chame': [8.60, -79.88], 'Corpus Christi': [27.80, -97.40],
  'South Padre Island': [26.11, -97.17], 'Fort Lauderdale': [26.12, -80.14],
  'Pompano Beach': [26.24, -80.12], 'New York': [40.71, -74.01],
  Houston: [29.76, -95.37], Florida: [27.66, -81.52], California: [36.78, -119.42],
  'Puerto Rico': [18.22, -66.59], Alaska: [64.20, -153.37],
  'Hatteras Island': [35.22, -75.54], 'Kitty Hawk': [36.06, -75.72],
  'Lake Neusiedl': [47.82, 16.77], 'Lake Garda': [45.63, 10.66],
  'Port Elizabeth': [-33.96, 25.60], 'Port Elisabeth': [-33.96, 25.60],
  'Fuwairit Kite Beach': [26.03, 51.37],

  // Aliases / alternate spellings
  'Turks and Caicos Islands': [21.69, -71.80],
  Caribbean: [15.00, -73.00], Mediterranean: [35.00, 18.00],
  'South America': [-15.00, -60.00], Europe: [50.00, 10.00],
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
  const rawLocs: { provider_id: string; country: string; region: string | null; spot_name: string | null }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: chunk, error: lErr } = await supabase
      .from('provider_locations')
      .select('provider_id, country, region, spot_name')
      .in('provider_id', ids.slice(i, i + CHUNK));
    if (lErr) throw lErr;
    if (chunk) rawLocs.push(...chunk as typeof rawLocs);
  }

  // Add primary_country fallback for providers with no location rows
  const placedIds = new Set(rawLocs.map(l => l.provider_id));
  for (const p of providers) {
    if (!placedIds.has(p.id as string) && p.primary_country) {
      rawLocs.push({
        provider_id: p.id as string,
        country: p.primary_country as string,
        region: p.primary_region as string | null ?? null,
        spot_name: null,
      });
    }
  }

  const noCoords = new Set<string>();

  function buildGroups(mode: 'country' | 'spot'): MapGroup[] {
    const groups = new Map<string, MapGroup>();

    for (const loc of rawLocs) {
      // In country mode use only the country; in spot mode try spot → region → country
      const candidates = mode === 'country'
        ? [loc.country]
        : [loc.spot_name, loc.region, loc.country].filter(Boolean) as string[];

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
      const provider = providerById.get(loc.provider_id);
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

    return [...groups.values()];
  }

  const countryGroups = buildGroups('country');
  const spotGroups = buildGroups('spot');

  if (noCoords.size > 0) {
    console.log(`  No coordinates for: ${[...noCoords].join(', ')}`);
  }

  const totalProviders = providers.length;
  const totalOnMap = new Set(spotGroups.flatMap(g => g.providers.map(p => p.url))).size;
  console.log(`Generating map — ${spotGroups.length} spot locations, ${countryGroups.length} countries, ${totalOnMap}/${totalProviders} providers placed…`);

  const html = buildHtml(countryGroups, spotGroups, totalProviders);
  writeFileSync(outputPath, html, 'utf8');
  console.log(`Map saved to ${outputPath} — open it in your browser.`);
}

function buildHtml(countryGroups: MapGroup[], spotGroups: MapGroup[], totalProviders: number): string {
  function toGeojson(groups: MapGroup[]) {
    return {
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
  }

  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
    border: 1px solid #30363d; white-space: nowrap;
  }
  #info strong { color: #58a6ff; }
  #toggle-wrap {
    position: absolute; top: 12px; right: 16px; z-index: 1000;
    background: rgba(13,17,23,0.88); border: 1px solid #30363d;
    border-radius: 20px; padding: 5px 6px; backdrop-filter: blur(6px);
    display: flex; align-items: center; gap: 8px; font-size: 12px; color: #8b949e;
  }
  #toggle-wrap label { cursor: pointer; user-select: none; }
  /* pill toggle */
  .pill { position: relative; display: inline-block; width: 44px; height: 22px; }
  .pill input { opacity: 0; width: 0; height: 0; }
  .pill-track {
    position: absolute; inset: 0; background: #30363d; border-radius: 22px;
    cursor: pointer; transition: background .2s;
  }
  .pill input:checked + .pill-track { background: #1f6feb; }
  .pill-thumb {
    position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
    background: #e6edf3; border-radius: 50%; transition: transform .2s; pointer-events: none;
  }
  .pill input:checked ~ .pill-thumb { transform: translateX(22px); }
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
  KiteScout &nbsp;·&nbsp; <strong>${totalProviders}</strong> providers &nbsp;·&nbsp; ${date}
</div>
<div id="toggle-wrap">
  <label for="view-toggle">Country</label>
  <label class="pill">
    <input type="checkbox" id="view-toggle">
    <span class="pill-track"></span>
    <span class="pill-thumb"></span>
  </label>
  <label for="view-toggle">Spot</label>
</div>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const map = L.map('map', { zoomControl: false }).setView([20, 10], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 18,
}).addTo(map);

const countryData = ${JSON.stringify(toGeojson(countryGroups))};
const spotData    = ${JSON.stringify(toGeojson(spotGroups))};

function makeLayer(geojson) {
  const layer = L.layerGroup();
  geojson.features.forEach(f => {
    const { label, count, providers } = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const r = Math.max(6, Math.min(28, 5 + Math.sqrt(count) * 5));
    const circle = L.circleMarker([lat, lng], {
      radius: r, fillColor: '#58a6ff', color: '#1f6feb',
      weight: 1.5, fillOpacity: 0.75,
    });
    const items = providers.map(p => {
      const badge = p.status === 'verified' ? '<span class="badge-verified">✓</span>' : '';
      const link = p.url
        ? \`<a href="\${p.url}" target="_blank" rel="noopener">\${p.name}</a>\${badge}\`
        : \`\${p.name}\${badge}\`;
      return \`<li>\${link}</li>\`;
    }).join('');
    circle.bindPopup(\`
      <div class="popup-title">\${label}&nbsp;<small style="font-weight:400;color:#8b949e">(\${count})</small></div>
      <ul class="popup-list">\${items}</ul>
    \`, { maxWidth: 280 });
    layer.addLayer(circle);
  });
  return layer;
}

const countryLayer = makeLayer(countryData);
const spotLayer    = makeLayer(spotData);
countryLayer.addTo(map);

document.getElementById('view-toggle').addEventListener('change', e => {
  if (e.target.checked) {
    map.removeLayer(countryLayer);
    spotLayer.addTo(map);
  } else {
    map.removeLayer(spotLayer);
    countryLayer.addTo(map);
  }
});
</script>
</body>
</html>`;
}
