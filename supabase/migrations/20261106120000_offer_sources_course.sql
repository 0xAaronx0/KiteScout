-- ---------------------------------------------------------------------------
-- offer_sources.kind takes 'course' (cron 2026-11-05, run 42039913397).
--
-- OfferKind has known 'course' since the first course adapters, the CHECK from 20261009120000 never did: the 5 course
-- adapters (elevation-nitinat-lake-kite-wing-camps, fkb-zero-to-hero-fuwairit, kitekurs-snowkite-weekend-haugastol,
-- kiteskolen-snowkite-course-haukeliseter, kitetribe-el-gouna) have no row, their run history stays empty, the previous
-- run reads as unknown and run-verdict.ts turns every one-off timeout of theirs into a red run.
--
-- Widens the CHECK only, no row and no view is touched; the listings themselves are unaffected. The code already
-- writes these rows on every run, so the next ingest fills them.
--
-- Before running, the live constraint must carry this name (a differently named one would stay and keep blocking):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.offer_sources'::regclass AND contype = 'c';
--
-- Safe to re-run. Rollback (the rows go first, the old CHECK rejects them):
--   DELETE FROM public.offer_sources WHERE kind = 'course';
--   ALTER TABLE public.offer_sources DROP CONSTRAINT offer_sources_kind_check;
--   ALTER TABLE public.offer_sources ADD CONSTRAINT offer_sources_kind_check CHECK (kind IN ('accommodation', 'tour', 'camp'));
-- ---------------------------------------------------------------------------

ALTER TABLE public.offer_sources DROP CONSTRAINT IF EXISTS offer_sources_kind_check;
ALTER TABLE public.offer_sources ADD CONSTRAINT offer_sources_kind_check
  CHECK (kind IN ('accommodation', 'tour', 'camp', 'course'));
