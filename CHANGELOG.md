# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
