# Text origin and reuse policy for published offer facts

Owner: KiteScout (Aaron Lindner). Applies to the GEO evidence manifest (`publishing/manifest/v1/`) that the
Kite Cruise Scout app reads for public offer pages (MartinMarzi/KiteCruiseScout#267). Every manifest entry's
`rights.grantRef` points at a pinned revision of this file.

## What we grant

- **Scope: text only.** The published description is the `summary` column of `package_offers`, which
  KiteScout writes itself. Titles, operator names, places, prices and dates are facts, not prose.
- **No operator prose.** Summaries are composed by our offer adapters from facts read on the operator's
  own site (templates in `src/offers/adapters/*`, e.g. `dagali-snowkite-camp-fagerheim.ts`). We do not
  copy operator sentences, reviews or marketing copy into them.
- **No photos or other media.** Images need a separate rights contract and are not covered here.
- **Licence to the app:** Kite Cruise Scout (Bstoked) may display, index and quote these texts on its
  public pages for as long as the entry's `rights.status` is `permitted` and `rights.expiresAt` has not
  passed (12 months from the snapshot; renewed by every new manifest).

## How we check it

The verifier (`pnpm cli geo-verify`) compares each summary with the operator page it re-fetches. When the
summary shares 12 or more consecutive words verbatim with that page, the entry gets
`rights.status: "unknown"` (the app gate then holds it) until the summary is rewritten in our own words.

## Revocation

- **Normal:** add the offer to `publishing/rights/revocations.json` (or remove the text). The next manifest
  marks the entry `status: "revoked"`, `rights.status: "revoked"` and drops its claims; the app holds it.
- **Urgent** (an operator objects, a copy is found): same file change plus an immediate manifest run and
  commit; the app picks it up when it pins the new commit. Until then the app can stop showing the offer
  on its side without waiting for us.
- A revoked text is not re-granted silently: un-revoking needs a rewritten summary and a new manifest.

Contact for objections: the KiteScout repository owner (github.com/0xAaronx0).
