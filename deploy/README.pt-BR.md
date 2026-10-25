<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="deploying-dcp-ai-services"></a>

# Implantar os serviços do DCP-AI

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Os quatro serviços incluídos neste repositório — **verification**, **anchor**,
**transparency-log**, **revocation** — são distribuídos como imagens Docker
pré-compiladas no GitHub Container Registry (GHCR). Você pode executá-las em
qualquer host de contêineres. Abaixo estão os fluxos mais comuns.

<a id="images"></a>

## Imagens

| Serviço | Imagem | Porta padrão |
|---|---|---|
| Verificação | `ghcr.io/dcp-ai-protocol/dcp-ai/verification` | 3000 |
| Ancoragem | `ghcr.io/dcp-ai-protocol/dcp-ai/anchor` | 3001 |
| Log de transparência | `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log` | 3002 |
| Revogação | `ghcr.io/dcp-ai-protocol/dcp-ai/revocation` | 3003 |

Tags (veja [`publish-docker.yml`](../.github/workflows/publish-docker.yml)): um push para `main` que dispara o fluxo
publica `:latest`, `:main` e `:sha-xxxxxxx`; uma versão publicada acrescenta as suas tags semver
(`:<major>.<minor>.<patch>`, `:<major>.<minor>`, `:<major>`) e também pode mover `:latest`, que é mutável. São
construídas tanto `linux/amd64` quanto `linux/arm64`.

Teste rápido no seu notebook:

```bash
docker run --rm -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
# in a second terminal, while the container runs in the foreground
curl http://localhost:3000/health
```

`/health` só mostra que o processo responde por HTTP. Não diz nada sobre persistência, ancoragem, gossip ou preparo
para produção.

---

<a id="option-1--docker-compose-self-host-simplest"></a>
<a id="option-1-docker-compose-self-host-simplest"></a>

## Opção 1 — Docker Compose (auto-hospedado, o mais simples)

O repositório traz um arquivo compose pronto para uso que conecta os quatro serviços em cinco contêineres, com dois
logs de transparência. Os logs só fazem gossip quando cada um tem uma `OPERATOR_KEY` fixa e a chave pública do outro
fixada (veja [`docker/README.md`](../docker/README.md)); sem isso, cada um consulta o outro e ignora as suas cabeças de
árvore:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai
cd dcp-ai/docker
docker compose up -d
```

Os serviços expõem:

- `http://localhost:3000` — verificação
- `http://localhost:3001` — ancoragem
- `http://localhost:3002` — log de transparência (log-alpha)
- `http://localhost:3012` — log de transparência (log-beta, par de gossip)
- `http://localhost:3003` — revogação

Para usar as imagens publicadas no GHCR em vez de compilar a partir do código-fonte, edite
`docker/docker-compose.yml` e substitua cada bloco `build:` por uma linha `image:`, por exemplo:

```yaml
services:
  verification:
    image: ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
```

---

<a id="option-2--flyio-managed"></a>
<a id="option-2-flyio-managed"></a>

## Opção 2 — Fly.io (gerenciado)

```bash
# one-time setup
brew install flyctl
fly auth login
cd deploy/fly
```

Implante cada serviço (os `.toml` deste diretório já estão configurados para baixar do GHCR, sem compilar o código-fonte):

```bash
fly launch --config verification.toml    --no-deploy
# admin endpoints and registering new agent_ids
fly secrets set --app dcp-ai-verification OPERATOR_TOKEN="$(openssl rand -hex 32)"
fly deploy --config verification.toml

fly launch --config anchor.toml          --no-deploy
# on-chain submission is not implemented: no RPC URL, wallet key or contract is read
fly secrets set --app dcp-ai-anchor OPERATOR_TOKEN="$(openssl rand -hex 32)"   # unlocks POST /flush
fly deploy --config anchor.toml

fly launch --config transparency-log.toml --no-deploy
fly secrets set --app dcp-ai-transparency-log \
  OPERATOR_KEY="$(openssl rand -hex 32)" \
  GOSSIP_PEERS="https://<your-second-log>.fly.dev#<its /health public_key>"
fly deploy --config transparency-log.toml

fly launch --config revocation.toml      --no-deploy
fly deploy --config revocation.toml
```

Cada serviço recebe uma URL HTTPS pública como `https://dcp-ai-verification.fly.dev`. Na aplicação de verificação, isso também torna públicos os seus endpoints do DCP-05 ao DCP-09, que não precisam de token e não verificam assinaturas (veja as notas de operação).

Um par de gossip sem o seu `#<public key>` é consultado, mas as suas cabeças de árvore são ignoradas.

O estado fica em memória. As configurações de verificação, revogação e log de transparência mantêm uma máquina em
execução para que a ociosidade não apague os seus registros; uma implantação ou uma reinicialização continua
começando-os vazios. A configuração da ancoragem deixa a sua máquina parar (`min_machines_running = 0`), o que descarta
os seus hashes pendentes e registros locais. Só o serviço de revogação pode manter o seu estado entre reinicializações:
coloque `REVOCATION_STATE_PATH` em um volume, como mostra o comentário em `revocation.toml`. O log de transparência não
tem opção de persistência.
Defina `OPERATOR_TOKEN` também na aplicação de revogação, porque registrar um `agent_id` novo ali o exige, e nas
aplicações de ancoragem e de log de transparência se você precisar de `POST /flush` ou `POST /gossip/peers`.

Para produção, convém ter **duas** instâncias do log de transparência em regiões diferentes, cada uma com a sua própria `OPERATOR_KEY` e apontando para a outra via `GOSSIP_PEERS` com a chave pública da outra fixada. O gossip compara as suas cabeças de árvore assinadas e emite um alerta quando duas cabeças do mesmo tamanho têm raízes diferentes (DCP-03 §4). Isso só revela uma visão dividida se os dois logs devem conter as mesmas entradas na mesma ordem: os logs não replicam as entradas entre si, então dois logs que receberam legitimamente entradas diferentes também geram alertas, e cabeças de tamanhos diferentes não são comparadas (não há prova de consistência).

---

<a id="option-3--google-cloud-run-pay-per-request"></a>
<a id="option-3-google-cloud-run-pay-per-request"></a>

## Opção 3 — Google Cloud Run (pagamento por requisição)

```bash
gcloud run deploy dcp-ai-verification \
  --image ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest \
  --port 3000 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="DCP_VERSION=2.0,VERIFIER_MODE=hybrid_required"
```

Repita para cada serviço. O Cloud Run escala para zero quando ocioso, e esses serviços guardam o estado em memória: uma
instância que escala para zero ou reinicia começa vazia (veja as notas de operação).

---

<a id="option-4--railway-one-click-credit-card-required-for-deploy"></a>
<a id="option-4-railway-one-click-credit-card-required-for-deploy"></a>

## Opção 4 — Railway (um clique, exige cartão de crédito para implantar)

Crie um projeto novo a partir de uma imagem Docker. Para cada serviço, cole a URL da imagem do GHCR e defina as variáveis de ambiente do `deploy/fly/*.toml` correspondente.

---

<a id="operating-notes"></a>

## Notas de operação

- **Ancoragem**: o envio on-chain não está implementado. Implantar `contracts/ethereum/src/DCPAnchor.sol` e definir `ANCHOR_CONTRACT` não o ativa: `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` e `ANCHOR_CONTRACT` não são lidos (definir `ANCHOR_RPC_URL` só registra um aviso), então não dê ao serviço nenhuma chave de carteira. Ele mantém registros locais em memória com `tx_hash: null` e `onchain: false`.
- **Log de transparência**: só em memória, sem opção de persistência: uma reinicialização começa uma árvore nova e vazia, e um volume não muda isso. Uma `OPERATOR_KEY` fixa mantém a mesma chave de assinatura entre reinicializações.
- **Revogação**: o registro só é autoritativo se todos os verificadores da sua política apontarem para *esta* URL. Publique a URL no seu `.well-known/dcp-capabilities.json`. Sem `REVOCATION_STATE_PATH` em um armazenamento persistente, uma reinicialização esquece todos os registros e revogações.
- **Verificação**: não é sem estado. Ela guarda passaportes, chaves, cadeias de auditoria e os registros do DCP-05–09 em memória, e instâncias separadas não os compartilham, então várias instâncias atrás de um balanceador de carga responderiam de forma diferente. Execute uma única instância.
- **Verificação, endpoints do DCP-05 ao DCP-09**: não precisam de token e não verificam assinaturas, e `OPERATOR_TOKEN` não os protege, então qualquer pessoa que alcance uma implantação pública (Fly, ou Cloud Run com `--allow-unauthenticated`) pode alterar o estado do ciclo de vida, das disputas e dos mandatos. Coloque a sua própria autorização na frente deles, ou não os roteie ([docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

---

## CI/CD

O fluxo [`publish-docker.yml`](../.github/workflows/publish-docker.yml) do repositório reconstrói e envia essas imagens a cada versão publicada, ao ser disparado manualmente e a cada push para `main` que mexa em `server/`, `services/`, `lib/`, `tools/`, `schemas/`, `docker/Dockerfile` ou no próprio fluxo. As imagens também compilam o SDK do workspace (`sdks/typescript/`), mas um push que só altera o SDK não dispara uma reconstrução.

Antes de implantar, rastreie o digest da imagem que você vai executar até uma execução bem-sucedida do fluxo de publicação para o commit escolhido. `:latest` é mutável e não garante essa revisão. Se não houver imagem para o commit escolhido, construa-a a partir desse checkout (`docker build -f docker/Dockerfile --target <service> .`, a partir da raiz do repositório).
