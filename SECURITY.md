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
- Disproportionate resource consumption or algorithmic exhaustion: input that makes a verifier, an SDK or a reference service use CPU, memory or time out of proportion to its size, shown with a bounded local reproduction

### Out of scope

- Self-declared identities without jurisdiction attestation (by design; see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md))
- Operators running modified verification code (each operator is responsible for their own deployment)
- Load or flooding against live infrastructure, or any other disruptive testing of deployed services: not authorized
- Social engineering attacks against human key holders

## Supported Versions

Reports are received for every published version and for `main`. Receiving a report does not mean that a version contains, or will receive, its fix. Fixes are made on `main` and reach users only in a later release; no backport, maintenance release or long-term support is promised. The packages do not share one version number; the `@dcp-ai/*` npm packages follow their own version lines.

| Version | Status |
|---------|--------|
| Latest published (09/11/2026): `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0, `@dcp-ai/cli` 2.2.0, `dcp-ai` 2.11.0 (PyPI), Go `v2.14.0`, Rust `dcp-ai` 2.14.0 | Current. They include the verifier fixes of 26/10/2026, the secondary SHA3-256 checks of 28/10/2026, the fixes listed in the [audit dossier](docs/conformance/AUDIT_DOSSIER.md#artifacts) and the Ed25519 acceptance change P-ED-1 (see the note below) |
| The adapters that depend on the SDK (`@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` and `@dcp-ai/google-a2a` 2.1.0) | Current, not republished. They get the checks of 09/11/2026 only when their installation resolves `@dcp-ai/sdk` 2.4.0; a lockfile that keeps an earlier SDK does not, until you update it |
| Previous releases, current as of 05/11/2026: `@dcp-ai/sdk` 2.3.0, `@dcp-ai/wasm` 2.1.3, `dcp-ai` 2.10.2 (PyPI), Go `v2.13.0` and Rust `dcp-ai` 2.13.0, published on 05/11/2026, and `@dcp-ai/cli` 2.1.1, published on 28/10/2026 | Superseded: they do not apply P-ED-1, so their TypeScript, Go, Rust, WASM and CLI verification accepts Ed25519 signatures that the latest versions reject (the official PyNaCl build behind the Python SDK already rejected them); upgrade |
| Published on 28/10/2026: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go `v2.11.1`, Rust `dcp-ai` 2.11.1 | Superseded: they do not run V2-2 schema validation, so they accept schema-invalid bundles that the latest versions reject; upgrade |
| Minimum published versions with the verifier fixes of 26/10/2026: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` and `@dcp-ai/cli` 2.1.0, `dcp-ai` 2.10.0 (PyPI), Go `v2.11.0`, Rust `dcp-ai` 2.11.0 | Superseded: they do not check the secondary SHA3-256 fields, which the latest versions check; upgrade |
| `@dcp-ai/sdk` 2.1.x | Affected: `verifySignedBundleV2` can be bypassed; fixed in 2.2.0 (see the note below) |
| `@dcp-ai/express` and `@dcp-ai/openclaw` 2.0.0 | Affected: they accept structurally valid V2 bundles without verifying their signatures; do not use them to verify V2 bundles. Fixed in 2.1.0 |
| FastAPI integration in `dcp-ai` 2.9.0 (PyPI) | Affected for V2; fixed in 2.10.0 |
| Other earlier published versions | Not evaluated against these fixes: no coverage is claimed for them. Reports are received |
| Other npm adapters and scaffolders: `@dcp-ai/anthropic-mcp` and `@dcp-ai/google-a2a` 2.1.0; `@dcp-ai/autogen`, `@dcp-ai/w3c-did` and the `create-*` scaffolders 2.0.1 | Optional and outside the protocol core; their limits are in their READMEs and in the [npm inventory](docs/NPM_RELEASES.md) |
| 1.0.x | Earlier line: reports are received; no maintenance release is scheduled or promised |
| < 1.0 | Unsupported |

`@dcp-ai/sdk` 2.2.0 was published to npm on 26/10/2026 as `latest`, with the verifier fixes. Earlier affected versions do not gain the fixes automatically.

**Ed25519 P-ED-1 (09/11/2026).** `@dcp-ai/sdk` 2.4.0, `@dcp-ai/wasm` 2.2.0, `@dcp-ai/cli` 2.2.0, `dcp-ai` 2.11.0 (PyPI), Go v2.14.0 and Rust `dcp-ai` 2.14.0 reject an Ed25519 signature whose public key or R is not a canonical encoding or is a point of order dividing 8, as well as one with S ≥ L. This changes which signatures are accepted: keep failing evidence as it is; sign again with the same key when it meets P-ED-1, rotate a non-canonical public key and replace a key of small order. Upgrade with `npm install @dcp-ai/sdk@^2.4.0` or the equivalent for your ecosystem, and refresh your lockfile; the adapters 2.1.0 get P-ED-1 once the lockfile resolves `@dcp-ai/sdk` 2.4.0. The Rust `otlp` feature of 2.14.0 requires `anyhow` 1.0.103 and `tokio` 1.53.3 or later (RUSTSEC-2026-0190, RUSTSEC-2026-0386); the default and `wasm` builds select neither, and a lock that enables `otlp` keeps its versions until you run `cargo update -p anyhow -p tokio`.

**Secondary SHA3-256 fields (28/10/2026).** `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 and Rust `dcp-ai` 2.11.1 verify the optional secondary SHA3-256 fields of [V2-11](spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) when they are present; earlier versions, including 2.2.0, 2.1.0, 2.10.0 and 2.11.0, do not. Upgrade with `npm install @dcp-ai/sdk@^2.2.1` or the equivalent for your ecosystem, and refresh your lockfile. The published adapters `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` and `@dcp-ai/google-a2a` 2.1.0 were not republished: they depend on `@dcp-ai/sdk` `^2.2.0` and get the secondary checks once your lockfile resolves `@dcp-ai/sdk` 2.2.1 or later. See the [published npm package inventory](docs/NPM_RELEASES.md) and [Published versions](docs/README.md#published-versions).

**Affected and corrected integration releases (26/10/2026).** `@dcp-ai/express` 2.0.0 and `@dcp-ai/openclaw` 2.0.0 accept structurally valid V2 bundles without verifying their signatures. Both are corrected in npm version 2.1.0, with `@dcp-ai/sdk` `^2.2.0`. Do not use 2.0.0 to verify V2 bundles. The FastAPI integration in `dcp-ai` 2.9.0 remains affected; the corrected implementation is now published in PyPI version 2.10.0. See the [Python upgrade notes](docs/PYTHON_RELEASE.md). See [Express](integrations/express/README.md), [OpenClaw](integrations/openclaw/README.md) and [FastAPI](integrations/fastapi/README.md). Package support does not mean every older build contains the fixes.

## Disclosure Policy

- We follow coordinated disclosure: fixes are developed privately and released before public disclosure.
- Reporters will be credited in the advisory (unless they prefer anonymity).
- We will not pursue legal action against researchers who follow this policy.

## Rewards

There is no bug bounty with fixed rewards, and no reward is guaranteed. The maintainers may offer a reward for a report case by case; a reward is committed only by an explicit agreement with them. Credit in the advisory is described under Disclosure Policy.

> **Note (05/11/2026).** Until this date this section listed fixed reward ranges per severity, explicitly marked as unconfirmed because [GOVERNANCE.md](GOVERNANCE.md) and [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) described case-by-case rewards. This page now states case-by-case rewards, as those two documents do.

See [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md#security-disclosure) for how security disclosure fits the early-adopter program.

## Security Model

For a detailed analysis of the protocol's security architecture, attack vectors, and protection layers, see [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) and [docs/NIST_CONFORMITY.md](docs/NIST_CONFORMITY.md). For an independent review, start with the [audit dossier](docs/conformance/AUDIT_DOSSIER.md): its baseline, reproduction commands, artifacts and known limits.

## Protocol Integrity

Compare the local V1 schema files with the local fingerprint manifest:

```bash
dcp integrity
```

This compares the V1 schema bytes against `protocol_fingerprints.json`. It does not check V2 schemas, implementation behavior or conformance, and the local manifest is not an authenticated trust anchor. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#protocol-fingerprints) for details.
