# DCP-AI Playground

An interactive, browser-based playground for exploring the **Digital Citizenship Protocol (DCP) v2.0**. No build tools, no dependencies to install — just open the HTML file.

## Quick Start

```bash
open playground/index.html
# or
python3 -m http.server 8080 -d playground
# then visit http://localhost:8080
```

## Features

| Tab | Description |
|-----|-------------|
| **Identity Generator** | Generate Ed25519 keypairs, create Responsible Principal Records (RPR) and Agent Passports |
| **Bundle Builder** | Walk through all 7 steps to build a complete `SignedBundleV2` |
| **Bundle Verifier** | Paste any bundle JSON and run structural + cryptographic verification |
| **Tier Comparison** | Visual comparison of the 4 adaptive security tiers with latency simulation |
| **Protocol Explorer** | Interactive flowchart of the DCP message pipeline with step-by-step animation |

## How It Works

All cryptographic operations run **entirely in the browser**:

- **Ed25519 signatures** via [tweetnacl](https://github.com/nickolai/nickel-nacl) loaded from CDN
- **SHA-256 hashing** via the Web Crypto API (`crypto.subtle.digest`)
- **Key IDs (kid)** derived per spec: `hex(SHA-256(UTF8(alg) || 0x00 || pubkey_bytes))[0:32]`
- **Domain separation** applied to all signatures: `UTF8(context_tag) || 0x00 || canonical_payload`
- **JCS canonicalization** (sorted keys) for deterministic hashing

## Architecture

The playground is a single self-contained `index.html` file (~700 lines) with embedded CSS and JavaScript. It loads two CDN scripts for tweetnacl and uses no other external resources.

## Limitations

- **Post-quantum signatures are simulated**: The playground uses Ed25519 only for real cryptographic operations. ML-DSA-65 and SLH-DSA key generation and signing are placeholder simulations — they produce correctly-sized byte arrays but are NOT real FIPS 204/205 implementations. For production PQ crypto, use the full WASM SDK (`sdks/wasm/`) or a FIPS-certified library.
- Merkle root computation uses a simplified concatenation approach
- No CBOR wire format (JSON only)
- Signature verification is limited to Ed25519 keys present in the bundle's passport
- Session nonces are generated with `crypto.getRandomValues()` and are cryptographically random, but the playground does not enforce session binding across tabs

## PQ Signature Notice

The V2 composite signature UI in the playground generates visual representations of hybrid signatures (Ed25519 + ML-DSA-65), but the ML-DSA-65 component is **HMAC-based simulation only**. This is sufficient for:
- Protocol flow demonstration
- UI/UX testing
- Integration testing with the reference gateway

It is NOT sufficient for:
- Security auditing
- Production key management
- Compliance with NIST PQ standards
