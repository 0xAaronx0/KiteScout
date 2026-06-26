import { writeFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Cruise World Map — STATIC SHELL ONLY.
//
// The map is data-driven at runtime: this generator emits a static Leaflet page
// that fetches the CURRENT cruise offers from the web app's /api/cruise-map
// endpoint on load. Newly extracted offers therefore appear on the map
// automatically — there is no need to re-run this generator or redeploy
// map.html when the underlying cruise_offers data changes.
//
// Re-run `pnpm cli map` only to change the SHELL itself (styling, basemap,
// layout, popup markup). The grouping + geocoding logic now lives next to the
// data, in web/lib/cruise-map.ts (served by web/app/api/cruise-map/route.ts).
//
// Point the shell at a different data source with MAP_API_URL, e.g. for local
// testing against the dev server:
//   MAP_API_URL=http://localhost:3000/api/cruise-map pnpm cli map
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = 'https://kitescout.tech/api/cruise-map';

export async function generateMap(outputPath = 'map.html'): Promise<void> {
  const apiUrl = process.env.MAP_API_URL || DEFAULT_API_URL;
  writeFileSync(outputPath, buildShell(apiUrl), 'utf8');
  console.log(`Map shell saved to ${outputPath} — fetches live data from ${apiUrl}`);
}

function buildShell(apiUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KiteScout — Kite Cruise Map</title>
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
  .offer-title { font-size: 13px; font-weight: 600; }
  .offer-title a { color: #79c0ff; }
  .offer-meta { font-size: 12px; color: #8b949e; margin-top: 2px; }
  .offer-provider { font-size: 11px; color: #6e7681; margin-top: 1px; }
</style>
</head>
<body>
<div id="info">
  KiteScout &nbsp;·&nbsp; <strong id="count">…</strong> <span id="noun">cruise offers</span>
</div>
<div id="toggle-wrap">
  <label for="view-toggle">Region</label>
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
const API_URL = ${JSON.stringify(apiUrl)};

const map = L.map('map', { zoomControl: false }).setView([20, 10], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 18,
}).addTo(map);

const CUR = { EUR: '€', USD: '$', GBP: '£' };
function fmtPrice(price, currency) {
  if (price == null) return '';
  const sym = CUR[currency] || (currency ? currency + ' ' : '');
  return 'from ' + sym + price.toLocaleString('en-US');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function makeLayer(geojson) {
  const layer = L.layerGroup();
  geojson.features.forEach(f => {
    const { label, count, offers } = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const r = Math.max(6, Math.min(28, 5 + Math.sqrt(count) * 5));
    const circle = L.circleMarker([lat, lng], {
      radius: r, fillColor: '#58a6ff', color: '#1f6feb',
      weight: 1.5, fillOpacity: 0.75,
    });
    const items = offers.map(o => {
      const title = esc(o.title);
      const head = o.url
        ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener">' + title + '</a>'
        : title;
      const meta = [o.vessel ? '🚢 ' + esc(o.vessel) : '', fmtPrice(o.price, o.currency)]
        .filter(Boolean).join(' &nbsp;·&nbsp; ');
      let li = '<li><div class="offer-title">' + head + '</div>';
      if (meta) li += '<div class="offer-meta">' + meta + '</div>';
      if (o.provider) li += '<div class="offer-provider">' + esc(o.provider) + '</div>';
      return li + '</li>';
    }).join('');
    circle.bindPopup(
      '<div class="popup-title">' + esc(label) + '&nbsp;<small style="font-weight:400;color:#8b949e">(' + count + ')</small></div>' +
      '<ul class="popup-list">' + items + '</ul>',
      { maxWidth: 300 });
    layer.addLayer(circle);
  });
  return layer;
}

let countryLayer = null;
let spotLayer = null;

fetch(API_URL)
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(data => {
    document.getElementById('count').textContent = data.totalOffers;
    countryLayer = makeLayer(data.country);
    spotLayer = makeLayer(data.spot);
    countryLayer.addTo(map);
    document.getElementById('view-toggle').addEventListener('change', e => {
      if (e.target.checked) { map.removeLayer(countryLayer); spotLayer.addTo(map); }
      else { map.removeLayer(spotLayer); countryLayer.addTo(map); }
    });
  })
  .catch(err => {
    console.error('Failed to load cruise offers', err);
    document.getElementById('count').textContent = '—';
    document.getElementById('noun').textContent = "couldn't load offers";
  });
</script>
</body>
</html>`;
}
