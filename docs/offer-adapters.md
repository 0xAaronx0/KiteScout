# Offer adapters: stays, tours, camps from provider sites

Status 2026-10-09: 15 test adapters (5 accommodation, 5 tour, 5 camp), 14 ingested into the live
`package_offers` (BookSurfCamps blocked). The KCS app reads them only with
`KITESCOUT_ENABLE_CATALOG_EXPANSION=true` - ON in Production since KCS PR #170 (live map 2026-10-12: 169
offers = 149 cruises + 20 packages). A full ingest geocodes `itinerary_spots` (the KCS map pins only
located spots): adapter `spotCoords` / `KNOWN_PINS` in `ingest.ts` first, then stored coordinates, then
Nominatim. Live map after the backfill 2026-10-12: 166/169 mapped. All 20 package rows (6 bstoked + 14 site)
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
npx tsx --test test/offers/*.test.ts         # 83 tests (fixtures, no network)
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
| tour | theriderexperience-los-roques | page dates + booking deadline; prices = constants from the info PDF (released while the page links it) | limited, closed after the deadline |
| tour | surfariafrika-primal-explorer | group-size price table (+ budget version), "Dates: TBC" | no (on request) |
| tour | surfariafrika-downwinder-xl | site-wide "Roadtrip / Downwinder xl 31 - 9 FEBRUARI 2027" card + "cost … sharing / single" | no (on request) |
| tour | surfariafrika-namibia-downwinder | itinerary only, the page prints no price | no (on request, low confidence) |

Added 2026-10-12 (Aaron: land-based trips found by the cruise monitor go to the package catalog, not
`cruise_offers`). Surfari Afrika keeps older parallel pages of the same products (`/project-page`,
`/Remoteislands`); the newest pages are the source, and three Kenya photos shown on every page are kept
off the Namibia tour. Not ingested: `/safari-2027---2-nights` (wildlife safari, no kiting).

## Stays round 2 (2026-10-12)

**Data rule (Aaron 2026-10-12):** data always from the provider's own website or its own booking engine.
bstoked, BookSurfCamps, Kayak, Airbnb, Booking.com, Hostelworld, KiteWorldWide and similar platforms are
only hints for finding a provider. All 6 bstoked package rows are `is_active=false`. Three were rebuilt
from the providers' own sites (`kenyaways-diani`, `kitesurfmaroc-essaouira`, `kitetribe-el-gouna`). Two
have no own website (Nature Surf House, Premium Kite Qatar). Ventus was a duplicate.

30 new adapters from the 60-stay research list (artifact "KiteScout Stays & Tours") plus the bstoked
replacements; 33 of the 60 stays are now in the catalog. Shared code: `src/offers/engines/omnibees.ts`
(Vila Guará, BGK, Rancho do Peixe). Omnibees "Close" days are `closed`, not `sold_out`. OfferKind
gained `course` and `experience`.

Live engines: Omnibees (3), Leão (Kite Village, Maré Alta), BedBooking (Vila Vento, public widget JSON).
The others read price tables (bands with real season limits; a year-less table takes the year from the
page's own dateModified or a dated PDF link) or are content only ("price on request").

Engines we do not use (blocked, or they need a session, token, signed header or spoofed Origin; never bypass):

| Engine | Seen at | Why not |
|---|---|---|
| Cloudbeds `/booking/*` | Keros Blue, Kite Lodge Brazil, Flag Beach, Blue Dream | 403 to non-browser clients |
| Guesty | Portal do Vento | login token + signed header built in the browser |
| Beddy | Floripa, Peahi | Cloudflare Turnstile |
| WebHotelier | Anapnoe (Paros) | 403, even robots.txt |
| Amenitiz | AlvorKiteCenter | 403 |
| SabeeApp | Baja Joe's | per-request HMAC from a client secret |
| HotelRunner | New Spirit Dakhla | needs the browser app's session |
| Wix Hotels | 35 Knots | signed visitor-token handshake |
| Foco Multimídia | Kitejuba | answers only with the site's Origin header |
| Beds24 / resrv.direct | Kite da Mary / Studios Vrettos | "service unavailable" to our UA |
| freetobook | Kenyaways | robots.txt disallows everything |
| Leão availability | LOGOS Rhodes | HTTP 500 without the form session |

Skipped from the list (updated after the re-check the same evening):
- Blocked: Addict Tarifa, Line Up Fuerteventura, Panama Kite Center, Isola dei Gabbiani (request backlog).
- No own website: Pousada Kite Guajiru. Coco Knots is permanently closed. GKS Kite House is listed from a manual
  portal snapshot (Aaron's exception, adapter `gks-kite-house-esposende`). Kite Hostel Stagnone has its own site
  now (`kite-hostel-stagnone-marsala`).
- Re-checked with relaxed liveness (2026 site edits, reviews or posts count): 9 of the 10 "no 2026/27 evidence"
  stays are live and built; Casa de João stays unknown (site untouched since 2022). Beekite, Peahi and White Wind
  are listed content-only by Aaron's decision.
- Kite link too thin on the own site: Portal do Kite, Buzio Beach, Kite da Mary.
- For sale without visibly open 2026/27 bookings: Guacamaya, Blue Dream.
- Not built for a technical reason: Kitejuba (spoofed Origin required; request backlog).

Shared-helper follow-ups the agents duplicated locally: block-text splitter (`visible()` / `*Lines`), memoised
page fetch, Crawl-delay in http.ts (Baja Joe's, Sakalava ask for 10 s), Google Maps embed / place-link
coordinates, Wix image + location readers, a Leão engine module (Kite Village + Maré Alta), a binary fetch for
PDF rate sheets (Kenyaways prices are hand-read constants guarded by the linked file names), fixture trim script.

## Stays round 3 (2026-10-12, evening)

New search outside Brazil and Tarifa (Europe, Americas, Africa, Indian Ocean, Oceania), targeted searches for
Vietnam / Philippines, South Africa / Mozambique and Oman (Masirah), Aaron's Google-Maps pins for the Philippines,
and Secret Island Kite Camp (Palawan, a fixed-date camp). 67 adapters, built by agents and each verified by the
lead (own test, fixture probe "content OK", slots valid, secret scan). kitebnb.com gave no leads: it shows a
SiteGround captcha to bots, lists only Zanzibar / Cape Town / Langebaan / Mauritius, and is reported in liquidation
(2025, unconfirmed).

Live engines added (public, anonymous, robots-allowed calls the site itself makes): Nightsbridge (Paje by Night),
Sirvoy (Kite Beach Inn; the widget's anonymous session id), HBook WordPress plugin (Windsurf Village Porto Pollo),
MasterCamping (La Ballena Alegre, 24 requests per run), BedBooking (Vila Vento). Streamline rate tables via the
WordPress plugin proxy (Villa Esencia; never `GetTapeChartData`, it returns guest names).

More engines we do not use: STAAH / mybookingsite.io (403), SiteMinder direct-book (AWS WAF challenge), Mews,
RoomRaccoon, Clock PMS, InnStyle, SynXis, Bookassist (robots.txt), OpenHotel (403), eZee ipms247 (403),
Ctoutvert / SecureHoliday (embedded API key + faked referer), Compusoft (would need per-unit price calls, not built).

Per-listing photo floor: `OfferAdapter.imageMinSize` (Wadi Lahami, whose operator only publishes 460 px photos;
it now also uses 2560 px photos from the on-site kite center's own website).

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
