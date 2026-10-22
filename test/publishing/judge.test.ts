import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropic } from '../../src/lib/anthropic.js';
import { pageZones, type EvidencePage } from '../../src/publishing/evidence-page.js';
import { judge, VERIFIER_BUDGET_USD, VERIFIER_MODEL } from '../../src/publishing/judge.js';

const page = (html: string): EvidencePage => ({ url: 'https://example.com/camp', fetchedAt: '2026-10-22T00:00:00Z', ok: true, htmlSha256: '', textSha256: '', zones: pageZones(html), linkHosts: [] });

test('judge: deterministic call (temperature 0, no reasoning) to the pinned model, spend cap unchanged', async t => {
  // OpenRouter price lookup for the spend guard
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ data: [{ id: VERIFIER_MODEL, pricing: { prompt: '0.0000001', completion: '0.0000004' } }] })));
  const calls: Array<Record<string, unknown>> = [];
  t.mock.method(anthropic.messages, 'create', async (params: Record<string, unknown>) => {
    calls.push(params);
    return {
      model: VERIFIER_MODEL, stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20, cost: 0.00002 },
      content: [{ type: 'text', text: '{"title": {"supported": true, "quote": "seven night kite camp in Dakhla", "note": ""}}' }],
    };
  });
  const r = await judge(page('<html><body><p>Our seven night kite camp in Dakhla.</p></body></html>'), { title: 'Dakhla Kite Camp' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].model, VERIFIER_MODEL);
  assert.deepEqual(calls[0].thinking, { type: 'disabled' });
  assert.equal(r.verdicts.title?.supported, true);
  if (!process.env.GEO_VERIFY_MAX_USD) assert.equal(VERIFIER_BUDGET_USD, 0.30);
});
