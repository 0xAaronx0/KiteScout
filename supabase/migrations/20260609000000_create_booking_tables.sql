-- ============================================================
-- Booking email flow — data model (Phase 1)
-- ============================================================
-- See docs/booking-email-flow.md §5.
-- These hold real user/provider data, so this migration is ADDITIVE
-- (CREATE TABLE IF NOT EXISTS) — it never drops existing rows.
-- Re-running it is safe.
-- ============================================================

-- ----- a user's booking request (one shortlist → one request) -----
CREATE TABLE IF NOT EXISTS booking_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email    TEXT        NOT NULL,
  user_name     TEXT,
  -- { destination, dateFrom, dateTo, flexible, groupSize, level, notes }
  trip          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- unguessable magic-link token for the status page
  status_token  TEXT        UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----- one inquiry per provider in the shortlist -----
CREATE TABLE IF NOT EXISTS inquiries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          UUID        NOT NULL REFERENCES booking_requests(id) ON DELETE CASCADE,
  cruise_provider_id  UUID        REFERENCES cruise_providers(id) ON DELETE SET NULL,
  to_email            TEXT,
  -- goes into the Reply-To plus-address; matched on inbound (Phase 2)
  reply_token         TEXT        UNIQUE,
  status              TEXT        NOT NULL DEFAULT 'queued'
                                  CHECK (status IN (
                                    'queued', 'sent', 'bounced',
                                    'replied', 'closed', 'no_email'
                                  )),
  provider_msg_count  INTEGER     NOT NULL DEFAULT 0,
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- idempotency: never two inquiries for the same provider in one request
  UNIQUE (request_id, cruise_provider_id)
);

CREATE INDEX IF NOT EXISTS idx_inquiries_request     ON inquiries (request_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_reply_token ON inquiries (reply_token);
CREATE INDEX IF NOT EXISTS idx_inquiries_status      ON inquiries (status);

-- ----- every outbound/inbound message on an inquiry -----
CREATE TABLE IF NOT EXISTS inquiry_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id    UUID        NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  direction     TEXT        NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_email    TEXT,
  to_email      TEXT,
  subject       TEXT,
  body_text     TEXT,
  body_html     TEXT,
  -- full provider payload (Postmark) for audit; provider MessageID for dedupe
  raw           JSONB,
  provider_message_id TEXT,
  -- Claude-extracted { available, dateRanges, pricePerPerson, ... } (inbound, Phase 2)
  summary       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_inquiry ON inquiry_messages (inquiry_id);
-- dedupe inbound webhooks on the provider's MessageID
CREATE UNIQUE INDEX IF NOT EXISTS idx_inquiry_messages_provider_msg_id
  ON inquiry_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ----- suppression list: never email these again -----
CREATE TABLE IF NOT EXISTS suppressions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        UNIQUE NOT NULL,
  reason      TEXT        NOT NULL CHECK (reason IN ('opt_out', 'hard_bounce', 'spam_complaint')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions (lower(email));
