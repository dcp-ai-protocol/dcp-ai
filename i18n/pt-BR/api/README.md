<sub>[English](../../../api/README.md) · [中文](../../zh-CN/api/README.md) · [Español](../../es/api/README.md) · [日本語](../../ja/api/README.md) · **Português**</sub>

<a id="api--openapi--protocol-buffers"></a>
<a id="api-openapi-protocol-buffers"></a>

# API — OpenAPI e Protocol Buffers

> Tradução informativa da [versão em inglês](../../../api/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Definições formais da API do DCP: especificação OpenAPI 3.1 para HTTP/REST e Protocol Buffers para gRPC. Use essas definições para gerar clientes em qualquer linguagem.

O que elas cobrem (25/10/2026):

- `openapi.yaml` descreve o gateway de referência (`server/`) e os serviços de ancoragem, log de transparência e revogação. Não cobre `POST /v2/admit` nem os endpoints do DCP-05 ao DCP-09 do gateway; para eles, consulte [server/README.md](../../../server/README.md) e [docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md).
- `proto/dcp.proto` é só uma definição: nenhum servidor ou cliente gRPC deste repositório a implementa.
- O repositório não configura nenhuma API do DCP-AI hospedada. Além dos endereços locais de desenvolvimento, `openapi.yaml` lista `https://api.dcp-ai.org`; uma URL declarada ali não é evidência de um serviço em funcionamento, e estas instruções nem a checam nem a chamam. Elas cobrem serviços executados pelo operador.

<a id="files"></a>

## Arquivos

| Arquivo | Formato | Descrição |
|------|--------|-------------|
| `openapi.yaml` | OpenAPI 3.1.0 | Especificação REST (V1 + V2 + fase 3), com as exclusões indicadas acima |
| `proto/dcp.proto` | Protocol Buffers 3 | Definição gRPC com 5 serviços |

<a id="openapi-spec"></a>

## Especificação OpenAPI

<a id="servers"></a>

### Servidores

| Ambiente | URL |
|-------------|-----|
| Gateway (local) | `http://localhost:3000` |
| Serviço de ancoragem (local) | `http://localhost:3001` |
| Log de transparência (local) | `http://localhost:3002` |
| Serviço de revogação (local) | `http://localhost:3003` |

### Endpoints

<a id="health--discovery"></a>
<a id="health-discovery"></a>

#### Saúde e descoberta

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET /health` | Checagem de saúde | Resposta: `{ ok, service, supported_versions }` |
| `GET /.well-known/dcp-capabilities.json` | Descoberta de capacidades | Resposta: versões, algoritmos e funcionalidades suportados |
| `GET /.well-known/algorithm-advisories.json` | Avisos de algoritmos | Resposta: `{ advisories }` |
| `GET /.well-known/governance-keys.json` | Chaves de governança | Resposta: conjunto de chaves de governança |

<a id="verification"></a>

#### Verificação

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST /verify` | Verifica um Signed Bundle (detecta V1/V2) | Requisição: `{ signed_bundle, public_key_b64? }` → Resposta: `{ verified, dcp_version, errors, warnings }` |
| `POST /v2/bundle/verify` | Verificação V2 completa conforme o nível (só `SignedBundleV2` normativo; bundles V1 recebem 400) | A resposta acrescenta `resolved_tier`, `verification_mode`, `session_binding_valid` |

<a id="v2-passport--keys"></a>
<a id="v2-passport-keys"></a>

#### V2: passaporte e chaves

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST /v2/passport/register` | Registra o passaporte e as chaves de um agente (um `agent_id` novo precisa do token do operador) | Requisição: `{ signed_passport }`; a autoassinatura composta deve ser verificada |
| `GET /v2/keys/{kid}` | Consulta ao registro de chaves | Resposta: `{ found, kid, key, agent_id }` |
| `POST /v2/keys/rotate` | Rotação de chaves com prova de posse | Requisição: `KeyRotationRecord` (`{ old_kid, new_key, timestamp, proof_of_possession, authorization_sig }`) |

<a id="v2-intent--policy"></a>
<a id="v2-intent-policy"></a>

#### V2: intenção e política

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST /v2/intent/declare` | Declara uma intenção e obtém a política | Requisição: `{ signed_intent }` (a sua `composite_sig` não é verificada) → Resposta: `{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }` |
| `GET /v2/policy` | Política atual do verificador | Resposta: `{ policy, policy_hash, mode }` |
| `POST /v2/policy/mode` | Troca o modo do verificador (token do operador) | Requisição: `{ mode }` (pq_only, hybrid_required etc.) |

<a id="v2-audit"></a>

#### V2: auditoria

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST /v2/audit/append` | Acrescenta um evento de auditoria | Requisição: `{ audit_event }` |
| `POST /v2/audit/compact` | Compacta a trilha de auditoria | Requisição: `{ compaction }` |

<a id="v2-revocation--emergency"></a>
<a id="v2-revocation-emergency"></a>

#### V2: revogação e emergência

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST /v2/emergency-revoke` | Revogação de emergência (botão de pânico) | Com limite de taxa e verificação da pré-imagem |
| `POST /v2/multi-party/authorize` | Autorização multipartes M de N | Requisição: `{ authorization }` |

<a id="v2-advisory--governance"></a>
<a id="v2-advisory-governance"></a>

#### V2: avisos e governança

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST /v2/advisory/publish` | Publica um aviso de algoritmo (token do operador) | Requisição: `{ advisory }` |
| `GET /v2/advisory/check` | Checa os avisos ativos | Resposta: `{ deprecated, warned, revoked }` |
| `POST /v2/advisory/auto-apply` | Aplica automaticamente os avisos à política (token do operador) | Remove os algoritmos obsoletos e acrescenta os substitutos |
| `POST /v2/governance/register` | Registra o conjunto de chaves de governança (token do operador) | Requisição: `{ governance_key_set }` |

<a id="anchoring"></a>

#### Ancoragem

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST /anchor` | Ancora um hash de bundle | No serviço de ancoragem (`:3001`): requisição `{ bundle_hash }` → resposta `{ anchored, chain, tx_hash }` (`tx_hash: null` até que o envio on-chain seja implementado), ou 202 no modo em lote. No gateway (`:3000`): 501 |

<a id="revocation-service-on-port-3003"></a>

#### Revogação (serviço na porta 3003)

`openapi.yaml` os lista sob um prefixo `/revocations`, como um gateway que fizesse proxy do serviço os exporia. O gateway de referência não faz proxy: chame o serviço de revogação na porta 3003 com os caminhos diretos.

| Método | Caminho no gateway | Caminho direto (`:3003`) | Descrição |
|--------|-------------|----------------------|-------------|
| `GET` | `/revocations` | `/list` | Lista as revogações |
| `POST` | `/revocations` | `/revoke` | Publica uma revogação |
| `GET` | `/revocations/{agent_id}` | `/check/{agent_id}` | Estado de revogação |

<a id="transparency-log-service-on-port-3002"></a>

#### Log de transparência (serviço na porta 3002)

`openapi.yaml` os lista sob um prefixo `/transparency-log`, como um gateway que fizesse proxy os exporia. O gateway de referência não faz proxy: chame o serviço na porta 3002 sem o prefixo.

| Método | Caminho no gateway | Caminho direto (`:3002`) | Descrição |
|--------|-------------|----------------------|-------------|
| `POST` | `/transparency-log/add` | `/add` | Acrescenta uma entrada |
| `GET` | `/transparency-log/root` | `/root` | Raiz de Merkle atual |
| `GET` | `/transparency-log/proof/{index}` | `/proof/{index}` | Prova de inclusão |

<a id="main-schemas"></a>

### Schemas principais

- `SignedBundleV1` / `SignedBundleV2` — Bundles assinados (V1: Ed25519, V2: assinaturas compostas)
- `CitizenshipBundleV1` / `CitizenshipBundleV2` — Citizenship bundles; só a V2 tem manifesto e payloads assinados
- `CompositeSignature` — Assinatura clássica + PQ com modo de vinculação
- `SignedPayload` — Envelope de um artefato assinado individualmente
- `BundleManifest` — Manifesto V2 com hashes por artefato e nonce de sessão
- `VerificationResult` — Resultado com `verified`, `errors`, `warnings`, `verifier_policy_hash`, `resolved_tier`
- `KeyEntryV2` — Entrada de chave V2 com kid, alg e estado
- `PolicyDecisionV2` — Decisão de política V2 com pontuação de risco e nível de segurança
- `VerifierPolicy` — Configuração da política do verificador
- `AlgorithmAdvisory` — Aviso de obsolescência ou revogação de um algoritmo
- `GovernanceKeySet` — Conjunto de chaves de governança com limiar
- `AnchorReceipt` — Recibo de ancoragem
- `RevocationRecord` — Registro de revogação
- `InclusionProof` — Prova de inclusão do log de transparência
- `ErrorResponse` — Resposta de erro padrão

### Swagger UI

Para ver a especificação de forma interativa:

```bash
# With Redocly CLI 1.x (downloads it)
npx @redocly/cli@1 preview-docs api/openapi.yaml

# Or with Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml \
  -v $(pwd)/api:/api swaggerapi/swagger-ui
```

## Protocol Buffers (gRPC)

<a id="package"></a>

### Pacote

```protobuf
package dcp.v1;
option go_package = "github.com/dcp-ai/dcp-ai-go/proto";
```

O caminho de `go_package` não é um módulo publicado; defina o seu ao gerar o código.

<a id="services"></a>

### Serviços

#### VerificationService

| RPC | Requisição | Resposta |
|-----|---------|----------|
| `VerifyBundle` | `VerifyBundleRequest` | `VerifyBundleResponse` |
| `ValidateBundle` | `ValidateBundleRequest` | `ValidateBundleResponse` |
| `VerifyBundleV2` | `VerifyBundleV2Request` | `VerifyBundleV2Response` |
| `HealthCheck` | `HealthCheckRequest` | `HealthCheckResponse` |

#### AnchorService

| RPC | Requisição | Resposta |
|-----|---------|----------|
| `AnchorHash` | `AnchorHashRequest` | `AnchorHashResponse` |
| `AnchorBatch` | `AnchorBatchRequest` | `AnchorBatchResponse` |
| `CheckAnchor` | `CheckAnchorRequest` | `CheckAnchorResponse` |

#### RevocationService

| RPC | Requisição | Resposta |
|-----|---------|----------|
| `Revoke` | `RevokeRequest` | `RevokeResponse` |
| `RevokeV2` | `RevokeV2Request` | `RevokeV2Response` |
| `EmergencyRevoke` | `EmergencyRevokeRequest` | `EmergencyRevokeResponse` |
| `CheckRevocation` | `CheckRevocationRequest` | `CheckRevocationResponse` |
| `CheckRevocationByKid` | `CheckRevocationByKidRequest` | `CheckRevocationByKidResponse` |
| `ListRevocations` | `ListRevocationsRequest` | `ListRevocationsResponse` |

#### TransparencyLogService

| RPC | Requisição | Resposta |
|-----|---------|----------|
| `AddEntry` | `AddEntryRequest` | `AddEntryResponse` |
| `GetRoot` | `GetRootRequest` | `GetRootResponse` |
| `GetProof` | `GetProofRequest` | `GetProofResponse` |

#### KeyService

| RPC | Requisição | Resposta |
|-----|---------|----------|
| `RegisterKeys` | `RegisterKeysRequest` | `RegisterKeysResponse` |
| `LookupKey` | `LookupKeyRequest` | `LookupKeyResponse` |
| `RotateKey` | `RotateKeyRequest` | `RotateKeyResponse` |

<a id="generate-clients"></a>

### Gerar clientes

Estes comandos precisam das suas ferramentas (`protoc` e os seus plugins, `grpc_tools`, `tonic-build`) instaladas; não foram executados para esta página.

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

Com `tonic-build` no `build.rs`:

```rust
fn main() {
    tonic_build::compile_protos("api/proto/dcp.proto").unwrap();
}
```

<a id="development"></a>

## Desenvolvimento

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

## Licença

Apache-2.0
