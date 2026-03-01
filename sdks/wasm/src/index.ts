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
  KemKeypairResult,
  KemEncapsulateResult,
  PopResult,
  CitizenshipBundleV2,
  SignedBundleV2,
  BuildBundleOptions,
} from './types.js';

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

  verifyBundle(signedBundle: SignedBundleV2 | unknown): V2VerificationResult {
    return parseOrThrow(
      wasm().wasm_verify_signed_bundle_v2(JSON.stringify(signedBundle)),
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

  computeSecurityTier(intent: unknown): SecurityTierResult {
    return parseOrThrow(
      wasm().wasm_compute_security_tier(JSON.stringify(intent)),
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
    const nonce = opts.sessionNonce ?? this.generateSessionNonce();
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
