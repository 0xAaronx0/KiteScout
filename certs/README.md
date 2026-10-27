# Extra trusted root certificates

Node ships its own CA bundle, which does not know Let's Encrypt's new **ISRG Root YR** (2025, RSA,
"Generation Y"). Sites whose chain ends there without a cross-sign (leaf issued by `YR1`, e.g.
kitesuites.com.br) fail in Node with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` / "fetch failed", while curl and
browsers accept them. TLS verification stays on; Node only trusts this one extra root.

| File | Certificate | SHA-256 fingerprint | Source |
|---|---|---|---|
| `isrg-root-yr.pem` | C=US, O=ISRG, CN=Root YR, valid 2025-09-03 to 2045-09-02 | `E5:7B:7E:6F:15:0C:41:91:02:E8:D5:C0:55:72:9F:F9:67:B9:D1:A8:29:BF:00:CE:C8:9C:A6:04:EB:F4:A8:6F` | https://letsencrypt.org/certs/gen-y/root-yr.pem (2026-10-28; identical to LE's published `root-yr.txt` dump, same SHA-256 on crt.sh) |

**How it is used**
- `pnpm cli ...` sets `NODE_EXTRA_CA_CERTS=certs/isrg-root-yr.pem` itself (package.json, unless you already set the
  variable), so local runs and CI behave the same.
- CI: `.github/workflows/monitor.yml` and `rerun-change.yml` also set it at workflow level.
- Direct `npx tsx ...` runs (probe-one, scratch scripts) need it explicitly:
  `NODE_EXTRA_CA_CERTS=certs/isrg-root-yr.pem npx tsx src/offers/probe-one.ts src/offers/adapters/<key>.ts`
- Regression test: `test/lib/root-yr-ca.test.ts` (fingerprint pin, offline chain check against the recorded
  kitesuites.com.br chain, CI and package.json wiring).

When Node's bundled store gains Root YR (check `require('tls').rootCertificates`), this file and the variable can go.
