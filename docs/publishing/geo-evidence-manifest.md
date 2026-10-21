# GEO evidence manifest (KCS#267, P2b data side)

Data-side half of MartinMarzi/KiteCruiseScout#267: per-field evidence for the app's publishing gate
(`src/features/publishing/offer-eligibility.server.ts`, merged in KCS PR #266). The gate decides; this repo
supplies the evidence, the text grant and a freshness-policy proposal.

## Pieces

| What | Where |
|---|---|
| Manifest (what the app reads) | `publishing/manifest/v1/<revision>.json`, pointer `latest.json` |
| Evidence sidecar (our audit trail) | `publishing/manifest/v1/<revision>.evidence.json` |
| Schema (mirror of `PublishingEvidenceSchema`) | `publishing/schema/v1/evidence.schema.json` |
| Generator + verifier | `src/publishing/*`, `pnpm cli geo-verify` |
| Text grant | `docs/publishing/text-policy.md` |
| Freshness proposal | `publishing/policy/v1/freshness-proposal.json` |
| Samples for Martin | `publishing/samples/v1/*.json` (`pnpm cli geo-verify --samples`) |
| Cross-repo test | `test/publishing/kcs-gate.test.ts` (runs the app's own loader + gate) |

## How a claim is made

1. Read the camp's `app_package_cards` row (read-only) and build the seven values exactly like the app
   (`src/publishing/catalog-values.ts`, a port of KCS `supabase.ts` + `catalog-loader.ts`).
2. Re-fetch the operator's own offer page now (`src/offers/http.ts`: KiteScoutBot UA, robots.txt, throttle,
   never bypass a 403/captcha).
3. Deterministic match of the value on that page: title phrase, operator name + same site, country/region
   name, amount next to its currency, every departure's day and month.
4. LLM judge (OpenRouter, `OPENROUTER_MODEL_VERIFIER`, default `deepseek/deepseek-v4.1-flash` without
   reasoning; hard spend cap `GEO_VERIFY_MAX_USD`, default 0.30 per run, a full run costs about 0.06) answers only
   "is this statement supported by this page" and must quote the page; the quote is re-found in the fetched
   text or the answer counts as no. For the description every sentence of our summary needs a supported
   verdict with an on-page quote, and every number in it must be printed on the page.
5. Re-read the row; the snapshot is that moment (`snapshot.observedAt`), and `complete` is false if the row
   moved, the page was unreadable or the judge failed.
6. Only passing fields become claims: `method: "source_reviewed"`, `verifiedBy:
   "kitescout-ai-verifier/<model>@<generator sha>"`, `observedAt` = page fetch, `expiresAt` = observedAt +
   policy maxAge. Page hashes, match locations, quotes and rejection reasons go to the sidecar.

Text reuse: a summary sharing 12+ consecutive words with the operator page gets `rights.status: "unknown"`.

## Trust and versioning

- Authenticity = the git commit the app pins (this repo is public). `revision` = sha256 of the canonical
  snapshot; every `valueHash` binds source, offerId, revision, field and value, so a manifest cannot be
  replayed onto another revision. `latest.json` carries the manifest file's sha256.
- Generator refs are pinned to the commit that contains the generator; `geo-verify` refuses to write a
  real manifest with uncommitted generator/schema/policy files (`--preview` writes to
  `publishing/manifest/preview/` instead).
- Release: commit code (A) -> run `pnpm cli geo-verify` at A -> commit the manifest (B) -> the app pins B.
- Removal: offers of the previous manifest that are no longer active camps get `status: "removed"`.
  Revocation: `publishing/rights/revocations.json` -> `status: "revoked"` on the next run.
- Alternative transport: the same entries could live in a Supabase table (`publishing_evidence`, one row
  per offer and revision) that the app reads server-side; git keeps the review trail and needs no new
  credentials, so it is the default.

## Running

```bash
pnpm cli geo-verify --preview --offer <id,id>     # dry run with uncommitted code
pnpm cli geo-verify                               # every active camp, writes publishing/manifest/v1
pnpm cli geo-verify --samples                     # samples from the latest manifest
npx tsx --test test/publishing/*.test.ts          # incl. the cross-repo gate test (needs ~/KiteCruiseScout)
```
