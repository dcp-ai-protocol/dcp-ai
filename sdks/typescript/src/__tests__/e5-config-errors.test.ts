/**
 * E5 gaps found in MP-03 P4: an operator configuration error is a typed error, never a result, through two public
 * functions whose own tests did not reach it.
 * - admitSignedBundleV2FromBytes: on bytes its ingress accepts, AdmissionConfigError with the code admitSignedBundleV2
 *   gives for the same options. On bytes the ingress rejects, the ingress decides first (scanner, domain, parser, then
 *   admission, where the configuration is read): a result with the rejection and no admission, not an error.
 * - evaluateDelegationActivationV2: the 6 config_cases of delegated_admission_vectors.json give the AdmissionConfigError
 *   and code that admitDelegatedBundleV2 gives (delegated-admission.test.ts), before any evidence is read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AdmissionConfigError,
  AlgorithmRegistry,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  admitSignedBundleV2,
  admitSignedBundleV2FromBytes,
  evaluateDelegationActivationV2,
  type AdmitOptions,
  type DelegatedOperator,
} from '../index.js';

const V = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/delegated_admission_vectors.json', import.meta.url), 'utf8'));
const NOW = Date.parse(V.now);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const registry = new AlgorithmRegistry();
for (const p of [new Ed25519Provider(), new MlDsa65Provider(), new SlhDsa192fProvider()]) registry.registerSigner(p);

const bundleBytes = () => Buffer.from(JSON.stringify(V.signed_bundles.orch), 'utf8');
const strict = (): AdmitOptions => ({ profile: clone(V.profiles.strict), trust: clone(V.trust_sets.base), revocation: clone(V.revocations.all_not_revoked), now: NOW });
const BAD: Array<[string, () => AdmitOptions]> = [
  ['a profile with a verifier policy', () => ({ ...strict(), policy: clone(V.policies.weak_classical) })],
  ['a profile without a trust set', () => { const o = strict(); delete o.trust; return o; }],
];

describe('admitSignedBundleV2FromBytes: configuration errors', () => {
  it('the control: these bytes and the strict options are admitted', async () => {
    const r = await admitSignedBundleV2FromBytes(bundleBytes(), registry, strict());
    expect(r.ingress.accepted).toBe(true);
    expect(r.admission?.admitted).toBe(true);
  });

  for (const [name, options] of BAD) {
    it(`${name}: AdmissionConfigError with the object API's code, on bytes the ingress accepts`, async () => {
      const object = admitSignedBundleV2(clone(V.signed_bundles.orch), registry, options());
      await expect(object).rejects.toBeInstanceOf(AdmissionConfigError);
      const code = await object.catch((e) => e.code);
      expect(code).toBe('CONFIG_PROFILE_CONTRADICTION');
      const bytes = admitSignedBundleV2FromBytes(bundleBytes(), registry, options());
      await expect(bytes).rejects.toBeInstanceOf(AdmissionConfigError);
      await expect(bytes).rejects.toMatchObject({ code });
    });

    it(`${name}: on bytes the scanner rejects, the ingress rejection, no error`, async () => {
      const r = await admitSignedBundleV2FromBytes(Buffer.from('{', 'utf8'), registry, options());
      expect(r.ingress.accepted).toBe(false);
      expect(r.ingress.layer).toBe('scanner');
      expect(r.admission).toBeNull();
    });
  }
});

describe('evaluateDelegationActivationV2: configuration errors', () => {
  expect(V.config_cases.length).toBe(6);
  for (const c of V.config_cases) {
    it(`${c.name}: AdmissionConfigError ${c.expected_code}`, async () => {
      const o = c.operator;
      const operator = {
        ...(o.trust ? { trust: clone(V.trust_sets[o.trust]) } : {}),
        ...(o.profile ? { profile: clone(V.profiles[o.profile]) } : {}),
        ...(o.policy ? { policy: clone(V.policies[o.policy]) } : {}),
        ...(o.max_revocation_age_seconds !== undefined ? { maxRevocationAgeSeconds: o.max_revocation_age_seconds } : {}),
        revocation: clone(V.revocations.all_not_revoked),
        mandateRevocation: clone(V.mandate_revocations.all_not_revoked),
        now: NOW,
      } as DelegatedOperator;
      const evidence = { signedBundle: clone(V.signed_bundles.orch), mandateChain: [clone(V.mandates.root)], delegatorBundles: [], acknowledgments: [], awarenessThresholds: [] };
      const call = evaluateDelegationActivationV2(evidence, registry, operator);
      await expect(call).rejects.toBeInstanceOf(AdmissionConfigError);
      await expect(call).rejects.toMatchObject({ code: c.expected_code });
    });
  }
});
