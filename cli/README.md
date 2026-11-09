# @dcp-ai/cli

Command-line tool for the Digital Citizenship Protocol for AI agents (DCP-AI). `dcp-ai verify` checks the signatures and the structure of a bundle file, and `dcp-init` sets up a directory for an agent. It needs Node.js 18 or later.

## Installation

```bash
npm install -g @dcp-ai/cli@^2.2.0
dcp-ai --version
```

Version 2.2.0 requires `@dcp-ai/sdk` `^2.4.0`, which npm installs with it. For the versions available in the registry, see [Published versions](../docs/README.md#published-versions).

## Commands

| Command | What it does |
|---|---|
| `dcp-ai verify <bundle.json>` | Verifies a bundle file: a V2 bundle with the normative V2 verifier of `@dcp-ai/sdk`, a V1 file with its Ed25519 signature over the canonical bundle |
| `dcp-ai init` | Runs the `dcp-init` wizard in the current directory |
| `dcp-ai status` | Shows the configuration found in `.dcp/` |
| `dcp-ai sign <bundle.json>` | Signs a bundle with the keys in `.dcp/` |
| `dcp-ai info` | Shows the protocol version and the capabilities |
| `dcp-ai --version` | Prints the CLI version and the protocol version |

## Verification and exit codes

`dcp-ai verify` exits with 0 when the bundle is VALID. It exits with 1 when the bundle is INVALID, when the file cannot be read or parsed, and for the pre-normative V2 envelope. It looks for a `.dcp/` directory in the current directory and then in each parent: a key in `.dcp/keys/ed25519_public.key` pins the expected signer, and without one the keys come from the bundle itself.

VALID is a result about signatures and structure only. It does not establish that the principal is trusted, it is not an admission decision under a trust set or a profile, and it authorizes no action; those are separate steps of the application (see [ADMISSION.md](../docs/ADMISSION.md)).

## Ed25519 P-ED-1 in 2.2.0

`dcp-ai verify` rejects an Ed25519 signature whose public key or R is not a canonical encoding, or is a point of order dividing 8, as well as one with S ≥ L: it prints INVALID and exits with 1. Keep failing evidence as it is; sign again with the same key when it meets P-ED-1, rotate a non-canonical public key and replace a key of small order. See the [changelog](../CHANGELOG.md#unreleased) and the [crypto profile](../spec/profiles/crypto/README.md).

## Limits

- The CLI runs no admission, mandate chain or activation, and authorizes no action.
- `dcp-ai init` and `dcp-ai sign` keep private keys in `.dcp/` of the current directory. Keep that directory out of version control and away from shared locations.
- [TESTING.md](TESTING.md) explains how the repository tests the CLI against the SDK built from the same checkout.
