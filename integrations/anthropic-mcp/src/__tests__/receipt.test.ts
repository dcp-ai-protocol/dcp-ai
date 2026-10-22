import { describe, it, expect, beforeAll } from 'vitest';
import { verifySignedBundleV2, getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';
import {
  createReceiptIdentity,
  withDcpReceipt,
  verifyDcpReceipt,
  hashEvidence,
  stableJson,
  resultSeen,
  defaultPolicy,
  type DcpReceiptIdentity,
} from '../receipt.js';

let identity: DcpReceiptIdentity;

beforeAll(async () => {
  identity = await createReceiptIdentity({ legalName: 'Test Operator', jurisdiction: 'CL', capabilities: ['api_call', 'browse'] });
}, 60_000);

const weather = async (args: { city: string }) => ({ content: [{ type: 'text' as const, text: `Sunny in ${args.city}` }], structuredContent: { temp_c: 21 } });

describe('withDcpReceipt', () => {
  it('returns the tool result with a receipt that verifies as a V2 bundle and against the arguments and result', async () => {
    const wrapped = withDcpReceipt('get_weather', weather, { identity });
    const args = { city: 'Santiago' };
    const out = await wrapped(args);
    expect(out.content[0].text).toBe('Sunny in Santiago');
    expect(out.structuredContent).toEqual({ temp_c: 21 });

    const receipt = out._meta.dcp_receipt;
    registerDefaultProviders();
    const plain = await verifySignedBundleV2(receipt, getDefaultRegistry());
    expect(plain.verified, plain.errors.join('\n')).toBe(true);

    const { content, structuredContent } = out;
    const checked = await verifyDcpReceipt(receipt, { tool: 'get_weather', arguments: args, result: { content, structuredContent } });
    expect(checked.verified, checked.errors.join('\n')).toBe(true);

    const entry = receipt.bundle.audit_entries[0];
    expect(entry.outcome).toBe('completed');
    expect(entry.policy_decision).toBe('approved');
    expect(entry.evidence.tool).toBe('get_weather');
    expect(entry.evidence.result_ref).toBe(hashEvidence({ content, structuredContent }));
    expect(receipt.bundle.intent.payload.target).toEqual({ channel: 'api', to: 'get_weather' });
    expect(receipt.bundle.intent.payload.security_tier).toBe('standard'); // risk 200 (spec §14.2), on every SDK version
    expect(receipt.bundle.policy_decision.payload.resolved_tier).toBe('standard');
    expect(receipt.bundle.policy_decision.payload.decision).toBe('approve');
    expect(entry.evidence.request_id).toBeUndefined();
  }, 60_000);

  it('hashes the arguments as received and the result as the caller sees it, _meta aside', async () => {
    const mutating = withDcpReceipt(
      'normalize',
      async (args: { amount: number }) => {
        args.amount = 10; // a handler that rewrites its input
        return { content: [{ type: 'text' as const, text: 'ok' }], _meta: { trace: 'abc' } };
      },
      { identity },
    );
    const out = await mutating({ amount: 1000 }, { requestId: 7 });
    expect(out._meta.trace).toBe('abc');
    const { _meta, ...seen } = out;
    const receipt = _meta.dcp_receipt;
    expect(receipt.bundle.audit_entries[0].evidence.request_id).toBe('7');
    // The caller sent 1000 and that is what the receipt attests, not the mutated 10.
    expect((await verifyDcpReceipt(receipt, { arguments: { amount: 1000 }, result: seen })).verified).toBe(true);
    expect((await verifyDcpReceipt(receipt, { arguments: { amount: 10 }, result: seen })).verified).toBe(false);
    expect(resultSeen(out)).toEqual(seen);

    // A bare value becomes a text content, and that is what is hashed.
    const bare = withDcpReceipt('hi', async () => 'hi', { identity });
    const b = await bare({});
    expect(b.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect((await verifyDcpReceipt(b._meta.dcp_receipt, { arguments: {}, result: { content: [{ type: 'text', text: 'hi' }] } })).verified).toBe(true);
  }, 60_000);

  it('verifyDcpReceipt fails closed on input that is not a signed bundle and on half-given evidence', async () => {
    for (const bad of [null, undefined, {}, 'str', [], { bundle: { dcp_bundle_version: '2.0' }, signature: {} }, { bundle: { audit_entries: {} }, signature: {} }]) {
      const r = await verifyDcpReceipt(bad as any);
      expect(r.verified, JSON.stringify(bad)).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    }
    const out = await withDcpReceipt('get_weather', weather, { identity })({ city: 'Santiago' });
    const half = await verifyDcpReceipt(out._meta.dcp_receipt, { arguments: { city: 'Santiago' } });
    expect(half.verified).toBe(false);
    expect(half.errors.join('\n')).toContain('together');
  }, 60_000);

  it('refuses options the schemas would reject', async () => {
    expect(() => withDcpReceipt('x', async () => ({}), { identity, appliedPolicyHash: 'sha256:…' })).toThrow('appliedPolicyHash');
    await expect(createReceiptIdentity({ legalName: 'x', jurisdiction: 'CL', capabilities: ['data_retrieval'] })).rejects.toThrow('capabilities');
  });

  it('rejects a receipt whose arguments or result were changed, or that names another tool', async () => {
    const wrapped = withDcpReceipt('get_weather', weather, { identity });
    const out = await wrapped({ city: 'Santiago' });
    const { _meta, ...result } = out;
    const receipt = _meta.dcp_receipt;
    const tampered = await verifyDcpReceipt(receipt, { tool: 'get_weather', arguments: { city: 'Lima' }, result });
    expect(tampered.verified).toBe(false);
    expect(tampered.errors.join('\n')).toContain('evidence_hash');
    const otherTool = await verifyDcpReceipt(receipt, { tool: 'send_email' });
    expect(otherTool.verified).toBe(false);
    expect(otherTool.errors.join('\n')).toContain('send_email');
  }, 60_000);

  it('does not run a blocked or escalated call and returns an isError result with the receipt', async () => {
    let calls = 0;
    const payment = withDcpReceipt(
      'pay_invoice',
      async () => {
        calls++;
        return { content: [{ type: 'text' as const, text: 'paid' }] };
      },
      { identity, classify: () => ({ action_type: 'initiate_payment', channel: 'payments', estimated_impact: 'high', data_classes: ['financial_data'] }) },
    );
    const out = await payment({ amount: 10 });
    expect(calls).toBe(0);
    expect(out.isError).toBe(true);
    const receipt = out._meta.dcp_receipt;
    expect(receipt.bundle.audit_entries[0].outcome).toBe('blocked');
    expect(receipt.bundle.audit_entries[0].policy_decision).toBe('blocked');
    expect(receipt.bundle.audit_entries[0].evidence.result_ref).toBeNull();
    expect(receipt.bundle.policy_decision.payload.required_confirmation).not.toBeNull();
    expect(receipt.bundle.intent.payload.security_tier).toBe('maximum'); // risk 1000
    const { _meta, ...seen } = out;
    const checked = await verifyDcpReceipt(receipt, { tool: 'pay_invoice', arguments: { amount: 10 }, result: seen });
    expect(checked.verified, checked.errors.join('\n')).toBe(true);

    const escalated = withDcpReceipt('pay_invoice', async () => ({ content: [] }), { identity, classify: () => ({ estimated_impact: 'medium' }) });
    const e = await escalated({});
    expect(e.isError).toBe(true);
    expect(e._meta.dcp_receipt.bundle.audit_entries[0].outcome).toBe('escalated');
    expect(e._meta.dcp_receipt.bundle.intent.payload.security_tier).toBe('elevated'); // risk 500
  }, 60_000);

  it('turns a throwing handler into an isError result whose receipt records the failure', async () => {
    const broken = withDcpReceipt('explode', async () => { throw new Error('boom'); }, { identity });
    const out = await broken({ x: 1 });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('boom');
    const entry = out._meta.dcp_receipt.bundle.audit_entries[0];
    expect(entry.outcome).toBe('failed');
    expect(entry.policy_decision).toBe('approved');
    expect(entry.evidence.result_ref).not.toBeNull();
    const { _meta, ...seen } = out;
    const checked = await verifyDcpReceipt(_meta.dcp_receipt, { tool: 'explode', arguments: { x: 1 }, result: seen });
    expect(checked.verified, checked.errors.join('\n')).toBe(true);
  }, 60_000);

  it('a custom policy can approve what the default would block', async () => {
    const wrapped = withDcpReceipt('pay_invoice', async () => ({ content: [] }), {
      identity,
      classify: () => ({ estimated_impact: 'high' }),
      decide: () => ({ decision: 'approve', risk_score: 100, reasons: ['pre-approved by the operator'] }),
      appliedPolicyHash: `sha256:${'0'.repeat(64)}`,
    });
    const out = await wrapped({});
    expect(out.isError).toBeUndefined();
    expect(out._meta.dcp_receipt.bundle.policy_decision.payload.applied_policy_hash).toBe(`sha256:${'0'.repeat(64)}`);
    expect((await verifyDcpReceipt(out._meta.dcp_receipt)).verified).toBe(true);
  }, 60_000);
});

describe('hashEvidence', () => {
  it('is independent of key order and keeps floats', () => {
    expect(stableJson({ b: 1, a: { d: 0.5, c: [1, { f: 2, e: 3 }] } })).toBe('{"a":{"c":[1,{"e":3,"f":2}],"d":0.5},"b":1}');
    expect(hashEvidence({ b: 1, a: 2 })).toBe(hashEvidence({ a: 2, b: 1 }));
    expect(hashEvidence(undefined)).toBe(hashEvidence(null));
  });
});

describe('defaultPolicy', () => {
  it('approves low impact, escalates medium, blocks high or sensitive data', () => {
    const intent = (over: Record<string, unknown>) => ({ data_classes: ['none'], estimated_impact: 'low', ...over }) as any;
    expect(defaultPolicy(intent({})).decision).toBe('approve');
    expect(defaultPolicy(intent({ estimated_impact: 'medium' })).decision).toBe('escalate');
    expect(defaultPolicy(intent({ estimated_impact: 'high' })).decision).toBe('block');
    expect(defaultPolicy(intent({ data_classes: ['pii', 'credentials'] })).decision).toBe('escalate');
    expect(defaultPolicy(intent({ estimated_impact: 'medium', data_classes: ['pii', 'credentials'] })).risk_score).toBe(800);
  });
});
