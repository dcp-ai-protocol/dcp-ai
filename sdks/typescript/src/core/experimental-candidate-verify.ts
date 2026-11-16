/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 3): verification of the original bytes of a
 * signed bundle. The bytes are routed once by the phase 2 router, and then at most one verifier runs:
 *
 * - `reject`: none.
 * - `v1_path`: today's verifySignedBundleV2, on the value the historical adapter decoded, which is
 *   what a current caller would hand it. When the adapter refused the data there is no such value,
 *   and nothing runs.
 * - `candidate`: today's verifier, accepting exactly `dcp-jcs-v2`, on the exact value of the bytes.
 *
 * There is no second attempt under another profile. `verified: true` means the signatures and
 * commitments verified; it grants no trust or admission and authorizes nothing.
 */

import type { SignedBundleV2, VerifierPolicy } from '../types/v2.js';
import type { AlgorithmRegistry } from './crypto-registry.js';
import { ExperimentalCandidateInternalError } from './experimental-candidate-ingress.js';
import { createExperimentalCandidateRouter } from './experimental-candidate-router.js';
import type {
  ExperimentalCandidateRouter,
  ExperimentalCandidateRouteResult,
  ExperimentalCandidateTransport,
  ExperimentalHistoricalAdapter,
} from './experimental-candidate-router.js';
import { verifySignedBundleV2, verifySignedBundleV2WithProfile } from './verify-v2.js';
import type { VerifyV2Options, VerifyV2Result } from './verify-v2.js';

type Route<O> = Extract<ExperimentalCandidateRouteResult, { outcome: O }>;

/** The route, the verifier it entered (at most one) and that verifier's result as is. */
export type ExperimentalCandidateVerifyResult =
  | { route: Route<'reject'>; entered: 'none'; verification: null }
  | { route: Route<'v1_path'>; entered: 'none'; verification: null }
  | { route: Route<'v1_path'>; entered: 'dcp-jcs-v1'; verification: VerifyV2Result }
  | { route: Route<'candidate'>; entered: 'dcp-jcs-v2'; verification: VerifyV2Result };

export type ExperimentalCandidateVerifier = {
  readonly configuration: ExperimentalCandidateRouter['configuration'];
  verify(
    bytes: Uint8Array,
    registry: AlgorithmRegistry,
    policy?: VerifierPolicy,
    options?: VerifyV2Options,
  ): Promise<ExperimentalCandidateVerifyResult>;
};

/** @internal Observes which verifier is about to run; it cannot replace one. */
type Probe = { enter(profile: 'dcp-jcs-v1' | 'dcp-jcs-v2'): void };

const own = (o: unknown, key: string): unknown =>
  o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, key)
    ? (o as Record<string, unknown>)[key]
    : undefined;

class Verifier implements ExperimentalCandidateVerifier {
  readonly #router: ExperimentalCandidateRouter;
  readonly #probe: Probe | undefined;

  constructor(router: ExperimentalCandidateRouter, probe: Probe | undefined) {
    this.#router = router;
    this.#probe = probe;
  }

  get configuration(): ExperimentalCandidateRouter['configuration'] {
    return this.#router.configuration;
  }

  async verify(
    bytes: Uint8Array,
    registry: AlgorithmRegistry,
    policy?: VerifierPolicy,
    options?: VerifyV2Options,
  ): Promise<ExperimentalCandidateVerifyResult> {
    const route = this.#router.route(bytes);
    switch (route.outcome) {
      case 'reject':
        return { route, entered: 'none', verification: null };
      case 'v1_path': {
        // The discriminant is the member, never the value: a decoded null is data and is delegated.
        if (!('decoded' in route.historical)) return { route, entered: 'none', verification: null };
        const decoded = route.historical.decoded as SignedBundleV2;
        this.#probe?.enter('dcp-jcs-v1');
        const verification = await verifySignedBundleV2(decoded, registry, policy, options);
        return { route, entered: 'dcp-jcs-v1', verification };
      }
      case 'candidate': {
        const profile = own(own(own(route.value, 'bundle'), 'manifest'), 'canonicalization_profile');
        if (profile !== 'dcp-jcs-v2') {
          throw new ExperimentalCandidateInternalError('a candidate route whose value does not name dcp-jcs-v2');
        }
        this.#probe?.enter('dcp-jcs-v2');
        const verification = await verifySignedBundleV2WithProfile(
          route.value as unknown as SignedBundleV2,
          registry,
          policy,
          options,
          'dcp-jcs-v2',
        );
        return { route, entered: 'dcp-jcs-v2', verification };
      }
      default:
        throw new ExperimentalCandidateInternalError(
          `unknown route outcome ${JSON.stringify((route as { outcome?: unknown }).outcome)}`,
        );
    }
  }
}

type VerifierConfig = {
  transport: ExperimentalCandidateTransport;
  acceptedProfiles: readonly string[];
  historical: ExperimentalHistoricalAdapter;
};

/**
 * EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 3): a verifier of original bytes over a router
 * created from `config` (createExperimentalCandidateRouter: validated before any input, no default
 * profile). `verify` takes the parameters of verifySignedBundleV2, with the same defaults.
 */
export function createExperimentalCandidateVerifier(config: VerifierConfig): ExperimentalCandidateVerifier {
  return new Verifier(createExperimentalCandidateRouter(config), undefined);
}

/** @internal Not exported by the package: the same verifier, with a probe for the tests. */
export function createExperimentalCandidateVerifierForTests(
  config: VerifierConfig,
  probe: Probe,
): ExperimentalCandidateVerifier {
  return new Verifier(createExperimentalCandidateRouter(config), probe);
}
