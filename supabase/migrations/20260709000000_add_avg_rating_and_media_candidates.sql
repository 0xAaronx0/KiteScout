-- ============================================================
-- 1) Combined average review rating on cruise_providers
--    (unweighted mean of the available google/tripadvisor/bstoked
--    ratings — review counts are too patchy for weighting; Google
--    counts are unavailable without a Places API key).
--    Maintained by `pnpm cli cruise-reviews` after every run.
-- 2) Media curation: candidate pool (images + videos) per offer for
--    the /admin/media interface, plus the offer's hero video.
--    Flow: `cruise-media collect` fills candidates → admin selects
--    up to 5 images (sort 0 = hero) + optional hero video →
--    `cruise-media apply` downloads/compresses into the bucket and
--    writes cruise_offers.images / hero_video_url.
-- Safe to re-run: ADD COLUMN / CREATE TABLE IF NOT EXISTS only.
-- ============================================================

ALTER TABLE cruise_providers
  ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(2,1);

COMMENT ON COLUMN cruise_providers.avg_rating IS
  'Unweighted mean of google_rating / tripadvisor_rating / bstoked_rating (the ones present); recomputed by cruise-reviews';

ALTER TABLE cruise_offers
  ADD COLUMN IF NOT EXISTS hero_video_url TEXT;

COMMENT ON COLUMN cruise_offers.hero_video_url IS
  'Admin-selected hero video (mp4/webm file URL or YouTube/Vimeo page URL), from offer_media_candidates';

CREATE TABLE IF NOT EXISTS offer_media_candidates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cruise_offer_id   UUID        NOT NULL REFERENCES cruise_offers(id) ON DELETE CASCADE,
  kind              TEXT        NOT NULL CHECK (kind IN ('image', 'video')),
  url               TEXT        NOT NULL,            -- remote media URL (image file, video file, or YouTube/Vimeo URL)
  origin            TEXT,                            -- page the candidate was found on
  note              TEXT,                            -- provenance: 'gallery', 'og:video', 'homepage <video>', 'currently live', …
  width             INTEGER,
  height            INTEGER,
  -- candidate → selected (admin picked it) → applied (in the bucket / on the offer)
  status            TEXT        NOT NULL DEFAULT 'candidate'
                                CHECK (status IN ('candidate', 'selected', 'applied', 'rejected')),
  hero              BOOLEAN     NOT NULL DEFAULT FALSE, -- image: sort 0; video: becomes hero_video_url
  sort              SMALLINT,                        -- admin ordering among selected images (0..4)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cruise_offer_id, url)
);

DROP TRIGGER IF EXISTS offer_media_candidates_updated_at ON offer_media_candidates;
CREATE TRIGGER offer_media_candidates_updated_at
  BEFORE UPDATE ON offer_media_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_media_candidates_offer    ON offer_media_candidates (cruise_offer_id, kind);
CREATE INDEX IF NOT EXISTS idx_media_candidates_selected ON offer_media_candidates (cruise_offer_id) WHERE status = 'selected';
