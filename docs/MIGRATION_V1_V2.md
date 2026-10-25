# Migration Guide: DCP-AI v1.0 to v2.0

**Specification version:** 2.0
**Last updated:** October 2026
**Applies to:** the SDKs on `main`. Published packages carry their own versions: on 25/10/2026 npm's `latest`
`@dcp-ai/sdk` was 2.1.1, without the 2.2.0 verifier fixes (see [`SECURITY.md`](../SECURITY.md#supported-versions)
and each SDK's *Release status*).

This guide walks you through migrating an existing DCP-AI v1.0 integration to v2.0. The migration introduces post-quantum composite signatures, dual-hash chains, session binding, adaptive security tiers, and agent-to-agent communication — while valid v1.0 bundles keep verifying where the verifier's policy allows them (see 1.2).

---

## 1. What Changed in v2.0

### 1.1 Summary of Changes

| Feature | v1.0 | v2.0 |
|---------|------|------|
| **Signatures** | Ed25519 only | Composite: Ed25519 + ML-DSA-65 (PQ) |
| **Hash Chains** | SHA-256 only | Dual: SHA-256 + SHA3-256 |
| **Session Binding** | None | `session_nonce` on every artifact |
| **Security Tiers** | None | Adaptive: routine / standard / elevated / maximum |
| **Bundle Manifest** | `bundle_hash` + `merkle_root` | Full manifest with per-artifact hashes, secondary Merkle root, PQ checkpoints |
| **Signature Format** | `{ alg, public_key_b64, sig_b64 }` | `{ composite_sig: { classical, pq, binding } }` |
| **A2A Communication** | Not specified | DCP-04: discovery, handshake, encrypted sessions |
| **Verification Policy** | Agent-declared | Verifier-authoritative |
| **Domain Separation** | None | Context tags on all signatures |
| **kid Derivation** | Implementation-specific | Deterministic: `hex(SHA-256(alg || 0x00 || pk))[0:32]` |
| **Numeric Fields** | Mixed (int/float) | Integer-only (float prohibited) |
| **Privacy** | Full RPR only | Blinded RPR mode available |
| **Key Recovery** | Not specified | M-of-N social recovery (Shamir SSS) |
| **Emergency Revocation** | Not specified | Pre-registered revocation token |
| **Algorithm Governance** | Not specified | Signed advisories with auto-response |
| **Wire Format** | JSON only | JSON (default) + CBOR (optional) |

### 1.2 Breaking Changes

The v1.0 format stays valid, with these limits:

- A verifier that handles both versions accepts a valid v1.0 bundle when its policy has `allow_v1_bundles: true`
  (the default) and the effective mode tolerates a classical-only signature (below). `verifySignedBundleV2` itself
  accepts only v2.0: route v1.0 bundles to the V1 verifier (see 3.2).
- Acceptance is stricter than in earlier versions: for example, an Ed25519 signature whose `S` is not below the
  group order `L` is now rejected (see the changelog's [`[Unreleased]`](../CHANGELOG.md#unreleased)), so a
  stored v1.0 bundle that an earlier verifier accepted may no longer verify.
- v1.0 verifiers reject v2.0 bundles (`"unsupported dcp_version 2.0"`).

A v1.0 bundle has one Ed25519 signature and no post-quantum one, so the verification middlewares (`@dcp-ai/express`, `@dcp-ai/openclaw`, `dcp_ai.fastapi`) accept it only where a classical-only v2.0 bundle would pass (VERIFICATION.md V2-10): the stricter of the policy mode for the V1 passport's `risk_tier` and the mode of the security tier computed from the V1 intent and policy decision (V1 `risk_score`, 0 to 1, scaled by 1000; a missing one counts as `elevated`) must be `classical_only` or `hybrid_preferred`. Under the default policy, a V1 bundle with a routine or standard intent passes, and one with a payment, sensitive data, a high estimated impact or a risk score of 0.5 or more is refused; Express `requireHybrid` refuses every V1 bundle.

The migration is **additive**: v2.0 introduces new fields and structures alongside the v1.0 format. You can migrate producers (agents) and consumers (verifiers) independently.

---

## 2. Step-by-Step Migration

### Step 1: Update SDK

The examples follow `main`. Build or install the SDKs from a source checkout to run them as written (each SDK
README's *Release status* has the commands); the registry commands below install the published versions.

**TypeScript** (published: 2.1.1 on 25/10/2026; 2.2.0 from a checkout):

```bash
npm install /path/to/dcp-ai/sdks/typescript   # main, built with `npm install && npm run build`
```

**Python:**

```bash
pip install -e /path/to/dcp-ai/sdks/python     # main
# or the published version, with optional framework extras: pip install --upgrade 'dcp-ai[fastapi]'
```

**Go** (note the v2 major suffix required by Go modules):

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@main
```

**Rust:**

```toml
dcp-ai = { git = "https://github.com/dcp-ai-protocol/dcp-ai", branch = "main" }
```

**WebAssembly:** build `sdks/wasm` from a checkout (`npm run build`), then `npm install /path/to/dcp-ai/sdks/wasm`.

### Step 2: Generate Hybrid Key Pairs

This hybrid migration uses both classical (Ed25519) and post-quantum (ML-DSA-65) key pairs. Classical-only acceptance remains subject to the effective verification mode (1.2).

**TypeScript:**

```typescript
import { getDefaultRegistry, registerDefaultProviders } from '@dcp-ai/sdk';

registerDefaultProviders(); // Ed25519, ML-DSA-65, SLH-DSA-192f into the default registry
const registry = getDefaultRegistry();

const classicalKp = await registry.getSigner('ed25519').generateKeypair();
const pqKp = await registry.getSigner('ml-dsa-65').generateKeypair();
// each: { kid, publicKeyB64, secretKeyB64 }; kid = deriveKid(alg, publicKey)
```

**Python:**

```python
import asyncio
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider

async def generate_hybrid():
    return await Ed25519Provider().generate_keypair(), await MlDsa65Provider().generate_keypair()

classical, pq = asyncio.run(generate_hybrid())
# each: {"kid", "public_key_b64", "secret_key_b64"}
```

The Python SDK builds, signs and verifies V2 bundles with `dcp_ai.v2` (`BundleBuilderV2`, `sign_bundle_v2`,
`verify_signed_bundle_v2`; see 5.2).

**CLI** (`bin/dcp.js` in a checkout):

```bash
dcp keygen --hybrid ./keys/
# Creates: ed25519_{public_key,secret_key,kid}.txt and ml_dsa_65_{public_key,secret_key,kid}.txt
```

### Step 3: Update Artifact Construction

Each of the V2 RPR, passport, intent and policy decision gains `dcp_version: "2.0"` and the bundle's `session_nonce`, and is signed on its own as a
`SignedPayload` (Step 4). Keys move into the artifacts: the RPR lists the principal's keys in `binding_keys`,
and the passport lists the agent's in `keys`, each with `kid`, `alg`, `public_key_b64`, `created_at`,
`expires_at` and `status`.

**Before (v1.0 RPR):** a detached Ed25519 `signature` over the object without it.

```json
{
  "dcp_version": "1.0",
  "human_id": "human:example-001",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "signature": "<base64 Ed25519 signature>"
}
```

**After (v2.0 RPR payload):** no `signature` field; the composite signature sits beside the payload (Step 4).

```json
{
  "dcp_version": "2.0",
  "human_id": "human:example-001",
  "session_nonce": "<64 hex characters>",
  "legal_name": "Example Principal",
  "entity_type": "natural_person",
  "jurisdiction": "ES",
  "liability_mode": "owner_responsible",
  "override_rights": true,
  "issued_at": "2026-10-25T00:00:00Z",
  "expires_at": null,
  "contact": null,
  "binding_keys": [
    { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" },
    { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "2026-01-01T00:00:00Z", "expires_at": null, "status": "active" }
  ]
}
```

Key differences:
- `dcp_version` is `"2.0"`, and `session_nonce` (64 hex characters, 256 random bits) is the same in every
  artifact of the bundle.
- The passport replaces `public_key` with `keys` (Ed25519 and ML-DSA-65 entries), and the policy decision's
  `risk_score` becomes an integer from 0 to 1000 (spec §14.2).
- Signatures leave the payloads.

### Step 4: Switch to Composite Signatures

Each of these four V2 artifacts is a `SignedPayload`: the payload, its hash and a composite signature under the artifact's
domain-separation context (the RPR with the principal's keys, the passport, intent and policy decision with the
agent's).

```json
{
  "payload": { "dcp_version": "2.0", "...": "..." },
  "payload_hash": "sha256:<hex of the canonical payload>",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

Key differences:
- Each component names its key by `kid` (deterministic, Step 2) instead of carrying the public key.
- `binding: "pq_over_classical"`: the PQ signature covers the classical signature, so the classical signature cannot
  be replaced without invalidating the PQ one. The PQ signature itself can still be removed and the binding relabelled
  `classical_only`: verifiers accept that in the `classical_only` and `hybrid_preferred` modes (the latter with a
  warning) and refuse it in `hybrid_required` and `pq_only`. A PQ signature that is present but invalid is refused in
  every mode.

**TypeScript SDK** (a fragment; the TypeScript SDK's
[Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) is the complete, runnable flow):

```typescript
import { compositeSign, preparePayload, DCP_CONTEXTS } from '@dcp-ai/sdk';

// payload: a V2 artifact payload; registry and agentKeys (a CompositeKeyPair) as in Step 2
const { canonicalBytes, payloadHash } = preparePayload(payload);
const signedIntent = {
  payload,
  payload_hash: payloadHash,
  composite_sig: await compositeSign(registry, DCP_CONTEXTS.Intent, canonicalBytes, agentKeys),
};
```

### Step 5: Add Domain Separation

Every V2 signature is taken over `UTF8(context) || 0x00 || canonical_bytes`, with the context of the artifact
(`DCP-AI.v2.Intent`, `DCP-AI.v2.Bundle` and so on, `DCP_CONTEXTS`). `compositeSign`, `signBundleV2` and their
equivalents in the other SDKs do it for you. If you build the message yourself, use the V2 canonicalization
(`dcp-jcs-v1`):

```typescript
import { canonicalizeV2, domainSeparatedMessage, DCP_CONTEXTS } from '@dcp-ai/sdk';

// manifest: the bundle manifest (Step 7)
const message = domainSeparatedMessage(DCP_CONTEXTS.Bundle, new TextEncoder().encode(canonicalizeV2(manifest)));
// classical signature over `message`; the PQ signature over `message || classical signature bytes`
```

### Step 6: Update Audit Entries

**Before (v1.0):**

```json
{
  "dcp_version": "1.0",
  "audit_id": "audit:example-001",
  "prev_hash": "GENESIS",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "<hex>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null }
}
```

**After (v2.0):**

```json
{
  "dcp_version": "2.0",
  "audit_id": "audit:example-001",
  "session_nonce": "<the bundle's nonce>",
  "prev_hash": "GENESIS",
  "hash_alg": "sha256",
  "timestamp": "2026-10-25T00:01:00Z",
  "agent_id": "agent:example-001",
  "human_id": "human:example-001",
  "intent_id": "intent:example-001",
  "intent_hash": "sha256:<hex of the canonical intent payload>",
  "policy_decision": "approved",
  "outcome": "call_completed",
  "evidence": { "tool": "http", "result_ref": null, "evidence_hash": null },
  "pq_checkpoint_ref": null
}
```

New fields: `session_nonce`, `hash_alg`, `evidence.evidence_hash` and `pq_checkpoint_ref`; hashes carry the
`sha256:` prefix. A dual-hash chain adds `prev_hash_secondary` (SHA3-256) and `hash_alg: "sha256+sha3-256"`.
Current V2 verifiers, the experimental candidate included, do not recompute the secondary chain or
`audit_merkle_root_secondary`: producing these fields does not establish the additional protection
([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)).
Audit entries are not signed one by one: the manifest commits to them through the audit Merkle root, and PQ
checkpoints sign ranges of them.

### Step 7: Construct Bundle Manifest

V1 signs the whole bundle (`signature.bundle_hash`); V2 signs a manifest that commits to each artifact.

**Before (v1.0 signed bundle):**

```json
{
  "bundle": {
    "responsible_principal_record": { "...": "..." },
    "agent_passport": { "...": "..." },
    "intent": { "...": "..." },
    "policy_decision": { "...": "..." },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "alg": "ed25519",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "public_key_b64": "..." },
    "bundle_hash": "sha256:<hex>",
    "merkle_root": "sha256:<hex>",
    "sig_b64": "..."
  }
}
```

**After (v2.0 signed bundle):**

```json
{
  "bundle": {
    "dcp_bundle_version": "2.0",
    "manifest": {
      "session_nonce": "<64 hex>",
      "rpr_hash": "sha256:...",
      "passport_hash": "sha256:...",
      "intent_hash": "sha256:...",
      "policy_hash": "sha256:...",
      "audit_merkle_root": "sha256:...",
      "audit_count": 1,
      "canonicalization_profile": "dcp-jcs-v1"
    },
    "responsible_principal_record": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "agent_passport": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "intent": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "policy_decision": { "payload": { "...": "..." }, "payload_hash": "sha256:...", "composite_sig": { "...": "..." } },
    "audit_entries": [{ "...": "..." }]
  },
  "signature": {
    "hash_alg": "sha256",
    "created_at": "2026-10-25T00:02:00Z",
    "signer": { "type": "human", "id": "human:example-001", "kids": ["<classical kid>", "<pq kid>"] },
    "manifest_hash": "sha256:<hex of the canonical manifest>",
    "composite_sig": { "classical": { "...": "..." }, "pq": { "...": "..." }, "binding": "pq_over_classical" }
  }
}
```

The manifest:
- has one hash per artifact (each artifact's `payload_hash`) and the audit Merkle root;
- may add `audit_merkle_root_secondary` (SHA3-256), `pq_checkpoints`, the signed session window
  (`session_issued_at`, `session_expires_at`), `intended_verifier` and `canonicalization_profile`;
- is signed by the responsible principal with a composite signature under `DCP-AI.v2.Bundle`.

### Step 8: Update Verifier Configuration

V2 verification takes a verifier policy that the verifier, not the bundle, decides. Start from
`DEFAULT_VERIFIER_POLICY` and change what you need: fields you leave out are not filled in from the defaults
(without `max_key_age_days`, for example, no key-age warning is produced; that check warns, it does not reject).

```typescript
import { DEFAULT_VERIFIER_POLICY, verifySignedBundleV2 } from '@dcp-ai/sdk';
import type { VerifierPolicy } from '@dcp-ai/sdk';

const policy: VerifierPolicy = {
  ...DEFAULT_VERIFIER_POLICY,
  default_mode: 'hybrid_required',
  risk_overrides: { high: 'hybrid_required', medium: 'hybrid_required', low: 'hybrid_preferred' },
  allow_v1_bundles: true,
};
// signedBundle and registry as in the TypeScript SDK's Quick Start (V2)
const result = await verifySignedBundleV2(signedBundle, registry, policy);
```

The fields are in the [API reference](API_REFERENCE.md#verifierpolicy). Keep `allow_v1_bundles: true` during the
transition period. V1 bundles still need a mode that tolerates a classical-only signature: with this policy
(`hybrid_required` for the medium and high tiers), the verification middlewares accept V1 bundles only from
low-risk passports with routine or standard intents.

### Step 9: Add Security Tier Support (Optional)

Compute the security tier from the intent and the policy decision, which carries the `risk_score`:

```typescript
// Fragment: the intent and the policy decision are V2 payloads, shortened here.
import { computeSecurityTier } from '@dcp-ai/sdk';
import type { IntentV2, PolicyDecisionV2 } from '@dcp-ai/sdk';

const intent = {
  intent_id: 'intent:...',
  action_type: 'api_call',
  data_classes: ['pii'],
  estimated_impact: 'medium',
  // ...
} as IntentV2;
const policyDecision = { risk_score: 350 /* , ... */ } as PolicyDecisionV2;

const tier = computeSecurityTier(intent, policyDecision);
// tier = "elevated" (pii is sensitive data; risk_score 350 alone would give "standard")
```

### Step 10: Run Conformance Tests

From the root of a checkout (each command in its own subshell):

```bash
# TypeScript
(cd sdks/typescript && npm test)

# Python
(cd sdks/python && pytest)

# NIST KAT compliance only
(cd sdks/typescript && npx vitest run src/__tests__/nist-kat.test.ts)

# Protocol conformance (V1 + V2)
npm run conformance
```

---

## 3. Backward Compatibility

### 3.1 Compatibility Matrix

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true and the effective mode
                                    for the bundle is classical_only or hybrid_preferred)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

### 3.2 Coexistence Strategy

During migration, your system can handle both v1.0 and v2.0 bundles by routing on the version:

```typescript
// Fragment: signedBundle comes from the request; v1PublicKeyB64, registry and policy from configuration.
import { detectDcpVersion, verifySignedBundle, verifySignedBundleV2 } from '@dcp-ai/sdk';

const version = detectDcpVersion(signedBundle);  // '2.0', '1.0', or null for anything else
let result;
if (version === '2.0') {
  result = await verifySignedBundleV2(signedBundle, registry, policy);  // composite verification, tier enforcement
} else if (version === '1.0' && policy.allow_v1_bundles) {
  result = verifySignedBundle(signedBundle, v1PublicKeyB64);           // the Ed25519 signature, hashes and chain
} else {
  result = { verified: false, errors: ['unsupported or disallowed bundle version'] };
}
```

This only routes formats. The V1 branch does not apply the V2 policy modes or the security tier to the V1 bundle
(VERIFICATION.md V2-10), and neither branch decides trust: the verification middlewares do the former, and
[admission](ADMISSION.md) the latter. `verifySignedBundleV2` only accepts v2.0 bundles; the reference CLI
(`dcp verify-bundle`) and the middlewares route by version themselves.

### 3.3 Schema Routing

A verifier routes on the bundle's version before checking its schema:

- a V2 signed bundle has `bundle.dcp_bundle_version: "2.0"` and a `bundle.manifest` → `schemas/v2/*.schema.json`;
- a V1 bundle's artifacts carry `dcp_version: "1.0"` → `schemas/v1/*.schema.json`.

### 3.4 When to Drop V1 Support

V2 verifiers MUST support V1 bundles indefinitely per the specification. However, individual deployments may set a policy to reject V1 bundles after a transition period:

```json
{
  "verifier_policy": {
    "allow_v1_bundles": false
  }
}
```

This should only be done after all agents in your ecosystem have migrated to v2.0.

---

## 4. Bundle Format Changes (Detailed)

### 4.1 Signed Bundle Envelope

The complete V1 and V2 envelopes are in [Step 7](#step-7-construct-bundle-manifest). Key structural differences:

- **Individual artifact signing:** the RPR, passport, intent and policy decision are each a `SignedPayload`
  (`payload`, `payload_hash`, `composite_sig`) signed under their own context. Audit entries stay unsigned and
  are committed through the audit Merkle root.
- **Manifest:** `bundle.manifest` commits to each artifact's hash and the audit Merkle root; it replaces V1's
  `signature.bundle_hash`.
- **Session nonce:** the same `session_nonce` in every artifact, audit entry and the manifest.
- **Bundle signature:** `signature.composite_sig` signs the manifest (`signature.manifest_hash`), not the whole
  bundle; `signature.signer.kids` names the keys instead of carrying a public key.
- **Version marker:** `bundle.dcp_bundle_version: "2.0"`.

### 4.2 Composite Signature Object

```json
{
  "composite_sig": {
    "classical": {
      "alg": "ed25519",
      "kid": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "sig_b64": "<base64-encoded Ed25519 signature>"
    },
    "pq": {
      "alg": "ml-dsa-65",
      "kid": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3",
      "sig_b64": "<base64-encoded ML-DSA-65 signature>"
    },
    "binding": "pq_over_classical"
  }
}
```

### 4.3 Audit Entry Changes

| Field | v1.0 | v2.0 |
|-------|------|------|
| `dcp_version` | `"1.0"` | `"2.0"` |
| `session_nonce` | Not present | Required |
| `prev_hash` | Hex SHA-256 of the previous entry, or `"GENESIS"` | `sha256:<hex>` of the previous entry, or `"GENESIS"` |
| `hash_alg` | Not present | Required: `sha256`, or `sha256+sha3-256` with a dual-hash chain |
| `prev_hash_secondary` | Not present | Optional: `sha3-256:<hex>` (dual-hash chain) |
| `intent_hash` | Hex SHA-256 | `sha256:<hex>` |
| `intent_hash_secondary` | Not present | Optional: `sha3-256:<hex>` |
| `evidence.evidence_hash` | Not present | Present, may be `null` |
| `pq_checkpoint_ref` | Not present | Required, may be `null` |
| Signature | None per entry; the bundle signature covers them | None per entry; the manifest's audit Merkle root commits to them, and PQ checkpoints sign ranges of them |

---

## 5. SDK API Changes

### 5.1 TypeScript SDK

| v1.0 API | v2.0 API | Notes |
|----------|----------|-------|
| `signBundle(bundle, secretKey)` | `signBundleV2(bundle, { registry, signerType, signerId, keys })` | Composite signature over the manifest |
| `verifySignedBundle(sb, publicKey)` | `verifySignedBundleV2(sb, registry, policy?)` | Policy-driven verification |
| `new BundleBuilder()…build()` | `new BundleBuilderV2(sessionNonce)…build()` | Session nonce required; artifacts are `SignedPayload`s |
| `hashObject(obj)` | `hashObject(obj)` (unchanged) | Still SHA-256 + JCS |
| N/A | `dualHashCanonical(canonicalJson)` | SHA-256 + SHA3-256 |
| N/A | `registerDefaultProviders()` + `getDefaultRegistry()` | Ed25519, ML-DSA-65, SLH-DSA-192f via the algorithm registry |
| N/A | `computeSecurityTier(intent, policyDecision?)` | Adaptive tier calculation (spec §14.2) |
| N/A | `deriveKid(alg, publicKeyBytes)` | Deterministic kid |
| N/A | `compositeSign(registry, context, payloadBytes, keys)` | Manual composite signing |
| N/A | `compositeVerify(registry, context, payloadBytes, sig, classicalPk, pqPk?)` | Manual composite verification |

### 5.2 Python SDK

| v1.0 API | v2.0 API | Notes |
|----------|----------|-------|
| `sign_bundle(bundle, secret_key)` | `prepare_payload` + `await composite_sign(registry, context, payload_bytes, classical_key, pq_key)` per artifact, then `BundleBuilderV2(session_nonce)…build()` + `await sign_bundle_v2(bundle, registry, signer_type, signer_id, classical_key, pq_key)` (`dcp_ai.v2`) | Composite signatures over each artifact and over the manifest |
| `verify_signed_bundle(sb, public_key)` | `await verify_signed_bundle_v2(signed_bundle, registry, policy=None)` (`dcp_ai.v2`) | Policy-driven |
| N/A | `Ed25519Provider` / `MlDsa65Provider` (`dcp_ai.providers`), async `generate_keypair()` | Hybrid keys |
| N/A | `compute_security_tier(intent, policy_decision=None)` (`dcp_ai.v2`) | Adaptive tier (spec §14.2) |
| N/A | `derive_kid(alg, public_key_bytes)` (`dcp_ai.v2`) | Deterministic kid |

### 5.3 Go SDK

| v1.0 API | v2.0 API | Notes |
|----------|----------|-------|
| `SignObject(bundle, secretKeyB64)` | `v2.SignPayload(registry, context, payload, classicalKey, pqKey)` per artifact, then `v2.BuildBundleV2(input)` + `v2.SignBundleV2(registry, bundle, classicalKey, pqKey)` | Composite signatures over each artifact and over the manifest |
| `VerifySignedBundle(sb, publicKeyB64)` | `v2.VerifySignedBundleV2(registry, signedBundleJSON)` | Policy-driven |
| N/A | `GenerateKeypair()` on `providers.Ed25519Provider` / `providers.MlDsa65Provider` | Hybrid keys |
| N/A | `v2.ComputeSecurityTier(input)`, `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | Adaptive tier (spec §14.2) |
| N/A | `v2.DeriveKid(alg, publicKey)` | Deterministic kid |

### 5.4 Rust SDK

| v1.0 API | v2.0 API | Notes |
|----------|----------|-------|
| `sign_object(bundle, secret_key_b64)` | `prepare_payload` (`dcp_ai::v2::signed_payload`) + `composite_sign(ed, pq, context, payload_bytes, classical_key, pq_key)` (`dcp_ai::v2::composite_ops`) per artifact, then `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` + `sign_bundle_v2(bundle, &classical_key, &pq_key)` (`dcp_ai::v2::bundle`) | Composite signatures over each artifact and over the manifest |
| `verify_signed_bundle(sb, public_key_b64)` | `verify_signed_bundle_v2_with_policy(&signed_bundle, &policy)` (`dcp_ai::v2::verify_bundle`) | Policy-driven |

### 5.5 CLI Changes

| v1.0 Command | v2.0 Command | Notes |
|-------------|-------------|-------|
| `dcp keygen [out_dir]` | `dcp keygen --hybrid [out_dir]` | Generates both key types |
| `dcp sign-bundle` | `dcp sign-bundle --composite <bundle_v2.json> <ed25519_sk> <ml_dsa_65_sk> [out]` | Composite signing via `@dcp-ai/sdk` |
| `dcp verify-bundle` | `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]` | Full V2 verification; `<mode>` is `classical_only`, `hybrid_preferred`, `hybrid_required` or `pq_only`; the key pins the classical signer |
| N/A | `dcp kid <public_key_file> --alg <algorithm>` | Compute kid |
| N/A | `dcp recovery-setup --threshold <M> --shares <N> [out]` | M-of-N social recovery |
| N/A | `dcp emergency-revoke --agent <id> --token <secret>` | Panic-button revocation |
| N/A | `dcp rotate-key --old-kid <kid> --new-alg <alg>` | Key rotation with PoP |
| N/A | `dcp capabilities <endpoint_url>` | Query endpoint capabilities |
| N/A | `dcp advisory check [url]` | Check algorithm advisories |

---

## 6. Testing Your Migration

### 6.1 Verification Checklist

Run through this checklist to confirm your migration is complete:

- [ ] **Key generation**: Hybrid key pairs (Ed25519 + ML-DSA-65) generate successfully
- [ ] **kid derivation**: `deriveKid('ed25519', pk)` matches expected value
- [ ] **kid derivation**: `deriveKid('ml-dsa-65', pk)` matches expected value
- [ ] **RPR construction**: v2.0 RPR includes `dcp_version`, `session_nonce`, both key types
- [ ] **Passport construction**: v2.0 passport includes `dcp_version`, `session_nonce`
- [ ] **Intent construction**: v2.0 intent includes `dcp_version`, `session_nonce` (and, optionally, a `security_tier` that can only raise the computed tier)
- [ ] **Composite signing**: `signBundleV2` produces valid composite signatures
- [ ] **Domain separation**: Signatures include context tags
- [ ] **Composite binding**: PQ signature covers classical signature bytes
- [ ] **Dual-hash chain**: Audit entries include `prev_hash_secondary` (SHA3-256); current V2 verifiers do not recompute it (Step 6)
- [ ] **Manifest**: Bundle manifest contains all artifact hashes and, with a dual-hash chain, the secondary Merkle root, which current V2 verifiers do not recompute
- [ ] **Session nonce**: All artifacts in a bundle share the same nonce
- [ ] **V2 verification**: `verifySignedBundleV2` (or `dcp verify-bundle`) passes for correctly signed v2.0 bundles
- [ ] **V1 compatibility**: v1.0 bundles still verify with the V1 function `verifySignedBundle` (which accepts only v1.0), with `dcp verify-bundle` or with a version router as in 3.2; the V2 function `verifySignedBundleV2` accepts only v2.0
- [ ] **Tamper detection**: Modifying any artifact field causes verification to fail
- [ ] **Stripping detection**: Removing the PQ signature (binding relabelled `classical_only`) fails under `hybrid_required` and `pq_only` and is accepted under `classical_only` and `hybrid_preferred`; a present but invalid PQ signature fails in every mode
- [ ] **NIST KAT**: All cryptographic operations pass KAT validation
- [ ] **Cross-SDK**: Bundles signed by one SDK verify in another

### 6.2 Common Migration Issues

**Issue: "kid mismatch" during verification**

The v2.0 kid derivation is deterministic: `hex(SHA-256(UTF8(alg) || 0x00 || raw_pk))[0:32]`. If your v1.0 implementation used a different kid scheme, regenerate kids using the v2.0 formula. The SDK's `deriveKid` function handles this.

**Issue: "session_nonce mismatch" across artifacts**

All artifacts in a single bundle MUST share the same `session_nonce`. Generate the nonce once per bundle creation and pass it to all artifact constructors.

**Issue: "composite_sig.pq verification failed"**

The PQ signature signs `context || 0x00 || payload || classical_sig`. Ensure the classical signature bytes (raw, not base64) are appended to the signed message before PQ signing.

**Issue: "unsupported dcp_version 2.0" from a v1.0 verifier**

This is expected. v1.0 verifiers cannot process v2.0 bundles. The upstream verifier needs to upgrade to a v2.0-capable SDK.

**Issue: Float values in signed payloads**

v2.0 prohibits floating-point numbers in all signed payloads (canonicalization ambiguity). Replace `risk_score: 0.75` with an integer scale: `risk_score: 750` (0-1000).

**Issue: Large bundle sizes**

v2.0 bundles are larger, mainly because of the ML-DSA-65 signatures (3309 B each). Measure your largest bundles in
the format your verifier actually reads and give the request body an explicit size budget (see
[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#security-tiers-in-verification)). The reference verification server reads JSON
bodies only, although its capability document lists `application/cbor`, and only the TypeScript SDK has a CBOR
encoder (`cborEncode`); this repository publishes no measured size reduction for it. `presentCompact` removes the
PQ signature (binding `classical_only`), so such a bundle passes only where the effective mode is `classical_only` or
`hybrid_preferred`. Transport size is not a reason to lower a security tier.

### 6.3 Validating Migrated Bundles

The CLI has no v1.0-to-v2.0 migration checker. Verify each migrated bundle with the V2 verifier instead:

```bash
dcp verify-bundle --policy hybrid_required signed_bundle_v2.json
```

It checks the manifest hashes, session binding, composite signatures and audit chain. `risk_score` belongs to the policy decision, as an integer from 0 to 1000; the V2 intent schema does not allow it (spec §14.2).

---

## 7. Recommended Migration Order

For teams migrating a production system, the recommended order is:

1. **Update SDK** to the latest version supporting v2.0.
2. **Update verifiers first** with `allow_v1_bundles: true`. This ensures your verifiers can handle both v1.0 and v2.0 bundles during the transition.
3. **Generate hybrid key pairs** for all agents and humans.
4. **Update artifact construction** to include `dcp_version: "2.0"`, `session_nonce`, and dual key entries.
5. **Switch to composite signatures** using the v2.0 signing APIs.
6. **Add dual-hash chains** to audit entries.
7. **Implement bundle manifest** structure.
8. **Sign sensitive intents with hybrid signatures.** V2 verifiers enforce the security tier (spec §14.3): a `classical_only` bundle is rejected for a payment, sensitive data, high impact or a policy decision `risk_score` of 500 or more.
9. **Run full conformance tests** including NIST KAT validation.
10. **Disable v1.0 bundle acceptance** when all agents in your ecosystem have migrated.

---

## 8. Timeline and Support

| Phase | Timeline | Actions |
|-------|----------|---------|
| **Preparation** | Weeks 1-2 | Update SDK, generate hybrid keys, review this guide |
| **Verifier upgrade** | Weeks 2-3 | Deploy v2.0 verifiers with v1 compatibility |
| **Agent migration** | Weeks 3-6 | Update artifact construction, switch to composite signatures |
| **Validation** | Weeks 6-8 | Run conformance tests, cross-SDK interop testing |
| **Cutover** | Week 8+ | Set `allow_v1_bundles: false` when ready |

For migration support:
- GitHub Issues or Discussions: [`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai)
- Private vulnerability reports via GitHub's security advisory UI
- Email the maintainers per [GOVERNANCE.md](../GOVERNANCE.md)

There is no dedicated Slack, Discord, or office-hours call at this time. See [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) for the current support model.

---

## References

- [DCP-AI v2.0 Normative Specification](../spec/DCP-AI-v2.0.md)
- [DCP-04: Agent-to-Agent Communication](../spec/DCP-04.md)
- [Security Model](SECURITY_MODEL.md)
- [NIST Conformity Statement](NIST_CONFORMITY.md)
- [NIST KAT Test Vectors](../tests/nist-kat/README.md)
- [Technical Architecture](TECHNICAL_ARCHITECTURE.md)
