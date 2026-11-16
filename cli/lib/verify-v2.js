// Normative V2 verification for `dcp-ai verify`, as verifyV2SignedBundle in lib/verify.js does it
// (the published package cannot import that file): JSON Schema validation of the envelope and the
// four signed payloads, then verifySignedBundleV2 from @dcp-ai/sdk under DEFAULT_VERIFIER_POLICY.
// The schemas are byte-identical copies of schemas/v2, kept in ./schemas/v2 so that they ship.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  AlgorithmRegistry,
  DEFAULT_VERIFIER_POLICY,
  Ed25519Provider,
  MlDsa65Provider,
  SlhDsa192fProvider,
  deriveKid,
  verifySignedBundleV2,
} from '@dcp-ai/sdk';

const SCHEMAS = [
  'signed_bundle', 'signed_payload', 'bundle_manifest', 'composite_signature', 'audit_entry', 'key_entry',
  'pq_checkpoint', 'responsible_principal_record', 'agent_passport', 'intent', 'policy_decision',
];
const PAYLOADS = ['responsible_principal_record', 'agent_passport', 'intent', 'policy_decision'];

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
for (const name of SCHEMAS) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`./schemas/v2/${name}.schema.json`, import.meta.url), 'utf8')));
}

function schemaErrors(name, data) {
  const validate = ajv.getSchema(`https://dcp-ai.org/schemas/v2/${name}.schema.json`);
  return validate(data) ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
}

const registry = new AlgorithmRegistry();
for (const provider of [new Ed25519Provider(), new MlDsa65Provider(), new SlhDsa192fProvider()]) {
  registry.registerSigner(provider);
}

/** Only the canonical base64 of exactly 32 bytes passes. */
function isCanonicalEd25519Key(b64) {
  if (typeof b64 !== 'string' || b64.length > 44) return false;
  const bytes = Buffer.from(b64, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === b64;
}

/**
 * @param {object} signedBundle - a V2 signed bundle (bundle.dcp_bundle_version or bundle.manifest)
 * @param {string} [pinnedKeyB64] - the content of .dcp/keys/ed25519_public.key, when the file
 *   exists: the bundle's classical signer must be that principal key (RPR binding_keys).
 * @returns {Promise<{ verified: boolean, errors: string[], warnings?: string[] }>}
 */
export async function verifyBundleV2(signedBundle, pinnedKeyB64) {
  if (pinnedKeyB64 === '') {
    return { verified: false, errors: ['Local public key file .dcp/keys/ed25519_public.key is empty.'] };
  }
  const envelope = schemaErrors('signed_bundle', signedBundle);
  if (envelope.length > 0) return { verified: false, errors: envelope.map((e) => `signed_bundle: ${e}`) };
  const errors = PAYLOADS.flatMap((name) =>
    schemaErrors(name, signedBundle.bundle[name].payload).map((e) => `${name}: ${e}`));
  if (errors.length > 0) return { verified: false, errors };

  const { bundle, signature } = signedBundle;
  if (pinnedKeyB64 !== undefined) {
    // The bundle signer is the principal: its key is in the RPR binding_keys
    // (spec/VERIFICATION.md V2-6). Every entry under the signing kid must carry
    // the pinned key, and the kid must be derived from it.
    const kid = signature.composite_sig.classical.kid;
    const rprKeys = bundle.responsible_principal_record.payload.binding_keys || [];
    const listed = [...bundle.agent_passport.payload.keys, ...rprKeys].filter((k) => k.kid === kid);
    const pinned =
      signature.composite_sig.classical.alg === 'ed25519' &&
      rprKeys.some((k) => k.kid === kid) &&
      listed.every((k) => k.alg === 'ed25519' && k.public_key_b64 === pinnedKeyB64) &&
      isCanonicalEd25519Key(pinnedKeyB64) &&
      kid === deriveKid('ed25519', Buffer.from(pinnedKeyB64, 'base64'));
    if (!pinned) return { verified: false, errors: ['Bundle is not signed by the expected public key.'] };
  }

  const result = await verifySignedBundleV2(signedBundle, registry, DEFAULT_VERIFIER_POLICY);
  // pq_only does not require the classical signature, so a pin on the
  // classical key would only prove the key is listed in the bundle.
  if (pinnedKeyB64 !== undefined && result.details?.verification_mode === 'pq_only') {
    return {
      verified: false,
      errors: ['Key pinning checks the classical signer, which pq_only mode does not verify.'],
      warnings: result.warnings,
    };
  }
  return { verified: result.verified, errors: result.errors, warnings: result.warnings };
}
