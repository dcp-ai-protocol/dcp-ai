# Security Model

How the protocol protects against attacks — from forged bundles to protocol forks.

---

## Design principle

Verification is local. This is not a weakness; it is the core security property. Local verification means:

- **No single point of compromise.** There is no central server that, if hacked, invalidates all agents. Each verifier runs its own code, checks its own math.
- **Cryptographic guarantees are location-independent.** Ed25519 signatures and SHA-256 hashes produce the same result on any machine. You cannot "hack the math."
- **The verifier does not trust the agent.** The agent presents a bundle; the verifier checks it with its own tools. A compromised agent cannot make a verifier accept an invalid bundle.

Verification says that a bundle is intact and signed by the keys it names. Whether to trust those keys, and to act on the bundle, is a separate decision: admission against the operator's trusted principals ([ADMISSION.md](ADMISSION.md)), plus the operator's own authorization.

Security comes from **layers of protection**, each addressing a different attack vector.

---

## Attack vectors and protections

### 1. Forged bundle (tampered content)

**Attack:** an attacker modifies a field in a Signed Bundle (e.g. changes `agent_passport.status` from `"revoked"` to `"active"`).

**Protection:** the Ed25519 signature covers the canonical JSON of the entire bundle (`dcp-jcs-v1`). Any change to the signed content — a value, a key, an element — invalidates the signature. Changes that leave the canonical form the same, such as whitespace or the order of keys, are not changes to the signed content and still verify. The verifier recomputes `bundle_hash = SHA-256(canonical(bundle))` and checks it against the signed hash. Both checks fail if the content was modified.

**Strength:** cryptographic. Breaking Ed25519 requires solving the discrete logarithm problem on Curve25519; no known practical attack exists.

### 2. Forged identity (fake RPR)

**Attack:** an attacker creates a Responsible Principal Record claiming to be "Google" or "US Government" and signs a bundle with their own key. The signature is valid, but the identity is false.

**Protection:**

- **Jurisdiction Attestation** (see [spec/DCP-01.md](../spec/DCP-01.md)): a government or accredited authority signs the RPR hash, certifying the identity. A verifier that requires attestation will reject bundles without it.
- **Public key binding:** the verifier can require that the signer's public key is known (e.g. published by the entity). A fake "Google" bundle won't have Google's real public key.
- **Transparency log:** if the real entity's `bundle_hash` is in the log and the fake one is not, the fake is detectable.

**Strength:** depends on whether attestation is required. Without attestation, identity is self-declared (like a self-signed certificate). With attestation, identity is authority-backed.

### 3. Stolen signing key

**Attack:** an attacker steals a user's secret key and creates valid bundles in their name.

**Protection:**

- **Revocation:** the key owner (or the jurisdiction) publishes a signed RevocationRecord. All verifiers that check the revocation list will reject bundles signed with the compromised key.
- **Jurisdictional revocation list:** the government publishes a signed list of revoked agents at a well-known URL. Verifiers fetch and cache it.
- **Key rotation:** generate a new keypair (`dcp keygen`), re-sign bundles, revoke the old key.

**Strength:** depends on revocation propagation and on what the verifier does when it cannot get fresh status. A cache TTL alone is not a bound: a stolen key stays useful until the owner publishes the revocation, and then until each verifier fetches a list that includes it. With a cached list (e.g. 1-hour TTL), the window after publication is about one hour only for a verifier that refreshes on time and fails closed when it cannot fetch the list. A verifier that keeps using a stale list, or that skips revocation when the source is unreachable, has no bound. The strict-v1 admission profile requires a revocation snapshot at most 300 seconds old and fails when the source is unavailable ([ADMISSION.md](ADMISSION.md#revocation-sources)).

### 4. Modified verifier (compromised verification code)

**Attack:** an attacker (or a careless implementor) modifies the verification code to always return `verified: true`, bypassing all checks.

**Protection:**

- **Trust boundary.** A compromised verifier affects its operator and clients that rely on its results. Independently run verifiers do not inherit those results; a shared compromised dependency can affect multiple operators.
- **Schema fingerprint check:** `dcp integrity` compares the local V1 schemas with the fingerprints in the local `protocol_fingerprints.json` (see below). It detects a V1 schema changed without its fingerprint; it does not check the verification code.
- **Conformance tests:** `npm run conformance` validates the implementation against known-good fixtures. A modified implementation that changes the results on those fixtures fails conformance; a change outside what the fixtures exercise can still pass.

**Strength:** the impact depends on how the compromised code is distributed and who relies on its results. Independent verification limits reliance on another verifier; it does not eliminate supply-chain risk.

### 5. Protocol fork (the real threat)

**Attack:** someone forks the protocol, weakens the schemas (removes required fields, loosens validation), and claims compatibility with DCP. If widely adopted, this erodes trust in the ecosystem.

**Protection:**

- **Protocol fingerprints:** the file `protocol_fingerprints.json` at the repo root contains the SHA-256 hash of each V1 schema file. Any implementation can check its V1 schemas against them. If someone modifies a schema, its hash changes.
- **`dcp integrity` command:** compares the V1 schemas in `schemas/v1/` with the fingerprints in the local `protocol_fingerprints.json`:

  ```bash
  dcp integrity
  # ✅ PROTOCOL INTEGRITY VERIFIED — all schemas match canonical fingerprints.
  ```

- **Conformance evidence:** passing `npm run conformance` with schemas obtained from a trusted source demonstrates agreement on the cases that suite covers. It does not prove that every protocol requirement or input is handled correctly; review the implementation and the coverage of the applicable specification as well.
- **Bundle-level version:** every artifact includes `dcp_version: "1.0"`. A verifier checks the version and uses the corresponding schemas. A fork with different schemas would need a different version, making it distinguishable.

**Strength:** limited. The fingerprints detect a V1 schema that differs from the fingerprint file next to it. They do not authenticate that file (it is not signed, and a fork can change both), they do not cover the V2 schemas, and they say nothing about the code. A match is not a certification of the implementation. Compare against fingerprints obtained from a source you trust, and run the conformance suite, to judge an implementation.

### 6. Retroactive modification (bundle changed after anchoring)

**Attack:** an attacker modifies a bundle after it was anchored to a blockchain or logged in a transparency log.

**Protection:**

- **Anchor immutability:** the `bundle_hash` in Bitcoin (OP_RETURN) or Ethereum (event) is immutable. The attacker cannot change the on-chain hash.
- **Verification:** the verifier recomputes `bundle_hash` from the bundle and compares it to the anchor. If the bundle was modified, the hash does not match.
- **Transparency log proof:** the log recorded the original `bundle_hash`. A Merkle inclusion proof links the hash to the signed root. If the bundle was modified, the proof fails.

**Strength:** cryptographic + blockchain immutability. Retroactive modification is detectable as long as the anchor or log entry exists.

---

## Protection layers (summary)

```
Layer 1: Cryptography (Ed25519 + SHA-256)
  Forged bundles are detected by signature and hash checks.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities are detected if attestation is required.

Layer 3: Revocation (signed lists by jurisdiction)
  Fresh status and fail-closed handling bound acceptance after revocation;
  a cache TTL alone is not a propagation guarantee.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications are detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum)
  Provides immutable, public proof of bundle existence at a point in time.
```

Layers 1–4 are available in this repo today. Layer 5 has a reference service (`services/transparency-log/`, in memory). Layer 6 is designed ([docs/STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)) and has an Ethereum contract (`contracts/ethereum/`), but the reference anchor service does not submit to a chain yet; production implementations are operator-specific.

---

## Protocol fingerprints

The file `protocol_fingerprints.json` at the repo root contains the SHA-256 hash of the bytes of each schema file in `schemas/v1/`. Format:

```json
{
  "protocol": "DCP-AI",
  "version": "1.0",
  "schema_fingerprints": {
    "responsible_principal_record": "sha256:<hex>",
    "agent_passport": "sha256:<hex>",
    ...
  }
}
```

Any implementation — in any language, on any platform — can compute the SHA-256 of its schema files and compare against these fingerprints. A match means its V1 schema files are byte-identical to the ones fingerprinted; it does not prove that its code verifies correctly, and the fingerprint file is only as trustworthy as the place you got it from.

**Verify locally:**

```bash
dcp integrity
```

---

## What the protocol does NOT protect against

- **A malicious human behind a valid bundle.** DCP can carry a principal binding and evidence checked against the operator's trust configuration. It does not establish a real-world identity automatically or ensure that the principal acts ethically. Law enforcement and regulation remain outside cryptographic verification.
- **A compromised verifier accepting invalid bundles.** Each entity is responsible for running correct verification code. The protocol provides fingerprints and conformance tests; using them is the operator's responsibility.
- **Denial of service.** Rate limiting is specified per-endpoint in the API (see `x-ratelimit` in [`api/openapi.yaml`](../api/openapi.yaml)). DDoS mitigation at the infrastructure level is the operator's responsibility.
- **Replay of a valid bundle.** A signed bundle can be presented again; see [Cross-Artifact Replay](#9-cross-artifact-replay) for what bounds it.

---

---

## V2.0 Security Enhancements

DCP v2.0 significantly strengthens the security model with post-quantum cryptography, composite signatures, adaptive security tiers, and agent-to-agent security.

### 7. Post-Quantum Threat Model

**Attack:** A quantum adversary with access to a large-scale quantum computer (or a "harvest now, decrypt later" strategy) targets Ed25519 signatures and key exchanges.

**Protection:**
- **Hybrid composite signatures:** A V2 composite signature pairs Ed25519 (classical) with ML-DSA-65 (post-quantum, FIPS 204). The PQ signature covers the classical signature (`pq_over_classical` binding), so breaking either alone is insufficient. A V2 signature can also be `classical_only`; whether it is accepted depends on the verification mode (§8).
- **Hybrid KEM:** The DCP-04 key exchange uses X25519 + ML-KEM-768 (FIPS 203), so session keys stay secure if either component algorithm holds. The SDKs do not run this exchange: the caller derives the session key ([NIST_CONFORMITY.md](NIST_CONFORMITY.md) §2.1).
- **Dual hash chains:** the design uses SHA-256 and SHA3-256 in parallel to provide continuity if one hash family is compromised, provided both chains are verified. The V2 bundle verifiers in the unreleased source code check the optional secondary links and secondary Merkle root that are present, but do not require them, and the published packages do not check them; a successful result therefore does not establish this additional protection ([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)).

**Strength:** NIST Level 3 post-quantum security for signatures checked in `hybrid_required` mode (the mode of the elevated and maximum tiers): an attacker must break both the classical and the post-quantum algorithm.

### 8. Stripping Attacks (Composite Signature)

**Attack:** An attacker intercepts a signed bundle and removes the post-quantum signature component, presenting only the classical signature.

**Protection:** The `pq_over_classical` binding protocol ensures:
1. `classical_sig = Ed25519.sign(context || 0x00 || payload)`
2. `pq_sig = ML-DSA-65.sign(context || 0x00 || payload || classical_sig)`

The PQ signature covers the classical signature, so a modified classical signature, or a PQ signature moved to another payload, fails verification. Stripping the PQ signature altogether leaves a `classical_only` signature, which only the effective mode decides: `hybrid_required` (and `pq_only`) rejects it, while `hybrid_preferred` accepts it with a warning and `classical_only` accepts it.

**Strength:** Cryptographic in `hybrid_required` mode. Under `hybrid_preferred` or `classical_only`, stripping is visible (the warning, the `classical_only` binding) but not rejected.

### 9. Cross-Artifact Replay

**Attack:** An attacker takes a valid intent from one session and replays it in a different session or with a different bundle.

**Protection:**
- **Domain separation:** Every signature includes a context tag (e.g., `DCP-AI.v2.Intent`, `DCP-AI.v2.Bundle`). Signatures for one artifact type cannot be replayed for another.
- **Session nonce:** Each bundle includes a 256-bit random session nonce. The manifest binds all artifacts to this nonce. Replaying artifacts from one session into another session breaks the manifest hash.

The nonce does not stop the same bundle from being presented again: a whole bundle replays as it is. A signed session expiry and a signed `intended_verifier` (both required by the strict-v1 admission profile) bound where and for how long a bundle can be replayed; they do not make it single-use. A verifier that needs single use keeps its own record of consumed nonces or bundle hashes ([ADMISSION.md](ADMISSION.md#limits)).

**Strength:** Cryptographic domain separation + session binding, against mixing artifacts; not against replaying a whole bundle.

### 10. Security Tier Downgrade

**Attack:** A malicious agent declares a low security tier (e.g., `routine`) to avoid PQ signature requirements for a high-risk operation.

**Protection:**
- **Verifier-authoritative policy:** The verifier determines the minimum tier, not the agent. It verifies each bundle against the stricter of its policy mode and the tier's mode (spec §14.3), so a passport that declares `risk_tier: "low"` cannot get `classical_only` for a payment intent. Verifiers can upgrade tiers but MUST NOT downgrade.
- **Automatic tier computation:** The SDK computes tiers from the policy decision's `risk_score` and the intent's `data_classes`, `action_type` and `estimated_impact` (spec §14.2). Unknown or missing values fail closed to `elevated`, and the agent cannot override the computed tier downward.
- **Never-downgrade rule:** If the intent computes to `elevated` but the agent declares `routine`, the verifier resolves to `elevated`.

**Strength:** Policy enforcement at the verifier level.

### 11. A2A Session Security

**Attack:** An attacker intercepts or hijacks an agent-to-agent communication session.

**Protection:**
- **Mutual bundle verification:** Both agents verify each other's bundles before establishing a session.
- **Hybrid KEM key exchange:** Ephemeral keys provide forward secrecy. Compromising long-term keys does not reveal past session keys. The SDKs leave this exchange to the caller.
- **AES-256-GCM encryption:** All session messages are encrypted with authenticated encryption.
- **Monotonic sequence numbers:** Prevent replay and reordering within a session.
- **Periodic rekeying:** The session reports when a rekey is due (`needsRekeying`); the caller derives the new key.
- **Revocation awareness:** The specification ends a session when either agent is revoked. The SDKs do not watch revocation during a session: the application must check it and close the session.

**Strength:** Post-quantum forward secrecy + authenticated encryption, when the caller runs the hybrid exchange and the rekeying.

### 12. Lifecycle State Manipulation (DCP-05)

**Attack:** A malicious actor attempts to bypass lifecycle state transitions — e.g., reactivating a decommissioned agent or skipping the "declining" state to avoid data disposition procedures.

**Protection (specification and SDK):**
- **State machine:** `commissioned → active → declining → decommissioned`; invalid transitions are refused.
- **Signed lifecycle records:** Every state transition (commissioning certificate, vitality report, decommissioning record) carries a composite signature, and vitality reports are hash-chained.
- **Final decommissioning:** Once an agent reaches `decommissioned`, no further transitions are possible. The decommissioning record states the data disposition.

**In the reference server:** the lifecycle endpoints refuse invalid transitions (409), but they do not verify the records' signatures and need no authentication; a new commissioning certificate for a decommissioned agent resets it to `commissioned` ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

**Strength:** where the records' signatures are verified (by the SDK functions, or by a service that calls them), the state machine plus the signed trail. The reference server alone gives neither.

### 13. Unauthorized Succession (DCP-06)

**Attack:** An unauthorized party creates a digital testament or initiates succession for an agent they don't control, transferring memory and authority to a rogue successor.

**Protection:**
- **Testament signing:** Digital testaments carry a composite signature that binds the `agent_id` and `successor_preferences`. The reference server stores testaments without verifying it.
- **Memory classification:** Memory transfers use classified access levels. Only entries matching the successor's clearance are transferred.
- **Dual-hash manifests:** Memory transfer manifests use dual-hash (SHA-256 + SHA3-256) references to prevent tampering with transferred data.

**Strength:** Cryptographic binding of succession authority + classified memory access control, for a verifier that checks the signatures.

### 14. Delegation Abuse & Authority Escalation (DCP-09)

**Attack:** An agent with delegated authority attempts to exceed its delegation scope, or a delegation mandate is forged to grant unauthorized capabilities.

**Protection:**
- **Scoped delegation mandates:** Each mandate specifies `authority_scope` with explicit domains and actions. Actions outside scope are rejected.
- **Awareness thresholds:** Configurable thresholds trigger alerts or require human confirmation when delegation parameters exceed defined limits (risk score, financial amount, data sensitivity).
- **Principal mirrors:** The `PrincipalMirror` record maintains a verifiable snapshot of the principal's preferences, preventing drift between delegated authority and principal intent.
- **Interaction logging:** Interactions can be recorded as signed `InteractionRecord` entries; recording them is up to the application.

**Strength:** Scoped authorization + threshold monitoring + cryptographic audit trail, for a verifier that checks mandates and their signatures. The reference server stores mandates without verifying their signatures, and lets anyone revoke a revocable one ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

### Updated Protection Layers (V2.0)

```
Layer 1: Cryptography (Ed25519 + ML-DSA-65 composite, SHA-256 + SHA3-256 dual hash)
  Forged bundles detected. Post-quantum resistant.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities detected if attestation is required.

Layer 3: Revocation (lists + emergency revocation via pre-image)
  Stolen keys are refused by verifiers that fetch fresh status and fail closed.
  Emergency revocation: revealing the pre-image revokes all keys without a signature,
  effective for each verifier once it learns of it.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum L2)
  Immutable, public proof of bundle existence.

Layer 7: Security Tiers (V2.0)
  Risk-adaptive cryptographic requirements. High-risk = full PQ.

Layer 8: A2A Security (DCP-04)
  Mutual authentication + encrypted channels between agents.

Layer 9: Observability (V2.0)
  Telemetry, metrics, and alerting for anomalous behavior.

Layer 10: Lifecycle Governance (DCP-05)
  Signed lifecycle records and a state machine, where the signatures are verified.

Layer 11: Succession Security (DCP-06)
  Signed testaments and classified memory transfers protect succession integrity.

Layer 12: Dispute Resolution (DCP-07)
  Structured escalation prevents unresolved conflicts from compromising operations.

Layer 13: Rights Enforcement (DCP-08)
  Declared rights and obligations create verifiable compliance boundaries.

Layer 14: Delegation Control (DCP-09)
  Scoped mandates and awareness thresholds prevent authority escalation.
```

For NIST post-quantum compliance details, see [NIST_CONFORMITY.md](NIST_CONFORMITY.md).
For migration from V1.0 security model, see [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md).

---

## Operational Security Requirements

### Private Key Storage

| Security Tier | Requirement |
|---|---|
| **Routine** | Key files with 0600 permissions, encrypted at rest (OS-level) |
| **Standard** | Passphrase-encrypted keystore (PKCS#8 or similar) |
| **Elevated** | HSM/TPM integration (SHOULD). OS keychain integration |
| **Maximum** | HSM/TPM integration (MUST). Air-gapped ceremony for key generation |

This repository has no HSM/TPM integration: the `HsmCryptoProvider` in the TypeScript source is a simulated pattern that must not be used for real evidence ([NIST_CONFORMITY.md](NIST_CONFORMITY.md) §2.2). The elevated and maximum rows need an integration of your own.

The reference CLI (`bin/dcp.js`) and the Python SDK's CLI write secret key files with mode `0600` (owner read and write, no permissions for group or others). The interactive `@dcp-ai/cli init` does not: it writes them with default permissions (`0644` with the usual umask `022`), so run `chmod 600 .dcp/keys/*_secret.key`. Operators MUST NOT relax these permissions.

### Revocation Propagation SLAs

| Security Tier | Maximum Acceptable Latency |
|---|---|
| **Routine** | 24 hours |
| **Standard** | 1 hour |
| **Elevated** | 15 minutes |
| **Maximum** | Immediate (push notification + OCSP-like stapling) |

These are targets for operators. The repository has no push notification or stapling; the closest is the strict-v1 admission profile, which requires a revocation snapshot at most 300 seconds old. Operators SHOULD configure revocation list cache TTL according to the highest tier they serve, and fail closed when the list cannot be fetched.

### API Security

All production deployments MUST:
- Enforce TLS 1.3 (minimum TLS 1.2)
- Require authentication on all mutating endpoints (Bearer token or API key)
- Configure rate limiting per the `x-ratelimit` specifications in `openapi.yaml`
- Set security headers: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- Restrict CORS to trusted origins only
- Use `Cache-Control: no-store` for verification responses

### V1 to V2 Downgrade Prevention

When an agent has V2 keys registered, verifiers SHOULD reject V1 bundles from that agent (capability pinning). The `allow_v1_bundles` policy flag defaults to `true` during migration but SHOULD be set to `false` once migration is complete.

### Supply Chain Security

Operators deploying DCP MUST:
- Pin all cryptographic library versions in lock files
- Verify integrity of dependencies using SRI hashes
- Monitor for compromises in upstream libraries (`@noble/post-quantum`, `tweetnacl`, etc.)
- Use reproducible builds for cryptographic components

---

## Known Limitations and Mitigations

| Limitation | Mitigation |
|---|---|
| Self-declared identity at `routine` tier | Require attestation, or admission against a trust set, for `standard`+ tiers; the verifiers do not enforce it by themselves |
| Verification cache may serve stale results | Cache MUST be invalidated on revocation list updates. The TypeScript `VerificationCache` is keyed only by the bundle hash and its `invalidateByAgent` does nothing, so clear it or do not cache across trust or revocation changes ([API_REFERENCE.md](API_REFERENCE.md)) |
| The published V2 verifiers do not check the optional secondary audit chain or secondary Merkle root; in the unreleased source code the present fields are checked, absent ones are not required | With the published packages, rely only on the checks actually performed: primary SHA-256 commitments and signatures, and do not claim the additional protection specified in V2-11 from a successful result. In the unreleased source code, a successful result covers the secondary fields that are present, not a complete secondary chain; the experimental candidate reuses these checks ([STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)) |
| `agent_id` persistence enables tracking | Consider pseudonym rotation for high-privacy scenarios |
| BlindedRPR exposes `entity_type` and `jurisdiction` | Future: ZKP-based credential presentation |
| No SDK runs the X25519 + ML-KEM-768 exchange of DCP-04 | The caller derives the A2A session key. Python, Go, Rust and WASM expose ML-KEM-768 as a primitive; the TypeScript KEM providers are internal |
| ML-DSA-87 is not implemented | The identifier is reserved in the key schema; no SDK can use it, and the simulated HSM pattern that lists it is not an implementation |
| The reference server's DCP-05–09 endpoints have no authentication and do not verify signatures | Do not expose them to untrusted clients ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)) |

The following limitations that appeared in earlier drafts have been **closed**:

- *PQ crypto in CLI was simulated (HMAC placeholder)* — resolved: the reference CLI (`bin/dcp.js`) now uses real ML-DSA-65 via `@noble/post-quantum` for key generation and signing.
- *Shamir SSS in CLI was placeholder (random shares)* — resolved: the CLI uses `secrets.js-grempe`, a proper Shamir Secret Sharing library, for key recovery operations.
- *DCP-04..09 behavior was TypeScript-only* — resolved in 2.2.0..2.7.0: lifecycle, succession, dispute resolution, arbitration, rights & obligations, delegation, awareness threshold and principal mirror are available across Python, Rust, and Go with the same semantics as the TypeScript reference. The A2A handshake messages and AES-256-GCM session layer are in Python and Go; Rust covers discovery, handshake messages and session IDs. See [CHANGELOG.md](../CHANGELOG.md#210---2026-04-22) for the release-by-release breakdown.
- *Canonical error taxonomy was TS-only* — resolved in 2.7.0: 38 `DcpErrorCode` values with stable `DCP-E###` identifiers are now aligned across TypeScript, Python, Rust, and Go so cross-SDK error handling matches on a single string.
- *Python CLI `keygen` wrote the secret key with default file mode* — resolved: `sdks/python/dcp_ai/cli.py` now creates `secret_key.txt` atomically with mode 0600 from the `os.open` call itself (no chmod race window) and sets the containing directory to mode 0700.

---

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Protocol fingerprints: [protocol_fingerprints.json](../protocol_fingerprints.json)
- DCP-01 (attestation): [spec/DCP-01.md](../spec/DCP-01.md)
- Storage, anchoring, revocation: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Technical architecture: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
