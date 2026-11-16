<sub>[English](../../../../services/anchor/README.md) · [Español](../../../es/services/anchor/README.md) · **Português** · [日本語](../../../ja/services/anchor/README.md) · [中文](../../../zh-CN/services/anchor/README.md)</sub>

<a id="anchoring-service"></a>

# Serviço de ancoragem

> Tradução informativa da [versão em inglês](../../../../services/anchor/README.md), atualizada em 25/10/2026. Em caso de diferença, prevalece o original em inglês. Identificadores e blocos de código, incluindo comentários, são mantidos sem tradução.

Serviço HTTP destinado a ancorar hashes de Citizenship Bundles em blockchains L2 (Base, Arbitrum, Optimism), individualmente ou em lotes sob uma raiz Merkle. Hoje ele apenas os registra localmente (veja a nota abaixo).

> **O envio on-chain ainda não está implementado.** Hashes e raízes de lotes são registrados localmente com
> `tx_hash: null` e `onchain: false`; o serviço nunca inventa um hash de transação.
> `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` e `ANCHOR_CONTRACT` ainda não são usados. O estado fica em memória
> (veja [Persistência](../../../../services/README.md#persistence)).

<a id="quickstart"></a>

## Início rápido

```bash
# Start the service, from the repo root after installing the root dependencies
node services/anchor/index.js

# Or with Docker, from the repo root
docker compose -f docker/docker-compose.yml up anchor
```

Por padrão, o serviço escuta em `http://localhost:3001`.

## Endpoints

### `GET /health`

Verificação da saúde do serviço.

```bash
curl http://localhost:3001/health
```

```json
{
  "ok": true,
  "service": "dcp-anchor",
  "mode": "batch",
  "pending": 0,
  "total_anchored": 5
}
```

`total_anchored` conta registros locais, um por lote, não hashes. Uma resposta saudável não comprova nenhuma operação on-chain.

### `POST /anchor`

Envie um hash de bundle para ancoragem: `sha256:` seguido de 64 caracteres hexadecimais minúsculos (o prefixo é opcional). Qualquer outro formato, ou um corpo maior que 1 MB, retorna 400.

```bash
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

**Modo individual** — Registra o hash imediatamente, de forma local: `anchored: true` significa registrado por este serviço, não on-chain (`onchain: false`, `tx_hash: null`):

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

**Modo em lote** — Aceita e coloca na fila (HTTP 202):

```json
{
  "accepted": true,
  "bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "position": 3,
  "hint": "Will be anchored in next batch (interval: 60000ms)"
}
```

### `GET /status/:hash`

Consulte o status de um hash ancorado.

```bash
curl http://localhost:3001/status/sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

```json
{
  "anchored": true,
  "hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "count": 1,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "tx_hash": null,
  "onchain": false,
  "chain": "base"
}
```

Se ainda não estiver ancorado, mas estiver pendente:

```json
{
  "anchored": false,
  "pending": true
}
```

Um registro só é encontrado pelo hash que armazena. No modo individual e em um lote de um único hash, é o hash enviado (com o prefixo `sha256:`). Em um lote de vários hashes, é somente a raiz Merkle deles; assim, cada um desses hashes passa a responder `{"anchored": false, "pending": false}`. Ainda não há prova de inclusão por hash. Enquanto estiver pendente, o hash é comparado tal como foi enviado (com ou sem prefixo). Os registros ficam em memória e são perdidos ao reiniciar.

### `GET /anchored`

Liste todos os registros ancorados.

```bash
curl http://localhost:3001/anchored
```

```json
{
  "records": [
    { "hash": "sha256:...", "count": 1, "timestamp": "...", "tx_hash": null, "onchain": false, "chain": "base" }
  ]
}
```

### `POST /flush`

Force o processamento do lote pendente (apenas no modo em lote). Exige o token do operador; sem `OPERATOR_TOKEN` configurado, o endpoint permanece bloqueado (401).

```bash
curl -X POST http://localhost:3001/flush -H "Authorization: Bearer $OPERATOR_TOKEN"
```

```json
{ "flushed": true }
```

<a id="configuration"></a>

## Configuração

<a id="environment-variables"></a>

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3001` | Porta HTTP |
| `ANCHOR_MODE` | `"batch"` | Modo de ancoragem: `"individual"` ou `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Intervalo de processamento automático em ms (modo em lote) |
| `ANCHOR_RPC_URL` | — | URL JSON-RPC do nó L2 (ainda não usada; um aviso é registrado quando configurada) |
| `ANCHOR_PRIVATE_KEY` | — | Chave privada da carteira para assinar transações (ainda não usada) |
| `ANCHOR_CONTRACT` | — | Endereço do contrato DCPAnchor implantado (ainda não usado) |
| `ANCHOR_CHAIN` | `"base"` | Identificador da cadeia |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /flush`. Não definido: bloqueado |

<a id="operating-modes"></a>

### Modos de operação

**Individual (`ANCHOR_MODE=individual`):** Cada hash recebe seu próprio registro local imediatamente. Quando o envio on-chain for conectado, cada um seria uma transação separada.

**Em lote (`ANCHOR_MODE=batch`):** Os hashes são acumulados e registrados como uma única raiz Merkle a cada `BATCH_INTERVAL_MS` milissegundos, ou imediatamente com `POST /flush`. Quando o envio on-chain for conectado, cada lote seria uma transação.

<a id="integration-with-dcpanchorsol"></a>

## Integração com DCPAnchor.sol

Depois de conectado, o serviço interagirá com o contrato inteligente `DCPAnchor.sol`:

- **Modo individual:** Chamará `anchorBundle(bytes32 bundleHash)`
- **Modo em lote:** Calculará a raiz Merkle dos hashes pendentes e chamará `anchorBatch(bytes32 merkleRoot, uint256 count)`

Veja [contracts/ethereum/README.md](../../../../contracts/ethereum/README.md) para os detalhes do contrato.

<a id="development"></a>

## Desenvolvimento

```bash
# Start in development mode, from the repo root
PORT=3001 ANCHOR_MODE=batch node services/anchor/index.js

# Test with curl
curl http://localhost:3001/health
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

<a id="license"></a>

## Licença

Apache-2.0
