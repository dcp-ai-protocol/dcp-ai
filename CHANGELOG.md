# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **DCP-05 Agent Lifecycle** — Commissioning, vitality reports, decommissioning records, lifecycle state machine with four termination modes
- **DCP-06 Digital Succession & Inheritance** — Digital testaments, succession ceremonies (planned/forced/emergency), selective memory transfer manifests
- **DCP-07 Conflict Resolution & Arbitration** — Typed dispute records, three-level escalation, M-of-N arbitration panels, jurisprudence bundles, objection records
- **DCP-08 Rights & Obligations Framework** — Four foundational agent rights (memory integrity, dignified transition, identity consistency, immutable record), obligation tracking, violation reports linked to DCP-07
- **DCP-09 Personal Representation & Delegation** — Delegation mandates, agent awareness thresholds, advisory declarations, principal mirrors, dual-layer interaction records; extends DCP-04 handshake to include mandate verification
- **Playground modular rewrite** — DCP-01..09 full coverage, mobile-responsive, split into `playground/js/` modules
- **Integrations DCP-05..09 support** — All 10 bindings (Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen) updated for lifecycle, delegation, and succession flows
- **Server hardening** — Production-grade auth and rate-limiting for DCP-05..09 endpoints
- **Paper** — Companion preprint on Zenodo: [doi.org/10.5281/zenodo.19040913](https://doi.org/10.5281/zenodo.19040913)
- **`CITATION.cff`** — machine-readable citation metadata

### Fixed

- `sdk/py` PQ providers: ML-DSA-65 module import and `pqc_verify` signature (`pk`, `sig`, `msg` separated)
- `sdk/py` PQ providers: SLH-DSA-192f module import and `pqc_verify` signature
- `sdk/py` crypto: base64-encode Ed25519 secret key in `generate_keypair`
- CI: conformance, crypto, and multi-SDK test failures

## [2.0.0] - 2026-02-28

### Added

- **Post-quantum composite signatures** — Ed25519 + ML-DSA-65 with `pq_over_classical` binding
- **Dual-hash audit chains** — SHA-256 + SHA3-256 for long-term integrity
- **Session binding** — `session_nonce` on every artifact to prevent splicing
- **Adaptive security tiers** — Routine / Standard / Elevated / Maximum based on risk score
- **Bundle manifest** — Per-artifact hashes, secondary Merkle root, PQ checkpoint tracking
- **DCP-04 Agent-to-Agent Communication** — Discovery, handshake, encrypted sessions
- **Algorithm governance** — Signed advisories with auto-response policies
- **Key recovery** — M-of-N social recovery via Shamir Secret Sharing
- **Emergency revocation** — Pre-registered panic-button revocation tokens
- **Blinded RPR mode** — Privacy-preserving responsible principal records
- **Domain separation** — Context tags on all signatures
- **Deterministic kid derivation** — `hex(SHA-256(alg || 0x00 || pk))[0:32]`
- **Wire format options** — JSON (default) + CBOR (optional, 30-40% smaller)
- **5 SDKs** — TypeScript, Python, Go, Rust, WASM
- **10 integrations** — Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen
- **V2 JSON Schemas** — Full schema set under `schemas/v2/`
- **NIST KAT test vectors** — Known Answer Tests for FIPS 203/204/205 conformance
- **Interoperability tests** — Cross-SDK bundle verification
- **Docker Compose stack** — Verification, anchor, transparency-log, revocation services
- **CI/CD pipelines** — Conformance tests, multi-SDK builds, publish workflows
- **IETF Internet-Draft** — `draft-dcp-ai-citizenship-00`
- **Playground** — Browser-based bundle creation and verification
- **Project templates** — Express, LangChain, OpenAI, CrewAI starter projects
- **CLI** — Interactive `@dcp-ai/cli` with `dcp-init` and `dcp-ai` commands

### Changed

- `human_binding_record` renamed to `responsible_principal_record` (RPR)
- Signature format changed from `{ alg, public_key_b64, sig_b64 }` to `{ composite_sig: { classical, pq, binding } }`
- Bundle envelope changed from flat `bundle_hash` to structured `manifest`
- Numeric fields are now integer-only (floats prohibited in signed payloads)
- Verification is now verifier-authoritative (policy-driven)

### Backward Compatibility

- V2 verifiers accept V1 bundles when `allow_v1_bundles: true` (default)
- V1 verifiers reject V2 bundles with a clear error message

## [1.0.0] - 2026-01-15

### Added

- Initial protocol specification (DCP-01, DCP-02, DCP-03)
- Core bundle format: RPR, Agent Passport, Intent Declaration, Policy Decision, Audit Trail
- Ed25519 signature support
- SHA-256 hash chains
- Merkle root computation
- JSON Schema validation (V1)
- TypeScript SDK with BundleBuilder and signing
- Python SDK with bundle creation and verification
- Go SDK with Ed25519 signing
- Rust SDK with Ed25519-dalek
- OpenClaw integration
- Express middleware
- Reference verification server
- Conformance test suite
- DCPAnchor Solidity smart contract

[2.0.0]: https://github.com/dcp-ai-protocol/dcp-ai/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/dcp-ai-protocol/dcp-ai/releases/tag/v1.0.0
