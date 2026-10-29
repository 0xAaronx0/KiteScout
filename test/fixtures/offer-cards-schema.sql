-- Synthetic PGlite fixture, not a production schema or migration: just the columns the two product views
-- (app_cruise_offer_cards, app_package_cards) read, with the types the live views expose (PostgREST OpenAPI,
-- 2026-10-29). `disciplines` is added by 20261021120000_offer_disciplines, which the test replays.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;

CREATE TABLE public.cruise_providers (
 id uuid PRIMARY KEY, name text, root_domain text, website_url text, contact_email text, contact_form_url text,
 languages text[], trip_types text[], passenger_capacity integer, cabin_count integer,
 verified_at timestamptz, last_verified_at timestamptz,
 bstoked_url text, bstoked_rating numeric, bstoked_review_count integer,
 tripadvisor_url text, tripadvisor_rating numeric, tripadvisor_review_count integer, reviews_checked_at timestamptz,
 google_url text, google_rating numeric, google_review_count integer, avg_rating numeric,
 status text);

CREATE TABLE public.cruise_offers (
 id uuid PRIMARY KEY, cruise_provider_id uuid, duplicate_of uuid,
 title text, slug text, source_url text, continent text, country text, region text, countries text[],
 departure_port text, itinerary_spots jsonb, vessel_name text, vessel_type text, booking_modes text[],
 beginner_friendly boolean, kite_lessons boolean, equipment_rental boolean, season_text text,
 duration_days integer, pricing jsonb, price_from_eur integer, currency text, summary text, images jsonb,
 extraction_confidence text, manually_verified boolean, is_reseller boolean, operated_by text,
 updated_at timestamptz, skill_levels text[], included_services text[], optional_services text[],
 comfort_level text, suitable_for_non_kiters boolean, family_friendly boolean, accommodation text, meal_plan text,
 capacity_guests integer, cabin_count integer, price_confidence text,
 season_start_month smallint, season_end_month smallint, dates jsonb, hero_video_url text,
 price_pp_cabin integer, price_pp_cabin_currency text, price_charter_week integer, price_charter_week_currency text,
 price_basis_note text, rooms jsonb);

CREATE TABLE public.providers (id uuid PRIMARY KEY, name text, root_domain text, website_url text,
 contact_email text, contact_form_url text, verified_at timestamptz, last_verified_at timestamptz, status text);

CREATE TABLE public.package_offers (
 id uuid PRIMARY KEY, source_listing_id text, operator_id uuid, is_active boolean,
 title text, slug text, source_url text, continent text, country text, region text, departure_port text,
 itinerary_spots jsonb, beginner_friendly boolean, kite_lessons boolean, equipment_rental boolean,
 duration_days integer, pricing jsonb, price_from_eur integer, currency text, summary text, images jsonb,
 extraction_confidence text, manually_verified boolean, updated_at timestamptz, languages text[],
 package_type text, skill_levels text[], included_services text[], optional_services text[],
 suitable_for_non_kiters boolean, family_friendly boolean, accommodation text, meal_plan text,
 bstoked_rating numeric, bstoked_review_count integer, hero_video_url text,
 price_pp_cabin integer, price_pp_cabin_currency text, price_basis_note text, rooms jsonb, price_unit text,
 live_availability boolean, availability_checked_at timestamptz, instant_booking boolean);

CREATE TABLE public.offer_slots (package_offer_id uuid, active boolean, start_date date, end_date date,
 availability text, unit text, price numeric, currency text, price_unit text, price_basis text,
 spots_left integer, date_precision text, price_valid_until date);

ALTER TABLE public.cruise_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cruise_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_slots ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.cruise_offers, public.cruise_providers, public.package_offers, public.providers,
 public.offer_slots TO service_role;
