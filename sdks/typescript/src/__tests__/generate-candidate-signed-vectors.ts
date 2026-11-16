/**
 * Phase 3 vectors for the experimental candidate dcp-jcs-v2: real signed bundles and the expectations
 * of the bytes verifier (createExperimentalCandidateVerifier), written by hand below. Nothing here runs
 * a verifier or a router: the only computed values are the input hashes and, for the positives, the
 * hashes of the canonical manifest and unit, taken with canonicalizeV2 over the base.
 *
 * Writes tests/interop/candidate/phase3-signed-vectors.json. Bases are whole inputs, frozen: the 18 of
 * the committed file, whose hashes are listed in FROZEN_BASES. A case is a base plus byte edits applied
 * in order; `find` must occur exactly once.
 *
 * Without flags the file is assembled again from its committed bases (to change cases or
 * expectations), never signed again. --sign-bases signs new bases (keys from fixed seeds; ML-DSA
 * signatures differ on each run) and refuses while the file exists. --check writes nothing: it checks
 * the bases against FROZEN_BASES, their payload_hash and manifest_hash and declared profile, and that
 * every case, edit, input hash and expectation is the one this file states. It does not verify
 * signatures: experimental-candidate-verify.test.ts does, for every signed base.
 *
 * Run: cd sdks/typescript && <vite-node> src/__tests__/generate-candidate-signed-vectors.ts [--check]
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import nacl from 'tweetnacl';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

import { BundleBuilderV2 } from '../bundle/builder-v2.js';
import { signBundleV2, signBundleV2ClassicalOnly } from '../bundle/signer-v2.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { classicalOnlySign, compositeSign } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import { deriveKid } from '../core/crypto-provider.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import type { DcpContext } from '../core/domain-separation.js';
import { sha256Hex } from '../core/dual-hash.js';
import { auditEventsMerkleRoot } from '../core/pq-checkpoint.js';
import { preparePayload } from '../core/signed-payload.js';
import { DEFAULT_VERIFIER_POLICY } from '../core/verify-v2.js';
import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import type {
  AgentPassportV2,
  AuditEventV2,
  IntentV2,
  KeyEntry,
  PolicyDecisionV2,
  ResponsiblePrincipalRecordV2,
  VerifierPolicy,
} from '../types/v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../../..');
const OUTPUT_PATH = resolve(ROOT, 'tests/interop/candidate/phase3-signed-vectors.json');
const V1_LEGACY_PATH = resolve(ROOT, 'tests/conformance/examples/citizenship_bundle.signed.json');

// The instant every verifier that takes one uses; the bases are valid from 2026-10-21 to 2099-12-31.
const NOW = '2026-10-25T00:00:00Z';

const V1 = ['dcp-jcs-v1'];
const V2 = ['dcp-jcs-v2'];
const BOTH = ['dcp-jcs-v1', 'dcp-jcs-v2'];

const POLICIES: Record<string, VerifierPolicy> = {
  default: DEFAULT_VERIFIER_POLICY,
  hybrid_required: {
    ...DEFAULT_VERIFIER_POLICY,
    default_mode: 'hybrid_required',
    risk_overrides: { low: 'hybrid_required', medium: 'hybrid_required', high: 'hybrid_required' },
  },
};

// ── Signing (generation only) ──

const registry = new AlgorithmRegistry();
registry.registerSigner(new Ed25519Provider());
registry.registerSigner(new MlDsa65Provider());

const seed = (label: string) => createHash('sha256').update(`dcp-ai phase 3 candidate vectors: ${label}`).digest();
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const sha256Of = (v: unknown) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(v), 'utf8'))}`;

function keysFrom(label: string): CompositeKeyPair {
  const c = nacl.sign.keyPair.fromSeed(seed(`${label} ed25519`));
  const p = ml_dsa65.keygen(seed(`${label} ml-dsa-65`));
  return {
    classical: { kid: deriveKid('ed25519', c.publicKey), alg: 'ed25519', secretKeyB64: b64(c.secretKey), publicKeyB64: b64(c.publicKey) },
    pq: { kid: deriveKid('ml-dsa-65', p.publicKey), alg: 'ml-dsa-65', secretKeyB64: b64(p.secretKey), publicKeyB64: b64(p.publicKey) },
  };
}

function keyEntries(keys: CompositeKeyPair): KeyEntry[] {
  return [keys.classical, keys.pq].map((k) => ({
    kid: k.kid,
    alg: k.alg,
    public_key_b64: k.publicKeyB64,
    created_at: '2026-10-21T00:00:00Z',
    expires_at: null,
    status: 'active',
  }));
}

async function sign<T>(payload: T, context: DcpContext, keys: CompositeKeyPair, classicalOnly = false) {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  const composite_sig = classicalOnly
    ? await classicalOnlySign(registry, context, canonicalBytes, keys.classical)
    : await compositeSign(registry, context, canonicalBytes, keys);
  return { payload, payload_hash: payloadHash, composite_sig };
}

interface Variant {
  /** The manifest canonicalization_profile; null removes the field. Default dcp-jcs-v2. */
  profile?: 'dcp-jcs-v1' | 'dcp-jcs-v2' | null;
  classicalOnly?: boolean;
  passport?: Partial<AgentPassportV2>;
  intent?: Partial<IntentV2>;
  /** Members added to the intent target. */
  target?: Record<string, unknown>;
  policyDecision?: Partial<PolicyDecisionV2>;
  evidence?: AuditEventV2['evidence'];
  firstPrevHash?: string;
  secondPrevHash?: string;
  /** The intent is signed under this session_nonce; the manifest commits to that intent. */
  intentNonce?: string;
  agentKeys?: CompositeKeyPair;
  agentKey?: Partial<KeyEntry>;
  /** A PQ checkpoint over the two audit entries, signed by the agent. */
  checkpoint?: boolean;
}

const ROUTINE_INTENT: Partial<IntentV2> = {
  action_type: 'browse',
  target: { channel: 'web' },
  data_classes: ['none'],
  estimated_impact: 'low',
};

function makeBuilder(principal: CompositeKeyPair, agent: CompositeKeyPair, nonce: string) {
  return async function build(v: Variant = {}) {
    const agentKeys = v.agentKeys ?? agent;
    const rpr: ResponsiblePrincipalRecordV2 = {
      dcp_version: '2.0',
      human_id: 'human:candidate-principal',
      session_nonce: nonce,
      legal_name: 'Candidate Principal',
      entity_type: 'natural_person',
      jurisdiction: 'US-CA',
      liability_mode: 'owner_responsible',
      override_rights: true,
      issued_at: '2026-10-21T00:00:00Z',
      expires_at: null,
      contact: null,
      binding_keys: keyEntries(principal),
    };
    const passport: AgentPassportV2 = {
      dcp_version: '2.0',
      agent_id: 'agent:candidate-bot',
      session_nonce: nonce,
      keys: keyEntries(agentKeys).map((k) => ({ ...k, expires_at: '2099-12-31T18:59:59-05:00', ...v.agentKey })),
      principal_binding_reference: rpr.human_id,
      capabilities: ['browse', 'api_call'],
      risk_tier: 'medium',
      created_at: '2026-10-21T00:00:00Z',
      status: 'active',
      ...v.passport,
    };
    const base: IntentV2 = {
      dcp_version: '2.0',
      intent_id: 'intent:candidate-001',
      session_nonce: nonce,
      agent_id: passport.agent_id,
      human_id: rpr.human_id,
      timestamp: '2026-10-21T12:00:00Z',
      action_type: 'send_email',
      target: { channel: 'email', to: 'bob@example.com', domain: 'example.com' },
      data_classes: ['contact_info'],
      estimated_impact: 'medium',
      requires_consent: false,
      ...v.intent,
    };
    const intent: IntentV2 = { ...base, target: { ...base.target, ...v.target } as IntentV2['target'] };
    const policyDecision: PolicyDecisionV2 = {
      dcp_version: '2.0',
      intent_id: intent.intent_id,
      session_nonce: nonce,
      decision: 'approve',
      risk_score: 450,
      reasons: ['Known recipient domain'],
      required_confirmation: null,
      applied_policy_hash: sha256Of({ policy: 'default' }),
      timestamp: '2026-10-21T12:00:01Z',
      ...v.policyDecision,
    };
    const audit: AuditEventV2 = {
      dcp_version: '2.0',
      audit_id: 'audit:candidate-001',
      session_nonce: nonce,
      prev_hash: v.firstPrevHash ?? 'GENESIS',
      hash_alg: 'sha256',
      timestamp: '2026-10-21T12:01:00Z',
      agent_id: passport.agent_id,
      human_id: rpr.human_id,
      intent_id: intent.intent_id,
      intent_hash: sha256Of(intent),
      policy_decision: 'approved',
      outcome: 'email_sent',
      evidence: v.evidence ?? { tool: 'smtp', result_ref: null, evidence_hash: null },
      pq_checkpoint_ref: null,
    };
    const audit2: AuditEventV2 = {
      ...audit,
      audit_id: 'audit:candidate-002',
      prev_hash: v.secondPrevHash ?? sha256Of(audit),
      timestamp: '2026-10-21T12:02:00Z',
    };
    const co = v.classicalOnly;
    const bundle = new BundleBuilderV2(nonce)
      .responsiblePrincipalRecord(await sign(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal, co))
      .agentPassport(await sign(passport, DCP_CONTEXTS.AgentPassport, agentKeys, co))
      .intent(await sign(intent, DCP_CONTEXTS.Intent, agentKeys, co))
      .policyDecision(await sign(policyDecision, DCP_CONTEXTS.PolicyDecision, agentKeys, co))
      .addAuditEntries([audit, audit2])
      .build();
    // The builder refuses nonces that differ, so this one is patched in after it.
    if (v.intentNonce) {
      bundle.intent = await sign({ ...intent, session_nonce: v.intentNonce }, DCP_CONTEXTS.Intent, agentKeys);
      bundle.manifest.intent_hash = bundle.intent.payload_hash;
    }
    if (v.checkpoint) {
      const checkpoint = {
        checkpoint_id: 'ckpt-candidate-001',
        session_nonce: nonce,
        event_range: { from_audit_id: audit.audit_id, to_audit_id: audit2.audit_id, count: 2 },
        merkle_root: `sha256:${auditEventsMerkleRoot(bundle.audit_entries)}`,
      };
      const { canonicalBytes } = preparePayload(checkpoint);
      const composite_sig = await compositeSign(registry, DCP_CONTEXTS.AuditEvent, canonicalBytes, agentKeys);
      bundle.pq_checkpoints = [{ ...checkpoint, composite_sig } as never];
      bundle.manifest.pq_checkpoints = [checkpoint.checkpoint_id];
    }
    Object.assign(bundle.manifest, {
      session_issued_at: '2026-10-21T00:00:00Z',
      session_expires_at: '2099-12-31T23:59:59+05:00',
    });
    const manifest = bundle.manifest as unknown as Record<string, unknown>;
    if (v.profile === null) delete manifest.canonicalization_profile;
    else manifest.canonicalization_profile = v.profile ?? 'dcp-jcs-v2';
    const signer = { registry, signerType: 'human' as const, signerId: rpr.human_id };
    const signed = co
      ? await signBundleV2ClassicalOnly(bundle, { ...signer, key: principal.classical })
      : await signBundleV2(bundle, { ...signer, keys: principal });
    signed.signature.created_at = '2026-10-21T12:05:00Z';
    return signed;
  };
}

/** Nested arrays: the unit depth is 5 (the signed bundle down to the intent target) plus n. */
const nest = (n: number, leaf: unknown): unknown => (n === 0 ? leaf : [nest(n - 1, leaf)]);
const NUMBERS = { exact_one: 1, ten: 10, hundred: 100, zero: 0, max_safe: 9007199254740991, min_safe: -9007199254740991 };

/** The same JSON with every object's members in reverse order, indented by two spaces. */
function reformat(text: string): string {
  const reverse = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(reverse);
    if (v === null || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).reverse()) Object.defineProperty(out, k, { value: reverse((v as Record<string, unknown>)[k]), enumerable: true, writable: true, configurable: true });
    return out;
  };
  return JSON.stringify(reverse(JSON.parse(text)), null, 2);
}

type BaseId =
  | 'B-v2' | 'B-v1' | 'B-absent' | 'B-numbers' | 'B-deep' | 'B-decoy' | 'B-migration' | 'B-checkpoint'
  | 'B-classical' | 'B-proto' | 'B-reordered' | 'B-chain-break' | 'B-v1-hash' | 'B-nonce' | 'B-kid'
  | 'B-expired' | 'B-v1-legacy' | 'B-null';

/** The SHA-256 of every base: they are frozen, and any change to one is refused. */
const FROZEN_BASES: Record<BaseId, string> = {
  'B-absent': 'd33a48dce994a92f8e65bc24b6eaba1fce9959e2676660d585a5fec6295ef8e5',
  'B-chain-break': '09f265699930025d9d3e122a807a751ff2be78ed3a6bd09aa0b25160e9a6d125',
  'B-checkpoint': 'bd112b70b5d83083c7cf8885fe562030b7f606b2de5e5af945d18d2e72c9d94e',
  'B-classical': 'f852f8afc7eed05f45c6e8c3dd93940b15e11ef98cce850bc6814de8ec6a1de7',
  'B-decoy': '4f4dd2ef1853d4c0c5e91da0a4575ccd5434ef1028c8c9ce36172e6ea3174a34',
  'B-deep': '61daddce6ef941bd2ec88db881abfadb5096bd6524166eb2eea08df1f5ae435b',
  'B-expired': '5666c40d174675185da48845424ce3f714d8045d19ed6a9551e4e91b60d2eddc',
  'B-kid': 'b767812fc676018ace92eaf919654b6a4aefdecd4c4256f98e821a4546517aac',
  'B-migration': '2b31a595db2c6f31e58b47a25138dc75f08c7652c8da3aae1383aee7e0bf9b69',
  'B-nonce': '7c39329c0ca74cfd771f0578ea88c7e425f571ec772c3c83b73a58eab4643319',
  'B-null': '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  'B-numbers': 'c916a724970fc6c98b5fd72bcf3aaacfa7a3edd377cd1e048e68e32b9bfc5cba',
  'B-proto': '3feb059f0b8f59f58aed3cadeeaaf92a987f6cd2486107933bbc1989e9a37ea0',
  'B-reordered': '458dc0797b5edf54517e220b64f310aa443ad96b61a43b70053c8afd2f63f398',
  'B-v1': '1c232727a5b7218bc8356205dfb9e4985ed435129bf05a1784bf70d56540cc9c',
  'B-v1-hash': '37150d9d6e4b10351a2f3160f1c4f2e549fae06155f18e48b7bfe9f53e09a8eb',
  'B-v1-legacy': 'e3f47147e2a6c6b7637e4b9c8662ef05f904f238b094044e90c5aaafc48f7115',
  'B-v2': '17321e8ccb1f3cc8f0de523b07ea406aae7ebf57d1500872ecb07740ece8b387',
};

/** The manifest profile of each signed base, for --check: v2 unless listed. */
const BASE_PROFILES: Partial<Record<BaseId, string | null>> = { 'B-v1': 'dcp-jcs-v1', 'B-absent': null };
/** Bases that are not signed by this generator, and how --check derives them. */
const DERIVED_BASES: Partial<Record<BaseId, (bases: Record<string, string>) => string>> = {
  'B-reordered': (b) => reformat(b['B-v2']),
  'B-v1-legacy': () => readFileSync(V1_LEGACY_PATH, 'utf8'),
  'B-null': () => 'null',
};

async function signBases(): Promise<Record<BaseId, string>> {
  const nonce = seed('session nonce').toString('hex');
  const principal = keysFrom('principal');
  const agent = keysFrom('agent');
  const build = makeBuilder(principal, agent, nonce);
  const text = async (v: Variant) => JSON.stringify(await build(v));
  const v1 = await build({ profile: 'dcp-jcs-v1' });
  const signed: Record<string, string> = {
    'B-v2': await text({}),
    'B-v1': JSON.stringify(v1),
    'B-absent': await text({ profile: null }),
    'B-numbers': await text({ target: { limits: NUMBERS } }),
    'B-deep': await text({ target: { deep: nest(59, 'depth-64') } }),
    'B-decoy': await text({ target: { note: { canonicalization_profile: 'dcp-jcs-v1' } } }),
    // New v2 evidence starts its own chain at GENESIS; the earlier v1 bundle is referenced as data.
    'B-migration': await text({ evidence: { tool: 'smtp', result_ref: v1.signature.manifest_hash, evidence_hash: null } }),
    'B-checkpoint': await text({ checkpoint: true }),
    'B-classical': await text({
      classicalOnly: true,
      passport: { risk_tier: 'low' },
      policyDecision: { risk_score: 0 },
      intent: ROUTINE_INTENT,
    }),
    'B-proto': await text({ target: { ['__proto__']: 'own data', constructor: 'own data', toString: 'own data' } }),
    'B-chain-break': await text({ secondPrevHash: `sha256:${'0'.repeat(64)}` }),
    'B-v1-hash': await text({ firstPrevHash: sha256Of(v1.bundle.audit_entries[0]) }),
    'B-nonce': await text({ intentNonce: seed('another session nonce').toString('hex') }),
    'B-kid': await text({ agentKeys: { ...agent, classical: { ...agent.classical, kid: keysFrom('other').classical.kid } } }),
    'B-expired': await text({ agentKey: { expires_at: '2001-01-01T00:00:00Z' } }),
  };
  for (const [id, derive] of Object.entries(DERIVED_BASES)) signed[id] = derive!(signed);
  return signed as Record<BaseId, string>;
}

// ── Cases (everything below is pure: the same in generation and in --check) ──

type Edit =
  | { find: string; replace: string }
  | { find: string; replace_hex: string }
  | { prefix: string; suffix: string }
  | { prefix_hex: string }
  | { drop_last: number };

type Expected = {
  route: {
    outcome: 'reject' | 'v1_path' | 'candidate';
    class?: string;
    detail?: string;
    offset?: number;
    profile?: string | null;
    profile_source?: string;
    warning_classes?: string[];
    /** For v1_path: what the adapter returned. */
    historical?: 'decoded' | 'failed';
  };
  adapter_calls: number;
  entered: 'none' | 'dcp-jcs-v1' | 'dcp-jcs-v2';
  verification: null | { verified: boolean; errors_contain: PerSdk };
};

/** Substrings every error list must contain, written out for each SDK. */
type PerSdk = { ts: string[]; py: string[]; go: string[]; rust: string[]; wasm: string[] };

type CaseSpec = {
  id: string;
  base: BaseId;
  edits?: (base: string) => Edit[];
  transport?: 'bare' | 'envelope';
  accepted: string[];
  policy?: keyof typeof POLICIES;
  expected: (base: string) => Expected;
  /** Expectations that differ for one adapter, keyed "<sdk>:<adapter name>". */
  byAdapter?: Record<string, (base: string) => Expected>;
  step: string;
  why: string;
};

const PROF1 = '"canonicalization_profile":"dcp-jcs-v1"';
const PROF2 = '"canonicalization_profile":"dcp-jcs-v2"';
const PROF3 = '"canonicalization_profile":"dcp-jcs-v3"';
const RISK = '"risk_score":450';
const ONE = '"exact_one":1';
const MAX = '"max_safe":9007199254740991';

/** The same substring in every SDK. */
const all = (s: string): PerSdk => ({ ts: [s], py: [s], go: [s], rust: [s], wasm: [s] });
const NONE: PerSdk = { ts: [], py: [], go: [], rust: [], wasm: [] };
/** Each SDK's message for a check (Rust and WASM share the Rust verifier). */
const per = (ts: string, py: string, go: string, rust: string): PerSdk => ({ ts: [ts], py: [py], go: [go], rust: [rust], wasm: [rust] });
const MANIFEST_SIGNATURE = per(
  'bundle: signature manifest_hash is not the hash of the manifest',
  'bundle: signature manifest_hash is not the hash of the manifest',
  'Bundle signature: manifest_hash is not the hash of the manifest',
  'is not the hash of the manifest',
);
const CHAIN = (i: number, expected = '') => per(
  `prev_hash chain break at entry[${i}]${expected && `: expected ${expected}`}`,
  `prev_hash chain break at entry[${i}]${expected && `: expected ${expected}`}`,
  `Audit hash chain broken at entry ${i}${expected && `: expected ${expected}`}`,
  `Audit hash chain broken at entry ${i}${expected && `: expected ${expected}`}`,
);
const BUNDLE_SIGNATURE = (tsPy: string) => per(tsPy, tsPy, 'Bundle signature verification failed', 'Bundle signature verification failed');
const UNSUPPORTED_VERSION = per('Unsupported bundle version', 'Unsupported bundle version', 'Invalid dcp_bundle_version', 'Invalid dcp_bundle_version');
const MALFORMED = 'Malformed signed bundle';

const esc = (hex4: string) => '\\' + 'u' + hex4; // a JSON escape, written out
const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex');
/** The byte offset of the only occurrence of `s` in an ASCII base. */
function at(base: string, s: string): number {
  const i = base.indexOf(s);
  if (i < 0 || base.indexOf(s, i + 1) >= 0) throw new Error(`${JSON.stringify(s.slice(0, 60))} must occur exactly once`);
  return i;
}
/** The base with the last hex digit of `value` changed. */
const flipLast = (value: string) => value.slice(0, -1) + (value.endsWith('0') ? '1' : '0');
/** The first base64 byte of a signature flipped. */
function corrupt(sigB64: string): string {
  const bytes = Buffer.from(sigB64, 'base64');
  bytes[0] ^= 0xff;
  return bytes.toString('base64');
}

const candidateOk = (): Expected => ({
  route: { outcome: 'candidate' },
  adapter_calls: 0,
  entered: 'dcp-jcs-v2',
  verification: { verified: true, errors_contain: NONE },
});
const candidateFails = (errors: PerSdk) => (): Expected => ({
  route: { outcome: 'candidate' },
  adapter_calls: 0,
  entered: 'dcp-jcs-v2',
  verification: { verified: false, errors_contain: errors },
});
const rejected = (cls: string, offset: number | undefined, profile: string | null, adapterCalls = 0, detail?: string): Expected => ({
  route: { outcome: 'reject', class: cls, ...(detail === undefined ? {} : { detail }), ...(offset === undefined ? {} : { offset }), profile },
  adapter_calls: adapterCalls,
  entered: 'none',
  verification: null,
});
/** v1_path, delegated to today's verifier: the value the adapter decoded, or the unit bytes (Go) or text (WASM). */
const delegated = (
  source: string,
  verified: boolean,
  errors: PerSdk,
  warnings: string[] = [],
  historical: 'decoded' | 'failed' = 'decoded',
): Expected => ({
  route: { outcome: 'v1_path', profile_source: source, warning_classes: warnings, historical },
  adapter_calls: 1,
  entered: 'dcp-jcs-v1',
  verification: { verified, errors_contain: errors },
});
/** v1_path where the decoder refused the unit and today's verifier takes an object: nothing to delegate. */
const notDelegated = (source: string, warnings: string[]): Expected => ({
  route: { outcome: 'v1_path', profile_source: source, warning_classes: warnings, historical: 'failed' },
  adapter_calls: 1,
  entered: 'none',
  verification: null,
});

/** Adapter names of every SDK, for by_adapter. */
const PY = ['py:json_loads_bytes', 'py:json_loads_strict_decode'];
const W1 = ['wasm:w1.textDecoderJsonParse', 'wasm:w1.bufferUtf8JsonParse'];
const W2 = ['wasm:w2.textDecoder', 'wasm:w2.bufferUtf8'];
const each = (names: string[], e: (base: string) => Expected) => Object.fromEntries(names.map((n) => [n, e]));

const CASES: CaseSpec[] = [
  // ── Positives: the candidate route, one verifier entry, verified ──
  { id: 'P01', base: 'B-v2', accepted: V2, expected: candidateOk, step: 'V2-1..V2-14', why: 'A real hybrid (Ed25519 + ML-DSA-65) bundle signed under dcp-jcs-v2.' },
  { id: 'P02', base: 'B-v2', accepted: BOTH, expected: candidateOk, step: 'V2-1..V2-14', why: 'Accepting both profiles changes nothing for a v2 bundle.' },
  { id: 'P03', base: 'B-v2', edits: () => [{ prefix: '{"signed_bundle":', suffix: '}' }], transport: 'envelope', accepted: V2, expected: candidateOk, step: 'V2-1..V2-14', why: 'The same bundle as the one signed_bundle member of an envelope.' },
  {
    id: 'P04', base: 'B-numbers', accepted: V2, expected: candidateOk, step: 'V2-3',
    edits: () => [
      { find: '"ten":10', replace: '"ten":10.0' },
      { find: '"hundred":100', replace: '"hundred":1e2' },
      { find: '"zero":0', replace: '"zero":-0' },
      { find: ONE, replace: '"exact_one":100e-2' },
      { find: MAX, replace: '"max_safe":9.007199254740991e15' },
    ],
    why: 'Other forms of the committed integers: the exact values, and so the commitments, are unchanged.',
  },
  {
    id: 'P05', base: 'B-v2', accepted: V2, expected: candidateOk, step: 'V2-3',
    edits: () => [
      { find: '"action_type":"send_email"', replace: `"action_type":"send_${esc('0065')}mail"` },
      { find: RISK, replace: `"risk_${esc('0073')}core":450` },
    ],
    why: 'Escapes of the same characters in a value and in a key.',
  },
  { id: 'P06', base: 'B-reordered', accepted: V2, expected: candidateOk, step: 'V2-3', why: 'Members in reverse order, with whitespace: canonical bytes are taken from the values.' },
  { id: 'P07', base: 'B-deep', accepted: V2, expected: candidateOk, step: 'V2-3', why: 'A unit 64 levels deep, the limit.' },
  { id: 'P08', base: 'B-decoy', accepted: V2, expected: candidateOk, step: 'V2-1', why: 'A canonicalization_profile of dcp-jcs-v1 outside the manifest path is data.' },
  { id: 'P09', base: 'B-migration', accepted: V2, expected: candidateOk, step: 'V2-11', why: 'New v2 evidence starts its chain at GENESIS; a v1 bundle is referenced as data.' },
  { id: 'P10', base: 'B-checkpoint', accepted: V2, expected: candidateOk, step: 'V2-12', why: 'A signed PQ checkpoint over the audit entries.' },
  { id: 'P11', base: 'B-classical', accepted: V2, policy: 'default', expected: candidateOk, step: 'V2-7', why: 'Classical-only, low risk, routine intent: the default policy resolves classical_only.' },
  { id: 'P12', base: 'B-proto', accepted: V2, expected: candidateOk, step: 'V2-3', why: 'Members named __proto__, constructor and toString are own data.' },
  ...[800, 801, 5000].map((zeros): CaseSpec => ({
    id: `P13-${zeros}`, base: 'B-numbers', accepted: V2, expected: candidateOk, step: 'V2-3',
    edits: () => [{ find: ONE, replace: `"exact_one":1.${'0'.repeat(zeros)}` }],
    why: `The literal 1 followed by ${zeros} decimal zeros: its exact value is 1, normalized to the integer 1, so the commitment over 1 holds.`,
  })),
  { id: 'P14', base: 'B-numbers', accepted: V2, expected: candidateOk, step: 'V2-3', why: 'The limits 2^53-1 and -(2^53-1) in committed fields.' },

  // ── Rejections before any verifier ──
  { id: 'R01', base: 'B-v2', edits: () => [{ prefix_hex: 'efbbbf' }], accepted: V2, expected: () => rejected('BOM', 0, null, 1), step: 'ingress', why: 'Not walkable: the adapter is consulted once and its reading never selects the candidate.' },
  { id: 'R02', base: 'B-v2', edits: () => [{ find: 'bob@example.com', replace_hex: `${hex('bob')}ff${hex('example.com')}` }], accepted: V2, expected: (b) => rejected('UTF8_INVALID', at(b, 'bob@example.com') + 3, null, 1), step: 'ingress', why: 'Not walkable, as R01.' },
  { id: 'R03', base: 'B-v2', edits: () => [{ drop_last: 1 }], accepted: V2, expected: (b) => rejected('SYNTAX', b.length - 1, null, 1), step: 'ingress', why: 'Ends early: not walkable, as R01.' },
  { id: 'R04', base: 'B-v2', edits: () => [{ find: 'bob@example.com', replace: `bob${esc('d800')}example.com` }], accepted: V2, expected: (b) => rejected('SURROGATE_UNPAIRED', at(b, 'bob@example.com') + 3, 'dcp-jcs-v2'), step: 'ingress', why: 'A lone surrogate in a v2 unit.' },
  { id: 'R05a', base: 'B-v2', edits: () => [{ find: PROF2, replace: `${PROF1},${PROF2}` }], accepted: BOTH, expected: (b) => rejected('DUPLICATE_KEY', at(b, PROF2) + PROF1.length + 1, 'dcp-jcs-v2'), step: 'ingress', why: 'The profile twice, v2 last: the last member makes the unit v2, and a v2 unit with a duplicate is rejected.' },
  { id: 'R05b-v2', base: 'B-v2', edits: () => [{ find: PROF2, replace: `${PROF2},${PROF1}` }], accepted: V2, expected: () => rejected('PROFILE_NOT_ACCEPTED', undefined, 'dcp-jcs-v1'), step: 'selection', why: 'The profile twice, v1 last: the unit is v1, which this policy does not accept.' },
  { id: 'R06', base: 'B-v2', edits: () => [{ find: RISK, replace: `${RISK},${RISK}` }], accepted: V2, expected: (b) => rejected('DUPLICATE_KEY', at(b, RISK) + RISK.length + 1, 'dcp-jcs-v2'), step: 'ingress', why: 'A duplicate member in a payload of a v2 unit.' },
  { id: 'R07', base: 'B-v2', edits: () => [{ find: RISK, replace: '"risk_score":1.5' }], accepted: V2, expected: (b) => rejected('NUMBER_NOT_INTEGER', at(b, RISK) + '"risk_score":'.length, 'dcp-jcs-v2'), step: 'ingress', why: 'Not an integer.' },
  { id: 'R08', base: 'B-numbers', edits: () => [{ find: ONE, replace: '"exact_one":1.0000000000000001' }], accepted: BOTH, expected: (b) => rejected('NUMBER_NOT_INTEGER', at(b, ONE) + '"exact_one":'.length, 'dcp-jcs-v2'), step: 'ingress', why: 'binary64 reads 1, so the commitment would match under a reading of the literal; no other profile is tried and no verifier runs.' },
  { id: 'R09', base: 'B-numbers', edits: () => [{ find: MAX, replace: '"max_safe":9007199254740992' }], accepted: V2, expected: (b) => rejected('NUMBER_OUT_OF_RANGE', at(b, MAX) + '"max_safe":'.length, 'dcp-jcs-v2'), step: 'ingress', why: '2^53, one past the limit.' },
  { id: 'R10', base: 'B-deep', edits: () => [{ find: '["depth-64"]', replace: '[["depth-64"]]' }], accepted: V2, expected: (b) => rejected('DEPTH_EXCEEDED', at(b, '["depth-64"]') + 1, 'dcp-jcs-v2'), step: 'ingress', why: 'One level past the limit: the bracket that opens level 65.' },
  { id: 'R11', base: 'B-v2', transport: 'envelope', accepted: V2, expected: () => rejected('TRANSPORT_INVALID', undefined, null, 0, 'NO_SIGNED_BUNDLE'), step: 'transport', why: 'A bare bundle where an envelope is configured.' },
  { id: 'R12', base: 'B-v2', edits: () => [{ prefix: '{"signed_bundle":', suffix: ',"signed_bundle":null}' }], transport: 'envelope', accepted: V2, expected: () => rejected('TRANSPORT_AMBIGUOUS', undefined, null, 0, 'SIGNED_BUNDLE_REPEATED'), step: 'transport', why: 'Two signed_bundle members.' },
  { id: 'R13', base: 'B-v2', edits: () => [{ find: PROF2, replace: PROF3 }], accepted: BOTH, expected: () => rejected('PROFILE_UNKNOWN', undefined, null), step: 'selection', why: 'An unknown profile.' },
  { id: 'R14', base: 'B-v2', accepted: V1, expected: () => rejected('PROFILE_NOT_ACCEPTED', undefined, 'dcp-jcs-v2'), step: 'selection', why: 'A v2 bundle under a v1-only policy.' },
  { id: 'R15', base: 'B-v1', accepted: V2, expected: () => rejected('PROFILE_NOT_ACCEPTED', undefined, 'dcp-jcs-v1'), step: 'selection', why: 'A v1 bundle under a v2-only policy.' },
  { id: 'R16', base: 'B-v2', edits: () => [{ find: PROF2, replace: PROF3 }, { find: RISK, replace: `${RISK},${RISK}` }], accepted: BOTH, expected: () => rejected('PROFILE_UNKNOWN', undefined, null), step: 'selection', why: 'An unknown profile and a duplicate: the profile decides first.' },

  // ── The candidate route, verification fails at the step named ──
  { id: 'F01', base: 'B-v2', edits: () => [{ find: '"action_type":"send_email"', replace: '"action_type":"send_fax"' }], accepted: V2, expected: candidateFails(all('intent: payload_hash mismatch')), step: 'V2-3', why: 'A payload changed under its hash.' },
  { id: 'F02', base: 'B-v2', edits: () => [{ find: '"session_expires_at":"2099-12-31T23:59:59+05:00"', replace: '"session_expires_at":"2099-12-30T23:59:59+05:00"' }], accepted: V2, expected: candidateFails(MANIFEST_SIGNATURE), step: 'V2-6', why: 'The manifest changed under its hash and signature.' },
  { id: 'F03', base: 'B-v1', edits: () => [{ find: PROF1, replace: PROF2 }], accepted: V2, expected: candidateFails(MANIFEST_SIGNATURE), step: 'V2-6', why: 'Signed as v1, relabeled v2: the manifest no longer matches its hash, and v1 is not tried.' },
  { id: 'F04', base: 'B-chain-break', accepted: V2, expected: candidateFails(CHAIN(1)), step: 'V2-11', why: 'A broken link, signed: the manifest commits to the entries as they are.' },
  { id: 'F05', base: 'B-v1-hash', accepted: V2, expected: candidateFails(CHAIN(0, 'GENESIS')), step: 'V2-11', why: 'The hash of a v1 audit entry copied as the first prev_hash: a break, not a continuation.' },
  {
    id: 'F06', base: 'B-v2', accepted: V2, expected: candidateFails(all('Manifest audit_merkle_root mismatch')), step: 'V2-3',
    edits: (b) => {
      const root = JSON.parse(b).bundle.manifest.audit_merkle_root as string;
      return [{ find: `"audit_merkle_root":"${root}"`, replace: `"audit_merkle_root":"${flipLast(root)}"` }];
    },
    why: 'An audit Merkle root that is not the root of the entries.',
  },
  { id: 'F07', base: 'B-nonce', accepted: V2, expected: candidateFails(per('Session binding failed', 'Session binding failed', 'Session nonce mismatch in intent', 'Session nonce mismatch in intent')), step: 'V2-2', why: 'The intent is signed under another session nonce.' },
  {
    id: 'F08', base: 'B-checkpoint', accepted: V2, expected: candidateFails(all('merkle_root does not match its audit entries')), step: 'V2-12',
    edits: (b) => {
      const root = JSON.parse(b).bundle.pq_checkpoints[0].merkle_root as string;
      return [{ find: `"merkle_root":"${root}"`, replace: `"merkle_root":"${flipLast(root)}"` }];
    },
    why: 'A PQ checkpoint whose Merkle root is not the root of its entries.',
  },
  {
    id: 'F09', base: 'B-v2', accepted: V2, expected: candidateFails(BUNDLE_SIGNATURE('bundle: Classical signature invalid')), step: 'V2-7',
    edits: (b) => {
      const sig = JSON.parse(b).signature.composite_sig.classical.sig_b64 as string;
      return [{ find: sig, replace: corrupt(sig) }];
    },
    why: 'The classical component of the bundle signature altered.',
  },
  {
    id: 'F10', base: 'B-v2', accepted: V2, expected: candidateFails(BUNDLE_SIGNATURE('bundle: PQ signature invalid')), step: 'V2-7',
    edits: (b) => {
      const sig = JSON.parse(b).signature.composite_sig.pq.sig_b64 as string;
      return [{ find: sig, replace: corrupt(sig) }];
    },
    why: 'The PQ component of the bundle signature altered.',
  },
  { id: 'F11', base: 'B-classical', accepted: V2, policy: 'hybrid_required', expected: candidateFails(per(
    'bundle: PQ signature invalid or missing (hybrid_required)',
    'bundle: PQ signature invalid or missing (hybrid_required)',
    'Bundle hybrid_required needs a pq_over_classical signature, got classical_only',
    'Bundle hybrid_required needs a pq_over_classical signature, got classical_only',
  )), step: 'V2-7', why: 'P11 under a policy that requires hybrid signatures.' },
  { id: 'F12', base: 'B-kid', accepted: V2, expected: candidateFails(all('is not derived from its public key (V2-13)')), step: 'V2-13', why: 'An agent key whose kid is not derived from its public key.' },
  { id: 'F13', base: 'B-expired', accepted: V2, expected: candidateFails(all('has expired')), step: 'V2-13', why: 'An agent key that expired in 2001.' },
  { id: 'F14', base: 'B-v2', edits: () => [{ find: RISK, replace: '"risk_score":451' }], accepted: V2, expected: candidateFails(all('policy_decision: payload_hash mismatch')), step: 'V2-3', why: 'An integer value changed, not only its form.' },

  // ── Delegation: today's verifySignedBundleV2 on what the adapter decoded ──
  { id: 'D01', base: 'B-v1', accepted: V1, expected: () => delegated('field', true, NONE), step: 'delegation', why: 'A bundle signed under dcp-jcs-v1.' },
  { id: 'D02', base: 'B-absent', accepted: V1, expected: () => delegated('absent', true, NONE), step: 'delegation', why: 'Without the field: dcp-jcs-v1.' },
  { id: 'D03', base: 'B-v2', edits: () => [{ find: PROF2, replace: PROF1 }], accepted: BOTH, expected: () => delegated('field', false, MANIFEST_SIGNATURE), step: 'delegation', why: 'Signed as v2, relabeled v1: delegated, and the manifest no longer matches.' },
  { id: 'D04', base: 'B-v2', edits: () => [{ find: `,${PROF2}`, replace: '' }], accepted: BOTH, expected: () => delegated('absent', false, MANIFEST_SIGNATURE), step: 'delegation', why: 'The field removed from a v2 bundle: absent means v1.' },
  { id: 'R05b-both', base: 'B-v2', edits: () => [{ find: PROF2, replace: `${PROF2},${PROF1}` }], accepted: BOTH, expected: () => delegated('field', false, MANIFEST_SIGNATURE, ['DUPLICATE_KEY']), step: 'delegation', why: 'The profile twice, v1 last: delegated with the diagnosis; the decoder keeps the last member.' },
  { id: 'D05', base: 'B-v1', edits: () => [{ find: RISK, replace: `${RISK},${RISK}` }], accepted: V1, expected: () => delegated('field', true, NONE, ['DUPLICATE_KEY']), step: 'delegation', why: 'A v1 unit with a duplicate of the same value: today\'s verdict, with the diagnosis.' },
  {
    id: 'D06', base: 'B-v1', edits: () => [{ prefix_hex: 'efbbbf' }], accepted: V1, step: 'delegation',
    expected: () => delegated('historical', true, NONE, ['BOM']),
    byAdapter: each(
      ['ts:bufferUtf8JsonParse', 'py:json_loads_strict_decode', 'go:encoding_json', 'rust:serde_json_from_slice', 'wasm:w1.bufferUtf8JsonParse', 'wasm:w2.bufferUtf8'],
      () => rejected('BOM', 0, null, 1),
    ),
    why: 'Not walkable: a decoder that drops the BOM reads v1 and the bundle is delegated (TextDecoder, json.loads on bytes); one that keeps it refuses the unit, which is rejected.',
  },
  {
    id: 'D07', base: 'B-v1-legacy', accepted: V1, step: 'delegation',
    expected: () => delegated('absent', false, UNSUPPORTED_VERSION, ['NUMBER_NOT_INTEGER']),
    byAdapter: each([...W1, ...W2], () => delegated('absent', true, NONE, ['NUMBER_NOT_INTEGER'])),
    why: 'A V1 bundle (no manifest, risk_score 0.21): delegated with the diagnosis. Today\'s V2 verifiers reject it, except the WASM binding, which verifies a V1 bundle when no policy is given; that difference is kept.',
  },
  {
    id: 'D08', base: 'B-v1', edits: () => [{ find: RISK, replace: '"risk_score":1e400' }], accepted: V1, step: 'delegation',
    expected: () => delegated('field', false, all(MALFORMED), ['NUMBER_OUT_OF_RANGE']),
    byAdapter: {
      'go:encoding_json': () => delegated('field', false, all('JSON parse error'), ['NUMBER_OUT_OF_RANGE'], 'failed'),
      'rust:serde_json_from_slice': () => notDelegated('field', ['NUMBER_OUT_OF_RANGE']),
      ...each(W1, () => delegated('field', false, all('policy_decision: payload_hash mismatch'), ['NUMBER_OUT_OF_RANGE'])),
      ...each(W2, () => delegated('field', false, all('JSON parse error'), ['NUMBER_OUT_OF_RANGE'], 'failed')),
    },
    why: 'An integer literal beyond binary64. JSON.parse and json.loads read Infinity, which is delegated and rejected; serde_json refuses it and Rust has no value to delegate; Go delegates the bytes and its parser refuses them; WASM w1 sends JSON.stringify of Infinity (null), w2 the text, which serde_json refuses.',
  },
  {
    id: 'D09', base: 'B-null', accepted: V1, step: 'delegation',
    expected: () => delegated('absent', false, per(MALFORMED, MALFORMED, 'Missing bundle field', 'Missing bundle field')),
    byAdapter: each([...W1, ...W2], () => delegated('absent', false, all('Unknown DCP version'))),
    why: 'A decoded null is data: it is delegated, and today\'s verifier rejects it.',
  },
];

// ── Assembly ──

function materialize(base: string, edits: Edit[]): Buffer {
  let buf = Buffer.from(base, 'latin1');
  for (const e of edits) {
    if ('find' in e) {
      const find = Buffer.from(e.find, 'latin1');
      const i = buf.indexOf(find);
      if (i < 0 || buf.indexOf(find, i + 1) >= 0) throw new Error(`edit: ${JSON.stringify(e.find.slice(0, 60))} must occur exactly once`);
      const by = 'replace' in e ? Buffer.from(e.replace, 'latin1') : Buffer.from(e.replace_hex, 'hex');
      buf = Buffer.concat([buf.subarray(0, i), by, buf.subarray(i + find.length)]);
    } else if ('prefix' in e) {
      buf = Buffer.concat([Buffer.from(e.prefix, 'latin1'), buf, Buffer.from(e.suffix, 'latin1')]);
    } else if ('prefix_hex' in e) {
      buf = Buffer.concat([Buffer.from(e.prefix_hex, 'hex'), buf]);
    } else {
      buf = buf.subarray(0, buf.length - e.drop_last);
    }
  }
  return buf;
}

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

function assemble(bases: Record<string, string>) {
  const ids = new Set<string>();
  const cases = CASES.map((c) => {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
    const base = bases[c.base];
    const edits = c.edits?.(base) ?? [];
    const expected: Record<string, unknown> = c.expected(base);
    if (expected.entered === 'dcp-jcs-v2' && (expected.verification as { verified: boolean }).verified) {
      const unit = JSON.parse(base);
      expected.manifest_sha256 = `sha256:${sha256(canonicalizeV2(unit.bundle.manifest))}`;
      expected.canonical_sha256 = sha256(canonicalizeV2(unit));
    }
    return {
      id: c.id,
      input: { base: c.base, edits },
      input_sha256: sha256(materialize(base, edits)),
      transport: c.transport ?? 'bare',
      accepted_profiles: c.accepted,
      verifier_policy: c.policy ?? 'default',
      expected,
      ...(c.byAdapter ? { by_adapter: Object.fromEntries(Object.entries(c.byAdapter).map(([k, f]) => [k, f(base)])) } : {}),
      step: c.step,
      why: c.why,
    };
  });
  return {
    title: 'Experimental candidate dcp-jcs-v2, phase 3: signed bundles and the bytes verifier',
    status: 'experimental, opt-in; dcp-jcs-v1 stays the default',
    _generator: 'sdks/typescript/src/__tests__/generate-candidate-signed-vectors.ts',
    how_to_read: {
      bases: 'Whole inputs as ASCII JSON text: signed bundles (keys from fixed seeds), the V1 conformance bundle, and null.',
      'cases[].input': 'The base, then each edit in order on its bytes: find/replace (find occurs exactly once), find/replace_hex, prefix/suffix, prefix_hex, drop_last. input_sha256 is the hash of the result.',
      'expected.route': 'The phase 2 route: outcome, and class, detail, offset (relative to the unit) and profile for a rejection, profile_source and the warning classes for v1_path.',
      'expected.adapter_calls': 'How many times the historical adapter is consulted (phase 2).',
      'expected.entered': 'The verifier that ran, at most one: none, dcp-jcs-v1 (today\'s verifier, on the decoded value) or dcp-jcs-v2.',
      'expected.verification': 'null when no verifier ran; otherwise the verdict and substrings every error list must contain, per SDK.',
      'expected.manifest_sha256 / canonical_sha256': 'For a verified candidate: the hash of the canonical manifest (signature.manifest_hash) and of the canonical unit.',
      by_adapter: 'The expectation for one adapter where it differs, keyed "<sdk>:<adapter name>".',
      now: 'The instant every verifier that takes one uses. The bases are valid from 2026-10-21 to 2099-12-31; a verifier on the wall clock depends on it falling in that window.',
      trust: 'A verified bundle grants no trust or admission and authorizes nothing.',
    },
    now: NOW,
    now_ms: Date.parse(NOW),
    verifier_policies: POLICIES,
    bases: Object.fromEntries(
      (Object.keys(bases) as BaseId[]).sort().map((id) => [id, { input_json: bases[id], input_sha256: sha256(Buffer.from(bases[id], 'latin1')) }]),
    ),
    cases,
  };
}

/** --check: every signed base is consistent signed data and has its declared profile. */
function checkBases(bases: Record<string, string>): void {
  const ids = Object.keys(bases).sort();
  if (JSON.stringify(ids) !== JSON.stringify(Object.keys(FROZEN_BASES).sort())) throw new Error(`bases ${ids.join(', ')} are not the frozen ones`);
  for (const [id, text] of Object.entries(bases)) {
    if (sha256(Buffer.from(text, 'latin1')) !== FROZEN_BASES[id as BaseId]) throw new Error(`${id}: not the frozen base`);
    if (!/^[\x20-\x7e\n]*$/.test(text)) throw new Error(`${id}: not printable ASCII`);
    const derive = DERIVED_BASES[id as BaseId];
    if (derive) {
      if (derive(bases) !== text) throw new Error(`${id}: not what it is derived from`);
      continue;
    }
    const { bundle, signature } = JSON.parse(text);
    for (const name of ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision']) {
      if (bundle[name].payload_hash !== preparePayload(bundle[name].payload).payloadHash) throw new Error(`${id}: ${name} payload_hash`);
    }
    if (signature.manifest_hash !== preparePayload(bundle.manifest).payloadHash) throw new Error(`${id}: manifest_hash`);
    const profile = bundle.manifest.canonicalization_profile ?? null;
    const declared = id in BASE_PROFILES ? BASE_PROFILES[id as BaseId] : 'dcp-jcs-v2';
    if (profile !== declared) throw new Error(`${id}: profile ${String(profile)}, declared ${String(declared)}`);
  }
}

function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return path;
}

async function main() {
  const committedBases = (): Record<string, string> => {
    const committed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    return Object.fromEntries(Object.entries(committed.bases as Record<string, { input_json: string }>).map(([k, v]) => [k, v.input_json]));
  };
  if (process.argv.includes('--check')) {
    const committed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    const bases = committedBases();
    checkBases(bases);
    const expected = assemble(bases);
    const diff = firstDifference(JSON.parse(JSON.stringify(expected)), committed);
    if (diff) {
      console.error(`phase 3 vectors: the committed file differs from this generator at ${diff}`);
      process.exit(1);
    }
    console.log(`phase 3 vectors: ${committed.cases.length} cases over ${Object.keys(bases).length} frozen bases match this generator`);
    return;
  }
  let bases: Record<string, string>;
  if (process.argv.includes('--sign-bases')) {
    if (existsSync(OUTPUT_PATH)) throw new Error('the bases are frozen: --sign-bases refuses while the file exists');
    bases = await signBases();
  } else {
    bases = committedBases();
  }
  checkBases(bases);
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(assemble(bases), null, 2)}\n`);
  console.log(`wrote ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
