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

Generate a new Ed25519 keypair:

```bash
dcp keygen
```

Generate a hybrid V2 keypair (Ed25519 + ML-DSA-65):

```bash
dcp keygen --hybrid
```

Keys are written to this directory by default. The CLI reads `secret_key.txt` and `public_key.txt` for signing and verification operations.

## Security Policy

- **Private keys** (`secret_key.txt`, `*_secret*`, `*.pem`, `*.key`) are excluded from version control via `.gitignore`.
- **Public keys** may be committed for reference and verification purposes.
- In production, use a hardware security module (HSM) or secure key management service rather than filesystem storage.
- For V2 hybrid keys, the ML-DSA-65 secret key material follows the same exclusion policy.

## Key Formats

| Key Type | Encoding | Size (bytes) |
|----------|----------|-------------|
| Ed25519 public | Base64 | 32 |
| Ed25519 secret | Base64 | 64 |
| ML-DSA-65 public | Base64 | 1952 |
| ML-DSA-65 secret | Base64 | 4032 |

## Deterministic Key ID (kid)

V2 keys use a deterministic `kid` derived from the public key material:

```
kid = base64url(SHA-256(canonical(public_key_bytes)))[:16]
```

This ensures the same key always produces the same `kid` across all DCP implementations.
