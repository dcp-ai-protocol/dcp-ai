<sub>**English** · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# dcp-ai-go — Go SDK

**Go release (26/10/2026).** Go SDK `v2.11.0` is available from the module tag `sdks/go/v2.11.0`, including verifier fixes, admission and experimental opt-in APIs. Rust publication remains separate. See [Go v2.11.0](../../docs/GO_RELEASE.md).

Official Go SDK for the Digital Citizenship Protocol (DCP) v1.0 and v2.0. Supports Ed25519, ML-DSA-65, SLH-DSA-192f, ML-KEM-768, composite signatures, dual hash chains, and bundle verification.

Verification checks integrity and signatures; it does not establish principal trust, admission or authorization to act. The current V2 verifier checks the primary audit chain but does not recompute the optional SHA3-256 chain or its secondary Merkle root. See [the documented verification limit](../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains) and use the admission APIs below when trust is required.

## Installation

**Requires:** Go 1.25+

**Go SDK v2.11.0.** This version includes the verifier fixes, principal trust and `strict-v1`, delegation chains, the A2A receive window and the experimental opt-in `dcp-jcs-v2` APIs. The module tag is `sdks/go/v2.11.0`; the import path keeps `/v2`. Changes remain recorded in the [changelog](../../CHANGELOG.md#unreleased).

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
```

Upgrading from v2.10.0 makes verification stricter: malformed or inconsistent evidence previously accepted may now be rejected. Invalid V1 public-key lengths return an error instead of panicking. Preserve historical evidence. `dcp-jcs-v1` remains the normative default; candidate APIs stay experimental and opt-in. Admission still requires operator trust configuration and does not authorize actions.

For source development only:

```bash
go mod edit -replace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2=/path/to/dcp-ai/sdks/go
```

## Features

| Feature | V1 | V2 |
|---------|----|----|
| Ed25519 signatures | Yes | Yes |
| ML-DSA-65 (FIPS 204) | — | Yes |
| SLH-DSA-192f (FIPS 205) | — | Yes |
| ML-KEM-768 (FIPS 203) | — | Yes |
| Composite signatures (PQ over classical) | — | Yes |
| Domain separation | — | Yes |
| Dual hash (SHA-256 + SHA3-256) | — | Yes |
| Bundle verification | Yes | Yes |
| Admission: principal trust set + `strict-v1` profile (spec/profiles/admission) | — | Yes |
| Bundle building & signing | — | Yes |
| Security tier computation | — | Yes |
| Proof of possession | — | Yes |
| Key rotation | — | Yes |
| DCP-04 A2A discovery + handshake + AES-256-GCM session (stdlib; safe for concurrent use, each message accepted once within the window) | — | Yes |
| DCP-05 agent lifecycle (commissioning / vitality / decommissioning) | — | Yes |
| DCP-06 digital succession (testament, memory transfer, ceremony) | — | Yes |
| DCP-07 dispute resolution + arbitration + jurisprudence | — | Yes |
| DCP-08 rights + obligations + compliance | — | Yes |
| DCP-09 delegation + verifiable delegation chains (`CreateSubMandate`, `VerifyMandateChain`) + awareness threshold + principal mirror | — | Yes |
| Session nonce helpers, emergency revocation | — | Yes |
| Lazy PQ checkpoints + `PQCheckpointManager` | — | Yes |
| Blinded RPR, multi-party authorization, algorithm advisory helpers | — | Yes |
| Canonical error codes (38 shared across all SDKs) + `DetectWireFormat` | — | Yes |
| OpenTelemetry / OTLP exporter (build tag `otlp`) | — | Yes |
| Canonicalization candidate `dcp-jcs-v2` (ingress, router, bytes verifier, producers) | — | Experimental and opt-in; not normative |

## Quickstart — V1

```go
package main

import (
    "fmt"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp"
)

func main() {
    keys, _ := dcp.GenerateKeypair()
    obj := map[string]interface{}{"agent_id": "agent-001", "action": "api_call"}
    sig, _ := dcp.SignObject(obj, keys.SecretKeyB64)
    ok, _ := dcp.VerifyObject(obj, sig, keys.PublicKeyB64)
    fmt.Println("Verified:", ok) // true
}
```

<a id="quickstart--v2"></a>

## Quickstart — V2

```go
package main

import (
    "encoding/json"
    "fmt"

    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
)

func main() {
    // Set up algorithm registry
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    reg.RegisterKem(&providers.MlKem768Provider{})

    // Generate keypairs (here one pair signs for both the principal and the agent)
    edKeys, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pqKeys, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    classicalKey := v2.CompositeKeyInfo{Kid: edKeys.Kid, Alg: "ed25519", SecretKeyB64: edKeys.SecretKeyB64, PublicKeyB64: edKeys.PublicKeyB64}
    pqKey := v2.CompositeKeyInfo{Kid: pqKeys.Kid, Alg: "ml-dsa-65", SecretKeyB64: pqKeys.SecretKeyB64, PublicKeyB64: pqKeys.PublicKeyB64}
    keys := []interface{}{
        map[string]interface{}{"kid": edKeys.Kid, "alg": "ed25519", "public_key_b64": edKeys.PublicKeyB64, "status": "active"},
        map[string]interface{}{"kid": pqKeys.Kid, "alg": "ml-dsa-65", "public_key_b64": pqKeys.PublicKeyB64, "status": "active"},
    }

    // Sign each artifact under its own context (Ed25519 + ML-DSA-65)
    sign := func(context string, payload map[string]interface{}) v2.SignedPayload {
        sp, _ := v2.SignPayload(reg, context, payload, classicalKey, &pqKey)
        return sp
    }

    // Build a V2 bundle from the signed artifacts
    nonce := v2.GenerateSessionNonce()
    bundle, _ := v2.BuildBundleV2(v2.BundleBuildInput{
        RPR:          sign(v2.CtxResponsiblePrincipal, map[string]interface{}{"human_id": "rpr:alice", "session_nonce": nonce, "binding_keys": keys}),
        Passport:     sign(v2.CtxAgentPassport, map[string]interface{}{"agent_id": "a-1", "session_nonce": nonce, "keys": keys, "status": "active", "principal_binding_reference": "rpr:alice"}),
        Intent:       sign(v2.CtxIntent, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "agent_id": "a-1", "human_id": "rpr:alice"}),
        Policy:       sign(v2.CtxPolicyDecision, map[string]interface{}{"intent_id": "i-1", "session_nonce": nonce, "risk_score": 200}),
        AuditEntries: []v2.AuditEventV2{},
        SessionNonce: nonce,
    })

    // Sign the manifest with a composite signature
    signed, _ := v2.SignBundleV2(reg, bundle, classicalKey, &pqKey)

    // Verify
    data, _ := json.Marshal(signed)
    result := v2.VerifySignedBundleV2(reg, data)
    fmt.Println("Verified:", result.Verified)
    fmt.Println("Classical:", result.ClassicalValid, "PQ:", result.PQValid)
}
```

### Security Tiers

```go
// Fragment, inside a function: intentPayload and policyPayload are decoded V2 payloads.
tier := v2.ComputeSecurityTier(v2.SecurityTierInput{
    RiskScore:       600, // from the bundle's PolicyDecision, never the intent
    DataClasses:     []string{"financial_data"},
    ActionType:      "initiate_payment",
    EstimatedImpact: "high",
})
fmt.Println(tier.Tier)               // "elevated"
fmt.Println(tier.VerificationMode)   // "hybrid_required"
fmt.Println(tier.CheckpointInterval) // 1

// From decoded intent and PolicyDecision payloads (map[string]interface{}):
tier = v2.ComputeSecurityTier(v2.SecurityTierInputFromPayloads(intentPayload, policyPayload))
```

### ML-KEM-768 Key Encapsulation

```go
// Fragment, inside a function.
kem := &providers.MlKem768Provider{}
kp, _ := kem.GenerateKeypair()
result, _ := kem.Encapsulate(kp.PublicKeyB64)
sharedSecret, _ := kem.Decapsulate(result.CiphertextB64, kp.SecretKeyB64)
```

## V2 API Reference

### Bundle Building & Signing

| Function | Description |
|----------|-------------|
| `v2.SignPayload(reg, context, payload, classicalKey, pqKey)` | Signs an artifact into a `SignedPayload` (composite, or classical-only when `pqKey` is nil) |
| `v2.BuildBundleV2(input)` | Assembles a V2 bundle from signed artifacts, with manifest hashes and dual Merkle roots |
| `v2.SignBundleV2(reg, bundle, classicalKey, pqKey)` | Signs a bundle with composite or classical-only signature; the signer is the bundle's principal (`signer.id` = the RPR's `human_id`) |
| `v2.VerifySignedBundleV2(reg, jsonBytes)` | V2 bundle verification (structure, hashes, signatures, primary audit chain) under `DefaultVerifierPolicy`, against the stricter of the policy mode and the security tier's mode (spec §14.3); reports `ResolvedTier` and `VerificationMode` |
| `v2.VerifySignedBundleV2WithPolicy(reg, jsonBytes, policy)` | Same with your own `VerifierPolicy`; only `DefaultMode`, `RiskOverrides`, `AcceptedClassicalAlgs`, `AcceptedPQAlgs`, `AllowV1Bundles` (a V1 bundle never verifies here), `MaxSessionDurationSeconds`, `RequireSessionExpiry`, `RequireAudienceBinding`, `VerifierID` and the Phase 3 fields (`AdvisoryRejectedAlgs`, `WarnClassicalOnlyDeprecated`, `AllowClassicalFallbackDisable`, as in TypeScript) may differ from `DefaultVerifierPolicy()`, any other change fails verification |
| `v2.VerifySignedBundleV2At(reg, jsonBytes, policy, now)` | Same at the instant `now`: the session window, the RPR expiry and key expiry compare against it, at millisecond precision. The two functions above call it with `time.Now()` |

Every result lists in `SignerKeys` (JSON `signer_keys`), for each composite signature checked (`bundle`, the four artifacts, each `pq_checkpoints[<id>]`), the key entry the verifier resolved for each component (`classical`, `pq`) and whether that component verified.

<a id="admission-principal-trust-and-strict-v1-unreleased"></a>

### Admission: principal trust and strict-v1

A verified bundle proves integrity and signature, not who the principal is. Admission ([spec/profiles/admission](../../spec/profiles/admission/README.md)) adds, on top of verification, an operator trust set that pins each principal's keys and the operator-fixed `strict-v1` profile (hybrid signatures for every tier, signed audience, a signed session of at most 300 s, a revocation snapshot at most 300 s old). It does no network I/O, and it never authorizes an action: `ActionAuthorized` is always `false`.

| Function | Description |
|----------|-------------|
| `v2.NewPrincipalTrustStore(json)` | Validates a trust set (`schemas/v2/principal_trust_set.schema.json`) |
| `v2.ResolveStrictV1Profile(json)` | Validates a strict-v1 configuration (`schemas/v2/admission_profile.schema.json`); the profile's getters (`VerifierPolicy()`, `VerifierID()`, `MaxSessionDurationSeconds()`, `MaxRevocationAgeSeconds()`) return copies |
| `v2.RevocationSubjects(json, verification)` | The passport `agent_id` and the kid of every verified signer key, sorted: what the revocation snapshot must answer for |
| `v2.EvaluateAdmissionV2(json, verification, v2.AdmissionOptions{...})` | Evaluates admission from the verifier's result at `Now`, with no cryptography |
| `v2.AdmitSignedBundleV2(reg, json, v2.AdmitOptions{...})` | Verifies (under the profile's policy, or `Policy` without a profile) and evaluates |

A trust set or profile that cannot be loaded, a profile without a trust set, or a profile together with a caller `Policy` returns an `*v2.AdmissionConfigError` whose `Code` is one of the `CONFIG_*` codes. An `AdmissionResult` has `Verified`, `Verification`, `PrincipalTrust`, `Profile`, `ProfileCompliance`, `Admitted`, `ActionAuthorized`, `RecordedDecision`, `TrustSetVersion` and `Errors` (`{Code, Message}`), with the field names of the spec in its JSON form. Proceed only when `Admitted` is true.

```go
// Fragment, inside a function: trustSetJSON, signedBundleJSON, reg (the algorithm registry) and lookupRevocation come from your application.
trust, err := v2.NewPrincipalTrustStore(trustSetJSON) // operator configuration, never the bundle
if err != nil {
    log.Fatal(err) // *v2.AdmissionConfigError
}
profile, err := v2.ResolveStrictV1Profile([]byte(`{"profile":"strict-v1","verifier_id":"api.acme.example"}`))
if err != nil {
    log.Fatal(err)
}

now := time.Now()
verification := v2.VerifySignedBundleV2At(reg, signedBundleJSON, profile.VerifierPolicy(), now)
subjects := v2.RevocationSubjects(signedBundleJSON, verification)
snapshot := lookupRevocation(subjects) // your source: a JSON snapshot, or nil when it cannot answer

result, err := v2.EvaluateAdmissionV2(signedBundleJSON, verification, v2.AdmissionOptions{
    Profile: profile, Trust: trust, Revocation: snapshot, Now: now,
})
if err != nil {
    log.Fatal(err)
}
if !result.Admitted {
    for _, e := range result.Errors {
        fmt.Println(e.Code, e.Message) // e.g. TRUST_PRINCIPAL_UNKNOWN, REVOCATION_STALE
    }
}
```

### Security Tiers

| Function | Description |
|----------|-------------|
| `v2.ComputeSecurityTier(input)` | Computes the adaptive security tier (routine/standard/elevated/maximum), its verification mode and checkpoint interval (spec §14.2); unknown values fail closed to `elevated` |
| `v2.SecurityTierInputFromPayloads(intent, policyDecision)` | Builds the tier input from decoded intent and PolicyDecision payloads (`risk_score` comes from the PolicyDecision; one that is missing or not an integer from 0 to 1000 becomes `RiskScore: -1`, which is unknown) |
| `v2.EffectiveVerificationMode(policyMode, tier)` | The stricter of the policy mode and the tier's mode; `pq_only` stays `pq_only` |

<a id="delegation-chains-dcp-09-35-unreleased"></a>

### Delegation Chains (DCP-09 §3.5)

| Function | Description |
|----------|-------------|
| `v2.CreateDelegationMandate(reg, humanClassical, humanPQ, params)` | Root mandate signed by the human; `SubDelegation` and `MinimumSecurityTier` are optional |
| `v2.CreateSubMandate(reg, delegatorClassical, delegatorPQ, parent, v2.SubMandateParams{...})` | Sub-mandate signed by the parent's agent under the `DCP-AI.v2.SubMandate` context |
| `v2.VerifyMandateChain(reg, chain, revokedIDs, v2.MandateChainKeys{HumanKeys, AgentKeys}, now)` | Verifies the chain root first and offline (signatures back to the human, links and depth, `sub_delegation`, nested validity, attenuation of actions, `data_classes` and `limits`, tier floor, revocation); returns `MandateChainResult{Valid, Errors, Depth, EffectiveTier}` |

`SecurityTierInput.MandateChainTier` takes the chain's `EffectiveTier` as a floor that can only raise the tier.

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: Canonicalization Candidate `dcp-jcs-v2` (opt-in)

Not normative and not active: `dcp-jcs-v1` stays the only canonicalization profile, and no default, builder,
signer or verifier changes. These functions are available in v2.11.0 only to callers that explicitly opt in. A verified candidate bundle grants no trust or admission. Design and contract:
[`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
(§15 ingress, §16 router, §17 verifier, §18 producers).

| Function | Description |
|----------|-------------|
| `ExperimentalCandidateIngress(input []byte)` | `Accepted`, `Canonical`, `CanonicalSHA256`, or the reject `Class` and `Offset` |
| `NewExperimentalCandidateRouter(config)` | Routes bytes: `reject`, `v1_path` or `candidate`; the historical decoder is named by the closed name `encoding_json` |
| `NewExperimentalCandidateVerifier(config)` and `VerifyAt(registry, input, policy, now)` | Verifies from the original bytes with at most one verifier |
| `ExperimentalCandidateSignPayload(registry, context, input, keys)` | Signs one artifact from `ExperimentalCandidateBytes(b)` or `ExperimentalCandidateHostValue(v)` (exact types; `json.Number` kept) |
| `ExperimentalCandidateSignBundle(registry, parts, signer, options)` | Assembles and signs a bundle whose manifest names `dcp-jcs-v2` |
| `*ExperimentalCandidateProduceError`, `ErrExperimentalCandidateUsage` | A rejection of the inputs' domain or form, before any signer is called; a misuse of the API |

```go
package main

import (
    "fmt"

    "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/providers"
    v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

func main() {
    // The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
    ok, _ := v2.ExperimentalCandidateIngress([]byte(`{"b":1.0,"a":[]}`))
    fmt.Println(string(ok.Canonical)) // {"a":[],"b":1}
    bad, _ := v2.ExperimentalCandidateIngress([]byte(`{"a":1,"a":2}`))
    fmt.Println(bad.Class, bad.Offset) // DUPLICATE_KEY 7

    // A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
    reg := v2.NewAlgorithmRegistry()
    reg.RegisterSigner(&providers.Ed25519Provider{})
    reg.RegisterSigner(&providers.MlDsa65Provider{})
    ed, _ := (&providers.Ed25519Provider{}).GenerateKeypair()
    pq, _ := (&providers.MlDsa65Provider{}).GenerateKeypair()
    keys := v2.ExperimentalCandidateKeys{
        Classical: v2.CompositeKeyInfo{Kid: ed.Kid, Alg: "ed25519", SecretKeyB64: ed.SecretKeyB64, PublicKeyB64: ed.PublicKeyB64},
        PQ:        &v2.CompositeKeyInfo{Kid: pq.Kid, Alg: "ml-dsa-65", SecretKeyB64: pq.SecretKeyB64, PublicKeyB64: pq.PublicKeyB64},
    }
    artifact, err := v2.ExperimentalCandidateSignPayload(reg, v2.CtxIntent, v2.ExperimentalCandidateBytes([]byte(`{"intent_id":"intent:1","risk":1.0}`)), keys)
    if err != nil {
        panic(err)
    }
    fmt.Println(artifact.SignedPayload["payload_hash"]) // sha256:... of {"intent_id":"intent:1","risk":1}
}
```

### Composite Signatures

| Function | Description |
|----------|-------------|
| `v2.CompositeSign(reg, ctx, payload, classicalKey, pqKey)` | PQ-over-classical composite signature |
| `v2.ClassicalOnlySign(reg, ctx, payload, key)` | Classical-only transition mode |
| `v2.CompositeVerify(reg, ctx, payload, sig, classicalPK, pqPK)` | Verify composite signatures |

### Crypto Providers

| Provider | Algorithm | Type | Standard |
|----------|-----------|------|----------|
| `Ed25519Provider` | ed25519 | Signature | — |
| `MlDsa65Provider` | ml-dsa-65 | Signature | FIPS 204 |
| `SlhDsa192fProvider` | slh-dsa-192f | Signature | FIPS 205 |
| `MlKem768Provider` | ml-kem-768 | KEM | FIPS 203 |

### V1 API (unchanged)

| Function | Description |
|----------|-------------|
| `dcp.GenerateKeypair()` | Ed25519 keypair |
| `dcp.SignObject(obj, sk)` | Sign object |
| `dcp.VerifyObject(obj, sig, pk)` | Verify signature |
| `dcp.Canonicalize(obj)` | Deterministic JSON |
| `dcp.HashObject(obj)` | SHA-256 of canonical JSON |
| `dcp.VerifySignedBundle(sb, pk)` | V1 bundle verification |

### DCP-05–09 Types

V2 includes Go structs for all DCP-05 through DCP-09 artifacts:

| Spec | Types |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Domain separation contexts: `CtxLifecycle`, `CtxSuccession`, `CtxDispute`, `CtxRights`, `CtxDelegation`, `CtxAwareness`

All structs include JSON tags for marshaling/unmarshaling and follow Go naming conventions (`json:"field_name,omitempty"` for optional fields).

## Development

```bash
go build ./...   # Build
go test ./...    # Tests (conformance + interop + unit)
go fmt ./...     # Format
go mod tidy      # Verify dependencies
```

### Dependencies

- `github.com/cloudflare/circl` — ML-DSA-65, SLH-DSA-192f, ML-KEM-768
- `golang.org/x/crypto` — SHA3-256

## License

Apache-2.0
