# DCP-AI Playground

Interactive browser-based demonstration of the Digital Citizenship Protocol (DCP-01 through DCP-09).

## Quick Start

```bash
cd playground
python3 -m http.server 8080
# Open http://localhost:8080
```

ES modules require an HTTP server — `file://` will not work.

## Architecture

The playground is a modular, no-build-step application using ES modules (`<script type="module">`).

```
playground/
  index.html                    # Shell: CDN scripts, CSS, navigation, containers (~585 lines)
  js/
    core/
      crypto.js                 # Ed25519 keygen, signing, verification, kid
      hash.js                   # SHA-256 (Web Crypto), canonicalize (JCS), Merkle root
      state.js                  # Central state (keypairs, agents, session)
      signature.js              # Composite signature builder (classical + PQ simulated)
      utils.js                  # uuid, sessionNonce (64-char hex), isoNow, hex/b64 encode/decode
    ui/
      tabs.js                   # Two-level tab navigation (group bar + tab bar)
      json-render.js            # Syntax highlighting, JSON display, copy
      forms.js                  # Form helpers, cards, notifications
      visualizations.js         # State machine, escalation flow, delegation chain, rights matrix (SVG)
    tabs/
      identity.js               # Tab 1: Identity Generator (DCP-01)
      builder.js                # Tab 2: Bundle Builder (DCP-01/02/03)
      verifier.js               # Tab 3: Bundle Verifier
      tiers.js                  # Tab 4: Tier Comparison
      explorer.js               # Tab 5: Protocol Explorer (DCP-01 through DCP-09)
      lifecycle.js              # Tab 6: Lifecycle Management (DCP-05)
      succession.js             # Tab 7: Succession & Inheritance (DCP-06)
      disputes.js               # Tab 8: Dispute Resolution (DCP-07)
      rights.js                 # Tab 9: Rights & Obligations (DCP-08)
      delegation.js             # Tab 10: Delegation & Representation (DCP-09)
      workflows.js              # Tab 11: Cross-Spec Workflows
```

17 JS modules. ~3,200 lines total.

## Navigation

Two-level navigation:

| Group | Tabs |
|-------|------|
| **Core Protocol** | Identity, Bundle Builder, Verifier, Tiers, Explorer |
| **Lifecycle** | Agent Lifecycle (DCP-05), Succession (DCP-06) |
| **Governance** | Disputes (DCP-07), Rights (DCP-08), Delegation (DCP-09) |
| **Workflows** | Cross-Spec Flows |

## Spec Coverage

| Spec | Features Demonstrated |
|------|----------------------|
| DCP-01 | RPR, Agent Passport, Ed25519 keypair generation |
| DCP-02 | Intent declarations, risk scoring, security tier selection |
| DCP-03 | Policy decisions, audit entries, hash-chained audit trail, bundle manifest, Merkle root |
| DCP-05 | State machine (commissioned/active/declining/decommissioned), vitality reports, commissioning certificates, decommissioning records |
| DCP-06 | Digital testaments, memory classification, memory transfer manifests, succession ceremonies |
| DCP-07 | Dispute records, three-level escalation, arbitration resolutions, jurisprudence bundles, objection records |
| DCP-08 | Rights declarations, obligation records, violation reports, rights matrix, auto-dispute filing |
| DCP-09 | Delegation mandates, awareness thresholds, advisory declarations, principal mirrors, delegation chain visualization |

## Cross-Spec Workflows

4 guided workflows for NIST/IEEE reviewers:

1. **Full Agent Lifecycle** (DCP-01 + 05 + 06): Identity creation through succession
2. **Delegated Action with Dispute** (DCP-01 + 09 + 02 + 07): Delegation through dispute resolution
3. **Rights Violation Escalation** (DCP-08 + 07 + 05): Violation detection through lifecycle impact
4. **Principal Oversight** (DCP-09 + 02 + 03): Threshold configuration through oversight reporting

## How It Works

All cryptographic operations run **entirely in the browser**:

- **Ed25519 signatures** via [tweetnacl](https://github.com/nickolai/nickel-nacl) loaded from CDN
- **SHA-256 hashing** via the Web Crypto API (`crypto.subtle.digest`)
- **Key IDs (kid)** derived per spec: `hex(SHA-256(UTF8(alg) || 0x00 || pubkey_bytes))[0:32]`
- **Domain separation** applied to all signatures: `UTF8(context_tag) || 0x00 || canonical_payload`
- **JCS canonicalization** (sorted keys) for deterministic hashing
- **Composite signatures**: `{ classical, pq, binding }` format per `composite_signature.schema.json`
- **Session nonces**: 64-char hex (`crypto.getRandomValues(32)`)

## Key Corrections from Previous Playground

- `session_nonce`: Changed from UUID to 64-char hex (per schema `^[0-9a-f]{64}$`)
- `composite_sig`: Changed from `{ entries[] }` to `{ classical, pq, binding }` (v2 schema format)
- All generated artifacts include `_spec_ref` with spec section reference
- Protocol Explorer expanded to cover DCP-01 through DCP-09

## Limitations

- **Post-quantum signatures are simulated**: ML-DSA-65 uses HMAC-based placeholder. Ed25519 is real. For production PQ crypto, use the WASM SDK (`sdks/wasm/`).
- Merkle root computation uses simplified concatenation
- No CBOR wire format (JSON only)
- Signature verification limited to Ed25519 keys in the bundle's passport
- Session binding across tabs uses shared state (not persisted to storage)

## Dependencies

- `tweetnacl@1.0.3` + `tweetnacl-util@0.15.1` (CDN)
- Web Crypto API (native)
- No framework, no build step
