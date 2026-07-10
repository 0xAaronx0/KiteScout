-- ============================================================
-- Standardisierte Anzeige-Preise (Aaron, 2026-07-10)
-- ============================================================
-- Die Rohpreise der Provider basieren wild gemischt auf pro-Person/Woche,
-- pro Nacht, pro Kabine oder Vollcharter. Die App soll nur noch ZWEI
-- normalisierte Ab-Preise zeigen:
--   price_pp_cabin_eur     — Ab-Preis pro Person in (Doppel-)Kabine,
--                            GESAMTER Cruise-Zeitraum, EUR
--   price_charter_week_eur — Ab-Preis ganzes Boot (Vollcharter),
--                            normalisiert auf 7 Tage, EUR
-- Befüllt vom Backend (Ableitung aus pricing.options + KI-Parse von
-- pricing.raw mit Plausibilitäts-Gates); NULL = "Price on request".
-- price_basis_note dokumentiert die Herleitung (Provenance/Review).
--
-- CREATE OR REPLACE VIEW hängt Spalten nur ans ENDE an — bestehende
-- Konsumenten bleiben unberührt. Safe to re-run.
-- ============================================================

alter table public.cruise_offers
  add column if not exists price_pp_cabin_eur integer,
  add column if not exists price_charter_week_eur integer,
  add column if not exists price_basis_note text;

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
  -- appended 2026-07-10 (hero video + Google/avg reviews)
  c.hero_video_url,
  p.google_url as provider_google_url,
  p.google_rating as provider_google_rating,
  p.google_review_count as provider_google_review_count,
  p.avg_rating as provider_avg_rating,
  -- appended 2026-07-10 (standardisierte Anzeige-Preise)
  c.price_pp_cabin_eur,
  c.price_charter_week_eur,
  c.price_basis_note
from public.cruise_offers c
left join public.cruise_providers p on p.id = c.cruise_provider_id
where c.duplicate_of is null
  and coalesce(p.status, 'new') not in ('dead', 'duplicate');

revoke all on public.app_cruise_offer_cards from anon, authenticated;
