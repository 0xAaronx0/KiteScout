ALTER TABLE discovery_queries ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 10;

CREATE INDEX IF NOT EXISTS idx_discovery_queries_search_order
  ON discovery_queries (priority, created_at)
  WHERE executed_at IS NULL;
