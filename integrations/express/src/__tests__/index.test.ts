import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { dcpVerify, type DCPAgent, type DCPVerifyOptions } from '../index.js';

function makeReq(overrides: Partial<Request> = {}): Request & { dcpAgent?: DCPAgent } {
  return {
    headers: {},
    body: {},
    ...overrides,
  } as any;
}

function makeRes(): Response & { _status?: number; _body?: any } {
  const res: any = {};
  res._status = 200;
  res.status = vi.fn((code: number) => {
    res._status = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res._body = body;
    return res;
  });
  return res;
}

function makeNext(): NextFunction & { called: boolean } {
  const fn: any = vi.fn(() => { fn.called = true; });
  fn.called = false;
  return fn;
}

function makeValidV2Bundle() {
  const nonce = 'a'.repeat(64);
  return {
    bundle: {
      dcp_bundle_version: '2.0',
      manifest: {
        session_nonce: nonce,
        rpr_hash: 'sha256:abc',
        passport_hash: 'sha256:def',
        intent_hash: 'sha256:ghi',
        policy_hash: 'sha256:jkl',
        audit_merkle_root: 'sha256:mno',
      },
      responsible_principal_record: {
        payload: { human_id: 'rpr:alice', session_nonce: nonce },
        composite_sig: { classical: 'sig1' },
      },
      agent_passport: {
        payload: {
          agent_id: 'agent:bot1',
          session_nonce: nonce,
          capabilities: ['browse', 'api_call'],
          status: 'active',
          keys: [{ kid: 'k1', public_key_b64: 'abc' }],
        },
        composite_sig: { classical: 'sig2' },
      },
      intent: {
        payload: { session_nonce: nonce },
        composite_sig: { classical: 'sig3' },
      },
      policy_decision: {
        payload: { session_nonce: nonce },
        composite_sig: { classical: 'sig4' },
      },
      audit_entries: [],
    },
    signature: {
      composite_sig: {
        classical: 'bundle-sig',
        pq: 'bundle-pq',
        binding: 'pq_over_classical',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Middleware: requireBundle behaviour
// ---------------------------------------------------------------------------

describe('dcpVerify middleware', () => {
  describe('when requireBundle=true', () => {
    it('returns 403 when no bundle is provided', async () => {
      const middleware = dcpVerify({ requireBundle: true });
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._body.verified).toBe(false);
      expect(next.called).toBe(false);
    });
  });

  describe('when requireBundle=false', () => {
    it('passes through when no bundle is provided', async () => {
      const middleware = dcpVerify({ requireBundle: false });
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('bundle from header', () => {
    it('parses bundle from x-dcp-bundle header', async () => {
      const bundle = makeValidV2Bundle();
      const middleware = dcpVerify({ requireBundle: true });
      const req = makeReq({
        headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
      });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.dcpAgent).toBeDefined();
      expect(req.dcpAgent!.dcpVersion).toBe('2.0');
      expect(req.dcpAgent!.agentId).toBe('agent:bot1');
    });
  });

  describe('bundle from body', () => {
    it('parses bundle from request body', async () => {
      const bundle = makeValidV2Bundle();
      const middleware = dcpVerify({ requireBundle: true });
      const req = makeReq({
        body: { signed_bundle: bundle },
      });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.dcpAgent).toBeDefined();
      expect(req.dcpAgent!.dcpVersion).toBe('2.0');
    });
  });

  describe('custom header name', () => {
    it('reads bundle from custom header', async () => {
      const bundle = makeValidV2Bundle();
      const middleware = dcpVerify({
        requireBundle: true,
        headerName: 'x-custom-dcp',
      });
      const req = makeReq({
        headers: { 'x-custom-dcp': JSON.stringify(bundle) } as any,
      });
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.dcpAgent).toBeDefined();
    });
  });

  describe('onFailure callback', () => {
    it('calls onFailure instead of returning 403', async () => {
      const onFailure = vi.fn();
      const middleware = dcpVerify({ requireBundle: true, onFailure });
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await middleware(req, res, next);

      expect(onFailure).toHaveBeenCalled();
      expect(next.called).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// V2 bundle verification
// ---------------------------------------------------------------------------

describe('V2 bundle validation', () => {
  it('rejects bundle with missing manifest', async () => {
    const bundle = makeValidV2Bundle();
    delete (bundle.bundle as any).manifest;

    const middleware = dcpVerify({ requireBundle: true });
    const req = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('manifest'))).toBe(true);
  });

  it('rejects bundle with invalid session_nonce format', async () => {
    const bundle = makeValidV2Bundle();
    bundle.bundle.manifest.session_nonce = 'too-short';

    const middleware = dcpVerify({ requireBundle: true });
    const req = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('session_nonce'))).toBe(true);
  });

  it('rejects bundle missing composite_sig in artifact', async () => {
    const bundle = makeValidV2Bundle();
    delete (bundle.bundle.intent as any).composite_sig;

    const middleware = dcpVerify({ requireBundle: true });
    const req = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('composite_sig'))).toBe(true);
  });

  it('rejects bundle with session_nonce mismatch across artifacts', async () => {
    const bundle = makeValidV2Bundle();
    bundle.bundle.agent_passport.payload.session_nonce = 'b'.repeat(64);

    const middleware = dcpVerify({ requireBundle: true });
    const req = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('nonce'))).toBe(true);
  });

  it('rejects when requireHybrid=true but binding is classical_only', async () => {
    const bundle = makeValidV2Bundle();
    bundle.signature.composite_sig = {
      classical: 'sig',
      binding: 'classical_only',
    } as any;

    const middleware = dcpVerify({ requireBundle: true, requireHybrid: true });
    const req = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ---------------------------------------------------------------------------
// V2 agent extraction
// ---------------------------------------------------------------------------

describe('V2 agent extraction', () => {
  it('extracts agent info from valid V2 bundle', async () => {
    const bundle = makeValidV2Bundle();
    const middleware = dcpVerify({ requireBundle: true });
    const req = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    const agent = req.dcpAgent!;
    expect(agent.dcpVersion).toBe('2.0');
    expect(agent.agentId).toBe('agent:bot1');
    expect(agent.humanId).toBe('rpr:alice');
    expect(agent.capabilities).toContain('browse');
    expect(agent.sessionNonce).toBe('a'.repeat(64));
    expect(agent.kids).toContain('k1');
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('caching', () => {
  it('caches verified bundles when cacheTtlSeconds > 0', async () => {
    const bundle = makeValidV2Bundle();
    const middleware = dcpVerify({
      requireBundle: true,
      cacheTtlSeconds: 60,
    });

    const req1 = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res1 = makeRes();
    const next1 = makeNext();
    await middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    const req2 = makeReq({
      headers: { 'x-dcp-bundle': JSON.stringify(bundle) } as any,
    });
    const res2 = makeRes();
    const next2 = makeNext();
    await middleware(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
    expect(req2.dcpAgent).toBeDefined();
  });
});
