<sub>[English](../../../../services/transparency-log/README.md) · [中文](../../../zh-CN/services/transparency-log/README.md) · [Español](../../../es/services/transparency-log/README.md) · [日本語](../../../ja/services/transparency-log/README.md) · **Português**</sub>

<a id="transparency-log-service"></a>

# Serviço de log de transparência

> Tradução informativa da [versão em inglês](../../../../services/transparency-log/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Serviço HTTP de log de transparência inspirado no Certificate Transparency (CT). Guarda hashes de bundles em uma árvore de Merkle RFC 6962 só de anexação, com provas de inclusão verificáveis e cabeças de árvore assinadas com Ed25519. O estado fica em memória: uma reinicialização começa uma árvore nova e vazia (veja [Persistência](../../../../services/README.md#persistence)).

<a id="quickstart"></a>

## Início rápido

```bash
# Start the service, from the root of a checkout after `npm install` there
node services/transparency-log/index.js

# Or with Docker, from the repo root: the Compose stack runs two logs that gossip with each other
docker compose -f docker/docker-compose.yml up transparency-log-a transparency-log-b
```

O serviço escuta por padrão em `http://localhost:3002`.

## Endpoints

### `GET /health`

Checagem de saúde do serviço.

```bash
curl http://localhost:3002/health
```

```json
{
  "ok": true,
  "service": "dcp-transparency-log",
  "log_id": "log-alpha",
  "public_key": "base64 Ed25519 public key that signs STHs",
  "size": 42,
  "gossip_peers": 1,
  "alerts": 0
}
```

### `POST /add`

Adiciona um hash de bundle ao log: `sha256:` seguido de 64 caracteres hexadecimais minúsculos. Qualquer outra coisa,
ou um corpo de mais de 1 MB, dá 400.

```bash
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
```

```json
{
  "index": 42,
  "leaf_hash": "a1b2c3...",
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root`

Obtém a raiz de Merkle atual do log.

```bash
curl http://localhost:3002/root
```

```json
{
  "root": "d4e5f6...",
  "size": 43
}
```

### `GET /root/signed`

Obtém a cabeça de árvore assinada (Signed Tree Head, STH): uma assinatura Ed25519 (em base64) sobre o JSON canônico
(chaves ordenadas, `signObject` em `tools/crypto.js`) de `{ log_id, root, size, timestamp }`.

```bash
curl http://localhost:3002/root/signed
```

```json
{
  "log_id": "log-alpha",
  "root": "d4e5f6...",
  "size": 43,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "signature": "base64...",
  "public_key": "base64..."
}
```

Verifique-a contra uma chave pública fixada por outro canal (impressa na inicialização e exibida em `/health`), nunca só
contra a `public_key` que a STH traz:

```js
import { verifyObject } from "./tools/crypto.js";
const { log_id, root, size, timestamp, signature } = sth;
verifyObject({ log_id, root, size, timestamp }, signature, pinnedPublicKey); // true
```

`OPERATOR_KEY` é a semente de 32 bytes da chave, então a chave de assinatura sobrevive às reinicializações; a árvore
não, porque fica em memória. Sem ela, o log assina com uma nova chave efêmera após cada reinicialização: as STHs
anteriores continuam sendo verificadas com a chave antiga, se você a arquivou ou fixou, mas não com a nova.

### `GET /proof/:index`

Obtém a prova de inclusão de Merkle de uma entrada pelo seu índice.

```bash
curl http://localhost:3002/proof/5
```

```json
{
  "index": 5,
  "leaf_hash": "a1b2c3...",
  "entry": {
    "hash": "sha256:abc123...",
    "leaf_hash": "a1b2c3...",
    "timestamp": "2025-01-01T00:00:00.000Z",
    "index": 5
  },
  "root": "d4e5f6...",
  "proof": [
    { "hash": "x1y2z3...", "direction": "left" },
    { "hash": "m4n5o6...", "direction": "right" }
  ]
}
```

A prova permite verificar que uma entrada está incluída na árvore de Merkle sem baixar o log inteiro.

### `GET /entries`

Lista todas as entradas do log.

```bash
curl http://localhost:3002/entries
```

```json
{
  "entries": [
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 0 },
    { "hash": "sha256:...", "leaf_hash": "...", "timestamp": "...", "index": 1 }
  ],
  "size": 2
}
```

### Gossip

| Método | Caminho | Descrição |
|--------|------|-------------|
| GET | `/gossip/peers` | Pares conhecidos e os 20 últimos alertas |
| POST | `/gossip/peers` | Adiciona um par `{ peer_id, endpoint, public_key }` (endpoint http/https, chave Ed25519 em base64). Exige `Authorization: Bearer <OPERATOR_TOKEN>`: o log consulta os pares por conta própria, então uma lista aberta permitiria SSRF |
| POST | `/gossip/exchange` | Troca STHs com um par fixado `{ sth }`; retorna a nossa e qualquer alerta de visão dividida |
| GET | `/gossip/alerts` | Alertas de visão dividida (os 100 últimos) |

As cabeças de árvore de um par só contam quando são verificadas com a sua chave pública **fixada**: informe-a como
`<endpoint>#<base64 Ed25519 public key>` em `GOSSIP_PEERS`, ou como `public_key` em `POST /gossip/peers`. São
ignoradas as cabeças de árvore consultadas a um par sem chave fixada, as malformadas e as que têm assinatura inválida.
Uma consulta lê no máximo 16 KB, desiste após um intervalo (10 s no máximo) e nunca começa enquanto a anterior ainda
está em andamento. `/gossip/exchange` é aberto, então só aceita uma STH bem formada (`root` de 64 hexadecimais ou nulo,
`size` inteiro) assinada por um par fixado, em um corpo de no máximo 16 KB (caso contrário, 400 ou 403). Os alertas
são deduplicados por par, tamanho da árvore e raiz, então reenviar uma cabeça de árvore assinada não acrescenta nada,
e só os 100 últimos são mantidos.

<a id="configuration"></a>

## Configuração

<a id="environment-variables"></a>

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3002` | Porta HTTP |
| `LOG_ID` | aleatório | Identificador desta instância do log |
| `OPERATOR_KEY` | — | Semente Ed25519 da chave que assina as STHs: 64 caracteres hexadecimais (`openssl rand -hex 32`). Qualquer outro valor interrompe o serviço; sem definir, usa-se uma chave efêmera |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /gossip/peers`. Sem definir: bloqueado |
| `GOSSIP_PEERS` | — | Pares separados por vírgulas, cada um `<endpoint>#<base64 Ed25519 public key>` (a `public_key` de `/health` do par, fixada pela sua `OPERATOR_KEY`), consultados a cada `GOSSIP_INTERVAL_MS` |
| `GOSSIP_INTERVAL_MS` | `30000` | Intervalo de consulta do gossip |

<a id="ct-style-format"></a>

## Formato no estilo do CT

O log segue um formato inspirado no Certificate Transparency (RFC 6962):

1. **Só anexação:** as entradas nunca são apagadas nem modificadas
2. **Árvore de Merkle:** RFC 6962 §2.1. `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))` e os nós internos são
   `SHA-256(0x01 || left || right)`, então uma folha nunca pode se passar por uma subárvore. Uma árvore de `n` folhas
   se divide na maior potência de dois menor que `n`; o último nó nunca é duplicado.
3. **Provas de inclusão:** qualquer pessoa pode verificar com a prova que uma entrada existe no log
4. **Raiz assinada:** cabeças de árvore assinadas com Ed25519 (`GET /root/signed`)

<a id="verifying-an-inclusion-proof"></a>

### Verificar uma prova de inclusão

Para verificar que uma entrada está no log:

1. Obtenha a prova com `GET /proof/:index`
2. Calcule `leaf_hash = SHA-256(0x00 || UTF-8(entry.hash))`
3. Recombine os nós da prova em ordem, como bytes brutos (as strings hexadecimais decodificadas):
   - Se `direction == "left"`: `hash = SHA-256(0x01 || proof_hash || current)`
   - Se `direction == "right"`: `hash = SHA-256(0x01 || current || proof_hash)`
4. O resultado final deve ser igual à `root` de uma cabeça de árvore assinada que seja verificada com a chave pública
   fixada do log e que cubra a árvore a partir da qual a prova foi construída (o mesmo tamanho). A `root` da resposta
   da prova é, sozinha, uma autodeclaração, e uma raiz mais recente deixa de coincidir assim que entradas são
   adicionadas

<a id="development"></a>

## Desenvolvimento

```bash
# Start in development mode, from the root of a checkout
PORT=3002 node services/transparency-log/index.js

# Test
curl http://localhost:3002/health
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d '{"bundle_hash": "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"}'
curl http://localhost:3002/root
curl http://localhost:3002/proof/0
```

<a id="license"></a>

## Licença

Apache-2.0
