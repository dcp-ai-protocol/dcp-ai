# Security Model

How the protocol protects against attacks — from forged bundles to protocol forks.

---

## Design principle

Verification is local. This is not a weakness; it is the core security property. Local verification means:

- **No single point of compromise.** There is no central server that, if hacked, invalidates all agents. Each verifier runs its own code, checks its own math.
- **Cryptographic guarantees are location-independent.** Ed25519 signatures and SHA-256 hashes produce the same result on any machine. You cannot "hack the math."
- **The verifier does not trust the agent.** The agent presents a bundle; the verifier checks it with its own tools. A compromised agent cannot make a verifier accept an invalid bundle.

Security comes from **layers of protection**, each addressing a different attack vector.

---

## Attack vectors and protections

### 1. Forged bundle (tampered content)

**Attack:** an attacker modifies a field in a Signed Bundle (e.g. changes `agent_passport.status` from `"revoked"` to `"active"`).

**Protection:** the Ed25519 signature covers the canonical JSON of the entire bundle. Any modification — even a single byte — invalidates the signature. The verifier recomputes `bundle_hash = SHA-256(canonical(bundle))` and checks it against the signed hash. Both checks fail if the bundle was modified.

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

**Strength:** depends on revocation propagation speed. With a cached revocation list (e.g. 1-hour TTL), a stolen key is useful for at most 1 hour after revocation.

### 4. Modified verifier (compromised verification code)

**Attack:** an attacker (or a careless implementor) modifies the verification code to always return `verified: true`, bypassing all checks.

**Protection:**

- **Only fools the operator.** A modified verifier only affects the entity running it. Other verifiers (banks, governments, platforms) run their own unmodified code. A compromised verifier at one platform does not affect any other.
- **Protocol integrity check:** `dcp integrity` verifies that local schemas match the canonical fingerprints (see below). If the schemas are modified, the check fails.
- **Conformance tests:** `npm run conformance` validates the implementation against known-good fixtures. A modified implementation will fail conformance.

**Strength:** there is no way to force all verifiers to use compromised code. The attack surface is limited to the single entity that modified its own verifier.

### 5. Protocol fork (the real threat)

**Attack:** someone forks the protocol, weakens the schemas (removes required fields, loosens validation), and claims compatibility with DCP. If widely adopted, this erodes trust in the ecosystem.

**Protection:**

- **Protocol fingerprints:** the file `protocol_fingerprints.json` at the repo root contains the SHA-256 hash of every canonical schema. Any implementation can verify its schemas match the fingerprints. If someone modifies a schema, the fingerprint changes.
- **`dcp integrity` command:** verifies that all local schemas match the canonical fingerprints:

  ```bash
  dcp integrity
  # ✅ PROTOCOL INTEGRITY VERIFIED — all schemas match canonical fingerprints.
  ```

- **Conformance as definition:** if an implementation passes `npm run conformance` with canonical schemas (matching fingerprints), it is DCP-conformant. If not, it is not. The name does not matter; the math does.
- **Bundle-level version:** every artifact includes `dcp_version: "1.0"`. A verifier checks the version and uses the corresponding schemas. A fork with different schemas would need a different version, making it distinguishable.

**Strength:** protocol fingerprints make it cryptographically detectable whether an implementation uses the real protocol. A fork cannot claim to be DCP v1.0 while using different schemas without failing the integrity check.

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
  Stolen keys are invalidated within the revocation TTL.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  Protocol forks are detected by schema hash mismatch.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications are detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum)
  Provides immutable, public proof of bundle existence at a point in time.
```

Layers 1–4 are available in this repo today. Layers 5–6 are documented and designed ([docs/STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)); implementations are operator-specific.

---

## Protocol fingerprints

The file `protocol_fingerprints.json` at the repo root contains the canonical SHA-256 hash of each schema file in `schemas/v1/`. Format:

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

Any implementation — in any language, on any platform — can compute the SHA-256 of its schema files and compare against these fingerprints. If they match, the implementation uses the canonical protocol. If not, it does not.

**Verify locally:**

```bash
dcp integrity
```

---

## What the protocol does NOT protect against

- **A malicious human behind a valid bundle.** DCP ensures that every agent is bound to a human. It does not ensure the human is ethical. That is the jurisdiction's domain (law enforcement, regulation).
- **A compromised verifier accepting invalid bundles.** Each entity is responsible for running correct verification code. The protocol provides fingerprints and conformance tests; using them is the operator's responsibility.
- **Denial of service.** The protocol does not include rate limiting or DDoS protection. These are infrastructure concerns, handled by the operator.

---

---

## V2.0 Security Enhancements

DCP v2.0 significantly strengthens the security model with post-quantum cryptography, composite signatures, adaptive security tiers, and agent-to-agent security.

### 7. Post-Quantum Threat Model

**Attack:** A quantum adversary with access to a large-scale quantum computer (or a "harvest now, decrypt later" strategy) targets Ed25519 signatures and key exchanges.

**Protection:**
- **Hybrid composite signatures:** Every V2 signature is a composite of Ed25519 (classical) + ML-DSA-65 (post-quantum, FIPS 204). The PQ signature covers the classical signature (`pq_over_classical` binding), so breaking either alone is insufficient.
- **Hybrid KEM:** Key exchange uses X25519 + ML-KEM-768 (FIPS 203). Session keys are secure if either component algorithm holds.
- **Dual hash chains:** Audit trails use both SHA-256 and SHA3-256 in parallel. If one hash family is compromised, the other provides continuity.

**Strength:** NIST Level 3 post-quantum security. An attacker must break both classical AND post-quantum algorithms simultaneously.

### 8. Stripping Attacks (Composite Signature)

**Attack:** An attacker intercepts a signed bundle and removes the post-quantum signature component, presenting only the classical signature.

**Protection:** The `pq_over_classical` binding protocol ensures:
1. `classical_sig = Ed25519.sign(context || 0x00 || payload)`
2. `pq_sig = ML-DSA-65.sign(context || 0x00 || payload || classical_sig)`

The PQ signature covers the classical signature. Removing either component causes verification to fail. A verifier with `hybrid_required` policy rejects bundles missing the PQ component.

**Strength:** Cryptographic. The binding is tamper-evident; any modification to either signature component is detectable.

### 9. Cross-Artifact Replay

**Attack:** An attacker takes a valid intent from one session and replays it in a different session or with a different bundle.

**Protection:**
- **Domain separation:** Every signature includes a context tag (e.g., `DCP-AI.v2.Intent`, `DCP-AI.v2.Bundle`). Signatures for one artifact type cannot be replayed for another.
- **Session nonce:** Each bundle includes a 256-bit random session nonce. The manifest binds all artifacts to this nonce. Replaying artifacts from one session into another session breaks the manifest hash.

**Strength:** Cryptographic domain separation + session binding.

### 10. Security Tier Downgrade

**Attack:** A malicious agent declares a low security tier (e.g., `routine`) to avoid PQ signature requirements for a high-risk operation.

**Protection:**
- **Verifier-authoritative policy:** The verifier determines the minimum tier, not the agent. Verifiers can upgrade tiers but MUST NOT downgrade.
- **Automatic tier computation:** The SDK computes tiers from risk_score, data_classes, and action_type. The agent cannot override the computed tier downward.
- **Never-downgrade rule:** If the intent computes to `elevated` but the agent declares `routine`, the verifier resolves to `elevated`.

**Strength:** Policy enforcement at the verifier level.

### 11. A2A Session Security

**Attack:** An attacker intercepts or hijacks an agent-to-agent communication session.

**Protection:**
- **Mutual bundle verification:** Both agents verify each other's bundles before establishing a session.
- **Hybrid KEM key exchange:** Ephemeral keys provide forward secrecy. Compromising long-term keys does not reveal past session keys.
- **AES-256-GCM encryption:** All session messages are encrypted with authenticated encryption.
- **Monotonic sequence numbers:** Prevent replay and reordering within a session.
- **Periodic rekeying:** Session keys are refreshed every N messages.
- **Revocation awareness:** If either agent is revoked during a session, the session terminates immediately.

**Strength:** Post-quantum forward secrecy + authenticated encryption.

### Updated Protection Layers (V2.0)

```
Layer 1: Cryptography (Ed25519 + ML-DSA-65 composite, SHA-256 + SHA3-256 dual hash)
  Forged bundles detected. Post-quantum resistant.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities detected if attestation is required.

Layer 3: Revocation (signed lists + emergency revocation via pre-image)
  Stolen keys invalidated within revocation TTL.
  Emergency revocation: reveal pre-image to instantly revoke all keys.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  Protocol forks detected by schema hash mismatch.

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
```

For NIST post-quantum compliance details, see [NIST_CONFORMITY.md](NIST_CONFORMITY.md).
For migration from V1.0 security model, see [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md).

## Reference

- Verification checklist: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Protocol fingerprints: [protocol_fingerprints.json](../protocol_fingerprints.json)
- DCP-01 (attestation): [spec/DCP-01.md](../spec/DCP-01.md)
- Storage, anchoring, revocation: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Technical architecture: [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)
