-- ============================================================
-- cruise_offers: reseller / affiliate flagging
-- ============================================================
-- Some sites resell other operators' cruises as affiliates (e.g. "operated by
-- a trusted partner, not by us — we earn a commission"). Those offers are
-- mis-attributed and duplicate the real operator, so we flag them and the web
-- layer hides them by default (kept in the DB for later operator-level dedup).
--
-- Populated by `pnpm cli cruise-offers`.
-- RUN THIS BEFORE the next extraction — the offer upsert writes these columns.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE cruise_offers
  ADD COLUMN IF NOT EXISTS is_reseller BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS operated_by TEXT;
