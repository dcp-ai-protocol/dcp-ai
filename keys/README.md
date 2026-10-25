# DCP Key Storage

This directory stores cryptographic keys used by the DCP protocol tooling.

## Structure

```
keys/
├── README.md               # This file
├── public_key.txt          # Ed25519 public key (base64) — safe to share
├── secret_key.txt          # Ed25519 secret key (base64) — NEVER commit
├── agent_public_key.txt    # Agent-specific public key (optional)
└── agent_secret_key.txt    # Agent-specific secret key (optional, NEVER commit)
```

## Key Generation

`dcp` is the reference CLI of the checkout (`node bin/dcp.js`). It writes into `keys/` when you give it no directory, and **in a checkout that overwrites `keys/public_key.txt`, the key the conformance examples are verified with** (`npm run conformance` and CI use it). Give it another directory:

```bash
# Ed25519 (V1): public_key.txt and secret_key.txt
node bin/dcp.js keygen my-keys

# Hybrid V2 (Ed25519 + ML-DSA-65): ed25519_public_key.txt, ed25519_secret_key.txt, ed25519_kid.txt,
# ml_dsa_65_public_key.txt, ml_dsa_65_secret_key.txt, ml_dsa_65_kid.txt
node bin/dcp.js keygen --hybrid my-keys
```

Secret key files are written with mode `0600`. V1 commands take key files as arguments (`dcp sign-bundle <bundle.json> <secret_key.txt>`, `dcp verify-bundle <bundle.signed.json> <public_key.txt>`). The secret key matching `keys/public_key.txt` is not in the repository.

## Security Policy

- **Private keys** (`secret_key.txt`, `*_secret*`, `*.pem`, `*.key`) are excluded from version control via `.gitignore`.
- **Public keys** may be committed for reference and verification purposes.
- In production, keep secret keys in a hardware security module (HSM) or a key management service rather than on the filesystem. This repository provides no HSM integration: that custody comes from your own infrastructure.
- For V2 hybrid keys, the ML-DSA-65 secret key material follows the same exclusion policy.

## Key Formats

| Key Type | Encoding | Size (bytes) |
|----------|----------|-------------|
| Ed25519 public | Base64 | 32 |
| Ed25519 secret | Base64 | 64 (seed followed by the public key) |
| ML-DSA-65 public | Base64 | 1952 |
| ML-DSA-65 secret | Base64 | 4032 |

## Deterministic Key ID (kid)

V2 keys use a deterministic `kid` derived from the algorithm and the raw public key:

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]
```

This ensures the same key always produces the same `kid` across all DCP implementations (`dcp kid <public_key_file> --alg <algorithm>` computes it).
