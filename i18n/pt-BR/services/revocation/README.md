<sub>[English](../../../../services/revocation/README.md) · [中文](../../../zh-CN/services/revocation/README.md) · [Español](../../../es/services/revocation/README.md) · [日本語](../../../ja/services/revocation/README.md) · **Português**</sub>

<a id="revocation-service"></a>

# Serviço de revogação

> Tradução informativa da [versão em inglês](../../../../services/revocation/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Serviço HTTP para publicar e consultar revogações de agentes do DCP. Suporta tanto a V1 (no nível do agente) quanto a V2 (no nível do kid, revogação de emergência, acompanhamento de certificados de curta duração). Expõe um endpoint `.well-known` para consultas padronizadas.

Toda escrita é autenticada. O operador registra cada novo agente com o seu passaporte V2 autoassinado
(`POST /v2/register` com o token do operador): a assinatura composta prova a posse das chaves signatárias, então o
serviço registra esses kids como do agente, com a sua validade e o token de revogação de emergência do passaporte.
Registrar-se de novo é autoatendimento, e as revogações devem ser assinadas pelas chaves registradas. O estado fica
em memória, a menos que `REVOCATION_STATE_PATH` indique um arquivo (veja [Configuração](#configuration)).

Os exemplos de escrita abaixo (`POST /revoke`, `POST /v2/register`, `POST /v2/revoke`, `POST /v2/emergency-revoke`)
são modelos: as suas assinaturas, passaportes e segredos são marcadores (`...`), então não funcionam como estão, e não
devem ser preenchidos com valores inventados. `index.test.js` mostra como os reais são construídos.

<a id="quickstart"></a>

## Início rápido

```bash
# Start the service, from the root of a checkout: it imports @dcp-ai/sdk, so build the
# workspace SDK and install the root package first
(cd sdks/typescript && npm install && npm run build) && npm install
node services/revocation/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up revocation
```

O serviço escuta por padrão em `http://localhost:3003`.

<a id="v1-endpoints"></a>

## Endpoints V1

### `GET /health`

Checagem de saúde do serviço.

```bash
curl http://localhost:3003/health
```

```json
{
  "ok": true,
  "service": "dcp-revocation",
  "supported_versions": ["1.0", "2.0"],
  "registered_agents": 2,
  "total_revocations": 3,
  "total_kid_revocations": 1
}
```

### `POST /revoke`

Publica uma revogação no nível do agente (V1). `signature` é uma assinatura Ed25519 (em base64) sobre o JSON canônico
V1 de `{ dcp_version, agent_id, human_id, timestamp, reason }` tal como enviado (`signObject` em `tools/crypto.js`),
feita com uma das chaves `ed25519` ativas do agente (registrada, não revogada, não expirada). O agente precisa ter se
registrado antes com `POST /v2/register`, que exige uma assinatura híbrida do passaporte: um agente só Ed25519 (V1) não
pode publicar revogações aqui.

```bash
curl -X POST http://localhost:3003/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "1.0",
    "agent_id": "agent:research-bot-001",
    "human_id": "human:alice-001",
    "timestamp": "2026-03-01T00:00:00Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }'
```

**Corpo da requisição:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|----------|-------------|
| `agent_id` | `string` | Sim | ID do agente a revogar |
| `human_id` | `string` | Não | ID da pessoa responsável |
| `reason` | `string` | Sim | Motivo da revogação |
| `signature` | `string` | Sim | Assinatura Ed25519 sobre os demais campos |
| `dcp_version` | `string` | Não | Versão do DCP (padrão: `"1.0"`) |
| `timestamp` | `string` | Não | ISO 8601 (padrão: agora) |

Os campos que não são enviados ficam fora do objeto assinado; os valores padrão são preenchidos depois.

**Resposta (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Respostas de erro:** 400 (faltam campos), 403 (a assinatura não é verificada com as chaves `ed25519` registradas do
agente), 409 (agente já revogado: as revogações são definitivas, então uma revogação de emergência não pode ser
sobrescrita).

### `GET /check/:agent_id`

Checa se um agente está revogado.

```bash
curl http://localhost:3003/check/agent-001
```

**Agente revogado:**

```json
{
  "revoked": true,
  "record": {
    "dcp_version": "1.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "timestamp": "2026-03-01T00:00:00.000Z",
    "reason": "Compromised credentials",
    "signature": "base64-signature..."
  }
}
```

**Agente não revogado:**

```json
{
  "revoked": false,
  "agent_id": "agent-001"
}
```

### `GET /list`

Lista todas as revogações no nível do agente.

```bash
curl http://localhost:3003/list
```

```json
{
  "revocations": [...],
  "total": 3
}
```

---

<a id="v2-endpoints"></a>

## Endpoints V2

### `POST /v2/register`

Registra as chaves de um agente e o seu token de revogação de emergência. O corpo é o passaporte autoassinado do
agente, o `SignedPayload` de um `AgentPassportV2` assinado com `DCP-AI.v2.AgentPassport` pelas chaves que ele lista (o
`agent_passport` de um bundle construído com o SDK). A assinatura composta deve ser `pq_over_classical`.

Registrar um `agent_id` **novo** exige `Authorization: Bearer <OPERATOR_TOKEN>`. Um passaporte é só autoassinado, e um
RPR também, então, sem uma âncora de confiança, qualquer pessoa poderia reivindicar primeiro o `agent_id` de uma
vítima, plantar o próprio token e revogá-lo por emergência. Em vez disso, o operador responde pelos agentes novos, e
sem um `OPERATOR_TOKEN` configurado ninguém pode registrar um. Registrar de novo um agente existente não exige token.

```bash
curl -X POST http://localhost:3003/v2/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "signed_passport": { "payload": { "dcp_version": "2.0", "agent_id": "...", "keys": [...], "emergency_revocation_token": "sha256:...", ... }, "payload_hash": "sha256:...", "composite_sig": { ... } } }'
```

- Só as duas chaves signatárias (clássica + PQ) são registradas: listar a chave pública de outra pessoa não registra
  nada. O `expires_at` delas determina a resposta `expired` de `GET /v2/check/kid/:kid`.
- Registrar de novo um `agent_id` (por exemplo, para substituir o token) exige um passaporte cujo `created_at` seja
  posterior ao registrado, porque os passaportes assinados são públicos e um antigo poderia ser reenviado, e que esteja
  assinado exatamente pelas chaves clássica e PQ ativas do agente (não revogadas, não expiradas). As entradas de chaves
  registradas são mantidas, então um passaporte novo não pode estender o `expires_at` de uma chave nem acrescentar
  chaves, e um passaporte sem token mantém o registrado.
- Um agente que perdeu a sua chave clássica ou PQ ativa (expirada, ou revogada por kid) fica bloqueado: caso contrário,
  a chave restante poderia se emparelhar com uma nova chave parceira e tomar o agente. A recuperação passa pelo token de
  revogação de emergência (revogar e depois registrar um `agent_id` novo) ou pelo operador, que ainda não tem nenhuma
  API para isso.

**Resposta (201):**

```json
{ "ok": true, "agent_id": "agent-001", "registered_kids": ["a1b2...", "c3d4..."] }
```

**Respostas de erro:** 400 (não é um passaporte V2 assinado, não tem um `created_at` válido, ou um token ou uma
validade de chave malformados), 401 (um `agent_id` novo sem o token do operador), 403 (assinatura inválida, ou agente
revogado por emergência), 409 (agente registrado com outras chaves, passaporte não posterior ao registrado, agente sem
uma chave clássica ou PQ ativa, ou um kid revogado, expirado ou de outro agente), 429 (mais de
`REGISTRATIONS_PER_HOUR` chamadas deste cliente), 507 (`MAX_AGENTS` atingido).

### `POST /v2/revoke`

Revogação no nível do kid com assinatura composta. `composite_sig` assina o registro sem ela (`dcp_version`,
`agent_id`, `human_id`, `revoked_kid`, `timestamp`, `reason`, tal como enviados) com `DCP-AI.v2.Revocation`, com as
chaves ativas do agente; `revoked_kid` deve ser um dos seus kids registrados.

```bash
curl -X POST http://localhost:3003/v2/revoke \
  -H "Content-Type: application/json" \
  -d '{
    "dcp_version": "2.0",
    "agent_id": "agent-001",
    "human_id": "human-001",
    "revoked_kid": "a1b2c3d4e5f6...",
    "reason": "key_compromise",
    "composite_sig": {
      "classical": { "alg": "ed25519", "kid": "abc123", "sig_b64": "..." },
      "pq": { "alg": "ml-dsa-65", "kid": "def456", "sig_b64": "..." },
      "binding": "pq_over_classical"
    }
  }'
```

**Corpo da requisição:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|----------|-------------|
| `dcp_version` | `string` | Sim | Deve ser `"2.0"` |
| `agent_id` | `string` | Sim | ID do agente |
| `human_id` | `string` | Não | ID da pessoa responsável |
| `revoked_kid` | `string` | Sim | Identificador da chave a revogar |
| `reason` | `string` | Sim | Motivo da revogação |
| `composite_sig` | `object` | Sim | Assinatura composta: clássica e PQ, ambas obrigatórias (uma assinatura só clássica é recusada) |

**Resposta (201):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_kid": "a1b2c3d4e5f6...",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Respostas de erro:** 400 (faltam campos ou `dcp_version`), 403 (`revoked_kid` não é uma chave registrada de
`agent_id`, ou `composite_sig` não é verificada com as chaves do agente).

### `POST /v2/emergency-revoke`

Revogação de emergência (botão de pânico). Revoga TODAS as chaves de um agente usando a pré-imagem do
`emergency_revocation_token` registrado com o seu passaporte. Limitado a 5 tentativas por minuto por IP de cliente
(endereço do socket, ou o último salto de `X-Forwarded-For` com `TRUST_PROXY=true`).

```bash
curl -X POST http://localhost:3003/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "revocation_secret": "a1b2c3d4e5f6..."
  }'
```

**Corpo da requisição:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|----------|-------------|
| `agent_id` | `string` | Sim | ID do agente a revogar |
| `human_id` | `string` | Não | ID da pessoa responsável |
| `revocation_secret` | `string` | Sim | Pré-imagem do token registrado (64 caracteres hexadecimais) |
| `reason` | `string` | Não | Motivo (padrão: `"key_compromise_emergency"`) |
| `timestamp` | `string` | Não | ISO 8601 (padrão: agora) |

**Resposta (200):**

```json
{
  "ok": true,
  "agent_id": "agent-001",
  "revoked_at": "2026-03-01T00:00:00.000Z",
  "keys_revoked": 2
}
```

**Respostas de erro:** 400 (formato inválido), 403 (segredo inválido), 404 (nenhum token registrado), 409 (token já consumido), 429 (limite de taxa).

`POST /v2/register-emergency-token` e `POST /v2/register-key-expiry` foram removidos: aceitavam requisições não
assinadas, então qualquer pessoa podia substituir um token ou marcar qualquer chave como expirada. O token e a validade
das chaves agora vêm do passaporte assinado (`POST /v2/register`).

### `GET /v2/check/kid/:kid`

Checa se um identificador de chave registrado está revogado: uma revogação explícita do kid, uma revogação de
emergência do seu dono ou a expiração. O serviço só conhece os kids que assinaram o registro de um agente
(`POST /v2/register`). Qualquer outro kid recebe **404** `{ "registered": false }`. Isso cobre os kids listados em um
passaporte sem assiná-lo, rotacionados no gateway ou pertencentes a um agente que nunca se registrou aqui: o estado
deles aqui é desconhecido, não «não revogado». `?agent_id=` é ignorado, então quem chama não pode pegar emprestado o
veredito de outro agente para um kid.

```bash
curl "http://localhost:3003/v2/check/kid/a1b2c3d4e5f6"
```

**Chave revogada:**

```json
{
  "revoked": true,
  "kid": "a1b2c3d4e5f6",
  "agent_id": "agent-001",
  "reason": "key_compromise",
  "revoked_at": "2026-03-01T00:00:00.000Z"
}
```

**Chave ativa:**

```json
{ "revoked": false, "kid": "a1b2c3d4e5f6" }
```

### `GET /v2/list`

Lista todas as revogações, tanto no nível do agente quanto do kid.

```bash
curl http://localhost:3003/v2/list
```

```json
{
  "dcp_version": "2.0",
  "agent_revocations": [...],
  "kid_revocations": [...],
  "total_agents": 2,
  "total_kids": 5
}
```

---

<a id="shared-endpoints"></a>

## Endpoints compartilhados

### `GET /.well-known/dcp-revocations.json`

Endpoint padronizado para consultar todas as revogações (V1 + V2). Segue a [RFC 8615](https://tools.ietf.org/html/rfc8615).

```bash
curl http://localhost:3003/.well-known/dcp-revocations.json
```

```json
{
  "dcp_version": "2.0",
  "updated_at": "2026-03-01T00:00:00.000Z",
  "revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "human_id": "human-001",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "Compromised credentials",
      "signature": "composite:a1b2c3d4"
    }
  ],
  "kid_revocations": [
    {
      "dcp_version": "2.0",
      "agent_id": "agent-001",
      "revoked_kid": "a1b2c3d4e5f6...",
      "timestamp": "2026-03-01T00:00:00.000Z",
      "reason": "key_compromise"
    }
  ]
}
```

Este endpoint pode ser:

- Consultado por qualquer verificador
- Armazenado em cache por CDNs
- Servido como arquivo estático em produção

A lista não traz assinatura: um verificador confia nela por causa da URL e do HTTPS de onde vem, então uma cópia em CDN ou estática precisa manter essa confiança. Uma cópia em cache só está tão atualizada quanto a sua última atualização: uma revogação recém-adicionada não aparece até a cópia ser atualizada. As demais checagens de admissão e os requisitos de atualização continuam valendo. A fonte de revogação da admissão lê este formato como uma lista de negação completa e falha quando não consegue obtê-la ([docs/ADMISSION.md](../../../../docs/ADMISSION.md#revocation-sources)).

<a id="configuration"></a>

## Configuração

<a id="environment-variables"></a>

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3003` | Porta HTTP |
| `OPERATOR_TOKEN` | — | Token Bearer para registrar um `agent_id` novo. Sem definir: nenhum agente novo |
| `REVOCATION_STATE_PATH` | — | Arquivo que mantém registros e revogações entre reinicializações. Sem definir: só memória. Cada escrita é acrescentada como uma linha JSON com fsync (um novo registro só anota o que mudou). Na inicialização, o arquivo é reproduzido e depois compactado para uma linha por entrada por meio de um arquivo temporário e de uma renomeação atômica. O serviço se recusa a iniciar se o caminho não permitir escrita ou o arquivo passar de 512 MB |
| `TRUST_PROXY` | — | `true` só atrás de um proxy que acrescenta o IP do cliente a `X-Forwarded-For` |
| `REGISTRATIONS_PER_HOUR` | `20` | Chamadas a `POST /v2/register` por cliente por hora; as demais recebem 429 |
| `MAX_AGENTS` | `10000` | Agentes registrados; a partir daí, os agentes novos recebem 507 (nada é removido) |

Sem `REVOCATION_STATE_PATH`, o estado fica em memória e **não sobrevive a uma reinicialização**, a uma implantação ou a
uma falha: os registros e todas as revogações se perdem, então os agentes revogados voltam a parecer válidos. No Fly,
coloque o arquivo em um volume (veja `deploy/fly/revocation.toml`); a pilha do Docker Compose o mantém no volume
`revocation-data`. Os limites acima impedem que uma enxurrada de registros deixe o serviço sem memória. Os registros
também são limitados:
- `human_id`, `timestamp` e `reason` têm no máximo 256 caracteres, e o `reason` da V2 é um de
  `key_compromise`, `key_rotation`, `administrative`, `key_compromise_emergency`.
- `emergency_revocation_token` deve ser `sha256:<64 hex>`.
- De `composite_sig`, só os campos de assinatura são armazenados.

<a id="integration"></a>

## Integração

<a id="querying-from-middleware"></a>

### Consultas a partir de um middleware

O `checkRevocation: true` do middleware do Express consulta `GET /check/:agent_id` e `GET /v2/check/kid/:kid` em cada requisição. Ele deixa a requisição passar quando o serviço não responde, a menos que `revocationFailClosed: true`. A admissão (Express, FastAPI, OpenClaw e o gateway de referência, com o perfil strict-v1) lê em vez disso `/.well-known/dcp-revocations.json` como lista de negação e recusa a requisição quando não consegue.

<a id="v2-flow"></a>

### Fluxo V2

1. O operador registra o passaporte assinado do agente durante a configuração (`POST /v2/register` com o token do operador): as chaves, a sua validade e o token de emergência
2. Revogue chaves específicas quando necessário, com a assinatura das chaves do agente (`POST /v2/revoke`)
3. Use o botão de pânico em emergências (`POST /v2/emergency-revoke`)
4. Cheque o estado das chaves antes de aceitar bundles (`GET /v2/check/kid/:kid`)

<a id="development"></a>

## Desenvolvimento

```bash
PORT=3003 node services/revocation/index.js   # from the repo root, after npm install there

curl http://localhost:3003/health
curl http://localhost:3003/check/test-001
curl http://localhost:3003/v2/list
curl http://localhost:3003/.well-known/dcp-revocations.json

# Writes need signatures; index.test.js builds signed passports and revocations
node --test services/revocation/index.test.js   # from the repo root
```

<a id="license"></a>

## Licença

Apache-2.0
