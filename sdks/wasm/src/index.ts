import type {
  KeypairResult,
  HybridKeypairResult,
  CompositeSignature,
  SignatureEntry,
  SignedPayload,
  CompositeVerifyResult,
  DualHash,
  SecurityTierResult,
  PreparedPayload,
  SessionBindingResult,
  V2VerificationResult,
  VerifierPolicy,
  KemKeypairResult,
  KemEncapsulateResult,
  PopResult,
  CitizenshipBundleV2,
  SignedBundleV2,
  BuildBundleOptions,
  ExperimentalCandidateIngressResult,
  ExperimentalCandidateRejectClass,
  ExperimentalWasmCandidateExtraction,
  ExperimentalWasmCandidateRouteResult,
  ExperimentalWasmCandidateRouter,
  ExperimentalWasmCandidateVerifier,
  ExperimentalWasmHistoricalAdapter,
} from './types.js';
import { WasmCandidateVerifier } from './experimental-candidate-verify.js';

export type * from './types.js';

type WasmModule = typeof import('../pkg/dcp_ai.js');

let wasmModule: WasmModule | null = null;

function wasm(): WasmModule {
  if (!wasmModule) {
    throw new Error('DCP WASM not initialized. Call initDcp() first.');
  }
  return wasmModule;
}

function parseOrThrow<T>(json: string, label: string): T {
  const parsed = JSON.parse(json);
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    throw new Error(`${label}: ${parsed.error}`);
  }
  return parsed as T;
}

/**
 * Initialize the DCP WASM module. Must be called once before using any API.
 * Supports both browser (fetch-based) and Node.js environments.
 */
export async function initDcp(wasmUrl?: string): Promise<DcpWasm> {
  if (wasmModule) {
    return new DcpWasm();
  }

  const mod = await import('../pkg/dcp_ai.js');

  if (typeof mod.default === 'function') {
    await mod.default(wasmUrl);
  }

  wasmModule = mod;
  return new DcpWasm();
}

// ── High-level wrapper ──────────────────────────────────────────────────

export class DcpWasm {

  // ── Keypair Generation ──────────────────────────────────────────────

  generateEd25519Keypair(): KeypairResult {
    return parseOrThrow(wasm().wasm_generate_keypair(), 'generateEd25519Keypair');
  }

  generateMlDsa65Keypair(): KeypairResult {
    return parseOrThrow(wasm().wasm_generate_ml_dsa_65_keypair(), 'generateMlDsa65Keypair');
  }

  generateSlhDsa192fKeypair(): KeypairResult {
    return parseOrThrow(wasm().wasm_generate_slh_dsa_192f_keypair(), 'generateSlhDsa192fKeypair');
  }

  generateHybridKeypair(): HybridKeypairResult {
    return parseOrThrow(wasm().wasm_generate_hybrid_keypair(), 'generateHybridKeypair');
  }

  // ── ML-KEM-768 (Key Encapsulation) ─────────────────────────────────

  mlKem768Keygen(): KemKeypairResult {
    return parseOrThrow(wasm().wasm_ml_kem_768_keygen(), 'mlKem768Keygen');
  }

  mlKem768Encapsulate(publicKeyB64: string): KemEncapsulateResult {
    return parseOrThrow(
      wasm().wasm_ml_kem_768_encapsulate(publicKeyB64),
      'mlKem768Encapsulate',
    );
  }

  mlKem768Decapsulate(ciphertextB64: string, secretKeyB64: string): string {
    const result = wasm().wasm_ml_kem_768_decapsulate(ciphertextB64, secretKeyB64);
    if (result.startsWith('{') && result.includes('"error"')) {
      const parsed = JSON.parse(result);
      throw new Error(`mlKem768Decapsulate: ${parsed.error}`);
    }
    return result;
  }

  // ── Composite Signing ──────────────────────────────────────────────

  compositeSign(
    context: string,
    payload: unknown,
    classicalSkB64: string,
    classicalKid: string,
    pqSkB64: string,
    pqKid: string,
  ): CompositeSignature {
    return parseOrThrow(
      wasm().wasm_composite_sign(
        context,
        JSON.stringify(payload),
        classicalSkB64, classicalKid,
        pqSkB64, pqKid,
      ),
      'compositeSign',
    );
  }

  classicalOnlySign(
    context: string,
    payload: unknown,
    skB64: string,
    kid: string,
  ): CompositeSignature {
    return parseOrThrow(
      wasm().wasm_classical_only_sign(context, JSON.stringify(payload), skB64, kid),
      'classicalOnlySign',
    );
  }

  signPayload(
    context: string,
    payload: unknown,
    classicalSkB64: string,
    classicalKid: string,
    pqSkB64: string,
    pqKid: string,
  ): SignedPayload {
    return parseOrThrow(
      wasm().wasm_sign_payload(
        context,
        JSON.stringify(payload),
        classicalSkB64, classicalKid,
        pqSkB64, pqKid,
      ),
      'signPayload',
    );
  }

  // ── Composite Verification ─────────────────────────────────────────

  compositeVerify(
    context: string,
    payload: unknown,
    compositeSig: CompositeSignature,
    classicalPkB64: string,
    pqPkB64?: string,
  ): CompositeVerifyResult {
    return parseOrThrow(
      wasm().wasm_composite_verify(
        context,
        JSON.stringify(payload),
        JSON.stringify(compositeSig),
        classicalPkB64,
        pqPkB64,
      ),
      'compositeVerify',
    );
  }

  /**
   * Verify a V1 or V2 signed bundle. `policy` applies to V2 bundles (the default
   * policy when it is left out); with a policy, V1 bundles are rejected.
   */
  verifyBundle(signedBundle: SignedBundleV2 | unknown, policy?: VerifierPolicy): V2VerificationResult {
    return parseOrThrow(
      wasm().wasm_verify_signed_bundle_v2(
        JSON.stringify(signedBundle),
        policy === undefined ? undefined : JSON.stringify(policy),
      ),
      'verifyBundle',
    );
  }

  // ── Hash Operations ────────────────────────────────────────────────

  dualHash(data: string): DualHash {
    return parseOrThrow(wasm().wasm_dual_hash(data), 'dualHash');
  }

  sha3_256(data: string): string {
    return wasm().wasm_sha3_256(data);
  }

  hashObject(obj: unknown): string {
    return wasm().wasm_hash_object(JSON.stringify(obj));
  }

  dualMerkleRoot(leaves: DualHash[]): DualHash {
    return parseOrThrow(
      wasm().wasm_dual_merkle_root(JSON.stringify(leaves)),
      'dualMerkleRoot',
    );
  }

  // ── Canonicalization & Domain Separation ────────────────────────────

  canonicalize(value: unknown): string {
    const result = wasm().wasm_canonicalize_v2(JSON.stringify(value));
    if (result.startsWith('{"error"')) {
      throw new Error(`canonicalize: ${JSON.parse(result).error}`);
    }
    return result;
  }

  /**
   * EXPERIMENTAL, opt-in (inactive candidate dcp-jcs-v2, phase 1): the ingress of one unit from its
   * original bytes. Returns the rejection class and byte offset, or the canonical bytes and their
   * SHA-256; it verifies, signs or admits nothing and does not change dcp-jcs-v1. A wrong argument
   * is a TypeError (the wasm glue would otherwise coerce it) and an internal error throws: neither
   * is a rejection.
   */
  experimentalCandidateIngress(bytes: Uint8Array): ExperimentalCandidateIngressResult {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('experimentalCandidateIngress expects the original bytes as a Uint8Array');
    }
    const r = parseOrThrow<
      | { status: 'accept'; canonical: string; canonical_sha256: string }
      | { status: 'reject'; class: ExperimentalCandidateRejectClass; offset: number }
    >(wasm().wasm_experimental_candidate_ingress(bytes), 'experimentalCandidateIngress');
    if (r.status === 'accept') {
      return { status: 'accept', canonical: new TextEncoder().encode(r.canonical), canonicalSha256: r.canonical_sha256 };
    }
    return { status: 'reject', class: r.class, offset: r.offset };
  }

  /**
   * EXPERIMENTAL, opt-in (inactive candidate dcp-jcs-v2, phase 2): the unit of a transport, by the
   * phases T1–T5 of the proposal for an envelope (the whole input for 'bare'), as offsets in the input.
   */
  experimentalCandidateExtractUnit(bytes: Uint8Array, transport: 'bare' | 'envelope'): ExperimentalWasmCandidateExtraction {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('experimentalCandidateExtractUnit expects the original bytes as a Uint8Array');
    }
    if (transport !== 'bare' && transport !== 'envelope') throw new TypeError("transport must be 'bare' or 'envelope'");
    const r = JSON.parse(wasm().wasm_experimental_candidate_extract(bytes, transport));
    if (r.status === 'unit') return { status: 'unit', start: r.start, end: r.end };
    return { status: 'reject', class: r.class, detail: r.detail, transportOffset: r.transport_offset };
  }

  /**
   * EXPERIMENTAL, opt-in (inactive candidate dcp-jcs-v2, phase 2): a router over a snapshot of
   * `config`, validated here, before any input. The historical adapter is a JS decoder
   * (experimentalWasmHistoricalAdapters, or one of the same shape); it is consulted lazily, once,
   * through the binding's route/resume protocol, and its reading never selects the candidate.
   */
  createExperimentalCandidateRouter(config: {
    transport: 'bare' | 'envelope';
    acceptedProfiles: readonly string[];
    historical: ExperimentalWasmHistoricalAdapter;
  }): ExperimentalWasmCandidateRouter {
    // A strict snapshot of primitives, in the order of the contract, before anything is serialized:
    // boxed strings, objects with toJSON and bigints are refused here, never handed to JSON.stringify.
    const { transport, policy, name, path, decode, historical } = snapshotWasmConfig(config);
    const request = JSON.stringify({ transport, accepted_profiles: policy, historical: name });
    const checked = JSON.parse(wasm().wasm_experimental_candidate_config(request));
    if (checked.config_error) throw new ExperimentalWasmCandidateConfigError(checked.config_error.code, checked.config_error.detail);
    return new WasmCandidateRouter(JSON.stringify(checked), checked, path, decode.bind(historical));
  }

  /**
   * EXPERIMENTAL, opt-in (inactive candidate dcp-jcs-v2, phase 3): a verifier of original bytes over
   * the configuration of createExperimentalCandidateRouter, validated here, before any input.
   * `verify(bytes, policy?)` makes one wasm_experimental_candidate_verify call: a rejection runs no
   * verifier, a candidate is verified with today's verifier accepting exactly dcp-jcs-v2, and a
   * delegation hands the decoder's own string to the binding verifyBundle uses, with the same policy
   * JSON. A verified bundle grants no trust or admission and authorizes nothing.
   */
  createExperimentalCandidateVerifier(config: {
    transport: 'bare' | 'envelope';
    acceptedProfiles: readonly string[];
    historical: ExperimentalWasmHistoricalAdapter;
  }): ExperimentalWasmCandidateVerifier {
    const { transport, policy, name, path, decode, historical } = snapshotWasmConfig(config);
    const request = JSON.stringify({ transport, accepted_profiles: policy, historical: name });
    const checked = JSON.parse(wasm().wasm_experimental_candidate_config(request));
    if (checked.config_error) throw new ExperimentalWasmCandidateConfigError(checked.config_error.code, checked.config_error.detail);
    return new WasmCandidateVerifier({
      config: JSON.stringify(checked),
      normalized: checked,
      path,
      decode: decode.bind(historical),
      bindings: {
        verify: (input, c, p) => wasm().wasm_experimental_candidate_verify(input, c, p),
        resume: (input, c, point, h) => wasm().wasm_experimental_candidate_resume(input, c, point, h),
        verifyBundle: (text, p) => wasm().wasm_verify_signed_bundle_v2(text, p),
      },
      adapterError: (adapter, message) => new ExperimentalWasmCandidateAdapterError(adapter, message),
    });
  }

  domainSeparatedMessage(context: string, payloadHex: string): string {
    const result = wasm().wasm_domain_separated_message(context, payloadHex);
    if (result.startsWith('{"error"')) {
      throw new Error(`domainSeparatedMessage: ${JSON.parse(result).error}`);
    }
    return result;
  }

  deriveKid(alg: string, publicKeyB64: string): string {
    return wasm().wasm_derive_kid(alg, publicKeyB64);
  }

  // ── Session & Security ─────────────────────────────────────────────

  generateSessionNonce(): string {
    return wasm().wasm_generate_session_nonce();
  }

  verifySessionBinding(artifacts: unknown[]): SessionBindingResult {
    return parseOrThrow(
      wasm().wasm_verify_session_binding(JSON.stringify(artifacts)),
      'verifySessionBinding',
    );
  }

  computeSecurityTier(intent: unknown, policyDecision?: unknown): SecurityTierResult {
    return parseOrThrow(
      wasm().wasm_compute_security_tier(
        JSON.stringify(intent),
        policyDecision === undefined ? undefined : JSON.stringify(policyDecision),
      ),
      'computeSecurityTier',
    );
  }

  // ── Payload Preparation ────────────────────────────────────────────

  preparePayload(payload: unknown): PreparedPayload {
    return parseOrThrow(
      wasm().wasm_prepare_payload(JSON.stringify(payload)),
      'preparePayload',
    );
  }

  // ── Bundle Building & Signing ──────────────────────────────────────

  buildBundle(opts: BuildBundleOptions): CitizenshipBundleV2 {
    const rprNonce = (opts.rpr.payload as { session_nonce?: unknown } | null)?.session_nonce;
    const nonce = opts.sessionNonce ?? (typeof rprNonce === 'string' ? rprNonce : '');
    return parseOrThrow(
      wasm().wasm_build_bundle(
        JSON.stringify(opts.rpr),
        JSON.stringify(opts.passport),
        JSON.stringify(opts.intent),
        JSON.stringify(opts.policy),
        JSON.stringify(opts.auditEntries),
        nonce,
      ),
      'buildBundle',
    );
  }

  signBundle(
    bundle: CitizenshipBundleV2,
    classicalSkB64: string,
    classicalKid: string,
    pqSkB64: string,
    pqKid: string,
  ): SignedBundleV2 {
    return parseOrThrow(
      wasm().wasm_sign_bundle(
        JSON.stringify(bundle),
        classicalSkB64, classicalKid,
        pqSkB64, pqKid,
      ),
      'signBundle',
    );
  }

  // ── Proof of Possession ────────────────────────────────────────────

  generateRegistrationPop(
    challenge: { kid: string; agent_id: string; timestamp: string; nonce: string },
    skB64: string,
    alg: string,
  ): SignatureEntry {
    return parseOrThrow(
      wasm().wasm_generate_registration_pop(JSON.stringify(challenge), skB64, alg),
      'generateRegistrationPop',
    );
  }

  verifyRegistrationPop(
    challenge: { kid: string; agent_id: string; timestamp: string; nonce: string },
    pop: SignatureEntry,
    pkB64: string,
    alg: string,
  ): PopResult {
    return parseOrThrow(
      wasm().wasm_verify_registration_pop(
        JSON.stringify(challenge),
        JSON.stringify(pop),
        pkB64, alg,
      ),
      'verifyRegistrationPop',
    );
  }

  // ── Version Detection ──────────────────────────────────────────────

  detectVersion(value: unknown): string | null {
    const result = wasm().wasm_detect_version(JSON.stringify(value));
    if (result === 'null') return null;
    return JSON.parse(result);
  }
}

// ── EXPERIMENTAL, opt-in: candidate dcp-jcs-v2 router (phase 2) ─────────────

/** A configuration error, raised when the router is created and never for the data. */
export class ExperimentalWasmCandidateConfigError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ExperimentalWasmCandidateConfigError';
  }
}

/** A historical adapter that failed otherwise than by refusing the data; never a rejection. */
export class ExperimentalWasmCandidateAdapterError extends Error {
  constructor(
    readonly adapter: string,
    message: string,
  ) {
    super(`historical adapter ${adapter}: ${message}`);
    this.name = 'ExperimentalWasmCandidateAdapterError';
  }
}

function describe(e: unknown): string {
  try {
    return e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
  } catch {
    return 'an unprintable value';
  }
}

const decoders: Record<'textDecoder' | 'bufferUtf8', (u: Uint8Array) => string> = {
  textDecoder: (u) => new TextDecoder().decode(u),
  bufferUtf8: (u) => {
    const B = (globalThis as { Buffer?: { from(u: Uint8Array): { toString(enc: string): string } } }).Buffer;
    if (B === undefined) throw new Error('Buffer is not available here');
    return B.from(u).toString('utf8');
  },
};

function w1(name: string, decode: (u: Uint8Array) => string): ExperimentalWasmHistoricalAdapter {
  return Object.freeze({
    name,
    path: 'w1' as const,
    decode(u: Uint8Array) {
      try {
        // The wrapper's own path: the object a JS decoder produces, serialized again for Rust.
        return { ok: true as const, text: JSON.stringify(JSON.parse(decode(u))) };
      } catch (e) {
        if (e instanceof SyntaxError || e instanceof RangeError) return { ok: false as const, reason: `${e.name}: ${e.message}` };
        throw e;
      }
    },
  });
}

function w2(name: string, decode: (u: Uint8Array) => string): ExperimentalWasmHistoricalAdapter {
  return Object.freeze({ name, path: 'w2' as const, decode: (u: Uint8Array) => ({ ok: true as const, text: decode(u) }) });
}

/** The measured JS decoders for the two wasm paths, offered by name; none is a default. */
export const experimentalWasmHistoricalAdapters = Object.freeze({
  w1TextDecoderJsonParse: w1('w1.textDecoderJsonParse', decoders.textDecoder),
  w1BufferUtf8JsonParse: w1('w1.bufferUtf8JsonParse', decoders.bufferUtf8),
  w2TextDecoder: w2('w2.textDecoder', decoders.textDecoder),
  w2BufferUtf8: w2('w2.bufferUtf8', decoders.bufferUtf8),
});

const PROFILES = ['dcp-jcs-v1', 'dcp-jcs-v2'];

/** The router configuration as primitives, validated strictly and in the order of the contract. */
function snapshotWasmConfig(config: unknown): {
  transport: 'bare' | 'envelope';
  policy: string[];
  name: string;
  path: 'w1' | 'w2';
  decode: (u: Uint8Array) => unknown;
  historical: object;
} {
  const fail = (code: string, detail: string) => new ExperimentalWasmCandidateConfigError(code, detail);
  let transport: unknown, accepted: unknown, historical: unknown;
  try {
    if (config === null || typeof config !== 'object') throw fail('CONFIG_INVALID', 'CONFIG');
    ({ transport, acceptedProfiles: accepted, historical } = config as Record<string, unknown>);
  } catch (e) {
    throw e instanceof ExperimentalWasmCandidateConfigError ? e : fail('CONFIG_INVALID', 'CONFIG');
  }
  if (accepted === undefined || accepted === null) throw fail('POLICY_INVALID', 'MISSING');
  if (!Array.isArray(accepted) || accepted.length === 0) throw fail('POLICY_INVALID', 'NOT_A_NON_EMPTY_LIST');
  const entries: unknown[] = [];
  try {
    for (let i = 0; i < accepted.length; i++) entries.push(accepted[i]);
  } catch {
    throw fail('CONFIG_INVALID', 'CONFIG');
  }
  if (!entries.every((p) => typeof p === 'string')) throw fail('POLICY_INVALID', 'NOT_STRINGS');
  const policy = entries as string[];
  if (new Set(policy).size !== policy.length) throw fail('POLICY_INVALID', 'REPEATED');
  if (!policy.every((p) => PROFILES.includes(p))) throw fail('POLICY_INVALID', 'UNKNOWN_PROFILE');
  if (typeof transport !== 'string' || (transport !== 'bare' && transport !== 'envelope')) throw fail('CONFIG_INVALID', 'TRANSPORT');
  let name: unknown, path: unknown, decode: unknown;
  try {
    if (historical !== null && typeof historical === 'object') ({ name, path, decode } = historical as Record<string, unknown>);
  } catch {
    throw fail('CONFIG_INVALID', 'HISTORICAL_ADAPTER');
  }
  if (typeof name !== 'string' || name.length === 0 || (path !== 'w1' && path !== 'w2') || typeof decode !== 'function') {
    throw fail('CONFIG_INVALID', 'HISTORICAL_ADAPTER');
  }
  return { transport, policy: [...policy], name, path, decode: decode as (u: Uint8Array) => unknown, historical: historical as object };
}

class WasmCandidateRouter implements ExperimentalWasmCandidateRouter {
  readonly #config: string;
  readonly #normalized: { transport: string; accepted_profiles: string[]; historical: string };
  readonly #path: 'w1' | 'w2';
  readonly #decode: (u: Uint8Array) => unknown;

  constructor(config: string, normalized: { transport: string; accepted_profiles: string[]; historical: string }, path: 'w1' | 'w2', decode: (u: Uint8Array) => unknown) {
    this.#config = config;
    this.#normalized = { transport: normalized.transport, accepted_profiles: [...normalized.accepted_profiles], historical: normalized.historical };
    this.#path = path;
    this.#decode = decode;
  }

  get configuration(): { transport: string; acceptedProfiles: string[]; historical: string } {
    const n = this.#normalized;
    return { transport: n.transport, acceptedProfiles: [...n.accepted_profiles], historical: n.historical };
  }

  #call(json: string): any {
    const r = JSON.parse(json);
    if (r && typeof r === 'object' && ('error' in r || 'usage_error' in r || 'config_error' in r)) {
      throw new Error(`experimental candidate router (wasm): ${JSON.stringify(r)}`);
    }
    return r;
  }

  /** The adapter, once, on its own copy of the unit; anything thrown is an adapter error. */
  #consult(unit: Uint8Array): { json: string } | { text: string } | { failed: string } {
    const name = this.#normalized.historical;
    let r: unknown;
    try {
      r = this.#decode(unit.slice());
    } catch (e) {
      throw new ExperimentalWasmCandidateAdapterError(name, `decode threw ${describe(e)}`);
    }
    try {
      const ok = (r as { ok?: unknown } | null)?.ok;
      if (ok === false) return { failed: String((r as { reason?: unknown }).reason) };
      const text = (r as { text?: unknown }).text;
      if (ok !== true || typeof text !== 'string') throw new Error('decode must return { ok: true, text } or { ok: false, reason }');
      return this.#path === 'w1' ? { json: text } : { text };
    } catch (e) {
      throw new ExperimentalWasmCandidateAdapterError(name, `inspecting the result of decode threw ${describe(e)}`);
    }
  }

  route(bytes: Uint8Array): ExperimentalWasmCandidateRouteResult {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('route expects the original bytes as a Uint8Array');
    const own = new Uint8Array(bytes); // a private copy, used for both calls
    let r = this.#call(wasm().wasm_experimental_candidate_route(own, this.#config));
    if (r.needs_historical) {
      const point = r.needs_historical;
      const historical = this.#consult(own.slice(point.unit[0], point.unit[1]));
      r = this.#call(wasm().wasm_experimental_candidate_resume(own, this.#config, JSON.stringify(point), JSON.stringify(historical)));
      if (r.needs_historical) throw new Error('experimental candidate router (wasm): resume asked for the decoder again');
    }
    const unit = r.unit ? { start: r.unit.start, end: r.unit.end } : null;
    const withBytes = () => ({ ...unit!, bytes: own.slice(unit!.start, unit!.end) });
    if (r.outcome === 'reject') {
      return { outcome: 'reject', class: r.class, detail: r.detail, offset: r.offset, transportOffset: r.transport_offset, unit, profile: r.profile, attempts: [], warnings: [] };
    }
    if (r.outcome === 'v1_path') {
      return {
        outcome: 'v1_path',
        unit: withBytes(),
        profile: 'dcp-jcs-v1',
        profileSource: r.profile_source,
        attempts: ['dcp-jcs-v1'],
        warnings: r.warnings.map((w: { class: string; offset: number; transport_offset: number }) => ({ class: w.class, offset: w.offset, transportOffset: w.transport_offset })),
        historical: 'decoded' in r.historical ? { adapter: r.historical.adapter, decoded: r.historical.decoded } : { adapter: r.historical.adapter, failed: r.historical.failed },
      };
    }
    if (r.outcome !== 'candidate') throw new Error(`experimental candidate router (wasm): unknown outcome ${JSON.stringify(r.outcome)}`);
    return {
      outcome: 'candidate',
      unit: withBytes(),
      profile: 'dcp-jcs-v2',
      attempts: ['dcp-jcs-v2'],
      warnings: [],
      canonical: new TextEncoder().encode(r.canonical),
      canonicalSha256: r.canonical_sha256,
    };
  }
}
