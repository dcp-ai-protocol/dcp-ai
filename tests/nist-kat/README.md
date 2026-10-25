# NIST KAT (Known Answer Test) Compliance

This directory contains known-answer vectors and property tests used by DCP-AI cryptographic providers. Passing these tests establishes the covered behavior, not full algorithm conformance or NIST validation of a cryptographic module; see [NIST conformity and scope](../../docs/NIST_CONFORMITY.md).

## Structure

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519 (RFC 8032) uses deterministic signing. The `vectors.json` contains exact test vectors from RFC 8032 Section 7.1. All SDKs MUST produce identical signatures for the given secret key and message.

## ML-DSA-65

ML-DSA-65 (FIPS 204) signing is hedged (randomized) in the TypeScript and Rust providers and deterministic in the Go provider; both variants are valid and verify the same way. Direct KAT vectors require seed control which varies across implementations. The checks here cover:

1. **Size conformance** - public key (1952 B), signature (3309 B)
2. **Round-trip** - sign then verify succeeds
3. **Wrong-key rejection** - verify with different key fails
4. **Cross-SDK verification** - signatures from the TypeScript SDK verify in all other SDKs
5. **Deterministic kid** - kid derivation is reproducible across SDKs

## ML-KEM-768

ML-KEM-768 (FIPS 203) decapsulation is deterministic, so `(dk, c) -> k` cases from NIST ACVP (`ML-KEM-encapDecap-FIPS203`) are true KATs for any implementation, including implicit rejection of a modified ciphertext. The file also carries the FIPS 203 input checks: an encapsulation key with coefficients >= q and a decapsulation key with a wrong `H(ek)` must be rejected.

## SLH-DSA-192f

SLH-DSA-SHA2-192f (FIPS 205) signing is randomized, so the vectors are NIST ACVP signature-verification cases (`SLH-DSA-sigVer-FIPS205`, external interface, pure mode). The valid case only verifies when the FIPS 205 `0x00 || len(ctx) || ctx` prefix is applied, which pre-standard SPHINCS+ omits. DCP signs with an empty context; these cases carry one, so tests pass it explicitly.

Both files record the ACVP-Server release and the SHA-256 of the source file. Values are copied verbatim: never edit them to match an SDK.

## Phase 1 Gate

Each SDK's test job in CI runs its KAT tests: TypeScript `src/__tests__/nist-kat.test.ts`, Python `tests/test_nist_kat.py`, Go `dcp/nist_kat_test.go` (in `go test ./...`) and Rust `tests/nist_kat.rs`. A failing KAT fails that job.
