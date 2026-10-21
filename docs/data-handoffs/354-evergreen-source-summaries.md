# Evergreen pilot summaries – source preparation only

Tracks https://github.com/MartinMarzi/KiteCruiseScout/issues/354. Martin requested source PRs
and tests without live database changes or redirects. This PR changes four adapter summary
outputs so the next authorized content refresh cannot restore dated prices, departure dates or
remaining-room scarcity in long-lived description prose. Slot/pricing/capacity parsers and other
content fields retain their existing behavior. The finite original summaries are shared constants,
not runtime redactions, a second catalog or a universal freshness-policy change.

The copied proposal JSON contains exact source-aware IDs, previous raw UTF-8 summary SHA256
preconditions and references. It is inert. The new prose has not been independently reverified by
this PR. Earlier public research used cached pages; the Swiss page could not be fetched. Historical
fixtures are replayed as dated fixtures, never presented as current operator observations.

## Offline verification

```
pnpm install --frozen-lockfile --ignore-scripts --filter kitescout
pnpm exec tsc --noEmit
node --import ./test/helpers/offline-only.mjs --import tsx --test test/offers/{len10-stig-ruben-brazil-tatajuba,swiss-kitesurf-camp-soma-bay,kitemex-camp-la-ventana,dakhla-evasion-free-ride-camp}.test.ts test/publishing/evergreen-summaries.test.ts
```

16 tests pass. The preload supplies disposable .invalid credentials and rejects every fetch.
Recorded source fixtures still prove prices, slots, date precision, availability, room/occupancy,
images, pins and booking flags parse unchanged. Added dynamic page text cannot enter the exact
summary outputs. Old raw hashes reconcile and differ from new text; old description receipts fail
new value hashes. Pure synthetic manifest tests retain separate optional expiries/unknowns without
writing a manifest, changing a policy or fabricating actual verification.

With an available read-only KCS checkout and installed dependencies:

```
KCS_DIR=/path/to/KiteCruiseScout KCS_REF=f179dd6be1263663de2ec4695d8934c03d2b0330 KCS_GATE_LIVE=0 node --import ./test/helpers/offline-only.mjs --import tsx --test test/publishing/kcs-gate.test.ts
```

The existing harness exports committed KCS code and mocks catalog requests. All3 groups pass:
current manifest parity, historical negative samples and16 new cases (4 camps × day8/day31/missing
optional/scarcity mutation). Actual gate results retain evergreen prose, omit expired/unqualified
optional facts and hold a newly inserted scarcity sentence. Synthetic case generation is test-only;
no generated receipts are persisted or accepted as real evidence. CI runs offline source tests;
this cross-repo pass needs the KCS checkout and is not silently claimed in source CI.

## Remaining source-owner/release steps

Aaron approves upstream fork CI and reviews the source PR. Coordinate merge timing with existing
content-ingest schedules: although this PR runs no job, a later existing ingest can consume the new
adapter code. Do not run content ingest or apply a broad adapter update merely to correct summaries.
Separately authorized correction must compare all4 current old-summary hashes first and stop on
drift, then update only intended summaries. Confirm/revise current operator support, especially the
unreadable Swiss source. Obtain separate authorization before live writes or a paid verifier run.
Generate genuinely new hashes/verification/rights and a complete immutable source snapshot after
correction, never copy old receipts or advance timestamps. Supply commit/revision/checksums for a
reviewed app pin update. Current app pins/manifest files, protected public-acceptance HOLD and
issues354/208/215 remain unchanged. No public activation is authorized here.

## GEO impact

Four camp descriptions only: remove embedded dynamic fact channels while retaining original
supported-in-principle descriptive proposals. No claim of fresh verified facts, availability,
prices or new dates. No new URLs, pages, markup, indexing, redirects, images/rights or settings.
App map/filter/carousel/chat code is untouched. No dependencies are added by this PR.
