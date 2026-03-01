# Security Policy

## Reporting a Vulnerability

**Do NOT report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in the DCP-AI protocol, SDKs, services, or smart contracts, please report it responsibly:

- **Email:** security@dcp-ai.org
- **GitHub:** Use [Private Vulnerability Reporting](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new)

Include as much detail as possible:
- Description of the vulnerability
- Steps to reproduce
- Affected component (protocol, SDK, service, contract)
- Potential impact assessment

## Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 7 days |
| Fix (critical/high) | Within 30 days |
| Fix (medium/low) | Within 90 days |

## Scope

### In scope

- Cryptographic flaws (Ed25519 signatures, SHA-256 hashing, Merkle trees)
- Bundle verification bypass (signature, bundle_hash, merkle_root, hash chains)
- SDK vulnerabilities (TypeScript, Python, Go, Rust, WASM)
- Smart contract bugs (DCPAnchor.sol)
- HTTP service vulnerabilities (anchor, transparency-log, revocation)
- Middleware bypass (Express, FastAPI integrations)
- Protocol-level attacks (schema manipulation, hash chain breaks)
- Post-quantum cryptographic flaws (ML-DSA-65/87 signatures, ML-KEM-768 KEM, SLH-DSA-192f)
- Composite signature binding vulnerabilities (pq_over_classical stripping attacks)
- Hybrid KEM key derivation weaknesses (X25519 + ML-KEM-768)
- A2A handshake protocol vulnerabilities (session hijacking, replay)
- Security tier downgrade attacks
- Dual hash chain (SHA-256 + SHA3-256) inconsistencies
- PQ checkpoint chain integrity
- Domain separation tag bypass
- Session nonce replay or splicing

### Out of scope

- Self-declared identities without jurisdiction attestation (by design; see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md))
- Operators running modified verification code (each operator is responsible for their own deployment)
- Denial of service (infrastructure concern, not protocol-level)
- Social engineering attacks against human key holders

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.0.x   | Yes       |
| 1.0.x   | Yes (maintenance) |
| < 1.0   | No        |

## Disclosure Policy

- We follow coordinated disclosure: fixes are developed privately and released before public disclosure.
- Reporters will be credited in the advisory (unless they prefer anonymity).
- We will not pursue legal action against researchers who follow this policy.

## Bug Bounty

DCP-AI runs a bug bounty program for security vulnerabilities:

| Severity | Reward |
|----------|--------|
| Critical (PQ crypto break, signature bypass) | $5,000 - $15,000 |
| High (verification bypass, key leakage) | $1,000 - $5,000 |
| Medium (tier downgrade, chain manipulation) | $500 - $1,000 |
| Low (information disclosure, DoS) | $100 - $500 |

See [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) for full program details.

## Security Model

For a detailed analysis of the protocol's security architecture, attack vectors, and protection layers, see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [docs/NIST_CONFORMITY.md](docs/NIST_CONFORMITY.md).

## Protocol Integrity

Verify that your local implementation matches the canonical protocol:

```bash
dcp integrity
```

This checks all schema fingerprints against `protocol_fingerprints.json`. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#protocol-fingerprints) for details.
