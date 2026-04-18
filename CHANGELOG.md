# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] - 2026-04-18

First public package release. Published simultaneously to npm (`@dcp-ai/sdk`, `@dcp-ai/cli`, `@dcp-ai/wasm`), PyPI (`dcp-ai`), and crates.io (`dcp-ai`).

### Added

**Protocol stack (DCP-01 through DCP-09)**

- **DCP-01** Identity & Human Binding — agent identity, operator attestation, key binding
- **DCP-02** Intent Declaration & Policy Gating — declared intents, tier enforcement, policy evaluation
- **DCP-03** Audit Chain & Transparency — hash-chained audit entries, Merkle proofs, transparency logs
- **DCP-04** Agent-to-Agent Communication — discovery, handshake, encrypted sessions
- **DCP-05** Agent Lifecycle — commissioning, vitality reports, decommissioning records, state machine with four termination modes
- **DCP-06** Digital Succession & Inheritance — digital testaments, succession ceremonies (planned/forced/emergency), selective memory transfer manifests
- **DCP-07** Conflict Resolution & Arbitration — typed dispute records, three-level escalation, M-of-N arbitration panels, jurisprudence bundles, objection records
- **DCP-08** Rights & Obligations Framework — four agent rights (memory integrity, dignified transition, identity consistency, immutable record), obligation tracking, violation reports linked to DCP-07
- **DCP-09** Personal Representation & Delegation — delegation mandates, awareness thresholds, advisory declarations, principal mirrors, dual-layer interaction records; extends DCP-04 handshake with mandate verification

**Cryptography (4-tier: Routine / Standard / Elevated / Maximum)**

- Post-quantum composite signatures — Ed25519 + ML-DSA-65 with `pq_over_classical` binding
- SLH-DSA-192f (FIPS 205) as hash-based backup signature
- Dual-hash audit chains — SHA-256 + SHA3-256 for long-term integrity
- Session binding — `session_nonce` on every artifact to prevent splicing
- Bundle manifest — per-artifact hashes, secondary Merkle root, PQ checkpoint tracking
- Algorithm governance — signed advisories with auto-response policies
- Key recovery — M-of-N social recovery via Shamir Secret Sharing
- Emergency revocation — pre-registered panic-button revocation tokens
- Blinded RPR mode — privacy-preserving responsible principal records
- Domain separation — context tags on all signatures
- Deterministic kid derivation — `hex(SHA-256(alg || 0x00 || pk))[0:32]`
- Wire format options — JSON (default) + CBOR (optional, 30–40% smaller)

**SDKs, integrations, and tooling**

- 5 SDKs — TypeScript, Python, Go, Rust, WASM
- 10 integrations — Express, FastAPI, LangChain, OpenAI, CrewAI, OpenClaw, W3C DID, Google A2A, Anthropic MCP, AutoGen (DCP-01..09 coverage)
- V2 JSON Schemas — full schema set under `schemas/v2/`
- NIST KAT test vectors — Known Answer Tests for FIPS 203/204/205 conformance
- Interoperability tests — cross-SDK bundle verification
- Docker Compose stack — verification, anchor, transparency-log, revocation services
- CI/CD pipelines — conformance tests, multi-SDK builds, publish workflows
- Playground — browser-based bundle creation and verification with modular DCP-01..09 tabs, mobile-responsive
- Project templates — Express, LangChain, OpenAI, CrewAI starter projects
- CLI — interactive `@dcp-ai/cli` with `dcp-init` and `dcp-ai` commands
- Server hardening — production-grade auth and rate-limiting for DCP-05..09 endpoints

**Documentation & citation**

- Companion paper on Zenodo: [doi.org/10.5281/zenodo.19040913](https://doi.org/10.5281/zenodo.19040913)
- `CITATION.cff` — machine-readable citation metadata

### Changed

- `human_binding_record` renamed to `responsible_principal_record` (RPR)
- Signature format changed from `{ alg, public_key_b64, sig_b64 }` to `{ composite_sig: { classical, pq, binding } }`
- Bundle envelope changed from flat `bundle_hash` to structured `manifest`
- Numeric fields are now integer-only (floats prohibited in signed payloads)
- Verification is now verifier-authoritative (policy-driven)

### Fixed

- `sdk/py` PQ providers: ML-DSA-65 module import and `pqc_verify` signature (`pk`, `sig`, `msg` separated)
- `sdk/py` PQ providers: SLH-DSA-192f module import and `pqc_verify` signature
- `sdk/py` PQ providers: capture return value of `pqc_verify` (was always returning True because `pqcrypto.verify` returns bool instead of raising)
- `sdk/py` crypto: base64-encode Ed25519 secret key in `generate_keypair`
- CI: conformance, crypto, and multi-SDK test failures

### Backward Compatibility

- V2 verifiers accept V1 bundles when `allow_v1_bundles: true` (default)
- V1 verifiers reject V2 bundles with a clear error message

---

## Pre-release milestones

The following dates mark the evolution of the specification prior to the first package release. No packages were published at these points.

- **2026-01-15** — Genesis spec frozen (DCP-01, DCP-02, DCP-03)
- **2026-02-28** — V2.0 normative specification finalized (post-quantum hybrid crypto, 4-tier security model, DCP-04 A2A)
- **2026-03-16** — Paper preprint on Zenodo
- **2026-04-15** — DCP-05..09 constitutional framework merged to `main`
- **2026-04-18** — v2.0.0 released to npm, PyPI, and crates.io

[2.0.0]: https://github.com/dcp-ai-protocol/dcp-ai/releases/tag/v2.0.0
