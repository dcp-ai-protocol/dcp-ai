/**
 * Secondary SHA3-256 fields (spec/VERIFICATION.md V2-11 and its erratum of 27/10/2026), through the shared vectors
 * tests/interop/v2/secondary_sha3_vectors.json and every path that reaches verifySignedBundleV2: the default
 * verifier, admission and the experimental candidate verifier (its v1 route on the vectors, its dcp-jcs-v2 route on a
 * bundle it produces).
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { canonicalizeV2 } from '../core/canonicalize.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import { sha256Hex, sha3_256Hex } from '../core/dual-hash.js';
import { admitSignedBundleV2 } from '../core/admission.js';
import { experimentalCandidateSignBundle, experimentalCandidateSignPayload } from '../core/experimental-candidate-produce.js';
import { experimentalHistoricalAdapters } from '../core/experimental-candidate-router.js';
import { createExperimentalCandidateVerifier } from '../core/experimental-candidate-verify.js';
import { verifySignedBundleV2 } from '../core/verify-v2.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import type { SignedBundleV2 } from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(resolve(__dirname, '../../../../tests/interop/v2/secondary_sha3_vectors.json'), 'utf8'));
const NOW = { now: Date.parse(V.verification_time) };
const TIMEOUT_MS = 60_000;

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

type Part = { audit_entries: unknown[]; manifest: Record<string, unknown>; signature: unknown };
type Case = Part & { name: string; group: string; expect: 'accept' | 'reject'; error_contains?: string; control?: Part };
const assemble = (c: Part): SignedBundleV2 =>
  ({
    bundle: { dcp_bundle_version: '2.0', manifest: c.manifest, ...V.base.artifacts, audit_entries: c.audit_entries },
    signature: c.signature,
  }) as SignedBundleV2;
const CASES = V.cases as Case[];
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('secondary SHA3-256 vectors', () => {
  it('cover accepts and rejects in every group', () => {
    expect(CASES.length).toBe(51);
    expect(new Set(CASES.map((c) => c.name)).size).toBe(51);
    expect(CASES.filter((c) => c.expect === 'accept').length).toBe(22);
    expect(CASES.filter((c) => c.expect === 'reject').length).toBe(29);
    expect(CASES.every((c) => c.expect === 'accept' || c.expect === 'reject')).toBe(true);
    for (const g of ['root', 'chain', 'intent', 'mixed']) expect(CASES.some((c) => c.group === g)).toBe(true);
    expect(CASES.filter((c) => c.expect === 'reject').every((c) => c.control && c.error_contains)).toBe(true);
  });

  for (const c of CASES) {
    it(`${c.expect}: ${c.name}`, async () => {
      const r = await verifySignedBundleV2(assemble(c), registry, undefined, NOW);
      if (c.expect === 'accept') {
        expect(r.errors).toEqual([]);
        expect(r.verified).toBe(true);
        return;
      }
      expect(r.verified).toBe(false);
      expect(r.errors.some((e) => e.includes(c.error_contains!)), r.errors.join(' | ')).toBe(true);
      // The defect is the only one: no other check fails.
      expect(r.errors.every((e) => e.includes('secondary')), r.errors.join(' | ')).toBe(true);
      // The root lands in the manifest step, the chain and the intent in the audit step.
      if (c.group === 'root') expect(r.details?.manifest_valid).toBe(false);
      else expect(r.details?.hash_chain_valid).toBe(false);
      const control = await verifySignedBundleV2(assemble(c.control!), registry, undefined, NOW);
      expect(control.errors).toEqual([]);
      expect(control.verified).toBe(true);
    }, TIMEOUT_MS);
  }
});

describe('the same verdicts through admission and the candidate verifier (v1 route)', () => {
  const trust = {
    trust_set_version: '2026-10-27.secondary',
    principals: [{
      human_id: V.base.artifacts.responsible_principal_record.payload.human_id,
      keys: V.base.principal_keys.map((k: Record<string, unknown>) => ({ kid: k.kid, alg: k.alg, public_key_b64: k.public_key_b64, status: 'active' })),
    }],
  };
  // The vectors name dcp-jcs-v1 in the manifest, so the router must accept it to take the v1 route.
  const candidate = createExperimentalCandidateVerifier({
    transport: 'bare',
    acceptedProfiles: ['dcp-jcs-v1', 'dcp-jcs-v2'],
    historical: experimentalHistoricalAdapters.bufferUtf8JsonParse,
  });

  for (const c of CASES) {
    it(`${c.expect}: ${c.name}`, async () => {
      const ok = c.expect === 'accept';
      const admission = await admitSignedBundleV2(assemble(c), registry, { trust, ...NOW });
      expect(admission.verified).toBe(ok);
      expect(admission.admitted).toBe(ok);
      expect(admission.action_authorized).toBe(false);
      const routed = await candidate.verify(utf8(JSON.stringify(assemble(c))), registry, undefined, NOW);
      expect(routed.entered).toBe('dcp-jcs-v1');
      expect(routed.verification?.verified).toBe(ok);
    }, TIMEOUT_MS);
  }
});

describe('candidate dcp-jcs-v2 bundles (experimental, opt-in)', () => {
  async function keys(): Promise<CompositeKeyPair> {
    const c = await ed25519.generateKeypair();
    const p = await mlDsa65.generateKeypair();
    return {
      classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
      pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
    };
  }
  const ref = (alg: 'sha256' | 'sha3-256', v: unknown) =>
    `${alg}:${(alg === 'sha256' ? sha256Hex : sha3_256Hex)(Buffer.from(canonicalizeV2(v), 'utf8'))}`;

  async function produce(secondLink: (first: unknown) => string) {
    const [pk, ak] = [await keys(), await keys()];
    const nonce = 'c'.repeat(64);
    const entry = (k: CompositeKeyPair) => [k.classical, k.pq].map((x) => ({
      kid: x.kid, alg: x.alg, public_key_b64: x.publicKeyB64, created_at: '2026-10-21T00:00:00Z', expires_at: null, status: 'active',
    }));
    const rpr = { ...V.base.artifacts.responsible_principal_record.payload, session_nonce: nonce, binding_keys: entry(pk) };
    const passport = { ...V.base.artifacts.agent_passport.payload, session_nonce: nonce, keys: entry(ak) };
    const intent = { ...V.base.artifacts.intent.payload, session_nonce: nonce };
    const policy = { ...V.base.artifacts.policy_decision.payload, session_nonce: nonce };
    const first = {
      dcp_version: '2.0', audit_id: 'audit:candidate-sec-0', session_nonce: nonce, prev_hash: 'GENESIS', prev_hash_secondary: 'GENESIS',
      hash_alg: 'sha256+sha3-256', timestamp: '2026-10-21T12:01:00Z', agent_id: passport.agent_id, human_id: rpr.human_id,
      intent_id: intent.intent_id, intent_hash: ref('sha256', intent), intent_hash_secondary: ref('sha3-256', intent),
      policy_decision: 'approved', outcome: 'ok', evidence: { tool: 'smtp', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
    };
    const second = { ...first, audit_id: 'audit:candidate-sec-1', prev_hash: ref('sha256', first), prev_hash_secondary: secondLink(first) };
    const part = async (context: string, payload: unknown, k: CompositeKeyPair) =>
      ({ value: (await experimentalCandidateSignPayload(registry, context, { value: payload }, k)).signedPayload });
    const out = await experimentalCandidateSignBundle(
      registry,
      {
        rpr: await part(DCP_CONTEXTS.ResponsiblePrincipal, rpr, pk),
        passport: await part(DCP_CONTEXTS.AgentPassport, passport, ak),
        intent: await part(DCP_CONTEXTS.Intent, intent, ak),
        policyDecision: await part(DCP_CONTEXTS.PolicyDecision, policy, ak),
        auditEntries: [{ value: first }, { value: second }],
      },
      { signerType: 'human', signerId: rpr.human_id, keys: pk },
      { sessionNonce: nonce, sessionIssuedAt: '2026-10-21T00:00:00Z', sessionExpiresAt: '2099-12-31T23:59:59Z', createdAt: '2026-10-21T12:05:00Z', dualHash: true },
    );
    const verifier = createExperimentalCandidateVerifier({
      transport: 'bare', acceptedProfiles: ['dcp-jcs-v2'], historical: experimentalHistoricalAdapters.bufferUtf8JsonParse,
    });
    return verifier.verify(out.bytes, registry, undefined, NOW);
  }

  it('a correct chain, intent and root verify on the candidate route', async () => {
    const r = await produce((first) => ref('sha3-256', first));
    expect(r.entered).toBe('dcp-jcs-v2');
    expect(r.verification?.errors).toEqual([]);
    expect(r.verification?.verified).toBe(true);
  }, TIMEOUT_MS);

  it('a wrong link is rejected on the candidate route, with the same diagnostic', async () => {
    const r = await produce(() => `sha3-256:${'ab'.repeat(32)}`);
    expect(r.entered).toBe('dcp-jcs-v2');
    expect(r.verification?.verified).toBe(false);
    expect(r.verification?.errors.some((e) => e.includes('prev_hash_secondary chain break at entry[1]'))).toBe(true);
  }, TIMEOUT_MS);
});
