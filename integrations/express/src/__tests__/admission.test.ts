/**
 * Admission through a real Express app (spec/profiles/admission): trusted principals, the
 * strict-v1 profile, revocation, caching and tenants. Every refused request is checked never to
 * reach the protected route.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { verifySignedBundleV2 } from '@dcp-ai/sdk';
import { dcpVerify, denyListRevocationSource, type DCPVerifyOptions } from '../index.js';

vi.mock('@dcp-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dcp-ai/sdk')>();
  return { ...actual, verifySignedBundleV2: vi.fn(actual.verifySignedBundleV2) };
});

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const V1_BUNDLE = JSON.parse(readFileSync(new URL('../../../../tests/conformance/examples/citizenship_bundle.signed.json', import.meta.url), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bundle = (name: string) => clone(VECTORS.signed_bundles[name]);
const CASE_A = VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict');
const NOW = Date.parse(CASE_A.now);
const STRICT = VECTORS.profiles.strict;
const TRUSTED = VECTORS.trust_sets.principal;
const EMPTY = VECTORS.trust_sets.empty;
const AGENT = 'agent:acme-bot';

/** A snapshot saying every subject is not revoked, established 30 s before the clock. */
function freshSnapshot(subjects: { agent_ids: string[]; kids: string[] }, now: number, edit?: (s: any) => void): any {
  const s = {
    checked_at: new Date(now - 30_000).toISOString(),
    agents: Object.fromEntries(subjects.agent_ids.map((id) => [id, 'not_revoked'])),
    keys: Object.fromEntries(subjects.kids.map((kid) => [kid, 'not_revoked'])),
  };
  edit?.(s);
  return s;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  vi.mocked(verifySignedBundleV2).mockClear();
});

async function listen(app: express.Express | ((req: any, res: any) => void)): Promise<string> {
  const server = createServer(app as any);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * An app whose operator authenticates the caller (a bearer token mapped to a tenant on the server)
 * before dcpVerify, and a protected route that counts the requests reaching it.
 */
async function app(options: DCPVerifyOptions | Record<string, DCPVerifyOptions>) {
  const a = express();
  a.use(express.json({ limit: '5mb' }));
  const tenants: Record<string, string> = { 'token-a': 'tenant-a', 'token-b': 'tenant-b' };
  a.use((req: any, _res, next) => {
    req.auth = { tenant: tenants[String(req.headers.authorization ?? '').replace('Bearer ', '')] ?? 'anonymous' };
    next();
  });
  const reached: any[] = [];
  const routes = 'trustedPrincipals' in options || 'profile' in options || Object.keys(options).length === 0 ? { '/protected': options as DCPVerifyOptions } : (options as Record<string, DCPVerifyOptions>);
  for (const [path, opts] of Object.entries(routes)) {
    a.post(path, dcpVerify(opts), (req: any, res) => {
      reached.push(req.dcpAgent);
      res.json({ ok: true, agent: req.dcpAgent });
    });
  }
  const url = await listen(a);
  const post = async (path: string, signedBundle: unknown, init: { token?: string; headers?: Record<string, string>; body?: Record<string, unknown> } = {}) => {
    const r = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...init.headers },
      body: JSON.stringify({ signed_bundle: signedBundle, ...init.body }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { post, reached };
}

/** strict-v1 options with a clock, a trust source and a revocation source the test controls. */
function strictOptions(over: Partial<DCPVerifyOptions> & { snapshotEdit?: (s: any) => void } = {}) {
  const state = { now: NOW, trust: TRUSTED as unknown, snapshotEdit: over.snapshotEdit };
  const revocationSource = vi.fn(async (subjects: any, _context: any) => freshSnapshot(subjects, state.now, state.snapshotEdit));
  const { snapshotEdit: _ignored, ...rest } = over;
  const options: DCPVerifyOptions = {
    profile: STRICT,
    trustedPrincipals: () => state.trust as any,
    revocationSource,
    clock: () => state.now,
    tenant: (req: any) => req.auth.tenant,
    ...rest,
  };
  return { options, state, revocationSource };
}

describe('strict-v1 through a real Express app', () => {
  it('admits a bundle from a trusted principal; the route sees the admission, not a permission', async () => {
    const { options } = strictOptions();
    const { post, reached } = await app(options);
    const r = await post('/protected', bundle('base'));
    expect(r.status).toBe(200);
    expect(reached).toHaveLength(1);
    expect(reached[0].admission).toEqual({
      admitted: true,
      principalTrust: 'trusted',
      profile: 'strict-v1',
      profileCompliance: 'compliant',
      recordedDecision: 'approve',
      trustSetVersion: TRUSTED.trust_set_version,
      actionAuthorized: false,
    });
  });

  it('admits a recorded block decision as evidence, with actionAuthorized false', async () => {
    const { post, reached } = await app(strictOptions().options);
    const r = await post('/protected', bundle('blocked'));
    expect(r.status).toBe(200);
    expect(reached[0].admission).toMatchObject({ recordedDecision: 'block', actionAuthorized: false });
  });

  it.each([
    ['unknown_principal', 'TRUST_PRINCIPAL_UNKNOWN', true],
    ['attacker_claims_known_human_id', 'TRUST_KEY_NOT_ANCHORED', true],
    ['classical_key_substituted', 'TRUST_KEY_NOT_ANCHORED', true],
    ['pq_key_substituted', 'TRUST_KEY_NOT_ANCHORED', true],
    ['other_intended_verifier', 'PROFILE_AUDIENCE_MISMATCH', false],
    ['no_session_issued_at', 'PROFILE_SESSION_START_MISSING', false],
    ['session_301_s', 'PROFILE_SESSION_TOO_LONG', false],
    ['classical_only', 'PROFILE_HYBRID_REQUIRED', false],
    ['pq_signature_invalid', 'VERIFICATION_FAILED', false],
  ])('refuses %s (%s) before the route', async (name, code, verified) => {
    const { post, reached } = await app(strictOptions().options);
    const r = await post('/protected', bundle(name));
    expect(r.status).toBe(403);
    expect(r.body.admitted).toBe(false);
    expect(r.body.verified).toBe(verified);
    expect(r.body.codes).toContain(code);
    expect(reached).toHaveLength(0);
    expect(JSON.stringify(r.body)).not.toContain(TRUSTED.principals[0].keys[1].public_key_b64);
  });

  it('refuses a V1 bundle and a request without a bundle', async () => {
    const { post, reached } = await app(strictOptions().options);
    const v1 = await post('/protected', V1_BUNDLE);
    expect(v1.status).toBe(403);
    expect(v1.body.codes).toEqual(['PROFILE_V2_REQUIRED']);
    const none = await post('/protected', undefined);
    expect(none.status).toBe(403);
    expect(reached).toHaveLength(0);
  });

  it.each([
    ['revoked agent', (s: any) => { s.agents[AGENT] = 'revoked'; }, 'REVOCATION_REVOKED'],
    ['stale snapshot', (s: any) => { s.checked_at = new Date(NOW - 300_001).toISOString(); }, 'REVOCATION_STALE'],
    ['unknown key', (s: any) => { s.keys[Object.keys(s.keys)[0]] = 'unknown'; }, 'REVOCATION_UNKNOWN'],
    ['missing agent', (s: any) => { delete s.agents[AGENT]; }, 'REVOCATION_UNKNOWN'],
  ])('refuses a %s', async (_label, edit, code) => {
    const { post, reached } = await app(strictOptions({ snapshotEdit: edit }).options);
    const r = await post('/protected', bundle('base'));
    expect(r.status).toBe(403);
    expect(r.body.codes).toContain(code);
    expect(r.body.profile_compliance).toBe('non_compliant');
    expect(reached).toHaveLength(0);
  });

  it.each([
    ['returns null', async () => null, 'REVOCATION_UNAVAILABLE'],
    ['throws', async () => { throw new Error('connection refused'); }, 'REVOCATION_UNAVAILABLE'],
    ['never answers', () => new Promise<never>(() => {}), 'REVOCATION_UNAVAILABLE'],
    ['answers unreadably', async () => { throw Object.assign(new Error('bad body'), { code: 'REVOCATION_INVALID' }); }, 'REVOCATION_INVALID'],
    ['returns a malformed snapshot', async () => ({ checked_at: 'yesterday', agents: {}, keys: {} }), 'REVOCATION_INVALID'],
  ])('refuses when the revocation source %s: a failure is never not_revoked', async (_label, source, code) => {
    const { post, reached } = await app(strictOptions({ revocationSource: source as any, revocationTimeoutMs: 50 }).options);
    const r = await post('/protected', bundle('base'));
    expect(r.status).toBe(403);
    expect(r.body.codes).toEqual([code]);
    expect(reached).toHaveLength(0);
  });

  it('asks the revocation source about the agent and every verified signer key', async () => {
    const { options, revocationSource } = strictOptions();
    const { post } = await app(options);
    await post('/protected', bundle('base'), { token: 'token-a' });
    const [subjects, context] = revocationSource.mock.calls[0];
    expect(subjects.agent_ids).toEqual([AGENT]);
    expect(subjects.kids).toHaveLength(4);
    expect(context).toEqual({ tenant: 'tenant-a' });
  });

  it('a request cannot choose the trust set, the profile, the audience or the tenant', async () => {
    const { post, reached } = await app(strictOptions().options);
    const stranger = bundle('unknown_principal');
    const r = await post('/protected', stranger, {
      headers: { 'x-tenant': 'tenant-a', 'x-dcp-profile': 'none' },
      body: {
        trusted_principals: { trust_set_version: 'x', principals: [{ human_id: 'human:stranger', keys: [] }] },
        profile: null,
        verifier_id: 'verifier:someone-else',
        tenant: 'tenant-a',
      },
    });
    expect(r.status).toBe(403);
    expect(r.body.codes).toEqual(['TRUST_PRINCIPAL_UNKNOWN']);
    expect(reached).toHaveLength(0);
  });
});

describe('cached verdicts under trusted principals and strict-v1', () => {
  it('keeps the cryptographic verdict but re-evaluates trust: removing the principal refuses the next request', async () => {
    const { options, state } = strictOptions({ cacheTtlSeconds: 60 });
    const { post, reached } = await app(options);
    expect((await post('/protected', bundle('base'))).status).toBe(200);
    expect((await post('/protected', bundle('base'))).status).toBe(200);
    expect(vi.mocked(verifySignedBundleV2)).toHaveBeenCalledTimes(1);

    state.trust = EMPTY;
    const r = await post('/protected', bundle('base'));
    expect(r.status).toBe(403);
    expect(r.body.codes).toEqual(['TRUST_PRINCIPAL_UNKNOWN']);
    expect(reached).toHaveLength(2);
  });

  it('a key revoked in the trust set refuses a cached bundle', async () => {
    const { options, state } = strictOptions({ cacheTtlSeconds: 60 });
    const { post } = await app(options);
    expect((await post('/protected', bundle('base'))).status).toBe(200);
    state.trust = VECTORS.trust_sets.classical_revoked;
    const r = await post('/protected', bundle('base'));
    expect(r.body.codes).toEqual(['TRUST_KEY_REVOKED']);
  });

  it('a key revoked at the revocation source refuses a cached bundle', async () => {
    const { options, state } = strictOptions({ cacheTtlSeconds: 60 });
    const { post } = await app(options);
    expect((await post('/protected', bundle('base'))).status).toBe(200);
    state.snapshotEdit = (s) => { s.keys[Object.keys(s.keys)[0]] = 'revoked'; };
    const r = await post('/protected', bundle('base'));
    expect(r.body.codes).toEqual(['REVOCATION_REVOKED']);
  });

  it('a cached verdict does not outlive the session', async () => {
    const { options, state } = strictOptions({ cacheTtlSeconds: 3600 });
    const { post } = await app(options);
    expect((await post('/protected', bundle('base'))).status).toBe(200);
    state.now = Date.parse('2026-11-02T10:05:00.001Z');
    const r = await post('/protected', bundle('base'));
    expect(r.status).toBe(403);
    expect(r.body.codes).toContain('PROFILE_SESSION_EXPIRED');
  });

  it('an admission in one tenant is not reused in another', async () => {
    const trustByTenant: Record<string, unknown> = { 'tenant-a': TRUSTED, 'tenant-b': EMPTY };
    const { options } = strictOptions({ cacheTtlSeconds: 60, trustedPrincipals: ({ tenant }) => trustByTenant[tenant] as any });
    const { post, reached } = await app(options);
    expect((await post('/protected', bundle('base'), { token: 'token-a' })).status).toBe(200);
    const r = await post('/protected', bundle('base'), { token: 'token-b', headers: { 'x-tenant': 'tenant-a' } });
    expect(r.status).toBe(403);
    expect(r.body.codes).toEqual(['TRUST_PRINCIPAL_UNKNOWN']);
    expect(reached).toHaveLength(1);
    // Separate cache entries: the bundle was verified once per tenant.
    expect(vi.mocked(verifySignedBundleV2)).toHaveBeenCalledTimes(2);
  });

  it('an acceptance under a permissive policy is not reused under strict-v1', async () => {
    const strict = strictOptions({ cacheTtlSeconds: 60 }).options;
    const { post, reached } = await app({
      '/permissive': { cacheTtlSeconds: 60, verifierPolicy: { default_mode: 'classical_only' }, clock: () => NOW },
      '/strict': strict,
    });
    expect((await post('/permissive', bundle('classical_only'))).status).toBe(200);
    const r = await post('/strict', bundle('classical_only'));
    expect(r.status).toBe(403);
    expect(r.body.codes).toEqual(['PROFILE_HYBRID_REQUIRED', 'VERIFICATION_FAILED']);
    expect(reached).toHaveLength(1);
  });
});

describe('trusted principals without the profile', () => {
  it('admits a trusted principal under the default policy and refuses an unknown one', async () => {
    const { post, reached } = await app({ trustedPrincipals: TRUSTED, clock: () => NOW });
    expect((await post('/protected', bundle('base'))).status).toBe(200);
    expect(reached[0].admission).toMatchObject({ principalTrust: 'trusted', profile: null, profileCompliance: 'not_evaluated' });
    const r = await post('/protected', bundle('unknown_principal'));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ verified: true, admitted: false, principal_trust: 'untrusted', codes: ['TRUST_PRINCIPAL_UNKNOWN'] });
    expect(reached).toHaveLength(1);
  });

  it('refuses V1 bundles: they carry no principal signature to anchor', async () => {
    const { post, reached } = await app({ trustedPrincipals: TRUSTED, clock: () => NOW });
    const r = await post('/protected', V1_BUNDLE);
    expect(r.status).toBe(403);
    expect(r.body.codes).toEqual(['VERIFICATION_FAILED']);
    expect(reached).toHaveLength(0);
  });

  it('a trust source that fails refuses the request', async () => {
    const { post, reached } = await app({ trustedPrincipals: () => { throw new Error('registry down'); }, clock: () => NOW });
    const r = await post('/protected', bundle('base'));
    expect(r.status).toBe(500);
    expect(reached).toHaveLength(0);
  });
});

describe('configuration', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code ?? (e as Error).message;
    }
    return 'accepted';
  };
  const base = { profile: STRICT, trustedPrincipals: TRUSTED, revocationSource: async (): Promise<null> => null };

  it.each([
    ['without trustedPrincipals', { profile: STRICT, revocationSource: async (): Promise<null> => null }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['without revocationSource', { profile: STRICT, trustedPrincipals: TRUSTED }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with requireBundle false', { ...base, requireBundle: false }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['trusted principals with requireBundle false', { trustedPrincipals: TRUSTED, requireBundle: false }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with verifierPolicy', { ...base, verifierPolicy: { default_mode: 'hybrid_required' } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with requireHybrid false', { ...base, requireHybrid: false }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with checkRevocation', { ...base, checkRevocation: true }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with revocationFailClosed', { ...base, revocationFailClosed: false }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['allowing V1 bundles', { ...base, profile: { ...STRICT, verifier_policy: { allow_v1_bundles: true } } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with pq_only', { ...base, profile: { ...STRICT, verifier_policy: { default_mode: 'pq_only' } } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with a 600 s session', { ...base, profile: { ...STRICT, max_session_duration_seconds: 600 } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['without verifier_id', { ...base, profile: { profile: 'strict-v1' } }, 'CONFIG_PROFILE_CONTRADICTION'],
    ['with a fake kid', { ...base, trustedPrincipals: VECTORS.config_cases.find((c: any) => c.name === '7_kid_not_derived').config }, 'CONFIG_TRUST_KID_NOT_DERIVED'],
    ['revocationSource without a profile', { trustedPrincipals: TRUSTED, revocationSource: async (): Promise<null> => null }, 'CONFIG_INVALID_VALUE'],
  ])('refuses a profile %s', (_label, options, expected) => {
    expect(code(() => dcpVerify(options as any))).toBe(expected);
  });

  it('refuses an unknown option or a wrong type', () => {
    expect(code(() => dcpVerify({ ...base, trustedPrincipalz: TRUSTED } as any))).toMatch(/Unknown dcpVerify option/);
    expect(code(() => dcpVerify({ ...base, tenant: 'tenant-a' } as any))).toMatch(/tenant must be a function/);
    expect(code(() => dcpVerify({ ...base, revocationTimeoutMs: -1 }))).toBe('CONFIG_INVALID_VALUE');
  });

  it('accepts requireHybrid true and a tightening profile', () => {
    expect(code(() => dcpVerify({ ...base, requireHybrid: true, profile: { ...STRICT, max_session_duration_seconds: 60 } }))).toBe('accepted');
  });
});

describe('denyListRevocationSource', () => {
  const subjects = { agent_ids: [AGENT], kids: ['a'.repeat(32), 'b'.repeat(32)] };
  async function serve(handler: (req: any, res: any) => void) {
    return listen(handler);
  }

  it('reads a complete deny list: listed subjects revoked, the rest not, as of updated_at', async () => {
    const url = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ dcp_version: '2.0', updated_at: '2026-11-02T10:00:30Z', revocations: [], kid_revocations: [{ revoked_kid: 'b'.repeat(32) }] }));
    });
    const snapshot = await denyListRevocationSource({ url: `${url}/.well-known/dcp-revocations.json` })(subjects, { tenant: '' });
    expect(snapshot).toEqual({
      checked_at: '2026-11-02T10:00:30Z',
      agents: { [AGENT]: 'not_revoked' },
      keys: { ['a'.repeat(32)]: 'not_revoked', ['b'.repeat(32)]: 'revoked' },
    });
  });

  it('sends the operator headers', async () => {
    let seen: string | undefined;
    const url = await serve((req, res) => {
      seen = req.headers.authorization;
      res.end(JSON.stringify({ updated_at: '2026-11-02T10:00:30Z', revocations: [{ agent_id: AGENT }], kid_revocations: [] }));
    });
    const snapshot = await denyListRevocationSource({ url, headers: { authorization: 'Bearer operator-token' } })(subjects, { tenant: '' });
    expect(seen).toBe('Bearer operator-token');
    expect(snapshot!.agents[AGENT]).toBe('revoked');
  });

  it.each([
    ['a 500', (_req: any, res: any) => { res.statusCode = 500; res.end('{}'); }, 'REVOCATION_UNAVAILABLE'],
    ['a redirect', (_req: any, res: any) => { res.statusCode = 302; res.setHeader('location', 'http://127.0.0.1:1/'); res.end(); }, 'REVOCATION_UNAVAILABLE'],
    ['no answer in time', () => {}, 'REVOCATION_UNAVAILABLE'],
    ['a body that is not JSON', (_req: any, res: any) => res.end('revoked: none'), 'REVOCATION_INVALID'],
    ['a list without updated_at', (_req: any, res: any) => res.end(JSON.stringify({ revocations: [] })), 'REVOCATION_INVALID'],
    ['a list of the wrong shape', (_req: any, res: any) => res.end(JSON.stringify({ updated_at: '2026-11-02T10:00:30Z', revocations: ['agent:acme-bot'] })), 'REVOCATION_INVALID'],
  ])('fails closed on %s', async (_label, handler, expected) => {
    const url = await serve(handler);
    const source = denyListRevocationSource({ url, timeoutMs: 100 });
    await expect(source(subjects, { tenant: '' })).rejects.toMatchObject({ code: expected });
  });

  it('refuses a URL that is not https, or http to a loopback host', () => {
    expect(() => denyListRevocationSource({ url: 'file:///etc/revocations.json' })).toThrow(/https/);
    expect(() => denyListRevocationSource({ url: 'http://revocation.example.com/list.json' })).toThrow(/https/);
    for (const url of ['https://revocation.example.com/list.json', 'http://localhost:3003/list.json', 'http://127.0.0.1/list.json', 'http://[::1]/list.json']) {
      expect(() => denyListRevocationSource({ url })).not.toThrow();
    }
  });

  it.each([
    ['declares a body over 16 MiB', (_req: any, res: any) => { res.setHeader('content-length', String(17 * 1024 * 1024)); res.end(); }],
    ['streams a body over 16 MiB', (_req: any, res: any) => {
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      for (let i = 0; i < 17; i++) res.write(chunk);
      res.end();
    }],
  ])('refuses a list that %s', async (_label, handler) => {
    const url = await serve(handler);
    await expect(denyListRevocationSource({ url, timeoutMs: 5000 })(subjects, { tenant: '' })).rejects.toMatchObject({ code: 'REVOCATION_INVALID' });
  });
});
