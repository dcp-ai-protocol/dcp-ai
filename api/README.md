# API — OpenAPI & Protocol Buffers

Formal DCP API definitions: OpenAPI 3.1 specification for HTTP/REST and Protocol Buffers for gRPC. Use these definitions to generate clients in any language.

## Files

| File | Format | Description |
|------|--------|-------------|
| `openapi.yaml` | OpenAPI 3.1.0 | Full REST spec (V1 + V2 + Phase 3) with Swagger UI |
| `proto/dcp.proto` | Protocol Buffers 3 | gRPC definition with 5 services |

## OpenAPI Spec

### Servers

| Environment | URL |
|-------------|-----|
| Local | `http://localhost:3000` |
| Production | `https://api.dcp-ai.org` |

### Endpoints

#### Health & Discovery

| Method | Path | Description |
|--------|------|-------------|
| `GET /health` | Health check | Response: `{ ok, service, supported_versions }` |
| `GET /.well-known/dcp-capabilities.json` | Capability discovery | Response: supported versions, algs, features |
| `GET /.well-known/algorithm-advisories.json` | Algorithm advisories | Response: `{ advisories }` |
| `GET /.well-known/governance-keys.json` | Governance keys | Response: governance key set |

#### Verification

| Method | Path | Description |
|--------|------|-------------|
| `POST /verify` | Verify a Signed Bundle (V1/V2 auto-detect) | Request: `{ signed_bundle, public_key_b64? }` → Response: `{ verified, dcp_version, errors, warnings }` |
| `POST /v2/bundle/verify` | Full V2 tier-aware verification | Response adds `resolved_tier`, `verification_mode`, `session_binding_valid` |

#### V2 Passport & Keys

| Method | Path | Description |
|--------|------|-------------|
| `POST /v2/passport/register` | Register agent passport + keys | Request: `{ signed_passport }` |
| `GET /v2/keys/{kid}` | Key registry lookup | Response: `{ found, kid, key, agent_id }` |
| `POST /v2/keys/rotate` | Key rotation with PoP | Request: `{ old_kid, new_key, proof_of_possession }` |

#### V2 Intent & Policy

| Method | Path | Description |
|--------|------|-------------|
| `POST /v2/intent/declare` | Declare intent, get policy | Response: `{ policy_decision, security_tier, verification_mode }` |
| `GET /v2/policy` | Current verifier policy | Response: `{ policy, policy_hash, mode }` |
| `POST /v2/policy/mode` | Switch verifier mode | Request: `{ mode }` (pq_only, hybrid_required, etc.) |

#### V2 Audit

| Method | Path | Description |
|--------|------|-------------|
| `POST /v2/audit/append` | Append audit event | Request: `{ audit_event }` |
| `POST /v2/audit/compact` | Compact audit trail | Request: `{ compaction }` |

#### V2 Revocation & Emergency

| Method | Path | Description |
|--------|------|-------------|
| `POST /v2/emergency-revoke` | Emergency revocation (panic button) | Rate-limited, pre-image verification |
| `POST /v2/multi-party/authorize` | Multi-party M-of-N authorization | Request: `{ authorization }` |

#### V2 Advisory & Governance

| Method | Path | Description |
|--------|------|-------------|
| `POST /v2/advisory/publish` | Publish algorithm advisory | Request: `{ advisory }` |
| `GET /v2/advisory/check` | Check active advisories | Response: `{ deprecated, warned, revoked }` |
| `POST /v2/advisory/auto-apply` | Auto-apply advisories to policy | Removes deprecated algs, adds replacements |
| `POST /v2/governance/register` | Register governance key set | Request: `{ governance_key_set }` |

#### Anchoring

| Method | Path | Description |
|--------|------|-------------|
| `POST /anchor` | Anchor bundle hash | Request: `{ bundle_hash, chain? }` → Response: `{ anchored, chain, tx_hash }` or 501 |

#### Revocation (service on port 3003)

Gateway paths use the `/revocations` prefix. When accessing the revocation service directly on port 3003, use the direct paths shown below.

| Method | Gateway path | Direct path (`:3003`) | Description |
|--------|-------------|----------------------|-------------|
| `GET` | `/revocations` | `/list` | List revocations |
| `POST` | `/revocations` | `/revoke` | Publish revocation |
| `GET` | `/revocations/{agent_id}` | `/check/{agent_id}` | Revocation status |

#### Transparency Log (service on port 3002)

Gateway paths use the `/transparency-log` prefix. When accessing the service directly on port 3002, strip the prefix.

| Method | Gateway path | Direct path (`:3002`) | Description |
|--------|-------------|----------------------|-------------|
| `POST` | `/transparency-log/add` | `/add` | Add entry |
| `GET` | `/transparency-log/root` | `/root` | Current Merkle root |
| `GET` | `/transparency-log/proof/{index}` | `/proof/{index}` | Inclusion proof |

### Main Schemas

- `SignedBundleV1` / `SignedBundleV2` — Signed bundles (V1: Ed25519, V2: composite signatures)
- `CitizenshipBundleV1` / `CitizenshipBundleV2` — Citizenship bundles with manifest and signed payloads
- `CompositeSignature` — Classical + PQ signature with binding mode
- `SignedPayload` — Individually signed artifact envelope
- `BundleManifest` — V2 manifest with per-artifact hashes and session nonce
- `VerificationResult` — Result with `verified`, `errors`, `warnings`, `verifier_policy_hash`, `resolved_tier`
- `KeyEntryV2` — V2 key entry with kid, alg, status
- `PolicyDecisionV2` — V2 policy decision with risk score and security tier
- `VerifierPolicy` — Verifier policy configuration
- `AlgorithmAdvisory` — Algorithm deprecation/revocation advisory
- `GovernanceKeySet` — Governance key set with threshold
- `AnchorReceipt` — Anchoring receipt
- `RevocationRecord` — Revocation record
- `InclusionProof` — Transparency log inclusion proof
- `ErrorResponse` — Standard error response

### Swagger UI

To view the spec interactively:

```bash
# With Swagger UI
npx @redocly/cli preview-docs api/openapi.yaml

# Or with Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
  -v $(pwd)/api:/api swaggerapi/swagger-ui
```

## Protocol Buffers (gRPC)

### Package

```protobuf
package dcp.v1;
option go_package = "github.com/dcp-ai/dcp-ai-go/proto";
```

### Services

#### VerificationService

| RPC | Request | Response |
|-----|---------|----------|
| `VerifyBundle` | `VerifyBundleRequest` | `VerifyBundleResponse` |
| `ValidateBundle` | `ValidateBundleRequest` | `ValidateBundleResponse` |
| `VerifyBundleV2` | `VerifyBundleV2Request` | `VerifyBundleV2Response` |
| `HealthCheck` | `HealthCheckRequest` | `HealthCheckResponse` |

#### AnchorService

| RPC | Request | Response |
|-----|---------|----------|
| `AnchorHash` | `AnchorHashRequest` | `AnchorHashResponse` |
| `AnchorBatch` | `AnchorBatchRequest` | `AnchorBatchResponse` |
| `CheckAnchor` | `CheckAnchorRequest` | `CheckAnchorResponse` |

#### RevocationService

| RPC | Request | Response |
|-----|---------|----------|
| `Revoke` | `RevokeRequest` | `RevokeResponse` |
| `RevokeV2` | `RevokeV2Request` | `RevokeV2Response` |
| `EmergencyRevoke` | `EmergencyRevokeRequest` | `EmergencyRevokeResponse` |
| `CheckRevocation` | `CheckRevocationRequest` | `CheckRevocationResponse` |
| `CheckRevocationByKid` | `CheckRevocationByKidRequest` | `CheckRevocationByKidResponse` |
| `ListRevocations` | `ListRevocationsRequest` | `ListRevocationsResponse` |

#### TransparencyLogService

| RPC | Request | Response |
|-----|---------|----------|
| `AddEntry` | `AddEntryRequest` | `AddEntryResponse` |
| `GetRoot` | `GetRootRequest` | `GetRootResponse` |
| `GetProof` | `GetProofRequest` | `GetProofResponse` |

#### KeyService

| RPC | Request | Response |
|-----|---------|----------|
| `RegisterKeys` | `RegisterKeysRequest` | `RegisterKeysResponse` |
| `LookupKey` | `LookupKeyRequest` | `LookupKeyResponse` |
| `RotateKey` | `RotateKeyRequest` | `RotateKeyResponse` |

### Generate Clients

#### Go

```bash
protoc --go_out=. --go-grpc_out=. api/proto/dcp.proto
```

#### Python

```bash
python -m grpc_tools.protoc \
  -I api/proto \
  --python_out=. \
  --grpc_python_out=. \
  api/proto/dcp.proto
```

#### TypeScript

```bash
npx grpc_tools_node_protoc \
  --ts_out=. \
  --grpc_out=. \
  -I api/proto \
  api/proto/dcp.proto
```

#### Rust

With `tonic-build` in `build.rs`:

```rust
fn main() {
    tonic_build::compile_protos("api/proto/dcp.proto").unwrap();
}
```

## Development

```bash
# Validate OpenAPI spec
npx @redocly/cli lint api/openapi.yaml

# Generate clients with OpenAPI Generator
npx @openapitools/openapi-generator-cli generate \
  -i api/openapi.yaml \
  -g typescript-fetch \
  -o generated/ts-client
```

## License

Apache-2.0
