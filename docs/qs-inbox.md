# QS inbox: listing quality without an admin page

Status 2026-10-30 (Aaron's Go). The daily monitor (`docs/cruise-observation.md`) and the offer adapters
(`docs/offer-adapters.md`) detect most problems, but the cases they cannot decide alone sat on `/changes`
unseen (26 open on 2026-10-30, the oldest from 2026-10-12, among them the 404s of Sea Dive, BVI and the
Canaries). The offer-slots job had been red every day since 2026-10-14 for the same reason.

Aaron's rule: **decide the cases autonomously and act; ask him only when really unsure. Report every
run so he stays informed and can spot-check, without being the blocker.**

## Run

A scheduled Claude Code task (local, Claude desktop app, daily after the 06:00 UTC cron) works the inbox:

```bash
pnpm cli qs inbox                 # open cases (change rows, dead pages, adapters, expired dates)
pnpm cli qs log --days 1          # what the inbox and the monitor did (for the report)
```

Actions (each needs `--reason`, each is journaled with its before-state in
`~/kitescout-backups/qs-journal.jsonl`):

| command | effect | undo |
|---|---|---|
| `qs hide cruise\|package <id> [--change <id>]` | `is_active=false` (listing out of the app view, data/media/monitoring kept) | `qs unhide ...` |
| `qs move <cruise-offer-id> <url> [--change <id>]` | moved page: new `source_url` + watch row, first LLM read now | `qs move <id> <old url>` (journal) |
| `qs resolve <change-id> apply-rerun [--fields a,b]` | writes the stored surgical re-run values (only the listed fields with `--fields`, e.g. the dates when the price is not on the page) | journal `before` values |
| `qs resolve <change-id> approve` | queues a full re-extraction of the provider (cron 06:00 UTC); journal keeps all provider rows | rows from the journal |
| `qs resolve <change-id> dismiss` | case closed, nothing written | `reopen` on /changes |
| `qs resolve <change-id> revert` | undoes an auto-applied observation | - |
| `qs ack <case-id> --days N` | known case, quiet for N days (e.g. a host that blocks us) | expires |
| `pnpm cli changes rerun <change-id>` | preview of a full re-extraction, no offer writes | - |

## Evidence first

Before any action, read the page yourself (curl with a browser UA, or the built-in browser for JS
sites). The `--reason` names the evidence: HTTP status, a short verbatim snippet, or what was missing.
A single failed fetch is never evidence for hiding (TLS/IP blocks look like dead sites: check the
homepage and a second fetch path first).

**Hide only on positive evidence that the product is gone** (a live site without it, a redirect to an
overview, a parked domain). A site that cannot be reached, or no website found, is no such evidence:
ask Aaron (Aaron 2026-10-30). Listings without a website of their own (source on bstoked or a
marketplace, provider only on Instagram/Facebook, e.g. the Philippines catamaran) are never hidden
without his explicit OK; `qs hide` refuses them unless `--aaron-ok` is given, and that flag needs his
word in chat for that listing.

## Decision rules

| case | act autonomously | ask Aaron |
|---|---|---|
| `offer_gone` (404) | replacement page on the provider's own domain clearly is the same product → `qs move`; product nowhere on a live site, or the whole site is dead/parked → `qs hide` | several candidate pages; the provider would lose ALL its listings and the site looks alive |
| `unlisted` | product absent after a rendered read (browser) → `qs hide`; still there (render artefact) → `dismiss` | page changed into something unclear (rebrand, merged products) |
| `offer_state` review (price jump, currency) | new value verbatim on the offer's own page, same basis (p.p. / cabin / charter) → `apply-rerun` (or `approve` when no surgical preview); not on the page or other basis → `dismiss`. Several open rows for one offer: apply the newest that holds, dismiss the older ones | page contradicts itself |
| `new_product` | not kite, or no boat (dive safari, land camp, stay, kite trip without a boat) → `dismiss`, land products go into the report as package candidates; kite cruise of this provider not yet listed → `changes rerun`, and only if the preview ADDS and removes/changes nothing → `approve` | preview removes or rewrites existing offers; KiteWorldWide products (never build, permission first) |
| `watch` (page fails, no 404 row) | transient (works now) → `ack --days 7`; only an old URL of the provider's own site while the homepage answers → `ack` + follow-up | site unreachable (TLS, timeout, refused) for 7+ checks: ask, recommend hide or wait; blocked only for us (403/Cloudflare) while the site is alive: report, never bypass |
| `source` (adapter) | host blocks us for good (Cloudbeds, BookSurfCamps, Cloudflare) and the listing has no fresh data → `ack --days 30` and name it in the report; code fix needed → record a follow-up (adapter fixes are code: a `claude/<name>` branch reported to the deployer, not a live write) | listing would keep showing bookable slots that are likely wrong for 7+ days |
| `expired` (all dates past) | `pnpm cli observe <source_url>` to read the page now; next season not published yet → `ack --days 30`; product discontinued (evidence on the site) → `qs hide` | dates exist only in a PDF or another page (no tool writes them yet): report as follow-up |

Hard limits, never autonomous: deleting rows or bucket files, mails or contact forms, KCS PRs/comments,
pushes to `main`, migrations, more than 5 hides in one run (stop and ask), anything from resellers or
non-original sites (`docs/offer-adapters.md`, memory `feedback_original-sites-only`).

## LLM budget

Aaron 2026-10-30: OpenRouter at most USD 5 per month for all of KiteScout (hard ceiling 10). The judgement
calls above are made in Claude Code (subscription), not on OpenRouter. Pipeline reads run on DeepSeek
(`CHEAP_MODEL`, `src/lib/anthropic.ts`); Sonnet (`COMPLEX_MODEL`) only for full offer extraction,
dedupe and cabins, and from USD 5 spend in a month every call is downgraded to DeepSeek. Check the
month's spend with `qs log` (first line) before running anything that re-extracts many providers.

## Report (every run)

German, short, in the task's own chat:
1. what was done per case: action, listing link, one-line evidence (Aaron spot-checks from these links)
2. what the monitor auto-applied (`qs log`)
3. open questions (only the "ask Aaron" column), each with a recommendation
4. follow-ups that need code (adapter fixes, new package candidates)
