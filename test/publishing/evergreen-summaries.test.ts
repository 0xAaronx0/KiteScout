import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EVERGREEN_PILOT_SUMMARIES as summaries } from '../../src/offers/evergreen-pilot-summaries.js';
import { parseLen10Content } from '../../src/offers/adapters/len10-stig-ruben-brazil-tatajuba.js';
import { parseSkEgyptContent } from '../../src/offers/adapters/swiss-kitesurf-camp-soma-bay.js';
import { parseKmcContent } from '../../src/offers/adapters/kitemex-camp-la-ventana.js';
import { parseDevContent } from '../../src/offers/adapters/dakhla-evasion-free-ride-camp.js';
import { appFacts, claimValueHash, sha256 } from '../../src/publishing/catalog-values.js';
import { buildManifest, refsAt } from '../../src/publishing/manifest.js';
import type { OfferVerification } from '../../src/publishing/verify.js';

const root = join(import.meta.dirname, '../..');
const historical = JSON.parse(readFileSync(join(root,'publishing/corrections/354-evergreen-summary-proposals.json'),'utf8'));
const proposals = JSON.parse(readFileSync(join(root,'publishing/corrections/354-advice-free-summary-proposals.json'),'utf8'));
const healthy = JSON.parse(readFileSync(join(root,'publishing/samples/v1/healthy.json'),'utf8'));
const read = (adapter: string, part: string) => {
  const dir = join(root,'test/fixtures/offers',adapter);
  return readFileSync(join(dir,readdirSync(dir).find(f=>f.includes(part))!),'utf8');
};
const keys = Object.keys(summaries) as Array<keyof typeof summaries>;
const extra = '<p>ONLY 1 ROOM LEFT. From EUR 9999. 2031-11-22 to 2031-11-29. Fully booked.</p>';
const parserOutputs = (extra: string) => [
  parseLen10Content(read(keys[0],'experience')+extra,'2026-10-21'),
  parseSkEgyptContent({camp:read(keys[1],'kite-camp-egypt')+extra,request:read(keys[1],'booking-request')},'2026-10-21'),
  parseKmcContent(read(keys[2],'kitesurf-and-wingfoil-camps')+extra,read(keys[2],'laventanabeachresort')),
  parseDevContent(read(keys[3],'offres-de-stage')+extra),
];

test('four source adapters emit exactly the finite advice-free proposals, despite dynamic page changes', () => {
  assert.equal(proposals.status,'proposal_only');
  assert.equal(proposals.claimsRegenerated,false);
  assert.equal(proposals.inventoryChanged,false);
  const outputs = parserOutputs('');
  const changed = parserOutputs(extra);
  for (const [i,key] of keys.entries()) {
    assert.equal(outputs[i].summary,summaries[key]);
    assert.equal(changed[i].summary,summaries[key]);
    assert.equal(summaries[key],proposals.entries[i].proposedSummary);
    assert.doesNotMatch(summaries[key], /\b(?:EUR|USD|CHF|\d+|sold out|fully booked)\b|[€$]|\b(?:rooms?|spots?) left\b/i);
  }
});

test('corrected text needs new value hashes; old summaries/receipts are not silently rewritten', () => {
  for (const entry of proposals.entries) {
    const sample = healthy.cases.find((c: {row:{offer_id:string}})=>c.row.offer_id===entry.offerId);
    assert.ok(sample);
    const prior = historical.entries.find((e: {offerId:string}) => e.offerId === entry.offerId);
    assert.equal(sha256(sample.row.summary),prior.expectedRawSummarySha256);
    assert.equal(sha256(prior.proposedSummary),entry.expectedRawSummarySha256);
    assert.notEqual(entry.expectedRawSummarySha256,prior.expectedRawSummarySha256);
    assert.notEqual(sha256(entry.proposedSummary),entry.expectedRawSummarySha256);
    const revision = sample.evidence.snapshot.revision;
    assert.notEqual(claimValueHash(entry.offerId,revision,'description',entry.proposedSummary),
      sample.evidence.claims.find((c: {field:string})=>c.field==='description').valueHash);
  }
});

test('confirmation advice stays outside source claims without rewriting historical evidence', () => {
  assert.equal(proposals.entries.length,4);
  assert.equal(proposals.supersedesProposal,'publishing/corrections/354-evergreen-summary-proposals.json');
  for (const entry of proposals.entries) {
    assert.equal(entry.field,'summary');
    assert.equal(entry.source,'package_offers');
    assert.equal(entry.newSourceVerificationRequired,true);
    assert.doesNotMatch(entry.proposedSummary,/\b(?:confirm|choose)\b/i);
    const prior = historical.entries.find((e: {offerId:string}) => e.offerId === entry.offerId);
    assert.ok(/\b(?:Confirm|Choose)\b/.test(prior.proposedSummary));
    assert.deepEqual(entry.referenceUrls,prior.referenceUrls);
  }
  assert.doesNotMatch(summaries['dakhla-evasion-free-ride-camp'],/wellness.*vary/i);
});

test('synthetic regenerated claims keep independent optional expiry without dynamic description prose', () => {
  // Pure synthetic evidence proves hashing/expiry only; it is never written to publishing/manifest.
  for (const entry of proposals.entries) {
    const sample = healthy.cases.find((c: {row:{offer_id:string}})=>c.row.offer_id===entry.offerId);
    const row = {...sample.row, summary:entry.proposedSummary};
    const facts = appFacts(row,new Date(sample.now));
    const observedAt = '2026-10-21T00:00:00.000Z';
    const fields = Object.fromEntries(Object.keys(facts.values).map(field=>[field,{
      claimed:true,reason:'SYNTHETIC TEST ONLY',sourceUrl:entry.referenceUrls[0],observedAt,deterministic:[],
    }]));
    const v = {offerId:entry.offerId,row,rowDigest:'synthetic',values:facts.values,fields,
      pages:[],complete:true,incompleteReason:null,textReuse:null,verifiedAt:observedAt,model:null,
      stillCurrent:true} as OfferVerification & {stillCurrent:boolean};
    const rules = ['title','type','operator','location'].map(field=>({field,maxAgeHours:4320}));
    rules.push({field:'description',maxAgeHours:2160},{field:'price',maxAgeHours:720},{field:'departures',maxAgeHours:168});
    const result = buildManifest({verified:[v],removed:[],revoked:new Set(),observedAt,
      refs:refsAt('a'.repeat(40)),verifiedBy:'synthetic-offline-test',rules:rules as Parameters<typeof buildManifest>[0]['rules']});
    const claims = result.manifest.entries[0].claims;
    const description = claims.find(c=>c.field==='description')!;
    assert.equal(description.valueHash,claimValueHash(entry.offerId,result.manifest.revision,'description',entry.proposedSummary));
    assert.equal(description.expiresAt,'2027-01-19T00:00:00.000Z');
    assert.equal(claims.find(c=>c.field==='price')?.expiresAt,'2026-11-20T00:00:00.000Z');
    const departure = claims.find(c=>c.field==='departures');
    if (departure) assert.equal(departure.expiresAt,'2026-10-28T00:00:00.000Z');
    // Missing optional values produce no receipt and cannot leak via the evergreen summary.
    delete v.values.price; delete v.values.departures;
    const unknown = buildManifest({verified:[v],removed:[],revoked:new Set(),observedAt,
      refs:refsAt('a'.repeat(40)),verifiedBy:'synthetic-offline-test',rules:rules as Parameters<typeof buildManifest>[0]['rules']});
    assert.deepEqual(unknown.manifest.entries[0].claims.filter(c=>c.field==='price'||c.field==='departures'),[]);
  }
});
