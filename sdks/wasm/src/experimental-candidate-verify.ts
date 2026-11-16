/**
 * EXPERIMENTAL, opt-in (inactive candidate dcp-jcs-v2, phase 3): the wasm verifier of original bytes,
 * created by DcpWasm.createExperimentalCandidateVerifier. This module is internal: the package entry
 * point does not export it, and the package `exports` map does not expose it.
 *
 * One `verify` is one call to wasm_experimental_candidate_verify, which routes and, for a candidate,
 * verifies with today's verifier accepting exactly dcp-jcs-v2. When it needs the historical decoder,
 * the decoder is consulted once, wasm_experimental_candidate_resume (which never verifies) ends in a
 * rejection or a delegation, and a delegation hands the decoder's own string to
 * wasm_verify_signed_bundle_v2 with the policy JSON DcpWasm.verifyBundle would send: what a current
 * caller of today's API gets. A decoder that refused the data leaves no string, and nothing runs.
 */

import type {
  ExperimentalWasmCandidateRouteResult,
  ExperimentalWasmCandidateVerifier,
  ExperimentalWasmCandidateVerifyResult,
  V2VerificationResult,
  VerifierPolicy,
} from './types.js';

/** The bindings the verifier calls; the tests count them. */
export type CandidateVerifyBindings = {
  verify(input: Uint8Array, config: string, policy: string | undefined): string;
  resume(input: Uint8Array, config: string, point: string, historical: string): string;
  verifyBundle(text: string, policy: string | undefined): string;
};

type Historical = { json: string } | { text: string } | { failed: string };
type Normalized = { transport: string; accepted_profiles: string[]; historical: string };

export class WasmCandidateVerifier implements ExperimentalWasmCandidateVerifier {
  readonly #config: string;
  readonly #normalized: Normalized;
  readonly #path: 'w1' | 'w2';
  readonly #decode: (u: Uint8Array) => unknown;
  readonly #bindings: CandidateVerifyBindings;
  readonly #adapterError: (adapter: string, message: string) => Error;

  constructor(options: {
    config: string;
    normalized: Normalized;
    path: 'w1' | 'w2';
    decode: (u: Uint8Array) => unknown;
    bindings: CandidateVerifyBindings;
    adapterError: (adapter: string, message: string) => Error;
  }) {
    const n = options.normalized;
    this.#config = options.config;
    this.#normalized = { transport: n.transport, accepted_profiles: [...n.accepted_profiles], historical: n.historical };
    this.#path = options.path;
    this.#decode = options.decode;
    this.#bindings = options.bindings;
    this.#adapterError = options.adapterError;
  }

  get configuration(): { transport: string; acceptedProfiles: string[]; historical: string } {
    const n = this.#normalized;
    return { transport: n.transport, acceptedProfiles: [...n.accepted_profiles], historical: n.historical };
  }

  #call(json: string): any {
    const r = JSON.parse(json);
    if (r && typeof r === 'object' && ('error' in r || 'usage_error' in r || 'config_error' in r)) {
      throw new Error(`experimental candidate verifier (wasm): ${JSON.stringify(r)}`);
    }
    return r;
  }

  /** The adapter, once, on its own copy of the unit, normalized as the phase 2 router does. */
  #consult(unit: Uint8Array): Historical {
    const name = this.#normalized.historical;
    const describe = (e: unknown) => {
      try {
        return e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
      } catch {
        return 'an unprintable value';
      }
    };
    let r: unknown;
    try {
      r = this.#decode(unit.slice());
    } catch (e) {
      throw this.#adapterError(name, `decode threw ${describe(e)}`);
    }
    try {
      const ok = (r as { ok?: unknown } | null)?.ok;
      if (ok === false) return { failed: String((r as { reason?: unknown }).reason) };
      const text = (r as { text?: unknown }).text;
      if (ok !== true || typeof text !== 'string') throw new Error('decode must return { ok: true, text } or { ok: false, reason }');
      return this.#path === 'w1' ? { json: text } : { text };
    } catch (e) {
      throw this.#adapterError(name, `inspecting the result of decode threw ${describe(e)}`);
    }
  }

  /** A binding route, as the phase 2 wrapper returns it. */
  #route(r: any, own: Uint8Array): ExperimentalWasmCandidateRouteResult {
    const unit = r.unit ? { start: r.unit.start as number, end: r.unit.end as number } : null;
    const withBytes = () => ({ ...unit!, bytes: own.slice(unit!.start, unit!.end) });
    switch (r.outcome) {
      case 'reject':
        return { outcome: 'reject', class: r.class, detail: r.detail, offset: r.offset, transportOffset: r.transport_offset, unit, profile: r.profile, attempts: [], warnings: [] };
      case 'v1_path':
        return {
          outcome: 'v1_path',
          unit: withBytes(),
          profile: 'dcp-jcs-v1',
          profileSource: r.profile_source,
          attempts: ['dcp-jcs-v1'],
          warnings: r.warnings.map((w: { class: string; offset: number; transport_offset: number }) => ({ class: w.class, offset: w.offset, transportOffset: w.transport_offset })),
          historical: 'decoded' in r.historical ? { adapter: r.historical.adapter, decoded: r.historical.decoded } : { adapter: r.historical.adapter, failed: r.historical.failed },
        };
      case 'candidate':
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
    throw new Error(`experimental candidate verifier (wasm): unknown outcome ${JSON.stringify(r.outcome)}`);
  }

  verify(bytes: Uint8Array, policy?: VerifierPolicy): ExperimentalWasmCandidateVerifyResult {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('verify expects the original bytes as a Uint8Array');
    const own = new Uint8Array(bytes); // a private copy, used for every call
    const policyJson = policy === undefined ? undefined : JSON.stringify(policy); // as DcpWasm.verifyBundle
    const first = this.#call(this.#bindings.verify(own, this.#config, policyJson));
    if (!first.needs_historical) {
      const route = this.#route(first.route, own);
      if (route.outcome === 'reject' && first.entered === 'none') return { route, entered: 'none', verification: null };
      if (route.outcome === 'candidate' && first.entered === 'dcp-jcs-v2') {
        return { route, entered: 'dcp-jcs-v2', verification: first.verification as V2VerificationResult };
      }
      throw new Error(`experimental candidate verifier (wasm): ${route.outcome} entered ${JSON.stringify(first.entered)}`);
    }
    const point = first.needs_historical;
    const historical = this.#consult(own.slice(point.unit[0], point.unit[1]));
    const r = this.#call(this.#bindings.resume(own, this.#config, JSON.stringify(point), JSON.stringify(historical)));
    if (r.needs_historical) throw new Error('experimental candidate verifier (wasm): resume asked for the decoder again');
    const route = this.#route(r, own);
    if (route.outcome === 'reject') return { route, entered: 'none', verification: null };
    if (route.outcome !== 'v1_path') throw new Error(`experimental candidate verifier (wasm): resume produced ${route.outcome}`);
    // The decoder's own string, never the route's echo; a refusal leaves none.
    const text = 'json' in historical ? historical.json : 'text' in historical ? historical.text : undefined;
    if (text === undefined) return { route, entered: 'none', verification: null };
    const verification = JSON.parse(this.#bindings.verifyBundle(text, policyJson));
    if (verification && typeof verification === 'object' && 'error' in verification) throw new Error(`verifyBundle: ${verification.error}`);
    return { route, entered: 'dcp-jcs-v1', verification };
  }
}
