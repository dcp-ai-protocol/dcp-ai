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

The packages do not share one version number; the `@dcp-ai/*` npm packages follow their own version lines.

| Version | Supported |
|---------|-----------|
| 2.10.x (`dcp-ai` on crates.io, Go module `sdks/go/v2`) | Yes |
| 2.9.x (`dcp-ai` on PyPI, crates.io, Go module `sdks/go/v2`) | Yes |
| 2.8.x (`dcp-ai` on PyPI and crates.io, Go module `sdks/go/v2`) | Yes |
| 2.2.x (`@dcp-ai/sdk`) | Yes |
| 2.1.x (`@dcp-ai/sdk`) | No: `verifySignedBundleV2` can be bypassed; the fix is in 2.2.x (see the note below) |
| 2.1.x (`@dcp-ai/wasm`, `@dcp-ai/openclaw`) | Yes |
| 2.0.x (`@dcp-ai/wasm`, `@dcp-ai/cli` and the other `@dcp-ai/*` npm packages) | Yes |
| 1.0.x   | Yes (maintenance) |
| < 1.0   | No        |

`@dcp-ai/sdk` 2.2.0 is tagged in `v2.10.0` but is not on npm: on 25/10/2026 the npm registry had 2.0.0, 2.1.0
and 2.1.1, with 2.1.1 as `latest`. Until 2.2.0 is published, the fix is only available by building the SDK from a
checkout of this repository (`cd sdks/typescript && npm install && npm run build`); a version installed from npm
stays affected.

**Known affected integration releases (25/10/2026):** the support table does not mean that a published build contains every fix on `main`. `@dcp-ai/express` 2.0.0 and `@dcp-ai/openclaw` 2.0.0 on npm, and the FastAPI integration in `dcp-ai` 2.9.0 on PyPI, accept structurally valid V2 bundles without cryptographically verifying their signatures. These paths are corrected on `main`, but no corrected package has been published yet. Do not use those releases to verify V2 bundles. See the source-checkout instructions and release notices in the [Express](integrations/express/README.md), [OpenClaw](integrations/openclaw/README.md) and [FastAPI](integrations/fastapi/README.md) READMEs. This notice does not change the supported-version policy above.

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

> **Note (25/10/2026): the documents disagree.** This table gives fixed reward ranges, while [GOVERNANCE.md](GOVERNANCE.md) and [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) say rewards are decided case by case, with no fixed tiers. The texts are kept as they are until a maintainer confirms which applies; until then, treat any reward as unconfirmed and ask the maintainers.

See [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) for full program details.

## Security Model

For a detailed analysis of the protocol's security architecture, attack vectors, and protection layers, see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [docs/NIST_CONFORMITY.md](docs/NIST_CONFORMITY.md).

## Protocol Integrity

Compare the local V1 schema files with the local fingerprint manifest:

```bash
dcp integrity
```

This compares the V1 schema bytes against `protocol_fingerprints.json`. It does not check V2 schemas, implementation behavior or conformance, and the local manifest is not an authenticated trust anchor. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#protocol-fingerprints) for details.
