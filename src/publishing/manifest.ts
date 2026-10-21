// ---------------------------------------------------------------------------
// GEO P2b source evidence manifest (MartinMarzi/KiteCruiseScout#267).
//
// One manifest = one snapshot of the pilot camps, written as versioned JSON in this public repo:
//   publishing/manifest/v1/<revision>.json           PublishingEvidence v1 entries (what the app gate reads)
//   publishing/manifest/v1/<revision>.evidence.json  our own verifier evidence (page hashes, match locations)
//   publishing/manifest/v1/latest.json               pointer to the newest revision
// The app pins a git commit of this repo; authenticity = that pinned commit. `revision` is the sha256 of
// the canonical snapshot content, and every claim's valueHash binds (source, offerId, revision, field, value).
// ---------------------------------------------------------------------------
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIELDS, canonical, claimValueHash, isPublicUrl, sha256, type Field } from './catalog-values.js';
import type { OfferVerification } from './verify.js';
import { COPY_RUN_WORDS } from './verify.js';

export const REPO_URL = 'https://github.com/0xAaronx0/KiteScout';
export const RIGHTS_OWNER = 'KiteScout (Aaron Lindner)';
const RIGHTS_MONTHS = 12;

export interface Refs { sha: string; schemaRef: string; generatorRef: string; grantRef: string; policyRef: string }

/** Pinned https URLs for schema, generator, text-policy grant and freshness policy at commit `sha`. */
export function refsAt(sha: string, policyRef?: string): Refs {
  return {
    sha,
    schemaRef: `${REPO_URL}/blob/${sha}/publishing/schema/v1/evidence.schema.json`,
    generatorRef: `${REPO_URL}/tree/${sha}/src/publishing`,
    grantRef: `${REPO_URL}/blob/${sha}/docs/publishing/text-policy.md`,
    policyRef: policyRef ?? `${REPO_URL}/blob/${sha}/publishing/policy/v1/freshness-proposal.json`,
  };
}

/** HEAD sha, and whether the files the refs point at are committed unchanged at HEAD. */
export function gitState(): { sha: string; clean: boolean } {
  const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const dirty = execSync('git status --porcelain -- src/publishing publishing/schema publishing/policy docs/publishing', { encoding: 'utf8' }).trim();
  return { sha, clean: dirty === '' };
}

export interface PolicyRule { field: Field; maxAgeHours: number }
export function loadPolicyRules(path = 'publishing/policy/v1/freshness-proposal.json'): PolicyRule[] {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { rules: PolicyRule[] };
  return doc.rules.map(r => ({ field: r.field, maxAgeHours: r.maxAgeHours }));
}

export interface ManifestEntry {
  version: 1;
  status: 'active' | 'removed' | 'revoked';
  source: 'package_offers';
  offerId: string;
  snapshot: { revision: string; schemaRef: string; schemaRevision: string; generatorRef: string; generatorRevision: string; observedAt: string; complete: boolean };
  policyRef: string;
  rights: { status: 'permitted' | 'unknown' | 'revoked'; scope: 'text'; grantRef: string; owner: string; expiresAt: string };
  claims: Array<{ field: Field; valueHash: string; sourceUrl: string; observedAt: string; verifiedAt: string; verifiedBy: string; method: 'source_reviewed'; expiresAt: string }>;
}
export interface Manifest {
  version: 1;
  kind: 'kitescout.publishing-evidence-manifest';
  revision: string;
  observedAt: string;
  verifier: string;
  refs: Refs;
  evidence: string;
  entries: ManifestEntry[];
}

export interface BuildInput {
  verified: Array<OfferVerification & { stillCurrent: boolean }>;
  removed: string[];
  revoked: Set<string>;
  observedAt: string;
  refs: Refs;
  verifiedBy: string;
  rules: PolicyRule[];
}

const addHours = (iso: string, h: number): string => new Date(Date.parse(iso) + h * 3600_000).toISOString();
const addMonths = (iso: string, m: number): string => { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString(); };

export function buildManifest(input: BuildInput): { manifest: Manifest; sidecar: unknown } {
  const { verified, removed, revoked, observedAt, refs, verifiedBy, rules } = input;
  // content-addressed snapshot: which offers, which status, which row state, which values, observed when
  const revision = sha256(canonical({
    version: 1, source: 'package_offers', observedAt, generatorRevision: refs.sha,
    offers: [...verified.map(o => ({ offerId: o.offerId, status: revoked.has(o.offerId) ? 'revoked' : 'active', rowDigest: o.rowDigest, values: o.values })),
      ...removed.map(offerId => ({ offerId, status: 'removed' }))].sort((a, b) => a.offerId < b.offerId ? -1 : 1),
  }));
  const snapshot = (complete: boolean): ManifestEntry['snapshot'] => ({
    revision, schemaRef: refs.schemaRef, schemaRevision: refs.sha, generatorRef: refs.generatorRef, generatorRevision: refs.sha, observedAt, complete,
  });
  const rights = (status: ManifestEntry['rights']['status']): ManifestEntry['rights'] => ({
    status, scope: 'text', grantRef: refs.grantRef, owner: RIGHTS_OWNER, expiresAt: addMonths(observedAt, RIGHTS_MONTHS),
  });

  const entries: ManifestEntry[] = verified.map(o => {
    const isRevoked = revoked.has(o.offerId);
    const copied = (o.textReuse?.words ?? 0) >= COPY_RUN_WORDS;
    const claims: ManifestEntry['claims'] = [];
    for (const field of FIELDS) {
      const check = o.fields[field];
      const rule = rules.find(r => r.field === field);
      if (!check.claimed || !rule || !check.sourceUrl || !check.observedAt || o.values[field] === undefined) continue;
      if (!isPublicUrl(check.sourceUrl)) { check.claimed = false; check.reason = `source URL cannot be cited: ${check.sourceUrl}`; continue; }
      claims.push({
        field, valueHash: claimValueHash(o.offerId, revision, field, o.values[field]), sourceUrl: check.sourceUrl,
        observedAt: check.observedAt, verifiedAt: o.verifiedAt, verifiedBy, method: 'source_reviewed',
        expiresAt: addHours(check.observedAt, rule.maxAgeHours),
      });
    }
    return {
      version: 1, status: isRevoked ? 'revoked' : 'active', source: 'package_offers', offerId: o.offerId,
      snapshot: snapshot(o.complete && o.stillCurrent), policyRef: refs.policyRef,
      rights: rights(isRevoked ? 'revoked' : copied ? 'unknown' : 'permitted'), claims: isRevoked ? [] : claims,
    };
  });
  for (const offerId of removed) entries.push({
    version: 1, status: 'removed', source: 'package_offers', offerId, snapshot: snapshot(true), policyRef: refs.policyRef,
    rights: rights(revoked.has(offerId) ? 'revoked' : 'permitted'), claims: [],
  });
  entries.sort((a, b) => a.offerId < b.offerId ? -1 : 1);

  const manifest: Manifest = {
    version: 1, kind: 'kitescout.publishing-evidence-manifest', revision, observedAt, verifier: verifiedBy, refs,
    evidence: `${revision}.evidence.json`, entries,
  };
  const sidecar = {
    version: 1, kind: 'kitescout.publishing-evidence-sidecar', revision, verifier: verifiedBy, copyRunWords: COPY_RUN_WORDS,
    offers: verified.map(o => ({
      offerId: o.offerId, row: o.row, rowDigest: o.rowDigest, rowUnchangedAtSnapshot: o.stillCurrent, complete: o.complete, incompleteReason: o.incompleteReason,
      verifiedAt: o.verifiedAt, model: o.model, pages: o.pages, textReuse: o.textReuse,
      fields: Object.fromEntries(FIELDS.map(f => [f, o.fields[f]])),
    })),
    removed,
  };
  return { manifest, sidecar };
}

export function writeManifest(dir: string, manifest: Manifest, sidecar: unknown): { path: string; latest: string } {
  mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const path = join(dir, `${manifest.revision}.json`);
  writeFileSync(path, body);
  writeFileSync(join(dir, manifest.evidence), `${JSON.stringify(sidecar, null, 2)}\n`);
  const latest = join(dir, 'latest.json');
  writeFileSync(latest, `${JSON.stringify({
    version: 1, revision: manifest.revision, path: `${manifest.revision}.json`, sha256: sha256(body),
    observedAt: manifest.observedAt, entries: manifest.entries.length,
  }, null, 2)}\n`);
  return { path, latest };
}

/** Offer ids of the previous latest manifest (so offers that left the catalog become `removed`). */
export function previousOfferIds(dir: string): string[] {
  const latest = join(dir, 'latest.json');
  if (!existsSync(latest)) return [];
  const { path } = JSON.parse(readFileSync(latest, 'utf8')) as { path: string };
  const prev = JSON.parse(readFileSync(join(dir, path), 'utf8')) as Manifest;
  return prev.entries.filter(e => e.status !== 'removed').map(e => e.offerId);
}
