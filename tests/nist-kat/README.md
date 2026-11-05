# NIST KAT (Known Answer Test) Compliance

This directory contains known-answer vectors and property tests used by DCP-AI cryptographic providers. Passing these tests establishes the covered behavior, not full algorithm conformance or NIST validation of a cryptographic module; see [NIST conformity and scope](../../docs/NIST_CONFORMITY.md).

## Structure

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
    acvp_sigver_tg3.json                  -- NIST ACVP sigVer test group 3 (ML-DSA-65, external, pure)
    wycheproof_mldsa_65_verify_test.json  -- C2SP Wycheproof ML-DSA-65 verification vectors
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519 (RFC 8032) uses deterministic signing. The `vectors.json` contains exact test vectors from RFC 8032 Section 7.1. All SDKs MUST produce identical signatures for the given secret key and message.

## ML-DSA-65

ML-DSA-65 (FIPS 204) signing is hedged (randomized) in the TypeScript and Rust providers and deterministic in the Go provider; both variants are valid and verify the same way. Reproducing signing KATs requires control of the signing randomness, which implementations expose differently, so signing is covered by these property checks; verification needs no such control and is covered by the [verification vectors](#ml-dsa-65-verification-vectors) below. The property checks cover:

1. **Size conformance** - public key (1952 B), signature (3309 B)
2. **Round-trip** - sign then verify succeeds
3. **Wrong-key rejection** - verify with different key fails
4. **Cross-SDK verification** - signatures from the TypeScript SDK verify in all other SDKs
5. **Deterministic kid** - kid derivation is reproducible across SDKs

<a id="ml-dsa-65-verification-vectors"></a>
### Verification vectors

Two independent sources of ML-DSA-65 verification cases are run through each SDK's real provider:

| File | Source | Pinned at | SHA-256 |
|---|---|---|---|
| `acvp_sigver_tg3.json` | NIST ACVP-Server `gen-val/json-files/ML-DSA-sigVer-FIPS204/internalProjection.json`, test group 3 (ML-DSA-65, external interface, pure mode, 15 cases) | commit `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` | source file `47cdd6314c7f746d02421ffcba89d4dbc7bb875ac49e07a029fdfc26fba55437`; this file `bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8` |
| `wycheproof_mldsa_65_verify_test.json` | C2SP Wycheproof `testvectors_v1/mldsa_65_verify_test.json` (210 cases), Apache-2.0; not a NIST source | commit `20b256949ea8f21a11375619b1825027ca0668bd` | `1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034` (the file is a byte-for-byte copy) |

`acvp_sigver_tg3.json` holds the test group copied unchanged, with a `_source` object giving the path, commit and SHA-256 of the source file and the NIST notice that comes with it. A commit is pinned rather than a tag, because tags can move. Values are copied verbatim: never edit them to match an SDK.

Every SDK provider verifies with the empty FIPS 204 context (DCP puts its domain separation in the message, see [§3 of NIST conformity](../../docs/NIST_CONFORMITY.md)), so only the cases with an empty context run through it:

- **Run: 204 cases, 77 valid and 127 invalid.** NIST tc39, the only case of test group 3 with an empty context (invalid), and the 203 Wycheproof cases with no context or an empty one (77 valid, 126 invalid).
- **Excluded, and checked by ID:** NIST tc31 to tc45 except tc39 (non-empty contexts, including the three valid cases tc33, tc43 and tc44), and Wycheproof tc3, tc4, tc5 and tc153 to tc156 (non-empty contexts). The pre-hash and internal-interface groups are not used.
- **Verdicts:** a valid case must return `true`. An invalid case must return `false`, except in Go and Rust where the provider returns an error for a key or signature of the wrong length: that error counts only for those cases (Go: Wycheproof tc69, tc70, tc158 and tc159; Rust: those and tc6, tc7 and tc157) and only with the provider's exact length error. Any other error or panic fails the test.

Each SDK has three tests: one checks the SHA-256 of both files, the counts and the excluded IDs; one checks that the provider is the SDK's; and the verdict test runs the cases and fails unless exactly 204 ran. The WASM target is the Rust provider compiled to `wasm32-unknown-unknown` and run with `wasm-bindgen-test` (`sdks/rust/tests/wasm_mldsa65_vectors.rs` in Node, `wasm_mldsa65_vectors_browser.rs` in a browser), with the files embedded at compile time; it shares the Rust implementation and is not a fifth library. The npm package `@dcp-ai/wasm` exposes no raw ML-DSA verification, so these vectors do not go through its exports.

Limits: passing these cases is not NIST validation (CAVP or CMVP) of any library or module. Non-empty contexts, pre-hash ML-DSA, the internal interface and signing are not covered by vectors. The names of the Wycheproof flags and of the ACVP reasons are kept as recorded upstream; they are not claims about which FIPS 204 condition a case exercises.

## ML-KEM-768

ML-KEM-768 (FIPS 203) decapsulation is deterministic, so `(dk, c) -> k` cases from NIST ACVP (`ML-KEM-encapDecap-FIPS203`) are true KATs for any implementation, including implicit rejection of a modified ciphertext. The file also carries the FIPS 203 input checks: an encapsulation key with coefficients >= q and a decapsulation key with a wrong `H(ek)` must be rejected.

## SLH-DSA-192f

SLH-DSA-SHA2-192f (FIPS 205) signing is randomized, so the vectors are NIST ACVP signature-verification cases (`SLH-DSA-sigVer-FIPS205`, external interface, pure mode). The valid case only verifies when the FIPS 205 `0x00 || len(ctx) || ctx` prefix is applied, which pre-standard SPHINCS+ omits. DCP signs with an empty context; these cases carry one, so tests pass it explicitly.

Both files record the ACVP-Server release and the SHA-256 of the source file. Values are copied verbatim: never edit them to match an SDK.

## Phase 1 Gate

Each SDK's test job in CI runs its KAT tests: TypeScript `src/__tests__/nist-kat.test.ts`, Python `tests/test_nist_kat.py`, Go `dcp/nist_kat_test.go` (in `go test ./...`) and Rust `tests/nist_kat.rs`. The WASM job runs `sdks/rust/tests/wasm_mldsa65_vectors.rs` in Node with `wasm-pack test` and fails unless its three tests passed. A failing KAT fails that job.
