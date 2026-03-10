# DCP-AI ↔ W3C DID/VC Bridge

Converts between DCP artifacts and W3C Decentralized Identifiers (DIDs) and Verifiable Credentials (VCs).

## Supported DCP Specifications

DCP-01 through DCP-09.

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
import { rprToDIDDocument, passportToVC, bundleToVP } from './index.js';

// Convert an RPR to a DID Document
const didDoc = rprToDIDDocument(myRpr);

// Issue a Verifiable Credential for an agent
const vc = passportToVC(myPassport, 'did:dcp:issuer-id');

// Wrap a full bundle as a Verifiable Presentation
const vp = bundleToVP(signedBundle, 'did:dcp:holder-id');
```

## Notes

- Skeleton conversions (W3C → DCP) produce partial records that require additional processing (key ID recomputation, signing, etc.) before they are valid DCP artifacts.
- The `publicKeyMultibase` encoding uses the `z` prefix (base64url) as specified in the DID Core specification.
