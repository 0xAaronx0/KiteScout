-- ============================================================
-- cruise_offers.source_text
-- ============================================================
-- Full readable text of the offer's own source subpage, captured at
-- extraction time. Kept for later use — e.g. letting the booking agent
-- answer free-form questions about a specific cruise offer.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE cruise_offers
  ADD COLUMN IF NOT EXISTS source_text TEXT;
