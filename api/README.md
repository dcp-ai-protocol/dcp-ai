# API — OpenAPI & Protocol Buffers

Definiciones formales de la API DCP: especificacion OpenAPI 3.1 para HTTP/REST y Protocol Buffers para gRPC. Usa estas definiciones para generar clientes en cualquier lenguaje.

## Archivos

| Archivo | Formato | Descripcion |
|---------|---------|-------------|
| `openapi.yaml` | OpenAPI 3.1.0 | Spec REST completa con Swagger UI |
| `proto/dcp.proto` | Protocol Buffers 3 | Definicion gRPC con 4 servicios |

## OpenAPI Spec

### Servidores

| Entorno | URL |
|---------|-----|
| Local | `http://localhost:3000` |
| Produccion | `https://api.dcp-ai.org` |

### Endpoints

#### Verification

| Metodo | Path | Descripcion |
|--------|------|-------------|
| `POST /verify` | Verificar un Signed Bundle | Request: `{ signed_bundle, public_key_b64? }` → Response: `{ verified, errors }` |

#### Anchoring

| Metodo | Path | Descripcion |
|--------|------|-------------|
| `POST /anchor` | Anclar bundle hash | Request: `{ bundle_hash, chain? }` → Response: `{ anchored, chain, tx_hash, bundle_hash, timestamp }` |

#### Revocation

| Metodo | Path | Descripcion |
|--------|------|-------------|
| `GET /revocations` | Listar revocaciones | Response: lista de `RevocationRecord` |
| `POST /revocations` | Publicar revocacion | Request: `RevocationRecord` |
| `GET /revocations/{agent_id}` | Estado de revocacion | Response: `{ revoked, record? }` |

#### Transparency Log

| Metodo | Path | Descripcion |
|--------|------|-------------|
| `POST /transparency-log/add` | Agregar entrada | Request: `{ bundle_hash }` → Response: `{ index, leaf_hash, root, size }` |
| `GET /transparency-log/root` | Merkle root actual | Response: `{ root, size }` |
| `GET /transparency-log/proof/{index}` | Inclusion proof | Response: `{ index, leaf_hash, root, proof }` |

#### Health

| Metodo | Path | Descripcion |
|--------|------|-------------|
| `GET /health` | Health check | Response: `{ ok, service }` |

### Schemas principales

- `SignedBundle` — Bundle firmado con Ed25519
- `CitizenshipBundle` — Bundle de ciudadania (HBR + Passport + Intent + Policy + Audit)
- `VerificationResult` — Resultado de verificacion (`verified`, `errors`)
- `AnchorReceipt` — Recibo de anclaje (`anchored`, `chain`, `tx_hash`)
- `RevocationRecord` — Registro de revocacion
- `InclusionProof` — Proof de inclusion en transparency log
- `ErrorResponse` — Respuesta de error estandar

### Swagger UI

Para visualizar la spec interactivamente:

```bash
# Con Swagger UI
npx @redocly/cli preview-docs api/openapi.yaml

# O con Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
  -v $(pwd)/api:/api swaggerapi/swagger-ui
```

## Protocol Buffers (gRPC)

### Paquete

```protobuf
package dcp.v1;
option go_package = "github.com/dcp-ai/dcp-ai-go/proto";
```

### Servicios

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

### Generar clientes

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

Con `tonic-build` en `build.rs`:

```rust
fn main() {
    tonic_build::compile_protos("api/proto/dcp.proto").unwrap();
}
```

## Desarrollo

```bash
# Validar OpenAPI spec
npx @redocly/cli lint api/openapi.yaml

# Generar clientes con OpenAPI Generator
npx @openapitools/openapi-generator-cli generate \
  -i api/openapi.yaml \
  -g typescript-fetch \
  -o generated/ts-client
```

## Licencia

Apache-2.0
