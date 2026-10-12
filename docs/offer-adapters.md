# Offer adapters: stays, tours, camps from provider sites

Status 2026-10-09: 15 test adapters (5 accommodation, 5 tour, 5 camp), 14 ingested into the live
`package_offers` (BookSurfCamps blocked). The KCS app reads them only with
`KITESCOUT_ENABLE_CATALOG_EXPANSION=true` - ON in Production since KCS PR #170 (live map 2026-10-12: 169
offers = 149 cruises + 20 packages). Their `itinerary_spots` carry no lat/lng yet, so the 14 site
offers are listed under "offers without coordinates" on the map. All 20 package rows (6 bstoked + 14 site)
parse through KCS `origin/main` `loadCatalogOfferCatalog` (checked 2026-10-09).

## Model (ported from kiezdad / kiezkind)

- One adapter per provider offer: `src/offers/adapters/<key>.ts`, registered in `src/offers/registry.ts`
  (completeness test: `test/offers/registry.test.ts`).
- Contract `src/offers/types.ts`: `fetchContent()` (title, summary, location, inclusions, image
  candidates) and `fetchSlots()` (bookable units in time: departure / camp week / room x month with
  price, currency, unit, basis and a mandatory `availability` enum + the provider's own words).
- Stable key per slot so history can follow it; price always in the original currency.
- `src/offers/http.ts`: honest UA `KiteScoutBot`, robots.txt enforced (24 h cache), 1.5 s per-host
  throttle, retry on 429/5xx, fixture record/replay (`OFFERS_RECORD_DIR` / `OFFERS_FIXTURE_DIR`).
  Never spoof a browser UA, never bypass a 403 / Cloudflare challenge.
- `src/offers/validate.ts`: plausibility gate (kiezdad `plausibel`) before anything is written.
- `src/offers/ingest.ts`: operator → `providers` (by `root_domain`, fills gaps only) → `package_offers`
  (`source_listing_id = 'site:<key>'`) → curated images (vision QC, private bucket
  `packages/<type>/<slug>-site-<key>/`) → slots. Empty-result guard (`EMPTY_GUARD = 3`), partial
  delivery keeps old slots, 4 adapters in parallel, 4 min timeout each.

## Commands

```bash
pnpm cli offers list                         # adapters + where slots are stored
pnpm cli offers probe [key|all] [--slots]    # live run, NO DB writes
pnpm cli offers ingest [key|all]             # full: content + images (first time) + slots
pnpm cli offers ingest all --slots           # daily price/availability refresh (cron: monitor.yml job offer-slots, 06:00 UTC)
pnpm cli offers ingest <key> --refresh-images
npx tsx src/offers/probe-one.ts src/offers/adapters/<key>.ts   # one adapter, no DB
npx tsx --test test/offers/*.test.ts         # 79 tests (fixtures, no network)
```

## Bands, not months (2026-10-12)

Per-day engines are stored as bands that end where the provider changes price or availability
(`runsOf` in `src/offers/parse.ts`): Vila Guará (Omnibees prices almost day by day; 52 bands in 174
days, plus per-room samples per month), Kite Village (flat prices, bands by free/taken nights).
Price tables keep their real season limits (Panama: 01.-24.12. / 25.12.-10.03. / 11.03.-30.04.).

## Live quote for exact dates (KCS)

Adapters with a `quote` recipe (Omnibees, Leão) store it in `offer_sources.quote`. The KCS route
`GET /api/catalog/quote?offerId&checkIn&checkOut&adults` (branch `feat/live-package-quotes`, flags
`KITESCOUT_ENABLE_CATALOG_EXPANSION` + `KITESCOUT_ENABLE_LIVE_QUOTES`) asks the engine live on user
request, caches 10 min, stores nothing. Verified end to end 2026-10-12 (Vila Guará 05.-08.12.: Pond
BRL 2,580.72; Kite Village 05.-12.12.: Bungalow EUR 770).

## Slot storage

- Migration `20261009120000_offer_slots.sql` APPLIED 2026-10-12. Before that (legacy path, still in code): a capped summary
  (24 future slots) in `package_offers.pricing.slots`; headline price in `price_pp_cabin` /
  `price_basis_note`.
- After applying it: `offer_slots` (current state), `offer_slot_history` (one row per change of
  price / availability / spots), `offer_sources` (per adapter: hashes, last run, history), and
  `app_package_cards.dates` = future dated slots of tours and camps (KCS already renders `dates`
  and hides sold_out / closed). The ingest detects the tables automatically.

## What the 15 adapters read (2026-10-09)

| Kind | Key | Slot source | Live availability |
|---|---|---|---|
| accommodation | kite-village-hamata | Leão Booking JSON (myleao.com) | yes, per room type and month |
| accommodation | vila-guara-atins | Omnibees calendar + results page | yes, rooms left |
| accommodation | keros-blue-limnos | Cloudbeds | BLOCKED (403 to non-browser clients) |
| accommodation | michaels-kite-vacancies-rhodes | static price table | no (on request) |
| accommodation | panama-kite-house | price tables (Bookinglayer robots-blocked) | no |
| tour | kiteactive-xxxl-downwinder | KiteActive app JSON (undocumented, ask first) | yes, spots left |
| tour | toowettoshred-brazil | dated page text (Bookinglayer robots-blocked) | status words |
| tour | ventus-brazil-routes | page text (JSON-LD is wrong: Colombia) | no (inquiry) |
| tour | dakhla-downwind-challenge | price table, early-bird until 2027-05-31 | no (inquiry) |
| tour | kitehi-maui-downwinder | constants (FareHarbor robots-blocked) | BLOCKED |
| camp | algarve-watersport-zero-to-hero | season price table (Bookinglayer robots-blocked) | no; 2026 prices expired |
| camp | real-la-ventana-supercamp | Shopify `products/<handle>.js` | yes, per room type |
| camp | lakeunited-djerba | dated weeks in page text | no (inquiry) |
| camp | bsc-atlanticzin-essaouira | BookSurfCamps calendar attribute | BLOCKED (Cloudflare 403); platform owner Tripaneer reportedly bankrupt 2026-10-01 |
| camp | kite-sisters-brazil | dated weeks + "SOLD OUT" text | status words |

## Refresh strategy (recommendation)

- Booking-engine / Shopify / app JSON: daily `--slots` (in the 06:00 UTC monitor cron, job `offer-slots`,
  since 2026-10-12); twice daily in the last 30 days before a departure. Never show a cached nightly price as final: link out with "from X, checked DATE".
- Inquiry-only pages: weekly; the content hash of the extracted block (not the whole page) decides
  whether anything changed. Only 1 of 8 static pages sends `Last-Modified`, so conditional GET is not
  enough.
- Engines blocked by robots.txt or bot protection (Bookinglayer, FareHarbor, Cloudbeds booking
  endpoints, BookSurfCamps): only via the provider's / vendor's official API access. Drafts of the
  requests: `docs/anfragen-angebotsdaten.md` (local only, not committed).
- Booking.com / Expedia / Airbnb APIs are partner-contract only and rarely list kite camps; not worth
  pursuing for this catalog now. iCal feeds (availability only, no prices) are a cheap option for
  per-night stays whose owners share their export link.

## Known model gaps (from building the 15)

- Stay-length conditions (2nd/3rd-week rates, extra day, minimum nights) have no structured field.
- Trip-wide capacity is repeated on each leg (KiteActive); summing `spots_left` over-counts.
- `closed` does not distinguish "rates not released yet" (Keros 2027) from "out of season".
- Several packages per offer have no "headline unit" (Algarve: Surf & Kite 935 beats Zero to Hero 1,200).
- Year-less seasonal tables expire (Algarve): the offer drops to "price on request" until new prices.
- `hero_video_url` expects a file; YouTube-only providers have no place for their video.
- Shared helper follow-ups: `visibleRoot()` (drop script/style/hidden blocks before `.text`),
  `imageCandidates` exclude list + unwrap escaped-quote URLs, Elementor `[data-thumbnail]`,
  `htmlToText` entity bug in `src/lib/content.ts` (NOT fixed: the cruise monitor hashes its output).
