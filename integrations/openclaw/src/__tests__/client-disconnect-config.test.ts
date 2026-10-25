/**
 * @dcp-ai/express has cancelOnDisconnect; dcp_verify_bundle has no such option, because its host
 * gives no signal of a caller that left: configureVerifier refuses it as an unknown option and
 * keeps the previous configuration.
 *
 *   DCP_NEGATIVE_CONTROL=1 npx vitest run src/__tests__/client-disconnect-config.test.ts   # must fail once
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { configureVerifier, executeVerifyBundle } from '../index.js';

const VECTORS = JSON.parse(readFileSync(new URL('../../../../tests/interop/v2/admission_vectors.json', import.meta.url), 'utf8'));
const NOW = Date.parse(VECTORS.cases.find((c: any) => c.name === 'A_known_principal_strict').now);
const TRUSTED = VECTORS.trust_sets.principal;
const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';

afterEach(() => configureVerifier());

describe('configureVerifier', () => {
  it('refuses cancelOnDisconnect as an unknown option and keeps the previous configuration', async () => {
    configureVerifier({ trustedPrincipals: TRUSTED, clock: () => NOW });
    const attempt = () => configureVerifier({ trustedPrincipals: TRUSTED, cancelOnDisconnect: true } as any);
    // The negative control inverts this expectation.
    if (NEGATIVE_CONTROL) expect(attempt).not.toThrow();
    else expect(attempt).toThrow(/Unknown configureVerifier option: cancelOnDisconnect/);
    const result = (await executeVerifyBundle({ signed_bundle: JSON.parse(JSON.stringify(VECTORS.signed_bundles.base)) })) as any;
    expect(result).toMatchObject({ verified: true, admitted: true });
  });
});
