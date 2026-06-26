# Cruise World Map — UI Handover

The standalone interactive map at **https://map.kitescout.tech** (the "Explore the Cruise
World Map" link on the cruise finder). It is **live and data-driven**: a static Leaflet page
fetches the current cruise offers from the web app on load, so **newly extracted offers appear
automatically** — nothing to regenerate or redeploy when the data changes.

> **🤝 Ported to the UI dev's repo (2026-06-26).** The map was handed over to
> **`MartinMarzi/KiteCruiseScout`** as
> [PR #30](https://github.com/MartinMarzi/KiteCruiseScout/pull/30) — adapted to that app's
> conventions (raw-REST Supabase access, zod, `@/features/*`, Leaflet via CDN, reading their
> `app_cruise_offer_cards` view). The repo-specific handover lives there at
> `docs/cruise-map-handover.md`. **This doc remains the reference for the KiteScout
> implementation** (`map.kitescout.tech` — the `src/pipeline/map.ts` shell + `web/` endpoint);
> the two share the same grouping logic and the busiest-spot placement rule.

> **TL;DR**
> - **Two pieces:** a static **shell** (`map.html`, served by nginx at `map.kitescout.tech`) +
>   a live **endpoint** (`GET /api/cruise-map` in the Next app). The shell `fetch()`es the
>   endpoint on load and renders markers. No data is baked into the HTML.
> - **Change the look** → edit `buildShell()` in [`src/pipeline/map.ts`](../src/pipeline/map.ts),
>   run `pnpm cli map`, redeploy `map.html` (see §5). **Change the data/markers** → edit
>   [`web/lib/cruise-map.ts`](../web/lib/cruise-map.ts); it ships with the web app's normal
>   push-to-deploy.
> - **Data source:** the `cruise_offers` table (one row per cruise product). Full model is in
>   [`cruise-offers-ui-handover.md`](./cruise-offers-ui-handover.md) — read that for field
>   meanings; this doc only covers the map.

---

## 1. Architecture (how a marker gets on the map)

```
map.kitescout.tech (nginx, static)            kitescout.tech (Next app)
┌─────────────────────────────┐   fetch()    ┌──────────────────────────────┐
│ map.html  (the SHELL)        │ ───────────▶ │ GET /api/cruise-map           │
│  Leaflet + CSS + popup code  │   GeoJSON    │  → buildCruiseMapData()       │
│  const API_URL = "…/api/…"   │ ◀─────────── │  → reads cruise_offers (live) │
└─────────────────────────────┘              └──────────────────────────────┘
        ▲ renders 2 layers (Country / Spot toggle), one popup per marker
```

- The shell is **~6 KB and static** — it holds no offer data, just Leaflet setup, styling, the
  popup renderer, and the endpoint URL. It rarely needs to change.
- The endpoint does all the work: query `cruise_offers`, group into the two layers, resolve
  coordinates, return GeoJSON. It runs **per request** (`force-dynamic`), so it always reflects
  the current table. A short `Cache-Control` (`s-maxage=300`) softens rapid reloads.
- Cross-origin (`map.` → root domain) is handled by `Access-Control-Allow-Origin: *` on the
  endpoint.

---

## 2. The files

| File | Role | Who edits it for the map |
|---|---|---|
| [`src/pipeline/map.ts`](../src/pipeline/map.ts) | **The shell.** `buildShell()` returns the full HTML (Leaflet, CSS, popup markup, basemap, the Country/Spot toggle). `generateMap()` writes it to `map.html`. | **Styling / popup layout / basemap.** |
| [`web/app/api/cruise-map/route.ts`](../web/app/api/cruise-map/route.ts) | The endpoint. Calls `buildCruiseMapData()`, adds CORS + cache headers. | Rarely (headers, caching). |
| [`web/lib/cruise-map.ts`](../web/lib/cruise-map.ts) | **The data layer.** Queries `cruise_offers`, builds the country + spot GeoJSON, resolves coordinates. | **What each marker/popup contains, grouping, coordinates.** |
| [`web/lib/cruise-map-coords.ts`](../web/lib/cruise-map-coords.ts) | `COORDS` — hardcoded country/region centroids, used only as a coordinate fallback (see §4). | Add a missing country/region centroid. |

The shell's runtime JS (inside `buildShell`) is deliberately plain — `makeLayer()` builds Leaflet
circle markers and dark popups from the GeoJSON `properties`. To restyle popups, edit the CSS in
the `<style>` block and the string-building in `makeLayer`.

---

## 3. The endpoint's response shape

`GET /api/cruise-map` →

```jsonc
{
  "country": { "type": "FeatureCollection", "features": [ /* one per itinerary country */ ] },
  "spot":    { "type": "FeatureCollection", "features": [ /* one per named itinerary stop */ ] },
  "totalOffers": 62,
  "operators": 26,
  "generatedAt": "2026-06-25T23:44:06.695Z"
}
```

Each feature:

```jsonc
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [lng, lat] },   // GeoJSON order: lng first
  "properties": {
    "label": "Egypt",
    "count": 12,                 // distinct offers at this marker (drives circle size)
    "offers": [
      { "title": "Egypt Red Sea Kitesurfing Cruise", "provider": "Egypt Kitesurfing Cruise",
        "url": "https://…", "price": 1400, "currency": "EUR", "vessel": "MY Falcon" }
      // price/vessel may be null — the popup omits the line when absent
    ]
  }
}
```

The **Country** layer is the default view; the toggle swaps to the **Spot** layer (one marker per
named itinerary stop). An offer with no resolvable stop still appears in the Spot layer at its
country's marker, so nothing disappears between views.

Excluded by default: `is_reseller = true` offers (affiliate dupes — same rule as the cards).

---

## 4. Coordinates — and the "don't drop a marker in the middle of the country" rule

There is **no runtime geocoding** (the endpoint can't call Nominatim per request). Coordinates
come from, in order:

- **Spot markers:** each itinerary stop's own `lat`/`lng` (set by the offers pipeline) →
  `COORDS[stopName]` → skipped if neither resolves.
- **Country markers:** the country's **busiest real spot** (the stop with the most offers) →
  `COORDS[country]` **only** when the country has no geocoded spot at all.

> ⚠️ **Why the country marker is a real spot, not a centroid.** A country's geographic centroid
> often sits nowhere near the cruises — e.g. `COORDS['Egypt']` is in the middle of the desert,
> while every Egyptian kite cruise is on the Red Sea coast. Snapping the country marker to the
> country's busiest actual spot keeps it where the cruises are. This mirrors the card-pin fix
> (commit `99b200f`, "use the search-relevant spot, not the generic country location"). **Don't
> revert the country layer to `COORDS[country]`-first** — that reintroduces the desert-marker bug.

Consequence of no runtime geocoding: a handful of obscure stop names with no embedded coords and
no `COORDS` entry won't get their own **spot** marker (those offers still show under their
country). To recover one, either ensure the offers pipeline geocodes that `itinerary_spots` entry,
or add the name to `COORDS`.

---

## 5. Running & deploying

**Locally** (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `web/.env.local`):

```bash
npm --prefix web run dev                       # serves the endpoint at :3000/api/cruise-map
MAP_API_URL=http://localhost:3000/api/cruise-map pnpm cli map   # shell that points at local dev
open map.html
```

**The endpoint** ships with the web app's normal **push-to-deploy** (any `web/**` change on
`main`). ⚠️ See the deploy caveat below.

**The shell** (`map.html`) is served by a separate nginx container, bind-mounted from
`/docker/cruise-map/html/index.html` on the VPS. It is **not** in any CI pipeline — to update it
you regenerate (`pnpm cli map`, default points at `https://kitescout.tech/api/cruise-map`) and
copy the file up:

```bash
scp -i ~/.ssh/hostinger_vps map.html root@187.77.70.112:/docker/cruise-map/html/index.html
```

You only need to redeploy the shell when you change `buildShell()` (styling/layout). Data changes
never require it.

> ⚠️ **Deploy caveat (web app):** the VPS `kitescout` compose **pins the image by digest**, and
> the deploy workflow pushes a new `:latest` but does **not** update that pin — so a plain
> `git push` rebuilds the image but the running container keeps the old one. Until that pipeline
> is fixed, deploying a web change also requires repinning the compose to the new digest on the
> VPS (`docker compose pull && up -d` after bumping the `image:` line). This affects the endpoint,
> not the static shell.

---

## 6. Common changes — where to make them

- **Restyle markers / popups / basemap** → `buildShell()` in `src/pipeline/map.ts` (CSS block +
  `makeLayer`); regenerate + redeploy the shell (§5).
- **Add a field to popups** (e.g. duration, season) → add it to the `select(...)` and to
  `offerProp()` in `web/lib/cruise-map.ts`, then render it in `makeLayer` in the shell.
- **Change grouping** (e.g. group by continent, or by region) → `buildCruiseMapData()` in
  `web/lib/cruise-map.ts`.
- **Fix a mis-placed marker** → add/adjust the centroid in `web/lib/cruise-map-coords.ts`, or
  (better) fix the stop's coords in the offers pipeline so the data carries them.
- **Show offer images in popups** → not done. Images live in a **private** bucket needing signed
  URLs (see §3 of [`cruise-offers-ui-handover.md`](./cruise-offers-ui-handover.md)); the endpoint
  would need to sign them server-side before returning. Text/price popups are the current design.

**Questions on the offer data model?** [`cruise-offers-ui-handover.md`](./cruise-offers-ui-handover.md).
Offers pipeline: `src/pipeline/extract-cruise-offers.ts`.
