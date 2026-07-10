# Booking Email Flow — Spec

**Status (updated 2026-07-10):** Phase 1 code is **built but never committed** — it sits
untracked/modified in the kitescout worktree (`web/app/api/booking/`, `web/app/status/`,
`web/components/BookingRequestForm.tsx`, `web/lib/booking-draft.ts`, `web/lib/postmark.ts`,
migration `20260609000000_create_booking_tables.sql`, plus wiring in `SwipeDeck.tsx`/`types.ts`).
Frontend CTA is gated by `NEXT_PUBLIC_BOOKING_ENABLED` (off); ⚠️ **the API routes themselves are
NOT flag-gated** — gate them before this ever ships. The booking migration is **not applied**
(verified against live Supabase 2026-07-10 — see `docs/supabase-live-state.md`). Blocked on
Phase 0 (Postmark account/DNS/env) + running the migration.
**⚠️ Parallel system:** the KCS product app has since built its **own** inquiry-email system
(**Resend**, not Postmark: `inquiry_batches`/`provider_inquiries` tables — applied live —, gated
send via `KITESCOUT_ENABLE_REAL_EMAIL_SEND`, reply forwarding, `/internal/inquiries`). It is
merged and ahead of this spec. Before investing here, decide which system carries the booking
flow — this spec may be superseded.
**Owner decision (2026-06-09):** full **relay** model, email provider **Postmark**.

## 1. Goal

After a user swipes/shortlists cruise providers, they can ask KiteScout to **automatically email
the shortlisted providers to inquire about dates/availability**, and KiteScout **relays the
providers' replies back to the user** (and can summarize them). Two-way relay is the end state.

This is the "Booking request email flow" from `CLAUDE.md` → Planned Next Steps.

## 2. Key decisions

- **Relay model (not intro):** providers reply to a KiteScout address; we receive (Postmark
  inbound webhook), store, and relay to the user. We own the conversation → can summarize/track
  and later do two-way relay.
- **Postmark** for both outbound (transactional) and inbound (parsing, `MailboxHash` threading).
- **No user auth for MVP:** capture the user's email per request; a **magic-link status page**
  (unguessable token) lets them view progress. Full accounts can come later.

## 3. Hard dependency — provider email coverage

The feature only works where a provider has an email. Sample (Egypt, 49 providers):
`contact_email` 31/49 (~63%), `contact_form_url` 39/49, `whatsapp` 22/49, `website_url` 49/49.

→ MVP runs on the **email-having subset**. Providers with only a contact form are shown as
"manual / no email" for now. A later enrichment pass (or assisted form-fill) raises coverage.

## 4. Architecture

### Threading (the core trick)
- Each `inquiry` gets an unguessable `token`.
- Outbound email sets `Reply-To: reply+<token>@reply.kitescout.tech`.
- `reply.kitescout.tech` MX → Postmark inbound. Provider replies → Postmark POSTs a webhook to
  `/api/inbound/postmark` with `MailboxHash = <token>` → we match the `inquiry`, store the inbound
  message, relay to the user, and (Claude) summarize.
- Two-way (Phase 3): the relay email we send the user has its own reply routing so the user's
  reply comes back through us and is forwarded to the provider — neither side sees the other's
  raw address unless intended.

### Relay loop
```
user shortlist ──► POST /api/booking/request (email + trip details)
                      │ create booking_request + N inquiries (one per provider)
                      ▼
                   for each provider with an email:
                      Claude drafts a personalized inquiry
                      Postmark send  (From: inquiries@mail.kitescout.tech,
                                      Reply-To: reply+<token>@reply.kitescout.tech)
                      inquiry.status = sent
                      ▼
provider replies ──► reply+<token>@reply.kitescout.tech
                      │ Postmark inbound webhook → /api/inbound/postmark
                      ▼
                   match token → store inbound message → relay to user
                                 + Claude summary (dates/price/availability)
```

## 5. Data model (Supabase migrations)

```
booking_requests
  id              uuid pk
  user_email      text not null
  user_name       text
  trip            jsonb            -- { destination, dateFrom, dateTo, flexible, groupSize, level, notes }
  status_token    text unique      -- magic-link for the status page (unguessable)
  created_at      timestamptz default now()

inquiries
  id              uuid pk
  request_id      uuid fk -> booking_requests
  cruise_provider_id uuid fk -> cruise_providers
  to_email        text not null
  reply_token     text unique      -- goes into Reply-To plus-address
  status          text             -- queued | sent | bounced | replied | closed | no_email
  provider_msg_count int default 0
  last_message_at timestamptz
  created_at      timestamptz default now()
  unique (request_id, cruise_provider_id)   -- idempotency

inquiry_messages
  id              uuid pk
  inquiry_id      uuid fk -> inquiries
  direction       text             -- outbound | inbound
  from_email      text
  to_email        text
  subject         text
  body_text       text
  body_html       text
  raw             jsonb            -- full Postmark payload for audit
  summary         jsonb            -- Claude-extracted { available, dates, pricePerPerson, notes } (inbound)
  created_at      timestamptz default now()
```

Add a `suppressions` table (email + reason: opt_out | hard_bounce) and check it before every send.

## 6. API routes (web/app/api)

- `POST /api/booking/request` — body: user email/name, trip details, provider ids (the shortlist).
  Creates `booking_request` + `inquiries`; enqueues sends. Returns `{ statusUrl }` (magic link).
  Skips providers without an email (status `no_email`). Idempotent on `(request_id, provider_id)`.
- `POST /api/inbound/postmark` — Postmark inbound webhook. Auth via shared secret (basic auth in
  the URL or a header) + optional IP allowlist. Parse `MailboxHash` → inquiry; store inbound msg;
  relay to user; Claude summary. Must be `force-dynamic`, fast, idempotent on Postmark `MessageID`.
- `POST /api/webhooks/postmark-bounce` — bounce/spam-complaint webhook → mark inquiry `bounced`,
  add to suppressions.
- `GET /api/booking/status?token=...` — data for the status page (per-provider status + messages).
- (Phase 3) `POST /api/booking/reply` — user reply from the status page → relay to provider.

Use the existing lazy `getSupabase()` (service role) and the Anthropic SDK already in the app.

## 7. AI usage (Claude)

- **Draft inquiry** (per provider): short, polite, in the provider's likely language (infer from
  country, default EN), includes the user's trip details and a clear question about availability +
  price. Plain, human, non-spammy. No fabricated claims.
- **Summarize reply** (inbound): structured extract `{ available, dateRanges, pricePerPerson,
  currency, nextStep, freeText }` for the relay + status page.

## 8. Frontend (web/components)

- **Shortlist CTA:** in `SwipeDeck`'s "done" screen (the liked-providers summary), add
  "Request availability from these N providers".
- **Request form:** user name + email, date range (+ flexible toggle), group size, level, optional
  message. Prefill destination/level from the search context where possible.
- **Status page** (`/status/[token]` or `/booking?token=`): per-provider status (sent / replied /
  no response / no email) + the replies and Claude summaries. Magic-link, no login.

## 9. Email + DNS setup (Postmark)

Subdomains (keeps reputation off the apex):
- **Sending:** `mail.kitescout.tech` — Postmark Sender Signature/Domain → add DKIM (CNAME/TXT) +
  Return-Path CNAME (`pm-bounces`). SPF as part of DMARC alignment.
- **Inbound:** `reply.kitescout.tech` — MX → `inbound.postmarkapp.com` (priority 10). Configure the
  Postmark server's inbound webhook → `https://kitescout.tech/api/inbound/postmark`.
- **DMARC:** `_dmarc.kitescout.tech` TXT (start `p=none` for monitoring, tighten later).

DNS is managed on Hostinger → can be set via the Hostinger MCP (`DNS_*`). Existing records: `@`,
`map`, `www` (see `vps-deployment` memory) — do **not** clobber them; only add `mail`, `reply`,
`_dmarc`, and Postmark's CNAMEs.

## 10. Env vars (local + VPS compose)

```
POSTMARK_SERVER_TOKEN          # transactional server token
POSTMARK_INBOUND_WEBHOOK_SECRET# protects /api/inbound/postmark
POSTMARK_FROM=inquiries@mail.kitescout.tech
REPLY_DOMAIN=reply.kitescout.tech
PUBLIC_BASE_URL=https://kitescout.tech
```
Add to local `web/.env.local` and to the VPS compose project env (source of truth in `deploy/`,
applied via the Hostinger API — see `vps-deployment`). New non-AI deps: `postmark` (or call the
REST API directly).

## 11. Cross-cutting requirements

- **Unguessable tokens** (crypto random), one per inquiry + one per request (status link).
- **Idempotency:** unique `(request_id, provider_id)`; dedupe inbound on Postmark `MessageID`;
  never double-send on retry.
- **Opt-out:** `List-Unsubscribe` header + footer link in every provider email → suppression list,
  checked before each send.
- **Inbound auth:** verify the webhook is from Postmark (secret + IP allowlist).
- **Deliverability:** correct DKIM/SPF/DMARC; warm up the new sending domain; low volume first;
  genuine, user-initiated content. Monitor bounce/spam rates.
- **GDPR:** store only what's needed; clear sender identity; a retention/delete path.
- **Rate limiting:** batch sends with small delays; respect Postmark limits.

## 12. Phased plan

- **Phase 0 — Prereqs (user + agent):** Postmark account + server token; verify `mail.` sender
  domain; add DNS (DKIM/SPF/DMARC + `reply.` MX) via Hostinger MCP; set env vars locally + on VPS.
- **Phase 1 — Data + outbound:** migrations; shortlist CTA + request form; `POST /api/booking/request`
  (Claude-drafted emails, Postmark send, reply-token); bounce webhook + suppressions; statuses.
- **Phase 2 — Inbound relay:** inbound webhook → token match → store → relay to user + Claude
  summary; magic-link status page.
- **Phase 3 — Two-way + polish:** user replies relayed to providers; no-response follow-ups;
  rate limiting; per-card "ask" entry point; optional provider-email enrichment to raise coverage.

## 13. First steps for the implementing session

1. Confirm Postmark account exists → get server token (Phase 0 blocker).
2. Decide/confirm subdomains `mail.` + `reply.`; set DNS via Hostinger MCP.
3. Write the migrations (Section 5) and apply to Supabase.
4. Build `POST /api/booking/request` + the request form behind a feature flag (works for the
   email-having subset); verify end-to-end with a Postmark sandbox token before going live.

## 14. Open questions / later

- Language of outbound emails per provider (infer vs always EN/DE)?
- Mask the user's email from providers in two-way relay, or expose it?
- Contact-form fallback for the ~37% without an email — skip, manual, or assisted submit?
- Data retention window for messages.
