# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.2.0] - 2026-04-23

### Added — Lifecycle + Succession parity across SDKs

Python, Rust, and Go SDKs now implement DCP-05 (Agent Lifecycle) and DCP-06
(Digital Succession) behavior. TypeScript already shipped these in 2.0.x; the
2.2.0 release closes the first behavioral-parity gap identified in the
cross-SDK crosswalk.

**New functions (identical semantics across Python/Rust/Go, matching TS):**

DCP-05 Agent Lifecycle:
- `validate_state_transition` / `ValidateStateTransition`
- `compute_vitality_score` / `ComputeVitalityScore`
- `create_commissioning_certificate` / `CreateCommissioningCertificate`
- `create_vitality_report` / `CreateVitalityReport`
- `hash_vitality_report` / `HashVitalityReport`
- `create_decommissioning_record` / `CreateDecommissioningRecord`

DCP-06 Digital Succession:
- `create_digital_testament` / `CreateDigitalTestament`
- `update_digital_testament` / `UpdateDigitalTestament`
- `classify_memory` / `ClassifyMemory`
- `create_memory_transfer_manifest` / `CreateMemoryTransferManifest`
- `execute_succession` / `ExecuteSuccession`

All new factories use the existing composite-sign path under the
`DCP-AI.v2.Lifecycle` and `DCP-AI.v2.Succession` domain-separation contexts,
so artifacts produced by any SDK are wire-compatible and cross-verifiable.

### Test counts after this release

- Python: 169/169 pass (+24 new)
- Rust: 104/104 pass (+10 new)
- Go: 60/60 pass (+13 new across outer `dcp` package; v2 package unchanged)
- TypeScript: 460/460 pass (no changes)

### Known protocol-level note

DCP v2.0 canonicalisation forbids floats for cross-SDK determinism, but
the vitality-report schema expresses per-metric values as `number`
(0.0..1.0). Factories in all four SDKs now accept metrics at the API
boundary but signers require integer representations on the wire. This
is documented in each SDK's tests. A future release may tighten the
schema to integers (or basis-points) to eliminate the gap entirely.

### Versions bumped

- `dcp-ai` (PyPI) 2.1.0 -> 2.2.0
- `dcp-ai` (crates.io) 2.1.0 -> 2.2.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.2.0
- `@dcp-ai/sdk` (npm) stays at 2.1.0 (TS already had these functions)

## [2.1.0] - 2026-04-22

### Added

**OpenTelemetry (OTLP) exporter for all four core SDKs** — TypeScript, Python, **Rust, and Go**. Adopters can now pipe DCP observability into any OTel-compatible backend (Grafana, Jaeger, Honeycomb, Datadog, New Relic, self-hosted Collectors) without hand-rolled bridges. Every SDK that performs DCP cryptography now reports the same metric names, counters, and span shapes.

- **Rust (`dcp-ai` 2.0.0 → 2.1.0)**
    - New `dcp_ai::observability` module with thread-safe `DcpTelemetry` singleton, recorder methods, span lifecycle, `on_event` listener bus, and `MetricsSummary` with p50/p95/p99.
    - Optional `otlp` Cargo feature (`cargo add dcp-ai --features otlp`) pulls `opentelemetry`, `opentelemetry_sdk`, `opentelemetry-otlp`, and `tokio`. Without the feature, requesting `ExporterType::Otlp` surfaces a clear error event instead of panicking.
    - Hot paths instrumented: `crypto::sign_object` and `crypto::verify_object` emit latency + error telemetry when enabled. Zero overhead when disabled (default).
    - 10 unit tests covering disabled-by-default behavior, percentiles, span lifecycle, tier distribution, cache hit rate, and listener panic isolation.

- **Go (`sdks/go/v2.0.0 → v2.1.0`)**
    - New `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability` package with mutex-protected `Telemetry` type, `Default()` singleton, recorder methods, subscribers with panic recovery, percentile math matching the other SDKs.
    - OTLP bridge gated by the `otlp` build tag (`go build -tags otlp`). Without the tag, requesting `ExporterOTLP` emits a clear `otlp_init` error event via the listener bus. The `go.opentelemetry.io/otel` dependencies are listed in `go.mod` but are not required at runtime by default builds.
    - Hot paths instrumented: `dcp.SignObject` and `dcp.VerifyObject` emit latency + error telemetry when enabled. Zero overhead when disabled (default).
    - 10 unit tests for the observability package + 2 integration tests against `dcp.SignObject` covering the enabled/disabled paths.

- **TypeScript (`@dcp-ai/sdk` 2.0.0 → 2.1.0)**
    - `dcpTelemetry.init({ exporterType: 'otlp' })` now actually works (the config field was declared in 2.0.x but not wired).
    - OTel SDK is imported **lazily** — default installs are unchanged. The `@opentelemetry/*` packages are declared as optional peer dependencies; when omitted, `init()` emits a clear error event via the listener bus and the app keeps running.
    - New `dcpTelemetry.shutdown()` to flush pending exports.
    - Endpoint resolution: `otlpEndpoint` config → `OTEL_EXPORTER_OTLP_ENDPOINT` env var → `http://localhost:4318`.
    - `service.name` + `service.version` resource attributes auto-populated.
    - Metric mapping: DCP recorders map to OTel histograms (`dcp.sign.latency_ms`, `dcp.verify.latency_ms`, `dcp.kem.latency_ms`, `dcp.checkpoint.latency_ms`, `dcp.bundle_verify.latency_ms`) and counters (`dcp.signatures.created`, `dcp.signatures.verified`, `dcp.bundles.verified`, `dcp.a2a.sessions`, `dcp.errors`).
    - 2 new vitest cases; 460/460 tests pass.

- **Python (`dcp-ai` 2.0.2 → 2.1.0)**
    - New `dcp_ai.observability` module providing `dcp_telemetry` singleton with the same API surface as the TypeScript version: spans, metric recorders (`record_sign_latency`, `record_verify_latency`, `record_kem_latency`, `record_checkpoint_latency`, `record_bundle_verify`, `record_cache_hit/miss`, `record_a2a_*`, `record_error`), `on_event` listener bus, `get_metrics_summary` with p50/p95/p99.
    - Exporter modes: `none` (default) / `console` / `otlp`.
    - New install extra: `pip install 'dcp-ai[otlp]'` pulls `opentelemetry-sdk` + `opentelemetry-exporter-otlp-proto-http`. Without the extra, `init(exporter_type="otlp")` surfaces a clear install hint without crashing.
    - Hot paths instrumented: `sign_object` and `verify_object` now emit latency + error telemetry when enabled. No overhead when disabled (default).
    - Public export: `from dcp_ai import dcp_telemetry` works.
    - 15 new pytest cases; 145/145 tests pass.

### Documentation

- New `docs/OBSERVABILITY.md` with three copy-paste backend recipes (local Jaeger via Docker, Grafana Cloud OTLP endpoint, Honeycomb).

### Backward compatibility

- Fully backward compatible across all four SDKs. Defaults unchanged — telemetry ships disabled, recorders are no-ops. No code changes needed for adopters who don't want observability.
- Synchronized semver: `@dcp-ai/sdk` (npm), `dcp-ai` (PyPI), `dcp-ai` (crates.io), and `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` all move to 2.1.0. Other publishable packages (CLI, WASM, integrations, create-* scaffolders) remain at their current versions.
- WASM SDK observability is deferred to a future minor; browser telemetry has different transport requirements.

## Template packages - 2026-04-21

First publication of four `npm create @dcp-ai/*` scaffolders, all at `v2.0.0`:

- `@dcp-ai/create-langchain`
- `@dcp-ai/create-crewai`
- `@dcp-ai/create-openai`
- `@dcp-ai/create-express`

Usage: `npm create @dcp-ai/langchain my-app` (or any of the four). Each scaffolder ships a self-contained starter template — same content as the existing `templates/<name>/` in the repo — plus a tiny 35-line `bin.js` with zero runtime dependencies.

## Infrastructure

- **JSON-LD context** now served at [`https://dcp-ai.org/credentials/v2`](https://dcp-ai.org/credentials/v2) (Content-Type `application/ld+json`, CORS `*`, 24 h cache). Required by `@dcp-ai/w3c-did` so every emitted Verifiable Credential/Presentation is dereferenceable by strict JSON-LD processors (Veramo, SpruceID, Trinsic).
- **Codecov coverage reports** aggregated across the four SDKs (TypeScript, Python, Go, Rust) with per-SDK flags. Badge live in the README.
- **Publish workflows hardened**: every job (npm / PyPI / crates.io) now pre-checks the registry and exits green with a skip notice if the manifest version is already live. No more red jobs on routine releases.

## Go SDK v2.0.0 - 2026-04-19

First installable release of the Go SDK via `go get`. The previous module path (`github.com/dcp-ai/dcp-ai-go`) pointed at a repository that did not exist, so external consumers could not install it. The module now lives as a sub-directory module inside this monorepo:

- **New module path**: `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` (`/v2` suffix required by Go for major versions ≥ 2)
- **Tag format**: `sdks/go/v2.0.0` (sub-directory-prefixed, as required by the Go module proxy for multi-module repos)
- **Install**: `go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0`

Code is unchanged — only the module path and internal imports were rewritten. All tests still pass.

## [2.0.2] - 2026-04-18

### Python SDK

- **Fixed**: `dcp_ai.__version__` now reflects the installed version dynamically via `importlib.metadata` instead of a hardcoded string. In 2.0.1 the attribute still reported `"1.0.0"` even though the wheel was `2.0.1`.

### CI / publish workflows

- Every publish job (`publish.yml`, `publish-pypi.yml`, `publish-integrations.yml`) now pre-checks whether the manifest version is already on the registry and, if so, exits green with a skip notice. Previously, any release-triggered run re-attempted to publish already-published versions and left four red jobs in the Actions tab. No more cosmetic red ghosts on routine releases.
- Fixed two outdated package names in the README integrations table: `@dcp-ai/a2a` → `@dcp-ai/google-a2a`, `@dcp-ai/mcp` → `@dcp-ai/anthropic-mcp`.
- Live npm / PyPI version badges added per row in the integrations table.

## [2.0.1] - 2026-04-18

### Python SDK

Framework bridges are now shipped inside the package. Prior to 2.0.1
they lived under `integrations/<name>/` in the repo and were only
loadable through a pytest hack; anyone who ran `pip install dcp-ai[fastapi]`
got the upstream `fastapi` library but not the `dcp_ai.fastapi`
middleware. 2.0.1 fixes that: the four modules now live under
`dcp_ai/` and are included in the published wheel.

- **Added**: `dcp_ai.fastapi` (middleware, dependency injection, V2 structure checks)
- **Added**: `dcp_ai.langchain` (agent wrapper, callback, risk scoring)
- **Added**: `dcp_ai.openai` (client, tool schema, audit trail builder)
- **Added**: `dcp_ai.crewai` (crew agent, combined audit trail, session consistency checks)
- **Removed**: `tests/conftest.py` dynamic-module loader (no longer needed)

### Installation

```bash
pip install dcp-ai[fastapi]     # brings fastapi + uvicorn
pip install dcp-ai[langchain]   # brings langchain + langchain-core
pip install dcp-ai[openai]      # brings openai
pip install dcp-ai[crewai]      # brings crewai
```

### Backward compatibility

Fully compatible with 2.0.0 imports. The new modules only add API
surface; existing `from dcp_ai import ...` calls are unaffected.

## [npm integrations] - 2026-04-18

First publication of the six framework bridges as standalone npm
packages, all at `v2.0.0`:

- `@dcp-ai/anthropic-mcp` — Anthropic MCP bridge
- `@dcp-ai/autogen` — Microsoft AutoGen bridge
- `@dcp-ai/google-a2a` — Google Agent-to-Agent bridge
- `@dcp-ai/w3c-did` — W3C DID/VC bridge
- `@dcp-ai/express` — Express middleware
- `@dcp-ai/openclaw` — OpenClaw plugin

`@dcp-ai/express` and `@dcp-ai/openclaw` depend on `@dcp-ai/sdk ^2.0.0`.

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
