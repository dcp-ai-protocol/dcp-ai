<sub>[English](../../../docker/README.md) · [中文](../../zh-CN/docker/README.md) · [Español](../../es/docker/README.md) · [日本語](../../ja/docker/README.md) · **Português**</sub>

<a id="docker--dcp-infrastructure"></a>
<a id="docker-dcp-infrastructure"></a>

# Docker — infraestrutura do DCP

> Tradução informativa da [versão em inglês](../../../docker/README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Configuração do Docker Compose para implantar todos os serviços do DCP como contêineres. Inclui verificação, ancoragem, log de transparência e revogação.

<a id="quickstart"></a>

## Início rápido

```bash
cd docker
docker compose up
```

`docker compose up` fica em primeiro plano: execute as checagens abaixo em um segundo terminal, ou inicie a pilha com
`docker compose up -d`. Isso inicia os quatro serviços em cinco contêineres (dois logs de transparência):

| Contêiner | Porta | Descrição |
|---------|------|-------------|
| **verification** | `3000` | Servidor de verificação de bundles |
| **anchor** | `3001` | Serviço de ancoragem: só registros locais; o envio on-chain não está implementado |
| **transparency-log-a** | `3002` | Log de transparência `log-alpha`, com provas de Merkle |
| **transparency-log-b** | `3012` | Log de transparência `log-beta`, par de gossip do `log-alpha` |
| **revocation** | `3003` | Serviço de revogação de agentes |

<a id="verify-everything-is-running"></a>

### Checar se tudo está em execução

```bash
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3012/health
curl http://localhost:3003/health
```

Uma resposta saudável só significa que o processo responde por HTTP. Ela não checa persistência, ancoragem nem gossip
(o `gossip_peers` de um log conta os pares configurados, fixados ou não).

<a id="services"></a>

## Serviços

### verification (`:3000`)

Servidor de verificação de Signed Bundles do DCP (V1 + V2 + fase 3). As duas requisições de verificação abaixo são
modelos: `{...}` e `...` representam um bundle assinado real, então não funcionam como estão. O exemplo completo no fim
desta página usa, em vez disso, um fixture de teste.

```bash
# V1 verification
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {...}, "signature": {...}}, "public_key_b64": "..."}'

# V2 composite verification
curl -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {"bundle": {"dcp_bundle_version":"2.0","manifest":{...},...}, "signature": {"composite_sig":{...},...}}}'

# Capability discovery
curl http://localhost:3000/.well-known/dcp-capabilities.json
```

### anchor (`:3001`)

Serviço de ancoragem de hashes de bundles em blockchain. Veja [services/anchor/README.md](../../../services/anchor/README.md).

### transparency-log (`:3002`)

Log de transparência só de anexação com provas de inclusão. Veja [services/transparency-log/README.md](../../../services/transparency-log/README.md).

### revocation (`:3003`)

Serviço de publicação e consulta de revogações. Veja [services/revocation/README.md](../../../services/revocation/README.md).

<a id="configuration"></a>

## Configuração

<a id="environment-variables"></a>

### Variáveis de ambiente

Cada serviço é configurado por variáveis de ambiente em `docker-compose.yml`:

#### verification

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3000` | Porta HTTP |
| `VERIFIER_MODE` | `hybrid_required` | Modo de verificação V2 |
| `ALLOW_V1_BUNDLES` | `true` | Aceita bundles no formato V1 |
| `REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS`, `PQ_CHECKPOINT_INTERVAL`, `ADVISORY_POLL_INTERVAL_MS` | definidas na imagem e aqui | **O servidor ainda não as lê.** Vale a sua política embutida (vinculação de sessão e composta obrigatórias, idade de chave de 365 dias); `GET /v2/policy` a mostra |

Os endpoints do DCP-05 ao DCP-09 do gateway não precisam de token e não verificam assinaturas; não publique a porta 3000 para clientes não confiáveis sem a sua própria autorização na frente ([docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

#### anchor

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3001` | Porta HTTP |
| `ANCHOR_MODE` | `batch` | `"individual"` ou `"batch"` |
| `BATCH_INTERVAL_MS` | `60000` | Intervalo de esvaziamento (ms) |
| `ANCHOR_RPC_URL` | — | URL JSON-RPC do nó L2 |
| `ANCHOR_PRIVATE_KEY` | — | Chave privada da carteira |
| `ANCHOR_CONTRACT` | — | Endereço do contrato DCPAnchor |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /flush` (repassado do ambiente do host) |

O envio on-chain ainda não está implementado, então as três configurações de cadeia `ANCHOR_*` não são usadas.

#### transparency-log

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3002` | Porta HTTP |
| `LOG_ID` | gerado automaticamente | Identificador único desta instância do log |
| `OPERATOR_KEY` | efêmera | Semente Ed25519 da chave que assina as STHs: 64 caracteres hexadecimais (`openssl rand -hex 32`), uma por log. Qualquer outra coisa interrompe o serviço |
| `OPERATOR_TOKEN` | — | Token Bearer para `POST /gossip/peers` (repassado do ambiente do host) |
| `GOSSIP_PEERS` | — | Pares separados por vírgulas, cada um `<endpoint>#<base64 Ed25519 public key>` (por exemplo, `http://log-b:3002#q1w2...`); as cabeças de árvore de pares não fixados são ignoradas |
| `GOSSIP_INTERVAL_MS` | `30000` | Intervalo de consulta do gossip, em milissegundos |

Para que os dois logs do Compose façam gossip, dê a cada um uma chave fixa e fixe a do outro. Execute isto a partir da
raiz do repositório, com as dependências da raiz instaladas (usa o `tweetnacl` do `node_modules` da raiz). Não há
nenhum arquivo compose na raiz, então indique este com `-f`:

```bash
export TLOG_ALPHA_OPERATOR_KEY=$(openssl rand -hex 32) TLOG_BETA_OPERATOR_KEY=$(openssl rand -hex 32)
pub() { node -e 'const n = require("tweetnacl"); console.log(Buffer.from(n.sign.keyPair.fromSeed(Buffer.from(process.argv[1], "hex")).publicKey).toString("base64"))' "$1"; }
export TLOG_ALPHA_PUBLIC_KEY=$(pub $TLOG_ALPHA_OPERATOR_KEY) TLOG_BETA_PUBLIC_KEY=$(pub $TLOG_BETA_OPERATOR_KEY)
docker compose -f docker/docker-compose.yml up
```

Os logs guardam a árvore em memória: uma `OPERATOR_KEY` fixa mantém a mesma chave de assinatura entre reinicializações,
mas uma reinicialização continua começando uma árvore vazia.

#### revocation

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3003` | Porta HTTP |
| `TRUST_PROXY` | — | `true` só atrás de um proxy que acrescenta o IP do cliente a `X-Forwarded-For` |
| `REVOCATION_STATE_PATH` | só memória | Arquivo de estado só de anexação. Este arquivo compose define `/data/revocation-state.jsonl` no volume `revocation-data` |

Os serviços de verificação e de revogação também leem `OPERATOR_TOKEN`: para os endpoints de administração do gateway e
para registrar `agent_id`s novos nos dois. A partir da raiz do repositório, execute
`OPERATOR_TOKEN=$(openssl rand -hex 32) docker compose -f docker/docker-compose.yml up` para desbloqueá-los; sem ele,
eles respondem 401.

Estado: todos os serviços guardam o estado em memória e começam vazios após uma reinicialização ou um
`docker compose down`, **exceto revocation**. Aqui os seus registros e revogações vão para o volume `revocation-data`,
então sobrevivem a uma reinicialização e a `docker compose down`; `docker compose down -v` apaga o volume e, com ele,
esses dados.

<a id="blockchain-anchoring-is-not-implemented"></a>

### A ancoragem em blockchain não está implementada

O serviço de ancoragem não envia nada on-chain. As configurações `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` e
`ANCHOR_CONTRACT` comentadas em `docker-compose.yml` não são lidas (definir `ANCHOR_RPC_URL` só registra um aviso),
então não coloque ali nenhuma chave de carteira. Os registros ficam locais, em memória, com `tx_hash: null` e
`onchain: false`.

## Dockerfile

O `Dockerfile` usa um build em várias etapas com alvos independentes:

```
Base: node:20-alpine
├── verification  → node server/index.js        (port 3000)
├── anchor        → node services/anchor/index.js      (port 3001)
├── transparency-log → node services/transparency-log/index.js (port 3002)
└── revocation    → node services/revocation/index.js  (port 3003)
```

<a id="individual-build"></a>

### Build individual

```bash
# Build a specific service (from the repo root: the build context is the repo)
docker build -f docker/Dockerfile --target anchor -t dcp-anchor .

# Run
docker run -p 3001:3001 -e ANCHOR_MODE=batch dcp-anchor
```

<a id="build-all"></a>

### Build de tudo

```bash
# from the repo root
docker compose -f docker/docker-compose.yml build
```

<a id="health-checks"></a>

## Checagens de saúde

Todos os serviços têm checagens de saúde configuradas:

- **Intervalo:** 30 segundos
- **Tempo limite:** 5 segundos
- **Tentativas:** 3
- **Comando:** `wget -qO- http://localhost:PORT/health`
- **Política de reinicialização:** `unless-stopped`

Uma checagem que passa só significa que o processo responde por HTTP; não é evidência de persistência, ancoragem,
gossip nem preparo para produção.

<a id="full-example--verify-a-bundle"></a>
<a id="full-example-verify-a-bundle"></a>

## Exemplo completo — verificar um bundle

```bash
# Run from the repo root: the example files are under tests/.
# 1. Start services
docker compose -f docker/docker-compose.yml up -d

# 2. Verify a signed bundle (note: body must wrap in signed_bundle key)
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d "{\"signed_bundle\": $(cat tests/conformance/examples/citizenship_bundle.signed.json)}"

# 3. Take the bundle_hash the signature carries (computed over the canonical bundle) and anchor it
HASH=$(node -e 'console.log(require("./tests/conformance/examples/citizenship_bundle.signed.json").signature.bundle_hash)')
curl -X POST http://localhost:3001/anchor \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 4. Add to transparency log (service on port 3002, route is /add)
curl -X POST http://localhost:3002/add \
  -H "Content-Type: application/json" \
  -d "{\"bundle_hash\": \"$HASH\"}"

# 5. Stop
docker compose -f docker/docker-compose.yml down
```

<a id="license"></a>

## Licença

Apache-2.0
