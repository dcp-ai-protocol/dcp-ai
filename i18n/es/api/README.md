<sub>[English](../../../api/README.md) · [中文](../../zh-CN/api/README.md) · **Español** · [日本語](../../ja/api/README.md) · [Português](../../pt-BR/api/README.md)</sub>

<a id="api--openapi--protocol-buffers"></a>
<a id="api-openapi-protocol-buffers"></a>

# API — OpenAPI y Protocol Buffers

> Traducción informativa de [la versión en inglés](../../../api/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Definiciones formales de la API de DCP: especificación OpenAPI 3.1 para HTTP/REST y Protocol Buffers para gRPC. Usa estas definiciones para generar clientes en cualquier lenguaje.

Qué cubren (25/10/2026):

- `openapi.yaml` describe la pasarela de referencia (`server/`) y los servicios de anclaje, registro de transparencia y revocación. No cubre `POST /v2/admit` ni los endpoints de DCP-05 a DCP-09 de la pasarela; para ellos, consulta [server/README.md](../../../server/README.md) y [docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md).
- `proto/dcp.proto` es solo una definición: ningún servidor ni cliente gRPC de este repositorio la implementa.
- El repositorio no configura ninguna API de DCP-AI alojada. Además de las direcciones locales de desarrollo, `openapi.yaml` enumera `https://api.dcp-ai.org`; una URL declarada ahí no es evidencia de un servicio en funcionamiento, y estas instrucciones ni la comprueban ni la llaman. Cubren servicios que ejecuta el operador.

<a id="files"></a>

## Archivos

| Archivo | Formato | Descripción |
|------|--------|-------------|
| `openapi.yaml` | OpenAPI 3.1.0 | Especificación REST (V1 + V2 + fase 3), con las exclusiones indicadas arriba |
| `proto/dcp.proto` | Protocol Buffers 3 | Definición gRPC con 5 servicios |

<a id="openapi-spec"></a>

## Especificación OpenAPI

<a id="servers"></a>

### Servidores

| Entorno | URL |
|-------------|-----|
| Pasarela (local) | `http://localhost:3000` |
| Servicio de anclaje (local) | `http://localhost:3001` |
| Registro de transparencia (local) | `http://localhost:3002` |
| Servicio de revocación (local) | `http://localhost:3003` |

### Endpoints

<a id="health--discovery"></a>
<a id="health-discovery"></a>

#### Salud y descubrimiento

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET /health` | Comprobación de salud | Respuesta: `{ ok, service, supported_versions }` |
| `GET /.well-known/dcp-capabilities.json` | Descubrimiento de capacidades | Respuesta: versiones, algoritmos y funciones admitidos |
| `GET /.well-known/algorithm-advisories.json` | Avisos de algoritmos | Respuesta: `{ advisories }` |
| `GET /.well-known/governance-keys.json` | Claves de gobernanza | Respuesta: conjunto de claves de gobernanza |

<a id="verification"></a>

#### Verificación

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST /verify` | Verifica un Signed Bundle (detecta V1/V2) | Petición: `{ signed_bundle, public_key_b64? }` → Respuesta: `{ verified, dcp_version, errors, warnings }` |
| `POST /v2/bundle/verify` | Verificación V2 completa según el nivel (solo `SignedBundleV2` normativo; los bundles V1 reciben 400) | La respuesta añade `resolved_tier`, `verification_mode`, `session_binding_valid` |

<a id="v2-passport--keys"></a>
<a id="v2-passport-keys"></a>

#### V2: pasaporte y claves

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST /v2/passport/register` | Registra el pasaporte y las claves de un agente (un `agent_id` nuevo necesita el token del operador) | Petición: `{ signed_passport }`; la autofirma compuesta debe verificarse |
| `GET /v2/keys/{kid}` | Consulta del registro de claves | Respuesta: `{ found, kid, key, agent_id }` |
| `POST /v2/keys/rotate` | Rotación de claves con prueba de posesión | Petición: `KeyRotationRecord` (`{ old_kid, new_key, timestamp, proof_of_possession, authorization_sig }`) |

<a id="v2-intent--policy"></a>
<a id="v2-intent-policy"></a>

#### V2: intención y política

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST /v2/intent/declare` | Declara una intención y obtiene la política | Petición: `{ signed_intent }` (su `composite_sig` no se verifica) → Respuesta: `{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }` |
| `GET /v2/policy` | Política actual del verificador | Respuesta: `{ policy, policy_hash, mode }` |
| `POST /v2/policy/mode` | Cambia el modo del verificador (token del operador) | Petición: `{ mode }` (pq_only, hybrid_required, etc.) |

<a id="v2-audit"></a>

#### V2: auditoría

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST /v2/audit/append` | Añade un evento de auditoría | Petición: `{ audit_event }` |
| `POST /v2/audit/compact` | Compacta el rastro de auditoría | Petición: `{ compaction }` |

<a id="v2-revocation--emergency"></a>
<a id="v2-revocation-emergency"></a>

#### V2: revocación y emergencia

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST /v2/emergency-revoke` | Revocación de emergencia (botón de pánico) | Con límite de tasa y verificación de la preimagen |
| `POST /v2/multi-party/authorize` | Autorización multiparte M de N | Petición: `{ authorization }` |

<a id="v2-advisory--governance"></a>
<a id="v2-advisory-governance"></a>

#### V2: avisos y gobernanza

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST /v2/advisory/publish` | Publica un aviso de algoritmo (token del operador) | Petición: `{ advisory }` |
| `GET /v2/advisory/check` | Comprueba los avisos activos | Respuesta: `{ deprecated, warned, revoked }` |
| `POST /v2/advisory/auto-apply` | Aplica automáticamente los avisos a la política (token del operador) | Quita los algoritmos obsoletos y añade los sustitutos |
| `POST /v2/governance/register` | Registra el conjunto de claves de gobernanza (token del operador) | Petición: `{ governance_key_set }` |

<a id="anchoring"></a>

#### Anclaje

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST /anchor` | Ancla un hash de bundle | En el servicio de anclaje (`:3001`): petición `{ bundle_hash }` → respuesta `{ anchored, chain, tx_hash }` (`tx_hash: null` hasta que se implemente el envío on-chain), o 202 en modo por lotes. En la pasarela (`:3000`): 501 |

<a id="revocation-service-on-port-3003"></a>

#### Revocación (servicio en el puerto 3003)

`openapi.yaml` los enumera bajo un prefijo `/revocations`, tal como los expondría una pasarela que hiciera de proxy del servicio. La pasarela de referencia no hace de proxy: llama al servicio de revocación en el puerto 3003 con las rutas directas.

| Método | Ruta en la pasarela | Ruta directa (`:3003`) | Descripción |
|--------|-------------|----------------------|-------------|
| `GET` | `/revocations` | `/list` | Enumera las revocaciones |
| `POST` | `/revocations` | `/revoke` | Publica una revocación |
| `GET` | `/revocations/{agent_id}` | `/check/{agent_id}` | Estado de revocación |

<a id="transparency-log-service-on-port-3002"></a>

#### Registro de transparencia (servicio en el puerto 3002)

`openapi.yaml` los enumera bajo un prefijo `/transparency-log`, tal como los expondría una pasarela que hiciera de proxy. La pasarela de referencia no hace de proxy: llama al servicio en el puerto 3002 sin el prefijo.

| Método | Ruta en la pasarela | Ruta directa (`:3002`) | Descripción |
|--------|-------------|----------------------|-------------|
| `POST` | `/transparency-log/add` | `/add` | Añade una entrada |
| `GET` | `/transparency-log/root` | `/root` | Raíz de Merkle actual |
| `GET` | `/transparency-log/proof/{index}` | `/proof/{index}` | Prueba de inclusión |

<a id="main-schemas"></a>

### Esquemas principales

- `SignedBundleV1` / `SignedBundleV2` — Bundles firmados (V1: Ed25519, V2: firmas compuestas)
- `CitizenshipBundleV1` / `CitizenshipBundleV2` — Citizenship bundles; solo V2 tiene manifiesto y payloads firmados
- `CompositeSignature` — Firma clásica + PQ con modo de vinculación
- `SignedPayload` — Sobre de un artefacto firmado individualmente
- `BundleManifest` — Manifiesto V2 con hashes por artefacto y nonce de sesión
- `VerificationResult` — Resultado con `verified`, `errors`, `warnings`, `verifier_policy_hash`, `resolved_tier`
- `KeyEntryV2` — Entrada de clave V2 con kid, alg y estado
- `PolicyDecisionV2` — Decisión de política V2 con puntuación de riesgo y nivel de seguridad
- `VerifierPolicy` — Configuración de la política del verificador
- `AlgorithmAdvisory` — Aviso de obsolescencia o revocación de un algoritmo
- `GovernanceKeySet` — Conjunto de claves de gobernanza con umbral
- `AnchorReceipt` — Recibo de anclaje
- `RevocationRecord` — Registro de revocación
- `InclusionProof` — Prueba de inclusión del registro de transparencia
- `ErrorResponse` — Respuesta de error estándar

### Swagger UI

Para ver la especificación de forma interactiva:

```bash
# With Redocly CLI 1.x (downloads it)
npx @redocly/cli@1 preview-docs api/openapi.yaml

# Or with Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
  -v $(pwd)/api:/api swaggerapi/swagger-ui
```

## Protocol Buffers (gRPC)

<a id="package"></a>

### Paquete

```protobuf
package dcp.v1;
option go_package = "github.com/dcp-ai/dcp-ai-go/proto";
```

La ruta de `go_package` no es un módulo publicado; define la tuya al generar el código.

<a id="services"></a>

### Servicios

#### VerificationService

| RPC | Petición | Respuesta |
|-----|---------|----------|
| `VerifyBundle` | `VerifyBundleRequest` | `VerifyBundleResponse` |
| `ValidateBundle` | `ValidateBundleRequest` | `ValidateBundleResponse` |
| `VerifyBundleV2` | `VerifyBundleV2Request` | `VerifyBundleV2Response` |
| `HealthCheck` | `HealthCheckRequest` | `HealthCheckResponse` |

#### AnchorService

| RPC | Petición | Respuesta |
|-----|---------|----------|
| `AnchorHash` | `AnchorHashRequest` | `AnchorHashResponse` |
| `AnchorBatch` | `AnchorBatchRequest` | `AnchorBatchResponse` |
| `CheckAnchor` | `CheckAnchorRequest` | `CheckAnchorResponse` |

#### RevocationService

| RPC | Petición | Respuesta |
|-----|---------|----------|
| `Revoke` | `RevokeRequest` | `RevokeResponse` |
| `RevokeV2` | `RevokeV2Request` | `RevokeV2Response` |
| `EmergencyRevoke` | `EmergencyRevokeRequest` | `EmergencyRevokeResponse` |
| `CheckRevocation` | `CheckRevocationRequest` | `CheckRevocationResponse` |
| `CheckRevocationByKid` | `CheckRevocationByKidRequest` | `CheckRevocationByKidResponse` |
| `ListRevocations` | `ListRevocationsRequest` | `ListRevocationsResponse` |

#### TransparencyLogService

| RPC | Petición | Respuesta |
|-----|---------|----------|
| `AddEntry` | `AddEntryRequest` | `AddEntryResponse` |
| `GetRoot` | `GetRootRequest` | `GetRootResponse` |
| `GetProof` | `GetProofRequest` | `GetProofResponse` |

#### KeyService

| RPC | Petición | Respuesta |
|-----|---------|----------|
| `RegisterKeys` | `RegisterKeysRequest` | `RegisterKeysResponse` |
| `LookupKey` | `LookupKeyRequest` | `LookupKeyResponse` |
| `RotateKey` | `RotateKeyRequest` | `RotateKeyResponse` |

<a id="generate-clients"></a>

### Generar clientes

Estos comandos necesitan sus herramientas (`protoc` y sus plugins, `grpc_tools`, `tonic-build`) instaladas; no se ejecutaron para esta página.

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

<a id="development"></a>

## Desarrollo

```bash
# Validate OpenAPI spec
npx @redocly/cli lint api/openapi.yaml

# Generate clients with OpenAPI Generator
npx @openapitools/openapi-generator-cli generate \
  -i api/openapi.yaml \
  -g typescript-fetch \
  -o generated/ts-client
```

<a id="license"></a>

## Licencia

Apache-2.0
