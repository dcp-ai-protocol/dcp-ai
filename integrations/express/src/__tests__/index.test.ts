import { readFileSync } from 'node:fs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { verifySignedBundle, verifySignedBundleV2 } from '@dcp-ai/sdk';
import { dcpVerify, type DCPAgent } from '../index.js';

// The real SDK verifiers, wrapped so the tests can count how often they run.
vi.mock('@dcp-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dcp-ai/sdk')>();
  return {
    ...actual,
    verifySignedBundle: vi.fn(actual.verifySignedBundle),
    verifySignedBundleV2: vi.fn(actual.verifySignedBundleV2),
  };
});
const v2VerifierCalls = () => vi.mocked(verifySignedBundleV2).mock.calls.length;

// Cross-SDK vectors: every verifier must accept `signed_bundle` under `default_verifier_policy`.
const VECTORS = JSON.parse(
  readFileSync(new URL('../../../../tests/interop/v2/bundle_vectors.json', import.meta.url), 'utf8'),
);

// A V1 signed bundle (Ed25519 only) from the conformance examples.
const V1_SIGNED_BUNDLE = JSON.parse(
  readFileSync(new URL('../../../../tests/conformance/examples/citizenship_bundle.signed.json', import.meta.url), 'utf8'),
);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The honest V2 bundle of the interop vectors (Ed25519 + ML-DSA-65, risk tier medium). */
function honestBundle(): any {
  return clone(VECTORS.signed_bundle);
}

/** A classical-only bundle from a low-risk passport, accepted by classical_only and hybrid_preferred only. */
function classicalOnlyBundle(): any {
  return clone(VECTORS.classical_only_routine_bundle.signed_bundle);
}

function flipFirstByte(b64: string): string {
  const bytes = Buffer.from(b64, 'base64');
  bytes[0] ^= 0x01;
  return bytes.toString('base64');
}

function makeReq(overrides: Partial<Request> = {}): Request & { dcpAgent?: DCPAgent } {
  return {
    headers: {},
    body: {},
    ...overrides,
  } as any;
}

function headerReq(signedBundle: unknown, header = 'x-dcp-bundle') {
  return makeReq({ headers: { [header]: JSON.stringify(signedBundle) } as any });
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

async function run(middleware: ReturnType<typeof dcpVerify>, req: Request & { dcpAgent?: DCPAgent }) {
  const res = makeRes();
  const next = makeNext();
  await middleware(req, res, next);
  return { req, res, next };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Middleware: requireBundle behaviour
// ---------------------------------------------------------------------------

describe('dcpVerify middleware', () => {
  describe('when requireBundle=true', () => {
    it('returns 403 when no bundle is provided', async () => {
      const { res, next } = await run(dcpVerify({ requireBundle: true }), makeReq());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._body.verified).toBe(false);
      expect(next.called).toBe(false);
    });
  });

  describe('when requireBundle=false', () => {
    it('passes through when no bundle is provided', async () => {
      const { next } = await run(dcpVerify({ requireBundle: false }), makeReq());

      expect(next).toHaveBeenCalled();
    });
  });

  describe('bundle from header', () => {
    it('parses bundle from x-dcp-bundle header', async () => {
      const { req, next } = await run(dcpVerify({ requireBundle: true }), headerReq(honestBundle()));

      expect(next).toHaveBeenCalled();
      expect(req.dcpAgent).toBeDefined();
      expect(req.dcpAgent!.dcpVersion).toBe('2.0');
      expect(req.dcpAgent!.agentId).toBe('agent:interop-bot');
    });
  });

  describe('bundle from body', () => {
    it('parses bundle from request body', async () => {
      const req = makeReq({ body: { signed_bundle: honestBundle() } });
      const { next } = await run(dcpVerify({ requireBundle: true }), req);

      expect(next).toHaveBeenCalled();
      expect(req.dcpAgent).toBeDefined();
      expect(req.dcpAgent!.dcpVersion).toBe('2.0');
    });
  });

  describe('custom header name', () => {
    it('reads bundle from custom header', async () => {
      const middleware = dcpVerify({ requireBundle: true, headerName: 'x-custom-dcp' });
      const { req, next } = await run(middleware, headerReq(honestBundle(), 'x-custom-dcp'));

      expect(next).toHaveBeenCalled();
      expect(req.dcpAgent).toBeDefined();
    });
  });

  describe('onFailure callback', () => {
    it('calls onFailure instead of returning 403', async () => {
      const onFailure = vi.fn();
      const { next } = await run(dcpVerify({ requireBundle: true, onFailure }), makeReq());

      expect(onFailure).toHaveBeenCalled();
      expect(next.called).toBe(false);
    });

    it('is called with the verifier errors for a forged bundle', async () => {
      const onFailure = vi.fn();
      const forged = honestBundle();
      forged.signature.composite_sig.classical.sig_b64 = flipFirstByte(forged.signature.composite_sig.classical.sig_b64);

      const { next } = await run(dcpVerify({ requireBundle: true, onFailure }), headerReq(forged));

      expect(next.called).toBe(false);
      expect(onFailure).toHaveBeenCalled();
      expect(onFailure.mock.calls[0][2].join(' ')).toMatch(/signature/i);
    });
  });
});

// ---------------------------------------------------------------------------
// V2 bundle verification (signatures, through the SDK verifier)
// ---------------------------------------------------------------------------

describe('V2 signature verification', () => {
  it('accepts the honest interop bundle', async () => {
    const { res, next } = await run(dcpVerify(), headerReq(honestBundle()));

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('rejects the bundle with a corrupted classical bundle signature', async () => {
    const forged = honestBundle();
    forged.signature.composite_sig.classical.sig_b64 = flipFirstByte(forged.signature.composite_sig.classical.sig_b64);

    const { req, res, next } = await run(dcpVerify(), headerReq(forged));

    expect(next.called).toBe(false);
    expect(req.dcpAgent).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.verified).toBe(false);
    expect(res._body.errors.join(' ')).toMatch(/signature/i);
  });

  it('rejects the bundle with a corrupted PQ bundle signature under the default policy', async () => {
    // VERIFICATION.md V2-7: a PQ signature that is present must verify in every mode.
    const forged = honestBundle();
    forged.signature.composite_sig.pq.sig_b64 = flipFirstByte(forged.signature.composite_sig.pq.sig_b64);

    const { res, next } = await run(dcpVerify(), headerReq(forged));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects the bundle with a changed intent payload and the original signatures', async () => {
    const forged = honestBundle();
    forged.bundle.intent.payload.action_type = 'make_payment';
    forged.bundle.intent.payload.target.to = 'attacker@example.com';

    const { res, next } = await run(dcpVerify(), headerReq(forged));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.join(' ')).toMatch(/intent/);
  });

  it('rejects a different bundle carrying the honest bundle signature', async () => {
    const other = clone(VECTORS.must_accept_bundles[0].signed_bundle);
    other.signature.composite_sig = honestBundle().signature.composite_sig;

    const { res, next } = await run(dcpVerify(), headerReq(other));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a structurally valid but unsigned bundle', async () => {
    const nonce = 'a'.repeat(64);
    const fake = (payload: object) => ({ payload: { session_nonce: nonce, ...payload }, composite_sig: { classical: 'sig' } });
    const unsigned = {
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
        responsible_principal_record: fake({ human_id: 'rpr:alice' }),
        agent_passport: fake({ agent_id: 'agent:bot1', keys: [{ kid: 'k1', public_key_b64: 'abc' }] }),
        intent: fake({}),
        policy_decision: fake({}),
        audit_entries: [],
      },
      signature: { composite_sig: { classical: 'bundle-sig', pq: 'bundle-pq', binding: 'pq_over_classical' } },
    };

    const { res, next } = await run(dcpVerify(), headerReq(unsigned));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('answers 403, not 500, for a malformed bundle', async () => {
    const malformed = honestBundle();
    malformed.bundle.intent = null;

    const { res, next } = await run(dcpVerify(), headerReq(malformed));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('intent'))).toBe(true);
  });
});

describe('V2 bundle validation', () => {
  it('rejects bundle with missing manifest', async () => {
    const bundle = honestBundle();
    delete bundle.bundle.manifest;

    const { res } = await run(dcpVerify({ requireBundle: true }), headerReq(bundle));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('manifest'))).toBe(true);
  });

  it('rejects bundle with invalid session_nonce format', async () => {
    const bundle = honestBundle();
    bundle.bundle.manifest.session_nonce = 'too-short';

    const { res } = await run(dcpVerify({ requireBundle: true }), headerReq(bundle));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('session_nonce'))).toBe(true);
  });

  it('rejects bundle missing composite_sig in artifact', async () => {
    const bundle = honestBundle();
    delete bundle.bundle.intent.composite_sig;

    const { res } = await run(dcpVerify({ requireBundle: true }), headerReq(bundle));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('composite_sig'))).toBe(true);
  });

  it('rejects bundle with session_nonce mismatch across artifacts', async () => {
    const vector = VECTORS.must_reject_bundles.find((c: any) => c.name === 'intent_session_nonce_differs');

    const { res } = await run(dcpVerify({ requireBundle: true }), headerReq(vector.signed_bundle));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.some((e: string) => e.includes('nonce'))).toBe(true);
  });

  it('accepts a classical-only bundle from a low-risk passport under the default policy', async () => {
    const { next } = await run(dcpVerify(), headerReq(classicalOnlyBundle()));

    expect(next).toHaveBeenCalled();
  });

  it('rejects when requireHybrid=true but binding is classical_only', async () => {
    const { res, next } = await run(dcpVerify({ requireHybrid: true }), headerReq(classicalOnlyBundle()));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('applies verifierPolicy.default_mode to every risk tier', async () => {
    const middleware = dcpVerify({ verifierPolicy: { default_mode: 'hybrid_required' } });
    const { res, next } = await run(middleware, headerReq(classicalOnlyBundle()));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('refuses an unknown verification mode when the middleware is created', () => {
    expect(() => dcpVerify({ verifierPolicy: { default_mode: 'none' as any } })).toThrow(/verification mode/);
  });
});

// ---------------------------------------------------------------------------
// V2 agent extraction
// ---------------------------------------------------------------------------

describe('V2 agent extraction', () => {
  it('extracts agent info from valid V2 bundle', async () => {
    const signed = honestBundle();
    const { req } = await run(dcpVerify({ requireBundle: true }), headerReq(signed));

    const agent = req.dcpAgent!;
    const passport = signed.bundle.agent_passport.payload;
    expect(agent.dcpVersion).toBe('2.0');
    expect(agent.agentId).toBe('agent:interop-bot');
    expect(agent.humanId).toBe('human:interop-principal');
    expect(agent.capabilities).toContain('browse');
    expect(agent.sessionNonce).toBe(signed.bundle.manifest.session_nonce);
    expect(agent.kids).toEqual(passport.keys.map((k: any) => k.kid));
    expect(agent.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

describe('revocation', () => {
  it('rejects a verified bundle whose agent is revoked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ revoked: true }) })));
    const middleware = dcpVerify({ checkRevocation: true, revocationServiceUrl: 'http://revocation.test' });

    const { res, next } = await run(middleware, headerReq(honestBundle()));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors).toEqual(['Agent or key has been revoked']);
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('caching', () => {
  it('caches verified bundles when cacheTtlSeconds > 0', async () => {
    const middleware = dcpVerify({ requireBundle: true, cacheTtlSeconds: 60 });

    const first = await run(middleware, headerReq(honestBundle()));
    expect(first.next).toHaveBeenCalled();

    const second = await run(middleware, headerReq(honestBundle()));
    expect(second.next).toHaveBeenCalled();
    expect(second.req.dcpAgent).toBeDefined();
    expect(second.req.dcpAgent!.agentId).toBe('agent:interop-bot');
  });

  it('does not reuse a cached verdict for a bundle with a changed intent and the same signature', async () => {
    const middleware = dcpVerify({ cacheTtlSeconds: 60 });
    const honest = honestBundle();
    expect((await run(middleware, headerReq(honest))).next).toHaveBeenCalled();

    const forged = clone(honest);
    forged.bundle.intent.payload.action_type = 'make_payment';
    const { res, next } = await run(middleware, headerReq(forged));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not reuse a cached verdict for a different bundle carrying the cached composite_sig', async () => {
    const middleware = dcpVerify({ cacheTtlSeconds: 60 });
    const honest = honestBundle();
    expect((await run(middleware, headerReq(honest))).next).toHaveBeenCalled();

    // A bundle signed by the same keys, whose intent carries another session nonce.
    const other = clone(
      VECTORS.must_reject_bundles.find((c: any) => c.name === 'intent_session_nonce_differs').signed_bundle,
    );
    other.signature.composite_sig = clone(honest.signature.composite_sig);
    const { res, next } = await run(middleware, headerReq(other));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not share a verdict between middlewares with different policies', async () => {
    const lax = dcpVerify({ cacheTtlSeconds: 60 });
    const strict = dcpVerify({ cacheTtlSeconds: 60, requireHybrid: true });

    expect((await run(lax, headerReq(classicalOnlyBundle()))).next).toHaveBeenCalled();
    const { res, next } = await run(strict, headerReq(classicalOnlyBundle()));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('cache bounds', () => {
  it('evicts the least recently used verdict beyond cacheMaxEntries', async () => {
    const middleware = dcpVerify({ cacheTtlSeconds: 60, cacheMaxEntries: 2 });
    const a = honestBundle();
    const b = classicalOnlyBundle();
    const c = clone(VECTORS.must_accept_bundles[0].signed_bundle);
    vi.mocked(verifySignedBundleV2).mockClear();

    for (const bundle of [a, b, a, c]) expect((await run(middleware, headerReq(bundle))).next).toHaveBeenCalled();
    expect(v2VerifierCalls()).toBe(3); // a, b, c; the second a is a hit

    expect((await run(middleware, headerReq(a))).next).toHaveBeenCalled();
    expect(v2VerifierCalls()).toBe(3); // a was used more recently than b, so c evicted b
    expect((await run(middleware, headerReq(b))).next).toHaveBeenCalled();
    expect(v2VerifierCalls()).toBe(4);
  });

  it('does not serve a cached verdict after the session expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
    const middleware = dcpVerify({ cacheTtlSeconds: 200 * 365 * 24 * 3600 });
    const signed = honestBundle();
    expect((await run(middleware, headerReq(signed))).next).toHaveBeenCalled();

    // The manifest's session_expires_at is 2099-12-31T18:59:59Z; the keys expire five hours later.
    vi.setSystemTime(new Date('2099-12-31T20:00:00Z'));
    const { res, next } = await run(middleware, headerReq(signed));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.join(' ')).toMatch(/expired/i);
  });

  it('checks revocation again on a cache hit', async () => {
    let revoked = false;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ revoked }) })));
    const middleware = dcpVerify({ cacheTtlSeconds: 60, checkRevocation: true, revocationServiceUrl: 'http://revocation.test' });
    expect((await run(middleware, headerReq(honestBundle()))).next).toHaveBeenCalled();

    revoked = true;
    const { res, next } = await run(middleware, headerReq(honestBundle()));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors).toEqual(['Agent or key has been revoked']);
  });
});

// ---------------------------------------------------------------------------
// V1 bundles: no downgrade below the verifier policy
// ---------------------------------------------------------------------------

describe('V1 bundles', () => {
  it('accepts a V1 bundle when every risk tier allows a classical signature', async () => {
    const middleware = dcpVerify({ verifierPolicy: { default_mode: 'hybrid_preferred' } });
    const { req, next } = await run(middleware, headerReq(clone(V1_SIGNED_BUNDLE)));

    expect(next).toHaveBeenCalled();
    expect(req.dcpAgent!.dcpVersion).toBe('1.0');
  });

  it('rejects a V1 bundle under the default policy, whose high risk tier requires hybrid signatures', async () => {
    const { res, next } = await run(dcpVerify(), headerReq(clone(V1_SIGNED_BUNDLE)));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.join(' ')).toMatch(/V1/);
  });

  it('rejects a V1 bundle when requireHybrid is set', async () => {
    const middleware = dcpVerify({ requireHybrid: true, verifierPolicy: { default_mode: 'hybrid_preferred' } });
    const { res, next } = await run(middleware, headerReq(clone(V1_SIGNED_BUNDLE)));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a V1 bundle when allow_v1_bundles is false', async () => {
    const middleware = dcpVerify({ verifierPolicy: { default_mode: 'hybrid_preferred', allow_v1_bundles: false } });
    const { res, next } = await run(middleware, headerReq(clone(V1_SIGNED_BUNDLE)));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a bundle whose version it cannot detect instead of trying the V1 verifier', async () => {
    const unknown = clone(V1_SIGNED_BUNDLE);
    delete unknown.bundle.responsible_principal_record.dcp_version;
    const middleware = dcpVerify({ verifierPolicy: { default_mode: 'hybrid_preferred' } });
    vi.mocked(verifySignedBundle).mockClear();
    const { res, next } = await run(middleware, headerReq(unknown));

    expect(next.called).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res._body.errors.join(' ')).toMatch(/version/i);
    expect(verifySignedBundle).not.toHaveBeenCalled();
  });
});
