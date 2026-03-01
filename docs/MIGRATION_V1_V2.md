# Migration Guide: DCP-AI v1.0 to v2.0

**Version:** 2.0.0
**Date:** February 2026

This guide walks you through migrating an existing DCP-AI v1.0 integration to v2.0. The migration introduces post-quantum composite signatures, dual-hash chains, session binding, adaptive security tiers, and agent-to-agent communication — while maintaining full backward compatibility for v1.0 bundles.

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

There are **no breaking changes** for v1.0 consumers. A v2.0 verifier will accept v1.0 bundles when configured with `allow_v1_bundles: true` (the default). v1.0 verifiers will reject v2.0 bundles with a clear error message (`"unsupported dcp_version 2.0"`).

The migration is **additive**: v2.0 introduces new fields and structures alongside the v1.0 format. You can migrate producers (agents) and consumers (verifiers) independently.

---

## 2. Step-by-Step Migration

### Step 1: Update SDK

Install the latest SDK version that supports v2.0.

**TypeScript:**

```bash
npm install @dcp-ai/sdk@latest
```

**Python:**

```bash
pip install dcp-ai --upgrade
```

**Go:**

```bash
go get github.com/dcp-ai/dcp-ai-go@latest
```

### Step 2: Generate Hybrid Key Pairs

v2.0 requires both classical (Ed25519) and post-quantum (ML-DSA-65) key pairs.

**TypeScript:**

```typescript
import {
  getDefaultRegistry,
  registerDefaultProviders,
  deriveKid,
} from '@dcp-ai/sdk';

const registry = getDefaultRegistry();
registerDefaultProviders(registry);

const ed25519 = registry.getSigner('ed25519');
const mlDsa65 = registry.getSigner('ml-dsa-65');

const classicalKp = await ed25519.generateKeyPair();
const pqKp = await mlDsa65.generateKeyPair();

const classicalKid = deriveKid('ed25519', classicalKp.publicKey);
const pqKid = deriveKid('ml-dsa-65', pqKp.publicKey);
// classicalKp: { publicKey, secretKey } (Ed25519)
// pqKp:        { publicKey, secretKey } (ML-DSA-65)
```

**Python:**

```python
from dcp_ai import generate_hybrid_keypair

keys = generate_hybrid_keypair()
# keys.classical.public_key, keys.classical.secret_key
# keys.pq.public_key, keys.pq.secret_key
```

**CLI:**

```bash
dcp keygen --hybrid --out ./keys/
# Creates: ed25519.pub, ed25519.key, ml-dsa-65.pub, ml-dsa-65.key
```

### Step 3: Update Artifact Construction

All v2.0 artifacts require two new fields: `dcp_version: "2.0"` and `session_nonce`.

**Before (v1.0):**

```json
{
  "human_id": "human:abc-123",
  "entity_type": "natural_person",
  "entity_name": "Alice",
  "jurisdiction": "US",
  "binding_method": "government_id",
  "keys": [{ "kid": "...", "alg": "ed25519", "public_key_b64": "..." }],
  "revocation_token": "sha256:..."
}
```

**After (v2.0):**

```json
{
  "dcp_version": "2.0",
  "human_id": "human:abc-123",
  "entity_type": "natural_person",
  "entity_name": "Alice",
  "jurisdiction": "US",
  "binding_method": "government_id",
  "keys": [
    { "kid": "...", "alg": "ed25519", "public_key_b64": "...", "status": "active" },
    { "kid": "...", "alg": "ml-dsa-65", "public_key_b64": "...", "status": "active" }
  ],
  "revocation_token": "sha256:...",
  "session_nonce": "a3f7c8d2e1b0f4a5c6d7e8f9..."
}
```

Key differences:
- `dcp_version` is now `"2.0"`.
- `keys` array includes both Ed25519 and ML-DSA-65 entries.
- `session_nonce` is a 256-bit random hex string (64 characters).
- Each key entry includes a `status` field.

### Step 4: Switch to Composite Signatures

Replace single Ed25519 signatures with composite signatures.

**Before (v1.0):**

```json
{
  "bundle": { "..." },
  "bundle_hash": "sha256:...",
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**After (v2.0):**

```json
{
  "payload": { "..." },
  "payload_hash": "sha256:...",
  "composite_sig": {
    "classical": {
      "alg": "ed25519",
      "kid": "a1b2c3d4...",
      "sig_b64": "..."
    },
    "pq": {
      "alg": "ml-dsa-65",
      "kid": "f6e5d4c3...",
      "sig_b64": "..."
    },
    "binding": "pq_over_classical"
  }
}
```

Key differences:
- `signature` becomes `composite_sig` with `classical` and `pq` components.
- Each component uses `kid` (deterministic key identifier) instead of `public_key_b64`.
- The `binding` field specifies `pq_over_classical` (PQ signature covers classical signature).
- The payload wrapper changes from `bundle`/`bundle_hash` to `payload`/`payload_hash`.

**TypeScript SDK:**

```typescript
import { signBundleV2 } from '@dcp-ai/sdk';

const signedBundle = await signBundleV2(bundle, {
  classicalKey: keys.classical,
  pqKey: keys.pq,
  sessionNonce: crypto.randomBytes(32).toString('hex'),
});
```

### Step 5: Add Domain Separation

v2.0 requires domain separation context tags on all signatures. If you are using the SDK's `signBundleV2` function, this is handled automatically. If signing manually:

```typescript
import { canonicalize } from '@dcp-ai/sdk';

const contextTag = 'DCP-AI.v2.Bundle';
const payload = canonicalize(bundleManifest);
const signedBytes = Buffer.concat([
  Buffer.from(contextTag, 'utf8'),
  Buffer.from([0x00]),
  Buffer.from(payload, 'utf8'),
]);

const classicalSig = ed25519.sign(signedBytes, classicalSecretKey);
const pqSignedBytes = Buffer.concat([signedBytes, classicalSig]);
const pqSig = mlDsa65.sign(pqSignedBytes, pqSecretKey);
```

### Step 6: Update Audit Entries

v2.0 audit entries include a secondary hash chain and session nonce.

**Before (v1.0):**

```json
{
  "event_id": "evt:...",
  "event_type": "action_executed",
  "agent_id": "agent:my-agent",
  "timestamp": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:...",
  "payload_hash": "sha256:..."
}
```

**After (v2.0):**

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:...",
  "event_type": "action_executed",
  "agent_id": "agent:my-agent",
  "timestamp": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:...",
  "prev_hash_secondary": "sha3-256:...",
  "payload_hash": "sha256:...",
  "session_nonce": "a3f7c8d2e1b0f4a5c6d7e8f9..."
}
```

New fields:
- `prev_hash_secondary`: SHA3-256 of the previous audit entry (dual-hash chain).
- `session_nonce`: Same nonce as all other artifacts in the bundle.

### Step 7: Construct Bundle Manifest

v2.0 replaces the flat `bundle_hash` with a structured manifest.

**Before (v1.0):**

```json
{
  "bundle": { "rpr": {}, "agent_passport": {}, "intent": {}, "policy_decision": {}, "audit_trail": [] },
  "bundle_hash": "sha256:...",
  "merkle_root": "sha256:...",
  "signature": { "..." }
}
```

**After (v2.0):**

```json
{
  "manifest": {
    "session_nonce": "a3f7c8d2...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 5,
    "pq_checkpoints": ["ckpt-uuid-1"]
  },
  "composite_sig": { "..." }
}
```

The manifest:
- Contains individual hashes for each artifact (not a single bundle hash).
- Includes both SHA-256 and SHA3-256 Merkle roots.
- Tracks PQ checkpoint IDs for the audit trail.
- Is signed with a composite signature under the `DCP-AI.v2.Bundle` context tag.

### Step 8: Update Verifier Configuration

v2.0 verifiers use a policy configuration that is verifier-authoritative.

```json
{
  "verifier_policy": {
    "default_mode": "hybrid_required",
    "risk_overrides": {
      "high": "hybrid_required",
      "medium": "hybrid_required",
      "low": "hybrid_preferred"
    },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "require_session_binding": true,
    "require_composite_binding": true,
    "allow_v1_bundles": true
  }
}
```

Set `allow_v1_bundles: true` during the transition period.

### Step 9: Add Security Tier Support (Optional)

If your system uses intents with risk scores, add security tier computation:

```typescript
import { computeSecurityTier } from '@dcp-ai/sdk';

const intent = {
  intent_id: 'intent:...',
  action_type: 'api_call',
  risk_score: 350,
  data_classes: ['pii'],
  // ...
};

const tier = computeSecurityTier(intent);
// tier = "elevated" (risk_score >= 200 AND has_sensitive data)
```

### Step 10: Run Conformance Tests

```bash
# TypeScript
cd sdks/typescript && npm test

# Python
cd sdks/python && pytest

# Verify NIST KAT compliance
cd sdks/typescript && npm test -- --grep "nist-kat"
```

---

## 3. Backward Compatibility

### 3.1 Compatibility Matrix

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

### 3.2 Coexistence Strategy

During migration, your system can handle both v1.0 and v2.0 bundles:

```typescript
import { verifyBundle } from '@dcp-ai/sdk';

const result = await verifyBundle(signedBundle, {
  allowV1Bundles: true,
  v1PublicKey: classicalPublicKey,   // for v1 bundles
  v2VerifierPolicy: verifierPolicy,  // for v2 bundles
});

if (result.version === '1.0') {
  // V1 bundle — classical verification only
} else {
  // V2 bundle — composite verification with tier enforcement
}
```

### 3.3 Schema Routing

The verifier inspects `dcp_version` to route to the correct schema set:

- `"1.0"` → `schemas/v1/*.schema.json`
- `"2.0"` → `schemas/v2/*.schema.json`

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

**v1.0:**

```json
{
  "bundle": {
    "responsible_principal_record": { "..." },
    "agent_passport": { "..." },
    "intent": { "..." },
    "policy_decision": { "..." },
    "audit_trail": [ "..." ]
  },
  "bundle_hash": "sha256:abc123...",
  "merkle_root": "sha256:def456...",
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "MCowBQYDK2Vw...",
    "sig_b64": "xYz789..."
  }
}
```

**v2.0:**

```json
{
  "dcp_version": "2.0",
  "responsible_principal_record": {
    "payload": { "..." },
    "payload_hash": "sha256:...",
    "composite_sig": { "..." }
  },
  "agent_passport": {
    "payload": { "..." },
    "payload_hash": "sha256:...",
    "composite_sig": { "..." }
  },
  "intent": {
    "payload": { "..." },
    "payload_hash": "sha256:...",
    "composite_sig": { "..." }
  },
  "policy_decision": {
    "payload": { "..." },
    "payload_hash": "sha256:...",
    "composite_sig": { "..." }
  },
  "audit_trail": [
    {
      "payload": { "..." },
      "payload_hash": "sha256:...",
      "composite_sig": { "..." }
    }
  ],
  "manifest": {
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 5,
    "pq_checkpoints": ["..."]
  },
  "bundle_sig": {
    "composite_sig": { "..." }
  }
}
```

Key structural differences:
- **Individual artifact signing:** Each artifact (RPR, passport, intent, policy, audit) is independently signed with a composite signature in a `SignedPayload` envelope.
- **Manifest:** Replaces `bundle_hash` with a structured manifest binding all artifact hashes.
- **Session nonce:** Present in every artifact and in the manifest.
- **Bundle signature:** Signs the manifest (not the entire bundle blob).

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
| `dcp_version` | Not present | `"2.0"` |
| `prev_hash` | SHA-256 or `"GENESIS"` | SHA-256 or `"GENESIS"` (unchanged) |
| `prev_hash_secondary` | Not present | SHA3-256 or `"GENESIS"` |
| `session_nonce` | Not present | Required |
| `intent_hash_secondary` | Not present | Optional (SHA3-256) |
| Per-event signature | Not specified | Ed25519 with domain separation |
| PQ checkpoint | Not specified | Composite sig over Merkle root every N events |

---

## 5. SDK API Changes

### 5.1 TypeScript SDK

| v1.0 API | v2.0 API | Notes |
|----------|----------|-------|
| `signBundle(bundle, secretKey)` | `signBundleV2(bundle, { classicalKey, pqKey, sessionNonce })` | Composite signing |
| `verifySignedBundle(sb, publicKey)` | `verifyBundleV2(sb, verifierPolicy)` | Policy-driven verification |
| `createBundle(rpr, ap, intent, policy, audit)` | `createBundleV2(rpr, ap, intent, policy, audit, sessionNonce)` | Session nonce required |
| `hashObject(obj)` | `hashObject(obj)` (unchanged) | Still SHA-256 + JCS |
| N/A | `hashObjectSecondary(obj)` | SHA3-256 hash |
| N/A | `getDefaultRegistry()` + `registerDefaultProviders()` + `deriveKid()` | Ed25519 + ML-DSA-65 via algorithm registry |
| N/A | `computeSecurityTier(intent)` | Adaptive tier calculation |
| N/A | `deriveKid(alg, publicKey)` | Deterministic kid |
| N/A | `createCompositeSignature(payload, ctx, keys)` | Manual composite signing |
| N/A | `verifyCompositeSignature(payload, ctx, sig)` | Manual composite verification |

### 5.2 Python SDK

| v1.0 API | v2.0 API | Notes |
|----------|----------|-------|
| `sign_bundle(bundle, secret_key)` | `sign_bundle_v2(bundle, classical_key, pq_key, session_nonce)` | Composite signing |
| `verify_signed_bundle(sb, public_key)` | `verify_bundle_v2(sb, verifier_policy)` | Policy-driven |
| N/A | `generate_hybrid_keypair()` | Ed25519 + ML-DSA-65 |
| N/A | `compute_security_tier(intent)` | Adaptive tier |
| N/A | `derive_kid(alg, public_key)` | Deterministic kid |

### 5.3 Go SDK

| v1.0 API | v2.0 API | Notes |
|----------|----------|-------|
| `SignBundle(bundle, secretKey)` | `SignBundleV2(bundle, opts)` | Composite signing |
| `VerifySignedBundle(sb, publicKey)` | `VerifyBundleV2(sb, policy)` | Policy-driven |
| N/A | `GenerateHybridKeyPair()` | Ed25519 + ML-DSA-65 |
| N/A | `ComputeSecurityTier(intent)` | Adaptive tier |
| N/A | `DeriveKid(alg, publicKey)` | Deterministic kid |

### 5.4 CLI Changes

| v1.0 Command | v2.0 Command | Notes |
|-------------|-------------|-------|
| `dcp keygen` | `dcp keygen --hybrid` | Generates both key types |
| `dcp sign-bundle` | `dcp sign-bundle --composite` | Composite signing |
| `dcp verify-bundle` | `dcp verify-bundle --policy <file>` | Policy-driven verification |
| N/A | `dcp kid --alg <alg> --key <file>` | Compute kid |
| N/A | `dcp recovery-setup` | M-of-N social recovery |
| N/A | `dcp emergency-revoke` | Panic-button revocation |
| N/A | `dcp rotate-key` | Key rotation with PoP |
| N/A | `dcp capabilities <endpoint>` | Query endpoint capabilities |
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
- [ ] **Intent construction**: v2.0 intent includes `dcp_version`, `session_nonce`, `security_tier`
- [ ] **Composite signing**: `signBundleV2` produces valid composite signatures
- [ ] **Domain separation**: Signatures include context tags
- [ ] **Composite binding**: PQ signature covers classical signature bytes
- [ ] **Dual-hash chain**: Audit entries include `prev_hash_secondary` (SHA3-256)
- [ ] **Manifest**: Bundle manifest contains all artifact hashes and secondary Merkle root
- [ ] **Session nonce**: All artifacts in a bundle share the same nonce
- [ ] **V2 verification**: `verifyBundleV2` passes for correctly signed v2.0 bundles
- [ ] **V1 compatibility**: `verifyBundleV2` passes for v1.0 bundles (with `allow_v1_bundles: true`)
- [ ] **Tamper detection**: Modifying any artifact field causes verification to fail
- [ ] **Stripping detection**: Removing the PQ signature causes verification to fail
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

v2.0 bundles are larger due to ML-DSA-65 signatures (3309 B each). For bandwidth-sensitive deployments, use CBOR wire format (30-40% reduction) and consider compact bundle presentation modes for established sessions at lower security tiers.

### 6.3 Automated Migration Validation

The DCP-AI SDK includes a migration validator:

```bash
# Validate that a v1.0 bundle can be upgraded to v2.0
dcp migrate-check --input v1-bundle.json

# Output:
# ✅ RPR: compatible (needs session_nonce, PQ key)
# ✅ Passport: compatible (needs session_nonce, PQ key)
# ✅ Intent: compatible (needs session_nonce, risk_score as integer)
# ✅ Policy: compatible (needs session_nonce)
# ✅ Audit: compatible (needs prev_hash_secondary, session_nonce)
# ⚠️  Signature: v1.0 Ed25519-only → needs composite upgrade
# ⚠️  Bundle hash: flat → needs manifest upgrade
```

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
8. **Add security tier computation** (optional but recommended).
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
- GitHub Issues: `dcp-ai-genesis` repository
- Slack: #dcp-migration channel (early adopters)
- Office Hours: Wednesdays 10:00 AM Pacific

---

## References

- [DCP-AI v2.0 Normative Specification](../spec/DCP-AI-v2.0.md)
- [DCP-04: Agent-to-Agent Communication](../spec/DCP-04.md)
- [Security Model](SECURITY_MODEL.md)
- [NIST Conformity Statement](NIST_CONFORMITY.md)
- [NIST KAT Test Vectors](../tests/nist-kat/README.md)
- [Technical Architecture](TECHNICAL_ARCHITECTURE.md)
