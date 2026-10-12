# Cruise monitoring: observe listing facts instead of diffing page text

Status 2026-10-12 (Aaron's Go). Replaces the text-diff queue on `/changes` (audit 2026-10-12: 722
changes since 2026-07-06, 392 open, about 4 real edge cases; the rest was layout/CTA/testimonial/
countdown noise, Tavily render flip-flops and older entries of the same page).

## Flow (daily cron, `pnpm cli monitor --loop --all`)

1. **Sweep** (`src/pipeline/monitor.ts`): fetch every watched page (direct first; Tavily watches retry
   direct once a week; a 404/410 never falls back to Tavily).
   - Homepage: `siteLossSignal` (gambling/parking/for-sale words, or no kite/sailing vocabulary) on
     EVERY read → observation `site_lost`.
   - Hash unchanged → done. Hash changed but the **facts key** (prices, dates, years, availability words;
     `cruise-state.ts` `factsKey`) is unchanged → done (no LLM, no row).
   - Page read by an adapter → skipped here (adapter phase).
   - Otherwise ONE structured LLM read (`observe.ts` `observePage`, Sonnet; Haiku when the page is no
     offer's own page and is only read for new products).
   - Source page 404/410 on 7 consecutive checks → review "offer gone".
2. **Adapter phase** (`src/cruise-adapters/`): deterministic readers for the loudest providers, daily.
3. **Confirm phase**: every open observation not seen in this run is re-read (its page may not change again).

## State machine (`cruise_changes`, no DDL; `details.kind` marks the new rows)

| kind | path |
|---|---|
| `offer_state` | proposal (`proposeUpdate`) → hidden row `observed` (significant=false) → the SAME proposal seen again ≥ 20 h later: rules pass → `auto_applied` (before/after in `details.applied`, revert button + `pnpm cli changes revert <id>`); rule violated → `rerun_done` review (the existing Approve applies it) |
| `unlisted` | own page no longer presents the offer: ≥ 3 sightings over ≥ 7 days → review with the 🗑 remove button |
| `offer_gone` | source page 404/410 on 7 consecutive checks → same review |
| `new_product` | product on a page that matches no offer title, seen twice ≥ 20 h apart → `pending` (Re-run → full re-extraction creates it) |
| `site_lost` | two sightings ≥ 20 h apart → provider `status=dead` (hidden in the app view) + `pending` alert with "Fehlalarm: wieder einblenden" |

Rules (`cruise-state.ts`): only the offer's OWN page (or an adapter) may propose its data; written
fields are only `STATE_FIELDS` (dates, `price_pp_cabin`/`price_charter_week` + currencies in the
ORIGINAL currency, `price_from_eur` only when EUR, duration, season months); never blanks a field;
review when a price jumps > 40 %, the currency changes, a price is implausible (same ranges and
1.5× cross gate as `_price-derive.ts`), all upcoming departures would disappear, or the duration
jumps. Past departures never count as a change. Free text (title, summary, vessel, season wording)
is never written. A dismissed proposal is not raised again (same fingerprint).

## Adapters (Variant A: they write through the state machine into `cruise_offers`)

| key | pages | reads |
|---|---|---|
| `kite-and-islands` | 4 product + 6 event pages (Wix Events) | departures + status words (AUSGEBUCHT, Nur noch N Plätze, Anmeldung geschlossen); no prices (on request / per night) |
| `kite-safari-season` | `/en.html` | Event JSON-LD per departure (dates **merge**: only the season on sale), cheapest "€/person" |
| `kite2sail` | 5 destination pages | site-wide schedule table split per destination, "starting from" p.p. price |

Not adapted: kitelife.vacations (SiteGround captcha for our honest UA since 2026-10-12, never
bypassed), windseekersredsea.com (dates load via JS; 1 change ever), ocean-ad-ventures (dates in a JS
widget). Add one: `src/cruise-adapters/adapters/<key>.ts` + registry + fixture test
(`OFFERS_RECORD_DIR=test/fixtures/cruise`, then trim JS/CSS).

## Commands

```bash
pnpm cli monitor --loop --all [--no-observe]      # daily sweep (+ adapter + confirm phase)
pnpm cli observe <url> [--dry-run]                # one page now
pnpm cli observe backfill --domain X [--dry-run]  # all source pages of one provider
pnpm cli observe confirm [--dry-run]              # 2nd-sighting phase only
pnpm cli cruise-adapters list | probe [key] | run [key] [--dry-run]
pnpm cli changes revert <change-id>               # undo an auto-applied observation
npx tsx --test test/pipeline/cruise-state.test.ts test/cruise-adapters/*.test.ts
```

## Known gaps

- Provider rename and vessel/text changes are no longer flagged (by design: free text is never auto-written).
- A homepage that is down (not hijacked) raises nothing yet; only source-page 404/410 does.
- `waitlist` / `on_request` departures render as available dates in KCS (its hidden set is
  sold_out/closed/cancelled/unavailable); a badge would be a KCS change.
- The monitor fetch (`src/lib/fetchPage.ts`) still sends a browser UA, unlike the adapters' honest UA.
