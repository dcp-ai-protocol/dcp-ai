# API — OpenAPI & Protocol Buffers

Formal DCP API definitions: OpenAPI 3.1 specification for HTTP/REST and Protocol Buffers for gRPC. Use these definitions to generate clients in any language.

## Files

| File | Format | Description |
|------|--------|-------------|
| `openapi.yaml` | OpenAPI 3.1.0 | Full REST spec with Swagger UI |
| `proto/dcp.proto` | Protocol Buffers 3 | gRPC definition with 4 services |

## OpenAPI Spec

### Servers

| Environment | URL |
|-------------|-----|
| Local | `http://localhost:3000` |
| Production | `https://api.dcp-ai.org` |

### Endpoints

#### Verification

| Method | Path | Description |
|--------|------|-------------|
| `POST /verify` | Verify a Signed Bundle | Request: `{ signed_bundle, public_key_b64? }` → Response: `{ verified, errors }` |

#### Anchoring

| Method | Path | Description |
|--------|------|-------------|
| `POST /anchor` | Anchor bundle hash | Request: `{ bundle_hash, chain? }` → Response: `{ anchored, chain, tx_hash, bundle_hash, timestamp }` |

#### Revocation

| Method | Path | Description |
|--------|------|-------------|
| `GET /revocations` | List revocations | Response: list of `RevocationRecord` |
| `POST /revocations` | Publish revocation | Request: `RevocationRecord` |
| `GET /revocations/{agent_id}` | Revocation status | Response: `{ revoked, record? }` |

#### Transparency Log

| Method | Path | Description |
|--------|------|-------------|
| `POST /transparency-log/add` | Add entry | Request: `{ bundle_hash }` → Response: `{ index, leaf_hash, root, size }` |
| `GET /transparency-log/root` | Current Merkle root | Response: `{ root, size }` |
| `GET /transparency-log/proof/{index}` | Inclusion proof | Response: `{ index, leaf_hash, root, proof }` |

#### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET /health` | Health check | Response: `{ ok, service }` |

### Main Schemas

- `SignedBundle` — Bundle signed with Ed25519
- `CitizenshipBundle` — Citizenship bundle (HBR + Passport + Intent + Policy + Audit)
- `VerificationResult` — Verification result (`verified`, `errors`)
- `AnchorReceipt` — Anchoring receipt (`anchored`, `chain`, `tx_hash`)
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
| `CheckRevocation` | `CheckRevocationRequest` | `CheckRevocationResponse` |
| `ListRevocations` | `ListRevocationsRequest` | `ListRevocationsResponse` |

#### TransparencyLogService

| RPC | Request | Response |
|-----|---------|----------|
| `AddEntry` | `AddEntryRequest` | `AddEntryResponse` |
| `GetRoot` | `GetRootRequest` | `GetRootResponse` |
| `GetProof` | `GetProofRequest` | `GetProofResponse` |

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
