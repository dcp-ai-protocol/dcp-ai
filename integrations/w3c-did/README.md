# DCP-AI ↔ W3C DID/VC Bridge

Converts between DCP artifacts and W3C Decentralized Identifiers (DIDs) and Verifiable Credentials (VCs).

## Installation

```bash
npm install @dcp-ai/w3c-did
```

npm's 2.0.1 (26/10/2026) has the same `index.js` as the source on `main`. It runs on Node.js (it uses `Buffer`) and has no dependencies.

## Limits (25/10/2026)

Read these before relying on the output, checked against `index.js`:

- **Keys.** `rprToDIDDocument` reads the keys from `rpr.keys`. A V2 RPR that follows the schema carries them in `binding_keys`, which it does not read, so its DID Document has no verification methods.
- **Encoding.** `publicKeyMultibase` is `z` followed by base64url. In [Multibase](https://www.w3.org/TR/cid-1.0/#multibase), `z` means base58btc: this mislabels the encoding and may produce a decoding error or different key bytes in other tools. This package's `didDocumentToRPR` uses the matching base64url decoder, not a conforming multibase decoder.
- **No proofs.** The Verifiable Credentials and Presentations it builds carry no `proof`: they are unsigned. `passportToVC` copies selected passport fields and does not preserve a DCP signature. `bundleToVP` preserves the supplied signed bundle in `dcpBundle`, which must be checked separately with a DCP verifier; that check does not authenticate the surrounding VP's `holder`, `created` or copied credential fields.
- **Context URL.** The DID Documents it produces list `https://w3id.org/security/suites/ed2519-2020/v1` in `@context`, a misspelling of the Ed25519-2020 suite URL (`index.js`). Until that is fixed in another change, do not treat the output as conforming W3C DID JSON-LD.
- **Namespaces.** This repository uses `did:dcp:` and `PostQuantumVerificationKey2024` as custom identifiers. It supplies no DID resolver or registration evidence for them; do not assume that external DID/VC tools recognize them.

## Supported DCP Specifications

DCP-01 through DCP-09, as partial mappings of the fields listed below and with the limits above; not a full implementation of those specifications.

## Overview

This bridge enables interoperability between the DCP-AI identity layer and the W3C decentralized identity ecosystem. It supports bidirectional conversion of:

- **Responsible Principal Records ↔ DID Documents** — map DCP human identities to `did:dcp:` method DIDs with verification methods derived from RPR keys.
- **Agent Passports ↔ Verifiable Credentials** — represent DCP agent certifications as W3C VCs, including capabilities, liability mode, and jurisdiction.
- **Signed Bundles → Verifiable Presentations** — wrap full DCP Citizenship Bundles as W3C VPs for presentation to external verifiers.

## Functions

| Function | Direction | Description |
|---|---|---|
| `rprToDIDDocument(rpr)` | DCP → W3C | Convert a Responsible Principal Record to a DID Document |
| `didDocumentToRPR(didDoc)` | W3C → DCP | Convert a DID Document back to an RPR skeleton |
| `passportToVC(passport, issuerDid)` | DCP → W3C | Convert an Agent Passport to a Verifiable Credential |
| `vcToPassport(vc)` | W3C → DCP | Convert a Verifiable Credential back to a Passport skeleton |
| `bundleToVP(signedBundle, holderDid)` | DCP → W3C | Wrap a signed bundle as a Verifiable Presentation |
| `rightsToServiceEndpoints(rightsDeclaration)` | DCP → W3C | Convert rights declaration to DID service endpoints (DCP-08) |

## DID Method

This bridge uses the `did:dcp:` method namespace. DID identifiers are derived directly from RPR human IDs:

```
did:dcp:<human-id-uuid>
```

Verification methods support both Ed25519 (classical) and post-quantum key types.

## Usage

```javascript
// Fragment: myRpr, myPassport and signedBundle come from your application
import { rprToDIDDocument, passportToVC, bundleToVP } from '@dcp-ai/w3c-did';

// Convert an RPR to a DID Document
const didDoc = rprToDIDDocument(myRpr);

// Issue a Verifiable Credential for an agent
const vc = passportToVC(myPassport, 'did:dcp:issuer-id');

// Wrap a full bundle as a Verifiable Presentation
const vp = bundleToVP(signedBundle, 'did:dcp:holder-id');
```

## Notes

- Skeleton conversions (W3C → DCP) produce partial records that require additional processing (key ID recomputation, signing, etc.) before they are valid DCP artifacts.
- The `publicKeyMultibase` value mislabels base64url as base58btc and does not correctly encode the original key for multibase consumers (see Limits).
