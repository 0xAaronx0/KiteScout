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

## Stays round 4: Tarifa and Brazil off the hotspots (2026-10-12, night)

33 adapters, built by agents and verified by the lead (fixture probe, own tests, secret scan, live ingest, pin
check). Tarifa (15): the kite schools' own houses in town (Kitefun, High Flyers, Freeride's Surfers Residence and
Hostal Africa, Lazy Kite, Rebels' Lion Hostel, Matos apartments, The Wild House via Matos) and the hotels and
campsites at Los Lances / Valdevaqueros / Punta Paloma (100% Fun, Arte Vida, both TAIGA sites, Camping Tarifa,
Copacabana, Dunas). Brazil (18): Ceará beyond Cumbuco (Praia de Patos, Praia do Farol, Icaraí de Amontada,
Fortim, Paracuru), Rio Grande do Norte (Touros, Barra do Cunhaú, Sibaúma, São Miguel do Gostoso, Galinhos),
Tutóia (MA), Búzios, Ilhabela and Ibiraquera.

Live engines added: Paraty Tech (TAIGA; the site's own anonymous form POST to /booking1, one 7-night sample per
month, 12 POSTs per property per run) and Omnibees for 7 more hotels (shared engine; Jaguaribe Lodge and
Jaguaríndia, Filho do Vento, Kilombo, Amagali, Oiti, Villa Rasa). Omnibees results fixtures are compacted to the
rate-plan elements (the parser output is unchanged).

Not used: Smoobu (bot challenge, High Flyers), Mirai (index-price 403; api.mirai.com needs a Basic-auth credential
baked into the widget), Thelis (robots `Disallow: /`), HSystem. Camping Tarifa's nginx cache answers gzip/br
requests with its robots.txt for every URL; the adapter asks for identity encoding (a broken cache, not a block).

Pins: the geocoder picked namesakes far away (Valdevaqueros in Zamora, Punta Paloma on Fuerteventura, Praia do
Farol in Pará) or municipality centroids inland (Touros, Icaraí de Amontada); these are in `KNOWN_PINS` now.
Package images are stripped of `\u0000` before the jsonb write (it failed one listing).

## Stays round 5: North and Baltic Sea outside Germany (2026-10-14)

17 adapters: Denmark 7 (Drivethru Hvide Sande, Hvide Sande Camping, Bork Havn, Skaven, Thorsminde, Drejby on Als,
Feddet), Poland 8 (Chałupy: kite.pl, Kite Crew, Surf House; Jastarnia: Sun4Hel, Loop It; Rewita Jurata, Kite Marina
Sarbsk, FLY House Łeba), Netherlands 1 (LearnKiteboardingNow, Oostvoorne), Belgium 1 (Lakeside Paradise, Knokke-Heist).
Left out on Aaron's call: Hotel Skipper Rewa, I Love Travels; Camping Hindeloopen (403) is on the request backlog.

Live engine added: Compusoft (v3.onlinebooking.dk, robots `Allow: /`, the widget's anonymous profile-list and price
calls; one Saturday-to-Saturday sample week per month) for Hvide Sande Camping, Drejby and Feddet. The helpers live in
`hvide-sande-camping.ts` (candidate for `src/offers/engines/compusoft.ts`; Thorsminde and Wulfener Hals use the same
engine). Not used: Bookinglayer (Drivethru, robots), mobile-calendar, RoomAdmin, Profitroom (robots), GuestSage
(switched off at Kite Marina), nfhotel (hidden-frame script, FLY House), Cubilis (403), LearnKiteboardingNow's
WordPress calendar beyond the current month (needs the page nonce).

Many Baltic price tables are 2026-only and already past (Kite Marina, kite.pl, Kite Crew, Surf House), so those show
"price on request" until the 2027 tables appear. The `\u0000` strip now covers every package, slot and image write
(a page text carried one). Pins: "Chałupy" and "Drejby Strand, Kegnæs" in `KNOWN_PINS`.

## Stays round 6: German North and Baltic Sea (2026-10-14)

20 adapters (Aaron: the 18 recommended plus NoHotel and Flügger Strand; Beach Motel SPO left out). Rügen and Bodden:
UMMAII, Regenbogen Ummanz and Born, ProBoarding, Rügen Kite Hostel, NoHotel, Loissin, Saal (Westwind / Darßblick),
FTF Zipke. Fehmarn and Holstein: Bretterbude, Kite Passion, Strukkamphuk, Wallnau, Flügger Strand, Kailua Lodge,
Nordwind Surendorf (kite weekends, kind camp). North Sea: WattLodge, Windloop (camp), Nordsee Surfschule dome +
Seeschwalbe, Strandgut Cuxhaven.

Live engines: Sirvoy for UMMAII (Kite Beach Inn's parser), Compusoft for Strukkamphuk (helpers from
hvide-sande-camping.ts), campbuchung.de for Wallnau (no robots.txt, anonymous POST, one per run). Not used: SIHOT
(Regenbogen; the data call needs a session cookie), mgm Easybuchen (Loissin; robots), OnePageBooking (Bretterbude;
encrypted session token), V-Office (Kailua; signed token), Easy-Booking (WattLodge; request not worked out), Smoobu.
Regenbogen and Kailua prices are read by hand from the parks' PDF price lists into constants, released only while the
page links the same PDF path (confidence medium; re-read when the PDFs change). Several sites ask for a Crawl-delay
(nohotel.de 5 s, ferienwohnungen-saal.de 10 s); those adapters wait themselves (http.ts has no crawl-delay support).

Ingest: a parallel run of two adapters of a new operator raced on `providers.root_domain`; the insert now re-reads on
a unique violation. Pins: "Saal" (the geocoder picked Saal an der Donau) and "Dranske, Wittow" in `KNOWN_PINS`.
Kitefun Tarifa: house photos exist only at 400x300, so that listing's floor is 400x300 and the school's 800 px course
photos (group-courses page) are added, capped so all house photos reach the vision QC (it sees the 10 largest).

## Djerba / Zarzis (2026-10-14)

Targeted search for Zarzis found nothing qualifying in Zarzis itself; three Djerba places on the south-east lagoon
side were built: Oasis Kite's camp (kind camp, Leão per-event API `GET /api/event/product/<id>/lang/de`, anonymous,
the call the engine's own calendar makes; helpers in the adapter, candidate for `src/offers/engines/leao.ts`), the
Djerbakite villa and Kite Aventure's AMWEJ camp (both price on request, on the request backlog for current prices).

## Baja California and USA (2026-10-14)

Baja (13 adapters): La Ventana (Aqua Ventana, La Ventana Beach Resort + the KiteMex camp, Chilochill, La Ventana
Hotel, the LVKC Villa Brisa camp, Playa Central camps), El Sargento (Azul, Todo Bien), Los Barriles (Vela Baja at
Playa del Sol, Wahoo Wind / Hotel Hondo). USA (6): Hatteras Island (Watermen's Retreat, Kite Club Hatteras house +
camp, Hatteras Island Vacation Rentals), Cascade Kiteboarding's Maui camp, Floras Lake House (Oregon). Deferred:
Cascade's Hatteras and Hood River camps (no 2027 dates); Waves Village is on the request backlog.

Live engines: ThinkReservations' published Markdown availability (Aqua Ventana, `/accommodations.md?...`, anonymous
and robots-allowed), Streamline via the WordPress plugin proxy (Watermen's), LVKC's own camps JSON, Squarespace
product stock (Playa Central). Not used: Cloudbeds `/booking/*` (403 / not-used list), eZee ipms247 (403),
ThinkReservations' secure.thinkreservations.com (robots `Disallow: /`), OwnerRez widgets (robots), Mirai, Acuity cart.
Pins: "Avon" (Hatteras) and "Maui" (North Shore, the camp page names no beach) in `KNOWN_PINS`.

Known gap: `lib/images.ts` downloads photos with a browser User-Agent; velabaja.com answers that with 403 (and our
honest bot UA with 200), so Vela Baja has no photos yet.

## Live availability upgrade (2026-10-14)

Flags: `liveAvailability` / `instantBooking` on every adapter (migration 20261014120000). 20 instantly bookable
adapters were re-checked for a compliant engine read; 6 now read live: Salty's (Sirvoy), LOGOS (Leão availability
API; engine loaded only to 31.10.2026), Kite Hostel Stagnone (Octorate public calendar, whole hostel, printed
prices), Thorsminde and Wulfener Hals (Compusoft; Thorsminde has no 2027 units yet, table fallback), WattLodge
(Easy-Booking `searchCatAvailability` with the widget's own random `X-Session-Id`; rates from Jan 2027 not loaded).
Not usable (robots / 403 / bot filter / session-only results): Mews, Clock PMS+, RoomRaccoon, Amenitiz (2), Beds24
(3, answer "service unavailable" to our bot; on the request backlog), Lodgify checkout API (403), freetobook,
Exely (hopenapi), Booking Expert, Danline (Skaven; results only in the session basket), Kite Passion's own system
(a price calculator, no inventory).

Badge rule (Aaron 2026-10-14, `badgeCols` in ingest.ts), two levels, stored badge-ready:
`live_availability` = the provider's own engine showed an open future date (`available` / `limited`) on the last
complete run; `instant_booking` = the provider's site books online instantly (adapter `instantBooking`) AND future
dates exist (live: an open date; otherwise a priced future slot that is not sold out or closed). An incomplete run
keeps the last state. `instantBooking` was verified per site on 2026-10-14 (provider page / embed, 1-2 requests):
4 turned out request-only (Windchaser, Panama Kite House, Drivethru, Inchcape) and 11 could not be confirmed
(Beds24 x3, Smoobu x2, Beddy, Guesty, Wix Hotels, Too Wet To Shred, Loissin, Surf House Chalupy); all 15 are false.

## Disciplines (2026-10-21)

`disciplines` on every adapter (migration 20261021120000, KCS#239): the sports an offer can be booked for, multi-value,
independent of `kind`. Values `kitesurf` / `snowkite` / `wingfoil` (`DISCIPLINES` in `src/offers/types.ts`); omitted =
`['kitesurf']`. **A new adapter must set it when it is not a plain kitesurf offer:** snowkite = `['snowkite']`;
`['kitesurf', 'wingfoil']` only when the package itself offers wing foil (wing included, a wing variant of the same
package, or wing lessons / rental by the operator or the school the listing is built around, as listed in its
included / optional services). Not wingfoil: a spot that merely suits wing foiling, nearby third-party clubs, site
menus or shop categories, cross-links to the operator's other products, instructor bios, "wing" meaning a kite.
The registry test enforces valid values and that snowkite / "wing" names carry them. State 2026-10-21: 194 kitesurf,
99 kitesurf+wingfoil, 13 snowkite. Cruises derive theirs from the trip text (`src/lib/disciplines.ts`, 63 of 164).

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

## Kite camps and tours worldwide (2026-10-19)

63 camp and tour adapters from a global research round (bstoked, Book Surf Camps via search snippets and web search
as leads; data from the operators' own sites). Camps: Canaries, Rhodes, Sicily, Sardinia, Montenegro, Cyprus,
Denmark, Sweden, Switzerland / Norway / Finland snowkite, Egypt, Dakhla, Essaouira, Sidi Kaouki, Djerba, Cape Verde,
Mauritius, Kenya, Cape Town, Brazil, Colombia, Los Roques, Baja, Vietnam, Fiji, Sulawesi, Cook Islands, Western
Australia. Tours: Morocco, Brazil downwinders and safari, Colombia, Vietnam, WA safari, Oman, Madagascar, Tyrol,
Norway / Iceland snowkite, Greenland crossing.

Rules applied (Aaron 2026-10-19): a provider or property may have a stay plus several camp/tour listings; products
whose only dates are past 2026 dates are listed with no slots ("2027 dates not yet published") and their parsers pick
up new dated rows automatically. Shared parsers: UCPA calendar JSON (ucpa-kitesurf-debutant-hurghada.ts, anonymous
`/api/product/<id>`, live), Latitudes Nord listing + PDF prices (latitudes-nord-finse-snowkite-weeks.ts), Kite
Republic WooCommerce variations (kite-republic-aitutaki-winter-escape.ts, live stock), Swiss Kitesurf, ION Club,
Freeride Kitesurf, Travel Active Club, Kitesurf Adventure, Global Kite Trips, Escape Eco. Pins: Rhodes (Fanes,
Theologos, Kremasti), Famara and the Norway snowkite bases in `KNOWN_PINS`.

Photos (Aaron 2026-10-19): `lib/images.ts` now checks the image host's robots.txt for our bot before downloading
(`robotsAllowsUrl` from `src/offers/http.ts`; e.g. kitewest.com.au disallows `/wp-content/`, so that listing has no
photos), and retries with our honest bot UA when the browser UA fails (freeridekitesurf.com, road2adventure.com.au,
redstarsurf.com and velabaja.com refuse the browser UA from Node but serve the bot).


Photo QC (2026-10-21, after Aaron flagged tide-table screenshots on the Kohama tour): an empty vision pick used to
fall back to the largest images without captions, and a JSON answer behind a short analysis failed to parse and took
the same silent fallback; 12 live listings had only such unvetted images. Now the vision answer is parsed from a
```json block or the first array, the prompt accepts genuine photos of the accommodation and the place (not only
kiting) and rejects only junk or other places, and an empty pick is asked once more, then stores nothing. Audit query:
active rows whose images all lack a caption. Kohama now takes photos from KITECLUB's own trip reports (WordPress REST
search), max 3 per report.

## Taiwan, Korea, Japan (2026-10-21)

Research (2026-10-19): no kite stay in these countries exists only on social media; every confirmed one has its own
site. Kakao channel pages give only name and image without JS (their JSON has contacts and posts, no rooms or
prices), so Kakao is at most a liveness signal. Built: Penghu Kitesurf + Sunrise BnB (Squarespace, undated price
table, pin from the site's map block), Jeju Kite Lab (MotoPress price list; its calendar is nonce-gated, not read),
Guesthouse Miyakojima + M-air (own yado-sagashi.net engine, server-rendered month calendars without cookies or
tokens: live + instant), AIRJUNK Tokoname (stay rates; school closed for 2026, reopens Feb 2027, wording drops
automatically; pin = OSM coast of the Sakai quarter) and FUNBASE Uruma (fee tables incl. the revised rates from
2026-12-30). X-FLY Miyako was already in the catalog (c1ba9e9). Gap: `fetchText` decodes everything as UTF-8, so
Shift_JIS pages (older Japanese sites, e.g. airjunk.jp home) lose their text.

Photo gaps (2026-10-21): 17 live listings had 0-2 photos; 13 now carry 4-10 vetted own-site photos (trip reports via
WordPress REST for KITECLUB Kumejima/Kohama and Latitudes Nord's `/carnets-et-photos/` reports; extra own pages for
Kite Tribe, LazyKite, Kahuna, Lion Hostel (WP media library + CSS backgrounds), My Salty Sisters (the operator's
Rhodes 2026 photo page); KiteWest via its camp co-operator sharkbaykitesurfing.com because kitewest.com.au disallows
/wp-content/ for bots; ExotiKite only 4 Los Barriles kiting photos). Still 1 photo, no own-site source: Latitudes Nord
North Cape (no report) and Iceland (only summer trek photos, misleading for a winter trip), LEN10 Tatajuba, The Rider
Experience Los Roques. `lib/images.ts`: `canonicalKey` keeps identifying query params for extension-less image
scripts (`/thumb?file=...` used to collapse every photo into one) and the vision thumbnails honour EXIF rotation.
Audit: `src/_fewimgs.ts` (gitignored) lists active rows below N photos.

## Camps and tours round 3 (2026-10-21)

Gap research (camps Med/Red Sea/East Africa, Asia/Indian Ocean/Americas, tours worldwide, Senegal, snowkite Canada
and Alaska) -> 31 adapters, all from the operators' own sites: Sri Lanka (KSL Learn to Kite, Ruuk Zero to Hero,
Valampuri bungalow week, Escape Eco 2027 at Rascals, Kitesurf School Dubai winter camp, Freerider's Kalpitiya-Mannar
downwinder), Dominican Republic (Kite Buen Hombre 10-day and 7-day specials, Cabarete Kite Point, Uncharted Foil
Master and Strapless Week, KiteXcite), Peru (Kite Sisters), Colombia (Kite Boarding Colombia Wild North, past-only),
Egypt (My Salty Sisters El Gouna, GET HIGH Hamata), Sicily (KBC Adventure Week via its public Leão events endpoint,
GET HIGH, Kite Me Up), Thailand (Kite Thailand x3, WooCommerce = instant), Madagascar (Sakalava all-inclusive),
Mauritius (Kite Republic Waves Dream, live WooCommerce; Kitereizen Residency, past-only), Portugal (Casa no Campo
CNC camp), South Africa (LakeUnited Langebaan + Cape Town), Philippines (Kitesurf Mindoro island safari), India
(Quest Island Hopping and Spice Coast) and Senegal (Le Papayer, kite stay, price on request).

Decisions (Aaron 2026-10-21): KiteWorldWide is not built; it is on the inquiry backlog for permission (image rights).
Course weeks without a stay (KBC/Primesurf/Let's Go Kite El Gouna, Primesurf Sicily) are not camps. lepapayer.com
photos are marked "tous droits réservés" and are not used. Senegal has no other live own-site kite product; Canada
and Alaska snowkiting is day lessons and events only (NorthWinds and AdrenaJen on the inquiry backlog). Pins for the
Cabarete Kite Beach and Pak Nam Pran listings reuse the existing stays' coordinates (the geocoder misses those names).
Follow-up: kite-buen-hombre-eco-lodge.ts still reads the old Product JSON-LD; the live page now has a Service offer
list, so its package sentence comes back empty.

TLS (2026-10-28): some provider sites chain to Let's Encrypt "ISRG Root YR", which Node does not bundle yet
(kitesuites.com.br failed daily with "fetch failed"). `pnpm cli` and the CI workflows pass `certs/isrg-root-yr.pem`
via `NODE_EXTRA_CA_CERTS`; direct `npx tsx` runs need the variable set by hand. Details: `certs/README.md`.

## Cape Verde deep dive (2026-10-28)

Research across all islands (EN/PT/DE/FR/IT/NL/PL/CZ), own sites only. Aaron 2026-10-28: build only the camps.
Built: `surf-hub-kitesurfing-camp-sal` (Santa Maria, 7 nights B&B + 8 h private lessons, undated price behind a
15-month freshness gate) and `wind-sports-center-surf-kiteweek-boa-vista` (the Surf + Kite week on the same page as
the Kiteweek camp; typo row labels mapped by position, see its header). Not built (stays, Aaron's call): BobbyWasHere
apartments Sal Rei (Kitekriol partner), ION CLUB partner hotels on Sal and at DPC Boa Vista. Dead ends, do not
re-research: São Vicente (kitesurfcaboverde.com redirects to a parked domain, Kitesurf NOW closed, São Pedro is a
kite-free windsurf bay), Maio/Santiago/Santo Antão/São Nicolau/Fogo/Brava (no kite operator), Sick Dog Sal camp
(dates TBA, dropped from its menu), Boavista Kite / Casa da Lua (untouched since 2017-2020), Kite & Tonic (school at
RIU Sal, recommends hotels only), Mitu & Djo (parked domain), 100 Feet (403, IKO "temporary closed"), KBC Sal event
(reseller of Surf Hub). No island-hopping kite tour exists.
