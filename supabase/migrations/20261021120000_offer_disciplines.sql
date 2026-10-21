-- ---------------------------------------------------------------------------
-- Disciplines: which sports an offer can be booked for (MartinMarzi/KiteCruiseScout#239, Aaron 2026-10-21).
--
-- package_offers.disciplines / cruise_offers.disciplines  TEXT[] NOT NULL DEFAULT '{kitesurf}', never empty,
--   values from ('kitesurf','snowkite','wingfoil'). Multi-value: "Kite & Wing Foil Camp" = {kitesurf,wingfoil};
--   a snowkite trip = {snowkite}. Independent of package_type (a snowkite offer stays a camp / tour / course).
--   Filter with array containment, e.g. PostgREST `disciplines=cs.{snowkite}`, SQL `disciplines @> '{snowkite}'`.
--   Adding a sport later = extend the two CHECK constraints below (+ DISCIPLINES in src/offers/types.ts).
--
-- Source of truth: packages = the adapter (OfferAdapter.disciplines, default ['kitesurf'], written by
-- `offers ingest`); cruises = derived by the cruise extractor from the operator's own trip text
-- (src/lib/disciplines.ts). The backfill below sets the same values for existing rows so they are right before
-- the next ingest / re-extraction:
--   packages  13 snowkite, 99 kitesurf+wingfoil (wing foil included, a wing variant of the package, or wing
--             lessons/rental by the operator or its school; a spot that merely suits wing foiling does not count)
--   cruises   63 kitesurf+wingfoil (wing sessions, coaching, lessons or gear on the trip)
--
-- VIEW SAFETY: both views are owned by BOTH repos. Each CREATE OR REPLACE below is the current live definition
-- with `disciplines` appended at the end; no existing column changes name, type, order or expression:
--   app_package_cards       = 20261014120000_package_live_availability (78 columns) + disciplines
--   app_cruise_offer_cards  = 20260930120000_add_cruise_rooms (72 columns) + disciplines
-- (diff-checked against the live column lists 2026-10-21; KCS has no later view migration). KCS's zod schemas
-- ignore unknown columns, so the deployed app is unaffected until it reads `disciplines`.
--
-- Safe to re-run. Rollback: CREATE OR REPLACE cannot drop a column - DROP VIEW both views (check dependents
-- first), re-run the view blocks of 20261014120000 and 20260930120000, then
-- ALTER TABLE package_offers DROP COLUMN disciplines; ALTER TABLE cruise_offers DROP COLUMN disciplines;
-- ---------------------------------------------------------------------------
BEGIN;

ALTER TABLE public.package_offers ADD COLUMN IF NOT EXISTS disciplines TEXT[] NOT NULL DEFAULT '{kitesurf}';
ALTER TABLE public.cruise_offers  ADD COLUMN IF NOT EXISTS disciplines TEXT[] NOT NULL DEFAULT '{kitesurf}';

ALTER TABLE public.package_offers DROP CONSTRAINT IF EXISTS package_offers_disciplines_check;
ALTER TABLE public.package_offers ADD CONSTRAINT package_offers_disciplines_check
  CHECK (cardinality(disciplines) > 0 AND disciplines <@ ARRAY['kitesurf', 'snowkite', 'wingfoil']::text[]);
ALTER TABLE public.cruise_offers DROP CONSTRAINT IF EXISTS cruise_offers_disciplines_check;
ALTER TABLE public.cruise_offers ADD CONSTRAINT cruise_offers_disciplines_check
  CHECK (cardinality(disciplines) > 0 AND disciplines <@ ARRAY['kitesurf', 'snowkite', 'wingfoil']::text[]);

COMMENT ON COLUMN public.package_offers.disciplines IS
  'sports the offer can be booked for (kitesurf / snowkite / wingfoil), set by the offer adapter; filter with @>';
COMMENT ON COLUMN public.cruise_offers.disciplines IS
  'sports the cruise can be booked for (kitesurf / wingfoil), derived from the operator''s trip text; filter with @>';

-- one-off backfill (adapter keys = package_offers.source_listing_id 'site:<key>')
UPDATE public.package_offers SET disciplines = '{snowkite}'
 WHERE source_listing_id = ANY (ARRAY[
    'site:apex-snow-kiting-tour-kosciuszko',
    'site:dagali-snowkite-camp-fagerheim',
    'site:expeditions-unlimited-greenland-snowkite-crossing',
    'site:kiteforce-tyrol-snowkite-trip',
    'site:lakeunited-snowkitecamp-norway-voringsfoss',
    'site:latitudes-nord-finse-snowkite-weeks',
    'site:latitudes-nord-snowkite-cap-nord',
    'site:latitudes-nord-snowkite-iceland-volcanoes',
    'site:latitudes-nord-snowkite-light-ryfylke-setesdal',
    'site:latitudes-nord-snowkite-nordkinn-varanger',
    'site:pallas-kiteweek-lappis-pallas',
    'site:swiss-snowkiting-school-packages-simplon',
    'site:versus-snowkite-trip-haugastol'
 ]);

UPDATE public.package_offers SET disciplines = '{kitesurf,wingfoil}'
 WHERE source_listing_id = ANY (ARRAY[
    'site:airzone-kite-wing-camp-rangiputa',
    'site:alvorkitecenter-guesthouse-alvor',
    'site:anapnoe-paroskite-pounda',
    'site:antony-boy-viganj',
    'site:aqua-ventana-la-ventana',
    'site:babaomby-island-lodge-diego-suarez',
    'site:bkc-houses-bilene',
    'site:blue-dream-kiteboarding-resort-bahia-salinas',
    'site:cabarete-boutique-kite-hotel',
    'site:camping-strukkamphuk-fehmarnsund',
    'site:campingpark-wulfener-hals-fehmarn',
    'site:canto-das-aguas-icarai',
    'site:casa-nomade-ilha-do-guajiru',
    'site:casa-suica-kite-villas-praia-do-farol',
    'site:cascade-kiteboarding-maui-winter-camp',
    'site:costa-kite-bahia-salinas',
    'site:dakhla-attitude-dakhla',
    'site:dakhla-evasion-free-ride-camp',
    'site:djerbakite-villa-sedouikech',
    'site:escape-pousada-barra-nova',
    'site:exotikite-baja-wave-camps',
    'site:filho-do-vento-barra-do-cunhau',
    'site:flag-beach-surfers-retreat-corralejo',
    'site:floras-lake-house-langlois',
    'site:floripa-ispica',
    'site:funbase-uruma',
    'site:habagat-aissatou-boracay',
    'site:hotel-copacabana-beach-valdevaqueros',
    'site:hotel-todo-bien-el-sargento',
    'site:icarai-kite-village-amontada',
    'site:ikarus-kiteboard-mexico-isla-blanca',
    'site:ion-club-oasis212-lessons-package-dakhla',
    'site:ion-club-pastorino-camp-dakhla',
    'site:jaguaribe-lodge-fortim',
    'site:jeju-kite-lab-sinyang',
    'site:keros-blue-limnos',
    'site:kite-buen-hombre-eco-lodge',
    'site:kite-club-hatteras-avon',
    'site:kite-hostel-africa-tarifa',
    'site:kite-house-sardinia-punta-trettu',
    'site:kite-passion-glamping-puttgarden',
    'site:kite-pl-caravans-chalupy',
    'site:kite-republic-aitutaki-winter-escape',
    'site:kite-sisters-brazil',
    'site:kitefun-surf-house-tarifa',
    'site:kitemex-camp-la-ventana',
    'site:kitesurf-mindoro-bulalacao',
    'site:kitesurfing-lanka-kalpitiya',
    'site:kitewest-wave-freestyle-camp-coronation-beach',
    'site:kokohau-bungalows-santa-veronica',
    'site:la-ballena-alegre-sant-pere-pescador',
    'site:la-ventana-beach-resort',
    'site:lazy-kite-surf-house-tarifa',
    'site:logos-beach-village-theologos',
    'site:loop-it-academy-apartments-jastarnia',
    'site:margarita-village-kalpitiya',
    'site:maszoperia-sun4hel-jastarnia',
    'site:mer-et-sel-union-island',
    'site:michaels-kite-vacancies-rhodes',
    'site:namotu-island-resort-mamanuca',
    'site:new-spirit-dakhla',
    'site:pandanus-resort-mui-ne',
    'site:peahi-resort-stagnone',
    'site:penghu-kitesurf-sunrise-bnb-guoye',
    'site:pensao-alcinda-santa-kite-sal',
    'site:playa-central-camps-la-ventana',
    'site:pousada-mare-alta-parajuru',
    'site:pousada-pais-tropical-icarai',
    'site:proboarding-ferienwohnungen-klein-zicker',
    'site:puza-moya-cape-sports-langebaan',
    'site:rancho-do-peixe-prea',
    'site:real-la-ventana-supercamp',
    'site:ruegen-kite-hostel-martinshafen',
    'site:sakalava-lodge-diego-suarez',
    'site:sea-lion-beach-resort-mui-ne',
    'site:seahorse-resort-mui-ne',
    'site:sol-y-mar-surf-camp-corralejo',
    'site:surf-house-kite-zone-chalupy',
    'site:surfers-residence-tarifa',
    'site:taiga-tarifa-punta-paloma',
    'site:tarifa-kite-hostel-tarifa',
    'site:the-breakers-soma-bay',
    'site:the-kitesurf-lodge-obidos',
    'site:ummaii-surfhostel-ummanz',
    'site:univela-campione-del-garda',
    'site:urla-surf-house-gulbahce',
    'site:vela-baja-los-barriles',
    'site:ventana-bay-resort-el-sargento',
    'site:ventus-brazil-routes',
    'site:villa-rasa-buzios',
    'site:villa-taina-cabarete',
    'site:wahoo-wind-hotel-hondo-los-barriles',
    'site:watermens-retreat-waves',
    'site:watersport-oman-camp-bar-al-hikman',
    'site:wattlodge-norden',
    'site:westpoint-dakhla',
    'site:wild-kite-peru-la-maison-mancora',
    'site:wind-sports-fiji-nananu-i-ra',
    'site:windtown-lagoon-hotel-langebaan'
 ]);

UPDATE public.cruise_offers SET disciplines = '{kitesurf,wingfoil}'
 WHERE id = ANY (ARRAY[
    'e644c086-ff66-41fe-9d00-86e5f4855524',  -- Antigua & Barbuda Kite Cruise
    'e2a04eab-a5ca-4d7b-9741-4f6b84180d3c',  -- Antigua & Barbuda Kitesurf & Wingfoil Catamaran Adventure
    '656a16a9-0876-492c-9a5f-cd265fdd68e3',  -- Antigua & Barbuda Kitesurf & Wingfoil Cruise
    '9357c7a3-8f1d-456a-a967-128de427f259',  -- Antigua Kite & Wingfoil Cruise
    '3719afac-ae6d-404e-b194-0a67afcf5ff9',  -- Antigua and Barbuda Kite Cruise
    '6342eae0-f1e0-475f-b2c6-23a61df47910',  -- Bahamas & Exumas Kite & Sail Catamaran Trip
    '42a0d325-d240-486f-82d2-b57d8d510269',  -- Bahamas Catamaran Kite Trip
    '118436de-6fa0-4720-adf4-eabf109245cf',  -- Bahamas Exuma Cays Kite & Wing Cruise (Lagoon 52)
    '6c89bfbb-4da1-45d0-b233-d0a0ff433bd4',  -- Blue Freedom 14-Day Kite Cruise - Eastern Caribbean
    '9d187759-0456-4409-8697-baa2145b8e2c',  -- Blue Freedom 7-Day Kite Cruise - Eastern Caribbean
    '60580de4-df0b-40dd-8ab0-36ec2113e757',  -- British Virgin Islands Kite & Wingfoil Cruise
    '301ae23b-672b-4309-b9e5-9124ba5c0ae8',  -- Croatia Dalmatia Kite Cruise
    '00caaa0f-c918-4428-80a1-25b23cd48333',  -- Croatia Kitesurf & Wingfoil Sailing Trip - Dalmatian Coast 8-Day Cruise
    '90e85d65-3149-4f7e-b286-29602eb11419',  -- Cyclades Kite & Sail Trip
    'ed9b1b9a-a4e9-47ca-badf-507c26563e14',  -- Cyclades Kitesurfing Catamaran Cruise (7 Days)
    '3a1638fb-1f63-4c91-9eea-5ceeb83e54c5',  -- Dominican Republic Kitesurf & Wingfoil Cruise
    '5e8b9b8d-0061-4511-b65e-33675f2c843c',  -- Dominican Republic Kitesurfing Cruise aboard Elise
    'b853439e-60c0-4428-a9ef-a3e7d1040ad3',  -- Egypt Red Sea Kitesurfing Cruise (Shared/Private Departures)
    '4b20f2ab-ee94-4894-8a96-a222e4882d61',  -- Exclusive Private Caribbean Sailing Adventure from $7,470
    '69f37c50-7ea0-47b8-a861-9ac0e561b34b',  -- Great Exumas Bahamas Kite Cruise
    '27b5b299-a86e-4080-9473-4c9f0f42a108',  -- Greece Cyclades 7-Day Kite Wing & Sail Camp
    '8f9bb8eb-a1c3-4424-8a2e-3e7fad576bd7',  -- Greece Cyclades Kite Cruise
    '3debdc75-748a-42ec-a369-c4628720259c',  -- Greece Cyclades Kite Cruise
    'f030d504-abe1-4a0d-b778-a316c595c3a1',  -- Greece Cyclades Kitesurf & Wingfoil Cruise
    'e913f391-f00e-431b-b8d6-1d908f46405c',  -- Greek Cyclades 7-Day Kitesurf Catamaran Charter
    'a528056e-c2bb-4b19-bfb8-a911bcc368ce',  -- Greek Cyclades Kite & Wing Catamaran Week
    '9c011a97-3aab-4520-ad40-d3452a70b10b',  -- Grenadines Kite & Wingfoil Cruise
    '39938358-b867-44cb-9637-c5a9daebc38d',  -- Grenadines Kitesurf & Wingfoil Cruise
    '863c7f6d-2c9c-482f-894a-123aa7077494',  -- Kite & Sail Caribbean - High Season (Grenadines / Exumas)
    '0a96a3dc-82ec-4113-bd85-1385d5a22248',  -- Kite & Sail Caribbean - Low Season (Grenadines / Exumas)
    '4dd69cfc-805d-4ede-b97b-736dd17de225',  -- Kite & Sail Cruise - Greece (Athens & Cyclades), 10 Days
    'be22d11b-3a24-462c-a75d-34e48909d680',  -- Kite & Sail Greece 2027 (Cyclades)
    'ab7b276d-b2a9-4761-8ef5-229a63cbf492',  -- Kite & Wing - Kitecruise for WINDLOVERS
    'ca4271a6-c669-44d9-a495-354740434865',  -- Kitesurf & Wingfoil Cruise Antigua & Barbuda
    '511b58df-f394-4d36-8991-f35d447faf10',  -- Kitesurf & Wingfoil Cruise Bahamas Exumas
    '583f2391-7bd4-4554-a7dc-d1925ba88424',  -- Kitesurf & Wingfoil Cruise British Virgin Islands
    'd66337b7-7899-4519-aca7-81be22b81949',  -- Kitesurf & Wingfoil Cruise Grenadines
    '63f3632b-3e74-4480-be08-5f1146ac6aca',  -- Kitesurf & Wingfoil Cruise Sardinia & Corsica
    '2c865367-aa0b-498c-8b82-55a95d8d6ac1',  -- Kitesurf Cruise Antigua & Barbuda
    '22fbb847-2dd0-4553-be57-00fa70539fa6',  -- MY Hermes Kite Cruise - Red Sea Safari
    '3a6d074e-01bb-49af-8c52-e283cca22dc3',  -- New Year's Kite Cruise - Eastern Caribbean (10 Days)
    '90402fbe-2caa-49ed-8d29-ef5b52beec74',  -- North Sardinia Wing Kite Cruise
    'fcb87513-6cf8-4788-bdf6-3a9165c2c1d0',  -- Private Kite & Wingfoil Cruise - Worldwide
    '87563eff-5394-4d12-b12d-19f39db94e8e',  -- Red Sea Islands 8-Day Kite Cruise
    'd2ab4908-82dc-460f-ba48-d44cf5ecb870',  -- Red Sea Kite & Wingfoil Safari Cruise
    '180f877d-c9ae-40b6-89a0-cd5943829352',  -- Red Sea Kite & Wingfoil Safari - 8-Day Liveaboard Egypt
    'fe33bb84-31e7-4757-9300-75d0ff4958d1',  -- Red Sea Kite Safari aboard DRAGON - Egypt
    'ddf553cc-9375-4a95-8e4f-d2b0d4fc1d7e',  -- Red Sea Kite Safari on a Yacht
    '6ef678e3-15e1-48b2-a9cc-c42795266a0b',  -- Red Sea Kite Safari - 7-Night Liveaboard (El Gouna / Red Sea Islands)
    '058fb61c-4012-4d5b-9347-cf143a6096ee',  -- Roussillon / Costa Brava Kitesurf & Wingfoil Cruise - Catalonia
    'd5c5208b-c2c5-44a4-91ad-605a281afefd',  -- Sardinia & Corse 6-Day Kite Wing & Sail Camp
    'cd00b0ed-f4cc-482f-91f9-bd0b7e18df2a',  -- Sardinia & Corsica Kite Cruise
    '490056a4-9a75-491e-94ae-0cb6149b2c92',  -- Society Islands Kite & Sail Cruise (ZEN QUEST)
    '6f223c74-5b20-4d0c-bef7-35bb1b918a5b',  -- St. Vincent & the Grenadines Kite Cruise
    '721d4e57-2dbe-41c1-b248-8fecd913b307',  -- St. Vincent and the Grenadines Kite Cruise
    'ab9e1e70-8d26-4027-9633-90019afcdb73',  -- Tuamotus Archipelago Kite & Sail Cruise (ZEN QUEST)
    '81319bc5-029a-4237-8e97-12cbdeab78ac',  -- Turks & Caicos Kitesurf & Wingfoil Cruise
    '4d8d22a6-dd0a-4a59-9f04-8f7251134e0f',  -- Virgin Islands Kitesurf & Wingfoil Cruise
    '1860bc53-fca1-4fea-8a4b-b735f1a0b2d7',  -- Wingfoil / Kitesurf Cruise in Greece - Cyclades
    '68c79ba8-f314-49c3-bdcb-7e94f5b9d1b5',  -- Wingfoil / Kitesurf Cruise in Northern Sardinia and Southern Corsica
    '66587c82-4de3-4c7b-b9b9-689509e19529',  -- Wingfoil / Kitesurf Cruise in Sicily and the Egadi Islands
    'b796f2b5-0638-4023-a3f3-f8950d4cd8b6',  -- Wingfoil / Kitesurf Cruise in the Grenadines
    '4bb6f559-017e-495e-8ca7-d7cbb7cf1d59'   -- Yasawa Islands Fiji Kite & Sail Cruise (ZEN QUEST)
 ]::uuid[]);

CREATE OR REPLACE VIEW public.app_package_cards
WITH (security_invoker = true) AS
SELECT
    p.id AS offer_id,
    p.title,
    p.slug,
    p.source_url,
    p.continent,
    p.country,
    p.region,
    CASE WHEN p.country IS NULL THEN '{}'::text[]
         ELSE ARRAY[p.country] END AS countries,
    p.departure_port,
    p.itinerary_spots,
    NULL::text AS vessel_name,
    NULL::text AS vessel_type,
    '{}'::text[] AS booking_modes,
    p.beginner_friendly,
    p.kite_lessons,
    p.equipment_rental,
    NULL::text AS season_text,
    p.duration_days,
    p.pricing,
    p.price_from_eur,
    p.currency,
    p.summary,
    p.images,
    p.extraction_confidence,
    p.manually_verified,
    false AS is_reseller,
    NULL::text AS operated_by,
    p.updated_at,
    p.id AS provider_id,
    o.name AS provider_name,
    o.root_domain AS provider_root_domain,
    o.website_url AS provider_website_url,
    o.contact_email AS provider_contact_email,
    o.contact_form_url AS provider_contact_form_url,
    p.languages AS provider_languages,
    ARRAY[p.package_type] AS provider_trip_types,
    NULL::integer AS provider_passenger_capacity,
    NULL::integer AS provider_cabin_count,
    o.verified_at AS provider_verified_at,
    o.last_verified_at AS provider_last_verified_at,
    p.skill_levels,
    p.included_services,
    p.optional_services,
    NULL::text AS comfort_level,
    p.suitable_for_non_kiters,
    p.family_friendly,
    p.accommodation,
    p.meal_plan,
    NULL::integer AS capacity_guests,
    NULL::integer AS offer_cabin_count,
    NULL::text AS offer_price_confidence,
    NULL::smallint AS season_start_month,
    NULL::smallint AS season_end_month,
    -- future dated departures/weeks of tours and camps; KCS hides sold_out/closed itself
    (SELECT jsonb_agg(jsonb_build_object(
              'start_date', s.start_date, 'end_date', s.end_date, 'status', s.availability,
              'unit', s.unit, 'price', s.price, 'currency', s.currency,
              'price_unit', s.price_unit, 'price_basis', s.price_basis, 'spots_left', s.spots_left,
              'date_precision', s.date_precision, 'price_valid_until', s.price_valid_until)
            ORDER BY s.start_date, s.unit)
       FROM public.offer_slots s
      WHERE s.package_offer_id = p.id AND s.active
        AND p.package_type IN ('tour', 'camp')
        AND s.start_date IS NOT NULL
        AND s.start_date >= current_date) AS dates,   -- a departure that has started is no longer bookable
    p.source_url AS provider_bstoked_url,
    p.bstoked_rating AS provider_bstoked_rating,
    p.bstoked_review_count AS provider_bstoked_review_count,
    NULL::text AS provider_tripadvisor_url,
    NULL::numeric AS provider_tripadvisor_rating,
    NULL::integer AS provider_tripadvisor_review_count,
    NULL::timestamp with time zone AS provider_reviews_checked_at,
    p.hero_video_url,
    NULL::text AS provider_google_url,
    NULL::numeric AS provider_google_rating,
    NULL::integer AS provider_google_review_count,
    p.bstoked_rating AS provider_avg_rating,
    p.price_pp_cabin,
    p.price_pp_cabin_currency,
    NULL::integer AS price_charter_week,
    NULL::text AS price_charter_week_currency,
    p.price_basis_note,
    p.rooms,
    p.package_type,
    p.price_unit,
    p.operator_id,
    p.live_availability,
    p.availability_checked_at,
    p.instant_booking,
    -- appended 2026-10-21 (sports, MartinMarzi/KiteCruiseScout#239)
    p.disciplines
FROM public.package_offers p
LEFT JOIN public.providers o
  ON o.id = p.operator_id AND o.status NOT IN ('dead', 'duplicate')
WHERE p.is_active;

REVOKE ALL ON public.app_package_cards FROM anon, authenticated;

create or replace view public.app_cruise_offer_cards
with (security_invoker = true)
as
select
  c.id as offer_id,
  c.title,
  c.slug,
  c.source_url,
  c.continent,
  c.country,
  c.region,
  c.countries,
  c.departure_port,
  c.itinerary_spots,
  c.vessel_name,
  c.vessel_type,
  c.booking_modes,
  c.beginner_friendly,
  c.kite_lessons,
  c.equipment_rental,
  c.season_text,
  c.duration_days,
  c.pricing,
  c.price_from_eur,
  c.currency,
  c.summary,
  c.images,
  c.extraction_confidence,
  c.manually_verified,
  c.is_reseller,
  c.operated_by,
  c.updated_at,
  p.id as provider_id,
  p.name as provider_name,
  p.root_domain as provider_root_domain,
  p.website_url as provider_website_url,
  p.contact_email as provider_contact_email,
  p.contact_form_url as provider_contact_form_url,
  p.languages as provider_languages,
  p.trip_types as provider_trip_types,
  p.passenger_capacity as provider_passenger_capacity,
  p.cabin_count as provider_cabin_count,
  p.verified_at as provider_verified_at,
  p.last_verified_at as provider_last_verified_at,
  c.skill_levels,
  c.included_services,
  c.optional_services,
  c.comfort_level,
  c.suitable_for_non_kiters,
  c.family_friendly,
  c.accommodation,
  c.meal_plan,
  c.capacity_guests,
  c.cabin_count as offer_cabin_count,
  c.price_confidence as offer_price_confidence,
  c.season_start_month,
  c.season_end_month,
  c.dates,
  p.bstoked_url as provider_bstoked_url,
  p.bstoked_rating as provider_bstoked_rating,
  p.bstoked_review_count as provider_bstoked_review_count,
  p.tripadvisor_url as provider_tripadvisor_url,
  p.tripadvisor_rating as provider_tripadvisor_rating,
  p.tripadvisor_review_count as provider_tripadvisor_review_count,
  p.reviews_checked_at as provider_reviews_checked_at,
  c.hero_video_url,
  p.google_url as provider_google_url,
  p.google_rating as provider_google_rating,
  p.google_review_count as provider_google_review_count,
  p.avg_rating as provider_avg_rating,
  c.price_pp_cabin,
  c.price_pp_cabin_currency,
  c.price_charter_week,
  c.price_charter_week_currency,
  c.price_basis_note,
  -- appended 2026-09-29 (cabin / room types)
  c.rooms,
  -- appended 2026-10-21 (sports, MartinMarzi/KiteCruiseScout#239)
  c.disciplines
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate')
  -- Reseller-Angebote hart inaktiv (Aaron 2026-07-10): nie im Produkt zeigen
  and coalesce(c.is_reseller, false) = false;

revoke all on public.app_cruise_offer_cards from anon, authenticated;

COMMIT;
