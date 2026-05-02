-- ============================================================
-- Archive rejected (dead) providers to a separate table
-- ============================================================

-- 1. Create the archive table from the live data.
--    Using CREATE TABLE AS preserves every column exactly as-is
--    (including any added via ALTER TABLE after the initial schema),
--    so this is safe even if whatsapp / phone / verified_at exist.
CREATE TABLE rejected_providers AS
  SELECT *, NOW()::TIMESTAMPTZ AS rejected_at
  FROM providers
  WHERE status = 'dead';

-- Re-add basic constraints (CREATE TABLE AS does not copy them)
ALTER TABLE rejected_providers ADD PRIMARY KEY (id);
ALTER TABLE rejected_providers ADD UNIQUE (root_domain);
CREATE INDEX idx_rejected_providers_country  ON rejected_providers (primary_country);
CREATE INDEX idx_rejected_providers_rejected ON rejected_providers (rejected_at);

-- 2. Nullify raw_search_results.provider_id for dead providers.
--    The column has no ON DELETE clause, so we must clear it manually
--    before deleting the parent rows.
UPDATE raw_search_results
  SET provider_id = NULL
  WHERE provider_id IN (SELECT id FROM rejected_providers);

-- 3. Delete dead providers from the live table.
--    provider_locations rows are removed automatically via ON DELETE CASCADE.
DELETE FROM providers WHERE status = 'dead';
