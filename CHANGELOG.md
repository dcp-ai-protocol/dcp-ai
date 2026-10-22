# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security

- Blinded RPR verification (`verifyBlindedRpr`, `verify_blinded_rpr`, `VerifyBlindedRPR`) now also
  compares `session_nonce` and `binding_keys`, in all four SDKs. Before, a full RPR with different
  binding keys or a different session nonce still matched the blinded record. In Go, list fields
  decoded from JSON no longer fail to match the same list built as `[]string`.
- Verification server: `POST /v2/passport/register` verifies the passport's composite
  self-signature and registers only its signer keys; re-registering an `agent_id` needs a newer
  passport signed by all of its active keys. Anyone could re-register an agent with their own
  keys, plant their emergency token and emergency-revoke it. `POST /v2/keys/rotate` verifies the
  proof of possession and the old key's authorization (`verifyKeyRotation`), and
  `POST /v2/multi-party/authorize` verifies each party's signature against its registered keys,
  counting each party once.
- Verification server: `/v2/policy/mode`, `/v2/governance/register`, `/v2/advisory/publish` and
  `/v2/advisory/auto-apply` require `Authorization: Bearer $OPERATOR_TOKEN` (locked when unset).
  Advisories are schema-validated and capped at 1000. Rate limits key on the socket address, not
  the client-supplied `X-Forwarded-For` (`TRUST_PROXY=true` behind a proxy), and `VERIFIER_MODE` /
  `ALLOW_V1_BUNDLES` are read from the environment; `allow_v1_bundles` is now enforced.
- Revocation service: agents register with their signed passport (`POST /v2/register`), which
  records kid ownership, key expiry and the emergency token; re-registration needs a newer passport
  signed by the agent's active classical and PQ keys, and `/revoke` and `/v2/revoke` must be
  signed by its active keys. `GET /v2/check/kid/:kid` reports emergency revocations of registered
  kids without `?agent_id=`.
- Anchor service: no more random `tx_hash` (records carry `tx_hash: null`, `onchain: false`),
  bodies are capped at 1 MB, `POST /flush` needs the operator token, and malformed input is a 400
  instead of a crash. Transparency log: tree heads are Ed25519-signed instead of an HMAC nobody
  else could verify; `OPERATOR_KEY` must be the 64-hex seed (the public compose placeholders were
  removed), the Merkle tree uses RFC 6962 leaf/node prefixes, and `POST /gossip/peers` (an SSRF
  vector) needs the operator token.
- Verification server and revocation service: expired keys can no longer re-register a passport,
  authorize a key rotation or sign for a party or a revocation, and re-registering keeps the
  registered key entries, so a new passport cannot extend a key's `expires_at`.
- Fly configs keep one verification and one revocation machine running: scaling to zero wiped
  their in-memory registries whenever the machine idled.
- TypeScript SDK: `verifySignedBundleV2` implements `spec/VERIFICATION.md` Steps V2-7 and V2-8. A
  PQ signature that is present (`pq_over_classical`) must verify in every mode; `hybrid_preferred`
  (the default for medium risk) accepted an invalid one with a warning and `classical_only`
  ignored it. Only an absent one (`classical_only` binding) is tolerated, and not under
  `hybrid_required` or `pq_only`. Each artifact's own `composite_sig` is now verified under the
  same rules with its context tag: the RPR against its `binding_keys`, the passport, intent and
  policy decision against the passport `keys`. Before, only `payload_hash` was checked, so a
  forged agent signature on the intent verified even under `hybrid_required`. The reference
  verifier, `dcp verify-bundle` and the server get this with the next `@dcp-ai/sdk` release.
- Go (`v2.VerifySignedBundleV2`) and Rust SDKs: each artifact's `composite_sig` is verified the
  same way (V2-8), and signer keys are looked up by `kid` (V2-6), the bundle signer in the
  passport `keys` and the RPR `binding_keys`. They used to take the passport's Ed25519 and
  ML-DSA-65 keys by algorithm, so they rejected bundles signed with the principal's keys and
  reported a bundle whose passport listed no Ed25519 key as verified, with a warning, without
  checking its signature.

### Changed (breaking)

- Revocation service: `POST /v2/register-emergency-token` and `POST /v2/register-key-expiry` were
  removed in favour of `POST /v2/register`. V1 `/revoke` needs an agent registered there, which
  takes a hybrid (Ed25519 + ML-DSA-65 or SLH-DSA-192f) passport signature, so Ed25519-only (V1)
  agents can no longer publish revocations. A revoked agent can no longer be revoked again (409).
- Verification server and revocation service: re-registering an `agent_id` (for example to replace
  the emergency revocation token) needs a passport whose `created_at` is newer than the registered
  one, signed by all of the agent's active keys; a passport without a token keeps the registered
  one. An agent that has lost every active key of a family (classical or PQ) cannot re-register:
  recovery goes through the emergency revocation token or the operator.
- Transparency log: leaf hashes, roots and inclusion proofs change with the RFC 6962 prefixes, and
  STH `signature` / `public_key` are now base64 Ed25519. `/add` only accepts `sha256:<64 hex>`
  hashes, and the anchor's `/anchor` 64 hex characters with an optional `sha256:` prefix.
- Verification server: `/v2/keys/rotate` requires `authorization_sig` and `timestamp`
  (`KeyRotationRecord`). `dcp rotate-key` and `dcp keys certify` still send a simulated proof of
  possession, which the server now rejects.

### Added

- TypeScript SDK: `blindRpr`, `verifyBlindedRpr`, `isBlindedRpr` and `computePiiHash` are exported
  from the package entry point. They were implemented but unreachable from `@dcp-ai/sdk` 2.1.2 and
  earlier; Python, Go and Rust already exported them.
- `lib/verify.js` exports `verifyCompositeSig` (a composite signature over a payload, with signer
  keys looked up by derived kid) and its `v2Registry`; `lib/http.js` holds the body parsing,
  client-IP and operator-token helpers shared by `server/` and `services/`. The anchor and
  transparency-log services have `node:test` suites, run in CI with the existing ones.
- Rust SDK: the V2 bundle verifier moved out of the `wasm` feature into
  `dcp_ai::v2::verify_bundle::verify_signed_bundle_v2`, so native builds and `cargo test` run it;
  `wasm_verify_signed_bundle_v2` delegates to it.
- `tests/interop/v2/bundle_vectors.json`: a signed bundle that every V2 verifier must accept, and
  mutations (forged bundle PQ signature, forged or misattributed artifact signatures) after which
  it must reject it, checked by the TypeScript, Go and Rust suites. Regenerate with
  `sdks/typescript/src/__tests__/generate-bundle-vectors.ts`.

### Documentation

- `spec/CANONICALIZATION_PROFILE.md`, `spec/DCP-AI-v2.0.md`, the WASM SDK README (all languages),
  `docs/NIST_CONFORMITY.md` and the TypeScript, Python and Rust canonicalizer comments describe
  `dcp-jcs-v1` as based on RFC 8785, not a strict subset of it or plain RFC 8785: Rule 1 orders keys
  by code point, RFC 8785 by UTF-16 code units. The profile is unchanged.
- The TypeScript SDK README (all languages) and `docs/API_REFERENCE.md` list the real signatures of
  the composite-signature, bundle, presentation, PQ checkpoint, A2A, error, emergency revocation,
  key recovery, hashing and CBOR functions.
- `docs/API_REFERENCE.md`: the V2 verification pipeline lists the per-artifact signature checks,
  and the known-limitations note on V2-7 and V2-8 now applies only to `@dcp-ai/sdk` 2.1.2 and
  earlier.

## [2.9.0] - 2026-10-21

### Package versions

- `dcp-ai` (PyPI) 2.8.1 → 2.8.2: fixes only.
- `@dcp-ai/sdk` (npm) 2.1.1 → 2.1.2: fixes only.
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.1 → v2.9.0: adds `v2.MarshalCanonical`.
- `dcp-ai` (crates.io) 2.8.1 → 2.9.0: OpenTelemetry 0.32, breaking for the optional `otlp`
  feature (see "Changed (breaking)").
- Unchanged: `@dcp-ai/wasm` 2.0.0, `@dcp-ai/cli` 2.0.0 and the integration packages.

### Security

- The reference verifier (`lib/verify.js`), `dcp verify-bundle` and the verification server now
  verify normative V2 bundles (`schemas/v2/signed_bundle.schema.json`) by delegating to
  `verifySignedBundleV2` from `@dcp-ai/sdk`, after JSON Schema validation. Before, bundles produced
  by any SDK were rejected as "Invalid signed bundle format", `dcp verify-bundle` printed
  `V2 BUNDLE STRUCTURE VALID` (exit 0) for forged bundles, and the server only checked structure.
  The pre-normative envelope (top-level `dcp_version` / `bundle_manifest`) is rejected. The server
  verifies against its advertised `VERIFIER_POLICY` (mode, accepted and advisory-rejected
  algorithms), and a public-key pin is refused in `pq_only` mode, which skips the classical signer.
- `dcp sign-bundle --composite` emits a normative `SignedBundleV2`; the ML-DSA-65 kid used to be
  derived from a hash of the secret key. `tools/bundle_sign.js --v2` was removed.
- Revocation service: one emergency revocation no longer reports every kid of every agent as
  revoked (`GET /v2/check/kid/:kid` now takes `?agent_id=`), and malformed percent-encoding returns
  400 instead of crashing the process.
### Changed (breaking)

- `lib/verify.js` (the root package `main`): `verifySignedBundle` is now `async` and takes a
  fourth `options` argument (`{ policy, mode }`); results always carry an `errors` array. The
  `verify-bundle` composite GitHub Action, `bin/dcp.js`, `server/` and `tools/bundle_verify.js`
  were updated. `tools/bundle_verify.js` no longer takes a PQ public key argument.
- Rust SDK, optional `otlp` feature: OpenTelemetry 0.24 → 0.32.
  - `OtlpHandles.tracer_provider` is now `SdkTracerProvider` and `OtlpHandles.tracer` is
    `SdkTracer`, following the upstream renames.
  - The feature no longer pulls in `tokio`: the bridge exports from the SDK's background threads
    over the blocking `reqwest` client.
  - Errors prefixed `tracer install:` now read `trace exporter:`.

### Added

- Go SDK: `v2.MarshalCanonical(obj)`, the `dcp-jcs-v1` encoder without the integer-only rule. The
  V1 `Canonicalize` and the proof-of-possession encoder now use it.

### Fixed

- Go SDK: canonicalization no longer escapes `<`, `>`, `&` or U+2028/U+2029 and emits `-0` as `0`
  (`dcp-jcs-v1` Rules 3 and 4) in the V2, proof-of-possession and V1 paths.
- TypeScript SDK: object keys are sorted by Unicode code point (Rule 1), not UTF-16 code units.
- Python SDK: `pqcrypto` is capped below 1.0. The 1.0 release removed the `pqcrypto.sign.ml_dsa_*`
  modules, so fresh installs of `dcp-ai` 2.8.1 fail to import the ML-DSA-65 provider.
- `tests/interop/v2/interop_vectors.json`: edge-case vectors for negative zero, HTML characters,
  U+2028/U+2029, control-character escapes and astral-plane key ordering.
- `tools/conformance.js`: the `edge_cases` entry no longer passes vacuously, the never-executed
  domain-separation block was removed, and V2 signed bundles (valid, tampered, forged, PQ-stripped,
  key-pinned, legacy) are checked against the reference verifier.

### Dependencies

- All 95 open Dependabot alerts are closed (11 critical, 54 high). #22 superseded the 15 Dependabot
  PRs (#5–#21); #24 bumped grpc.
- TypeScript SDK, `@dcp-ai/express`, `@dcp-ai/openclaw` (development):
  - vitest and `@vitest/coverage-v8` 4.1.12, bumped together.
  - vite 7.3.7, pinned through `overrides`.
  - postcss 8.5.31, nanoid 3.3.20, source-map-js 1.2.2, esbuild 0.28.2, fast-uri 3.1.9.
  - Express runtime lockfile: proxy-addr 2.0.8, qs 6.16.1, body-parser 2.3.0.
- Root harness: fast-uri 3.1.9, and the new `@dcp-ai/sdk` dependency.
- Go SDK: `golang.org/x/crypto` v0.55.0, `golang.org/x/net` v0.58.0, `google.golang.org/grpc`
  v1.83.2, `go.opentelemetry.io/otel/*` v1.46.0.
- Rust SDK: opentelemetry, opentelemetry_sdk and opentelemetry-otlp 0.32. `opentelemetry_sdk`
  0.32.1 fixes unbounded memory allocation in W3C Baggage propagation.
- CI:
  - New integration test job for express and openclaw.
  - The Rust job builds and tests `--features otlp`.
  - The Go job reads its version from `go.mod`.
  - The generated V2 bundle is verified with the CLI.
  - The server and revocation tests run.

### Documentation

- `spec/VERIFICATION.md`:
  - The V2 checklist now points at `schemas/v2/signed_bundle.schema.json` (the cited `*_v2` schemas never existed).
  - The non-existent `independent` binding was removed.
  - The reference implementation is named.
- `spec/CANONICALIZATION_PROFILE.md` §3 gained rows for string escaping and code-point key order. This clarifies Rules 1 and 3; the profile is unchanged.
- The server, operator, migration, API reference, CI and bundle docs now describe the real V2 verification, the actual CLI syntax and the SDK APIs that exist:
  - The migration guide's API tables named several functions that do not exist.
  - The server README showed the pre-normative envelope.
- The Python SDK README (all languages) no longer claims ML-KEM-768 or V2 bundle support, and the CrewAI quickstart flags its V2 snippet as planned API.
- Translations and project docs:
  - 11 integrations including Agno; canonicalization profile and Agno quickstart links.
  - Rust install snippets for this release and Go `@latest` pins.
  - Per-package supported versions in `SECURITY.md`, and the v2.8.x and v2.9.0 releases in `ROADMAP.md`.
  - The Zenodo concept DOI in `CITATION.cff`.

## [2.8.1] - 2026-04-26

### Wired the `canonicalization_profile` field across the four SDKs

`v2.8.0` declared the `canonicalization_profile` field in
`schemas/v2/bundle_manifest.schema.json` and described it in
`spec/CANONICALIZATION_PROFILE.md` § 4, but no SDK actually wrote or
read the field — the typed `BundleManifest` structures shipped without
it, and verifiers ignored it. `v2.8.1` closes that gap end-to-end.

- **TypeScript (`@dcp-ai/sdk` 2.1.0 → 2.1.1)** — `BundleManifest`
  interface in `sdks/typescript/src/types/v2.ts` gains
  `canonicalization_profile?: 'dcp-jcs-v1'`. `BundleBuilderV2.build()`
  in `sdks/typescript/src/bundle/builder-v2.ts` now emits
  `canonicalization_profile: "dcp-jcs-v1"` on every produced manifest.
  `verifyV2Bundle` in `sdks/typescript/src/core/verify-v2.ts` accepts
  an absent field (assumes `dcp-jcs-v1`), accepts `"dcp-jcs-v1"`
  explicitly, and rejects any other value with
  `"Unknown canonicalization_profile: <value>"`.
- **Python (`dcp-ai` 2.8.0 → 2.8.1)** — `BundleManifest` in
  `sdks/python/dcp_ai/v2/models.py` gains
  `canonicalization_profile: Literal["dcp-jcs-v1"] | None = "dcp-jcs-v1"`.
  Pydantic enforces unknown-value rejection at parse time; absence
  triggers the default value. No separate verifier change is needed
  because validation lives in the model.
- **Go (`sdks/go/v2.8.0` → `v2.8.1`)** — `BundleManifest` struct in
  `sdks/go/dcp/v2/types.go` gains `CanonicalizationProfile string` with
  `json:"canonicalization_profile,omitempty"`. `BuildBundleV2` in
  `sdks/go/dcp/v2/bundle_builder.go` sets it to `"dcp-jcs-v1"` on every
  produced manifest. `VerifySignedBundleV2` in
  `sdks/go/dcp/v2/verify_bundle.go` now rejects bundles whose manifest
  carries a `canonicalization_profile` value other than `"dcp-jcs-v1"`.
- **Rust (`dcp-ai` crates.io 2.8.0 → 2.8.1)** —
  `BundleManifest` in `sdks/rust/src/v2/types.rs` gains
  `pub canonicalization_profile: Option<String>` with
  `#[serde(skip_serializing_if = "Option::is_none")]`. `wasm_build_bundle`
  in `sdks/rust/src/lib.rs` sets `"canonicalization_profile":
  "dcp-jcs-v1"` on the manifest it emits.

### Spec & profile document

- `spec/DCP-AI-v2.0.md` § 9 (Bundle Manifest) now lists
  `canonicalization_profile` alongside the other manifest fields, with
  an inline note that an absent field MUST be assumed equivalent to
  `"dcp-jcs-v1"`.
- `spec/CANONICALIZATION_PROFILE.md` § 2 — Rule 6 (undefined / null
  handling) is rewritten as a cross-language table that explicitly
  lists how TypeScript, Python, Go, and Rust host values map onto the
  JSON wire format for both object slots and array slots.
- `spec/CANONICALIZATION_PROFILE.md` § 2 — new Rule 9 makes Unicode
  normalization (NFC, NFD, NFKC, NFKD) explicitly out of scope: the
  canonicalizer emits strings byte-for-byte as the host parser
  delivers them, and a future profile (`dcp-jcs-v2` or later) MAY pin
  a normalization form. RFC 8259 § 8.1 is referenced as the
  conventional choice (NFC) for application-layer normalisation.
- `spec/CANONICALIZATION_PROFILE.md` Rule 9 also pins the rationale
  for not shipping `NaN` / `±Infinity` interop fixtures: those values
  are not part of RFC 8259 wire format, so most parsers reject them
  before the canonicalizer is reached. Rejection is verified by
  per-SDK unit tests rather than shared fixtures.

### Behavioural compatibility

The new field is **additive and optional in serialization**:

- A `v2.8.1`-produced bundle carries `canonicalization_profile:
  "dcp-jcs-v1"` on its manifest. Older verifiers that don't know about
  the field will treat it as an unknown property — which is fine
  because the JSON Schema declares the field as `additionalProperties`-
  compatible (it lives among `properties` and is `optional`).
- A bundle produced by `v2.8.0` or earlier has no
  `canonicalization_profile` field. `v2.8.1` verifiers accept it: per
  `spec/CANONICALIZATION_PROFILE.md` § 4, an absent field MUST be
  assumed equivalent to `"dcp-jcs-v1"`.
- A bundle that carries `canonicalization_profile` with an unknown
  value (e.g. `"dcp-jcs-v2"`) is rejected by every `v2.8.1` SDK. This
  is the forward-compatibility hook for future profiles: a verifier
  that hasn't been updated to a new profile MUST refuse it rather than
  silently accept a manifest it cannot validate.

The bundle-level signature covers `canonical(manifest)`, so adding the
field changes the manifest hash of any newly-produced bundle relative
to one that would have been produced under `v2.8.0`. Bundles produced
under `v2.8.0` and earlier, and their stored signatures, remain valid
under `v2.8.1` verifiers.

### Versions bumped

- `dcp-ai` (PyPI) 2.8.0 → 2.8.1
- `dcp-ai` (crates.io) 2.8.0 → 2.8.1
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.0 → v2.8.1
- `@dcp-ai/sdk` (npm) 2.1.0 → 2.1.1 — first TypeScript code change
  since 2.1.0 (the 2.8.0 release was a docstring-only edit)

## [2.8.0] - 2026-04-26

### Added — Canonicalization profile `dcp-jcs-v1`

A public crosswalk against another protocol surfaced three real
asymmetries in how the four SDKs canonicalised JSON: `1.0`/`1.00`
were rejected by Python and Rust but accepted by TypeScript and Go;
`1e2` was rejected by Rust alone; and `undefined` had no formal
treatment in the spec. The "RFC 8785 + integer-only" summary in
`spec/DCP-AI-v2.0.md` § 15 was correct as far as it went, but did not
pin the cases JCS leaves implementation-defined. This release closes
all of them.

- **New normative document**: [`spec/CANONICALIZATION_PROFILE.md`](spec/CANONICALIZATION_PROFILE.md)
  formalises profile `dcp-jcs-v1` with eight numbered rules, an
  edge-case acceptance table covering 22 inputs, an undefined-handling
  contract that documents the TypeScript-only asymmetry (omit in
  objects, serialize as `null` in arrays), and a versioning policy
  for future profiles.
- **Bundle manifest field**: `canonicalization_profile: "dcp-jcs-v1"`
  added to `schemas/v2/bundle_manifest.schema.json` as an optional
  field. Verifiers that encounter a bundle without it MUST assume
  `dcp-jcs-v1`. Future profiles will make the field required.
- **Python (`dcp-ai` 2.7.1 → 2.8.0)**: `assert_no_floats` now accepts
  floats whose value is a finite integer (`1.0`, `1e2`, `1.00`); they
  are normalised to integer form before `json.dumps`. Non-integer
  floats (`0.1`), `NaN`, and infinities remain rejected.
- **Rust (`dcp-ai` 2.7.0 → 2.8.0)**: `assert_no_floats` now accepts
  `Number(f64)` whose `fract()` is zero. New `format_number` helper
  in `canonical_recurse` emits integer-valued floats without decimal
  point or exponent, matching the other SDKs byte-for-byte.
- **Go (`sdks/go/v2.7.0` → `v2.8.0`)**: behaviour already aligned
  (`v != math.Trunc(v)` check). Version-bump only.
- **TypeScript (`@dcp-ai/sdk` stays 2.1.0)**: behaviour already
  aligned. Docstring in `sdks/typescript/src/core/canonicalize.ts`
  formalises the undefined-vs-null asymmetry.

### Added — interop edge-case fixtures

`tests/interop/v2/interop_vectors.json` now ships
`canonicalization.edge_cases` with 14 vectors covering null
preservation (with key, inside arrays), integer-valued floats,
trailing zeros, scientific notation, fractional rejection, non-finite
rejection, code-point key sorting (including `é`), nested nulls,
empty containers, deeply nested objects, and arrays with null. Each
SDK's interop test loads the same block and asserts byte-identical
output (or matching error) for every vector. CI runs all four in
parallel on every PR; divergence is a release blocker.

### Versions bumped

- `dcp-ai` (PyPI) 2.7.1 → 2.8.0
- `dcp-ai` (crates.io) 2.7.0 → 2.8.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` → v2.8.0
- `@dcp-ai/sdk` (npm) stays 2.1.0 — TypeScript already implemented
  the profile; this release adds the docstring formalisation only.

### Behavioural compatibility

Bundles produced by previous releases remain valid. The change is
**additive** for SDKs that previously rejected `1.0`/`1.00`/`1e2`:
inputs that used to throw `TypeError`/`Err` now succeed and produce
the same canonical output other SDKs were already producing. No
input that previously canonicalised successfully canonicalises
differently in 2.8.0.

## [2.7.1] - 2026-04-23 (Python only)

### Fixed

- `dcp-ai` (PyPI) 2.7.0 was missing `cryptography` as a hard dependency. The
  package is required by the DCP-04 A2A session layer introduced in 2.5.0
  for AES-256-GCM encryption. Fresh `pip install dcp-ai==2.7.0` installs did
  not pull `cryptography`, so three A2A session tests failed under a clean
  environment (`test_encrypt_decrypt_round_trip`, `test_tamper_ciphertext_rejected`,
  `test_session_id_mismatch`). 2.7.1 adds `cryptography>=41.0` to the wheel's
  required dependencies.

Rust (`dcp-ai` crates.io) and Go (`sdks/go/v2`) are unaffected and remain at
2.7.0 — the `cryptography` Python package only matters for the Python wheel.

## [2.7.0] - 2026-04-23

### Added — Canonical error codes + wire-format detection in PY / GO / RS

Ports the `DcpErrorCode` enum and accompanying `DcpError` / `DcpProtocolError`
machinery from TS to Python, Rust, and Go, plus the lightweight
`detect_wire_format` helper that routes an incoming byte stream to
"json" or "cbor" based on the first byte.

**Every SDK now agrees on the same 38 canonical error codes** covering:
schema errors (E001-E099), signature errors (E100-E199), hash/chain errors
(E200-E299), identity errors (E300-E399), policy errors (E400-E499),
session errors (E500-E599), A2A errors (E600-E699), rate limiting
(E700-E799), and internal errors (E900-E999). Each code carries a canonical
message + a `retryable` flag so clients can implement policy-matching
retry logic consistently across SDKs.

**Python (`dcp-ai` 2.6.0 -> 2.7.0)** — new `dcp_ai.v2.error_codes` module
with `DcpErrorCode` (str-enum), `DcpError` dataclass,
`DcpProtocolError` exception, `create_dcp_error`, `is_dcp_error`,
`detect_wire_format`, and `ERROR_DESCRIPTIONS` mapping.

**Rust (`dcp-ai` 2.6.0 -> 2.7.0)** — `dcp_ai::v2::error_codes` with the
`DcpErrorCode` enum (`Display` → the stable `DCP-E###` identifier),
`DcpError` struct, `create_dcp_error`, and `detect_wire_format`.

**Go (`sdks/go/v2.6.0 -> v2.7.0`)** — `v2.DcpErrorCode` typed-string with
37 `Err*` constants, `v2.DcpError` struct implementing the `error`
interface, `CreateDcpError`, `IsDcpError`, `DetectWireFormat`.

### CBOR encoder/decoder scope decision

The full CBOR encoder/decoder remains TypeScript-only in 2.x. Porting a
deterministic RFC 8949 implementation to three more SDKs is a substantial
project that deserves its own milestone; `detect_wire_format` is the
single helper every SDK needs today to route CBOR payloads to an
existing ecosystem library (e.g. `cbor2` in Python,
`github.com/fxamacker/cbor/v2` in Go, `ciborium` in Rust). A dedicated
v3.x release will add a canonical port.

### Test counts

- Python: 231/231 pass (unchanged; import surface verified)
- Rust: 152/152 pass (+5 new)
- Go: 115/115 pass (+8 new)

### Versions bumped

- `dcp-ai` (PyPI) 2.6.0 -> 2.7.0
- `dcp-ai` (crates.io) 2.6.0 -> 2.7.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.7.0

## [2.6.0] - 2026-04-23

### Added — blinded RPR, multi-party auth, advisory helpers in Rust + Go

Ports three Python-exclusive features to Rust and Go, closing the gap
noted in the crosswalk where Python was ahead of the other non-TS SDKs.

- **Blinded RPR (Gap #2)**: `compute_pii_hash`, `blind_rpr`,
  `verify_blinded_rpr`, `is_blinded_rpr`.
- **Multi-Party Authorization (Gap #5)**: `verify_multi_party_authorization`
  + `MultiPartyPolicy` with the four default operation policies
  (`revoke_agent`, `rotate_org_key`, `change_jurisdiction`,
  `modify_recovery_config`).
- **Algorithm advisory helpers (Gap #4)**: `check_advisory`,
  `evaluate_advisories`, `apply_advisories_to_policy`,
  `build_algorithm_advisory`.

All three modules match the Python semantics: SHA-256 PII commitment,
M-of-N structural validation (crypto verification stays at the gateway),
and routing by action (`revoke` / `deprecate` / `warn`) with grace-period
handling.

Python (`dcp-ai` 2.5.0 -> 2.6.0): no code change, version bump only to
keep the SDK suite synchronised.

### Test counts

- Rust: 147/147 (+14 new)
- Go: 106/106 (+12 new)
- Python: 231/231 (unchanged)

## [2.5.0] - 2026-04-23

### Added — DCP-04 Agent-to-Agent protocol parity

Ports DCP-04 (Agent-to-Agent) scaffolding to the remaining SDKs.

**Python (`dcp-ai` 2.4.0 -> 2.5.0)** — full parity with TS including the
symmetric session layer (AES-256-GCM via the `cryptography` package).

- Discovery: `create_agent_directory`, `find_agent_by_capability`,
  `find_agent_by_id`, `validate_directory_entry`.
- Handshake: `generate_nonce`, `create_hello`, `create_welcome`,
  `derive_session_id`, `create_close_message`.
- Session: `A2ASession`, `create_session`, `encrypt_message`,
  `decrypt_message`, `needs_rekeying`, `generate_resume_proof`,
  `verify_resume_proof`, `derive_rekeyed_session_key`.

**Go (`sdks/go/v2.4.0 -> v2.5.0`)** — full parity with TS, using Go stdlib
`crypto/aes` + `crypto/cipher` for AES-256-GCM (no new dependencies).

**Rust (`dcp-ai` 2.4.0 -> 2.5.0)** — discovery + handshake scaffolding.
The AES-256-GCM session layer is scheduled for a follow-up release; Rust
users can still build directories, HELLO/WELCOME messages, and derive
session IDs.

Test counts: Python 231/231, Rust 133/133, Go 94/94.

## [2.4.0] - 2026-04-23

### Added — Production hardening primitives in Python, Rust, Go

Ports the four protocol-critical hardening primitives from the TS core:

- **Session nonce** helpers: `generate_session_nonce`, `is_valid_session_nonce`,
  `verify_session_binding`, `generate_session_expiry`, `is_session_expired`.
- **Adaptive security tier**: `compute_security_tier`, `max_tier`,
  `tier_to_verification_mode`, `tier_to_checkpoint_interval` (Go already had
  `ComputeSecurityTier`; v2.4 adds the three helper functions).
- **Emergency revocation** (Gap #13): `generate_emergency_revocation_token`,
  `verify_emergency_revocation_secret`, `build_emergency_revocation`.
- **Lazy PQ checkpoints**: `audit_events_merkle_root`, `create_pq_checkpoint`,
  and `PQCheckpointManager` class with tier-driven interval selection and
  automatic flush behaviour.

All four modules match the TS semantics exactly: constant-time secret
verification for emergency revocation, tier-driven checkpoint intervals,
session-nonce validator regex, and signed checkpoint payloads under the
`DCP-AI.v2.AuditEvent` domain-separation context.

### What's not in v2.4

Deliberately scoped out (will ship as follow-up releases if demand appears):
- Shamir secret sharing (Gap #1) — requires careful crypto review; TS-only.
- Verification cache — app-level concern, not protocol.
- Rate limiting / circuit breaker / retry — app-level patterns best
  delegated to existing ecosystem libraries.

### Test counts

- Python: 214/214 pass (+24 new)
- Rust: 126/126 pass (+10 new)
- Go: 81/81 pass (+9 new)

### Versions bumped

- `dcp-ai` (PyPI) 2.3.0 -> 2.4.0
- `dcp-ai` (crates.io) 2.3.0 -> 2.4.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.4.0

## [2.3.0] - 2026-04-23

### Added — Dispute + Rights + Delegation parity across SDKs

Python, Rust, and Go now implement DCP-07 (Dispute Resolution + Arbitration),
DCP-08 (Rights & Obligations), and DCP-09 (Delegation, Awareness-threshold,
Principal Mirror) behavior — matching the TypeScript feature set.

**New function groups (identical semantics across PY/RS/GO, matching TS):**

DCP-07 Conflict Resolution:
- `create_dispute` · `escalate_dispute` · `resolve_dispute` · `create_objection`
- Arbitration: `create_arbitration_panel` · `submit_resolution` ·
  `build_jurisprudence_bundle` · `lookup_precedent`

DCP-08 Rights & Obligations:
- `declare_rights` · `record_obligation` · `report_violation` ·
  `check_rights_compliance`

DCP-09 Delegation & Representation:
- Delegation: `create_delegation_mandate` · `verify_mandate_validity` ·
  `revoke_delegation` · `generate_interaction_record`
- Awareness threshold: `evaluate_significance` · `should_notify_human` ·
  `create_awareness_threshold` · `create_advisory_declaration`
- Principal mirror: `generate_mirror`

All new factories use the existing composite-sign path under the
`DCP-AI.v2.Dispute`, `DCP-AI.v2.Rights`, `DCP-AI.v2.Delegation`, and
`DCP-AI.v2.Awareness` domain-separation contexts. The delegation mandate
artifact carries its human-principal signature in the `human_composite_sig`
field, matching the TS wire format.

### Test counts

- Python: 190/190 pass (+21 new)
- Rust: 116/116 pass (+12 new)
- Go: 72/72 pass (+12 new across outer `dcp_test` package)
- TypeScript: 460/460 pass (no changes)

### Versions bumped

- `dcp-ai` (PyPI) 2.2.0 -> 2.3.0
- `dcp-ai` (crates.io) 2.2.0 -> 2.3.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.3.0
- `@dcp-ai/sdk` (npm) stays at 2.1.0

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
