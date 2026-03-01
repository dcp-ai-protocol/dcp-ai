# NIST KAT (Known Answer Test) Compliance

This directory contains test vectors and property definitions for NIST KAT compliance of all DCP-AI cryptographic providers.

## Structure

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
```

## Ed25519

Ed25519 (RFC 8032) uses deterministic signing. The `vectors.json` contains exact test vectors from RFC 8032 Section 7.1. All SDKs MUST produce identical signatures for the given secret key and message.

## ML-DSA-65

ML-DSA-65 (FIPS 204) uses randomized signing. Direct KAT vectors require seed control which varies across implementations. Compliance is verified through:

1. **Size conformance** - public key (1952 B), signature (3309 B)
2. **Round-trip** - sign then verify succeeds
3. **Wrong-key rejection** - verify with different key fails
4. **Cross-SDK verification** - signatures from the TypeScript SDK verify in all other SDKs
5. **Deterministic kid** - kid derivation is reproducible across SDKs

## Phase 1 Gate

No SDK ships V2 support without passing all KAT tests. This is enforced in CI via the conformance test suite.
