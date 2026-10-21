// SYNTHETIC offline evidence only. Never persist these claims as real verification.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appFacts, FIELDS } from '../../src/publishing/catalog-values.js';
import { buildManifest, refsAt, loadPolicyRules } from '../../src/publishing/manifest.js';
import type { OfferVerification } from '../../src/publishing/verify.js';

export function evergreenKcsCases() {
  const root = join(import.meta.dirname,'../..');
  const proposals = JSON.parse(readFileSync(join(root,'publishing/corrections/354-evergreen-summary-proposals.json'),'utf8'));
  const healthy = JSON.parse(readFileSync(join(root,'publishing/samples/v1/healthy.json'),'utf8'));
  const observedAt = '2026-10-21T19:00:00.000Z';
  const rules = loadPolicyRules(join(root,'publishing/policy/v1/freshness-proposal.json'));
  const ref = 'https://github.com/0xAaronx0/KiteScout/blob/fb8f4989fd796674641f8b936eeb11cd34caf52d/publishing/policy/v1/freshness-proposal.json';
  const policy = {version:1,approvalRef:ref,owner:'Martin Marzi',approvedAt:'2026-10-21T18:10:26Z',rules};
  return proposals.entries.flatMap((entry: {offerId:string; proposedSummary:string; referenceUrls:string[]}) => {
    const row = {...healthy.cases.find((c: {row:{offer_id:string}})=>c.row.offer_id===entry.offerId).row, summary:entry.proposedSummary};
    const facts = appFacts(row,new Date(observedAt));
    const fields = Object.fromEntries(FIELDS.map(field=>[field,{claimed:facts.values[field]!==undefined,
      reason:'SYNTHETIC TEST ONLY',sourceUrl:entry.referenceUrls[0],observedAt,deterministic:[]}]));
    const v = {offerId:entry.offerId,row,rowDigest:'synthetic',values:facts.values,fields,
      pages:[],complete:true,incompleteReason:null,textReuse:null,verifiedAt:observedAt,model:null,
      stillCurrent:true} as OfferVerification & {stillCurrent:boolean};
    const {manifest} = buildManifest({verified:[v],removed:[],revoked:new Set(),observedAt,
      refs:refsAt('a'.repeat(40),ref),verifiedBy:'synthetic-offline-test',rules});
    const base = {row,evidence:manifest.entries[0],policy,expectedRevision:manifest.revision};
    return [
      {...base,name:entry.offerId+' day8',now:'2026-10-29T19:00:00.000Z',expected:'editorial_preview'},
      {...base,name:entry.offerId+' day31',now:'2026-11-21T19:00:00.000Z',expected:'editorial_preview'},
      {...base,name:entry.offerId+' missing-optional',now:observedAt,expected:'editorial_preview',
        evidence:{...base.evidence,claims:base.evidence.claims.filter(c=>c.field!=='price'&&c.field!=='departures')}},
      {...base,name:entry.offerId+' scarcity-change',now:observedAt,expected:'held',
        row:{...row,summary:row.summary+' Only 4 rooms left.'}},
    ];
  });
}
