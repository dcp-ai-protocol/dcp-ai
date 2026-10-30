<sub>[English](../../../docs/STORAGE_AND_ANCHORING.md) · [中文](../../zh-CN/docs/STORAGE_AND_ANCHORING.md) · [Español](../../es/docs/STORAGE_AND_ANCHORING.md) · [日本語](../../ja/docs/STORAGE_AND_ANCHORING.md) · **Português**</sub>

<a id="storage-and-anchoring--p2p-verification-local"></a>
<a id="storage-and-anchoring-p2p-verification-local"></a>

# Armazenamento e ancoragem — P2P, verificação local

> Tradução informativa da [versão em inglês](../../../docs/STORAGE_AND_ANCHORING.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

O protocolo não depende de nenhum serviço central. A verificação é local; a ancoragem opcional usa blockchains públicas **existentes** ou serviços **de terceiros**. O protocolo não aponta para nenhum «registro DCP» canônico nem para nenhuma URL «dcp.ai».

<a id="design"></a>

## Projeto

- **A verificação é local.** Um verificador só precisa de: (1) o Signed Bundle (ou o Citizenship Bundle + a assinatura) e (2), opcionalmente, um conjunto de RevocationRecords assinados (de um par, de um arquivo ou ancorados on-chain). Nenhuma chamada de API a um servidor central é necessária.
- **Ancoragem opcional:** os usuários (ou qualquer terceiro) publicam hashes em blockchains públicas **existentes** (Bitcoin, Ethereum) ou num log de transparência **de terceiros**.
- **Revogação:** um ou mais RevocationRecords assinados. Distribuídos P2P (o titular os entrega ao verificador) ou publicados como hash on-chain ou num log; o verificador tem um conjunto de «revogações conhecidas» (hashes ou registros) e confere o assinante ou o agent_id contra elas. Não há servidor central de revogação.

<a id="storage-options"></a>

## Opções de armazenamento

| Opção | O que é armazenado | Onde |
|--------|----------------|--------|
| **Somente portátil** | O bundle completo fica com o titular e é apresentado ao verificador quando necessário (por exemplo, numa chamada de API). | Dispositivo ou armazenamento do titular; o verificador recebe o bundle dentro da própria comunicação. |
| **Ancoragem (somente hashes)** | Só o bundle_hash ou o merkle_root (e, opcionalmente, hashes de revogação) é publicado. O bundle completo fica fora da cadeia. | Blockchain pública, log de transparência ou DHT. O verificador confere «este hash foi ancorado em T» com dados públicos. Usuários ou serviços de ancoragem de terceiros usam cadeias ou logs existentes. |
| **Revogação** | Um ou mais RevocationRecords assinados. Distribuídos P2P ou publicados como hash on-chain ou num log. | Um par, um arquivo, IPFS, uma blockchain (somente o hash) ou uma lista fornecida pelo usuário. |

<a id="optional-anchor-receipt"></a>

## Recibo de ancoragem opcional

Se a ancoragem for usada, uma prova opcional pode ser guardada **junto** ao bundle (não necessariamente no esquema):

- `anchor_receipt`: `{ chain, tx_id, block_height }` (Bitcoin) ou `{ chain, contract, tx_id, block_number, event_index }` (Ethereum) ou `{ log_url, log_index }` (log de transparência).

A ancoragem é feita por usuários ou por serviços de ancoragem de terceiros sobre cadeias ou logs existentes.

<a id="blockchain-anchoring"></a>

## Ancoragem em blockchain

Como ancorar hashes DCP numa blockchain. Os usuários (ou qualquer serviço de ancoragem de terceiros) publicam hashes em cadeias públicas **existentes**.

<a id="what-goes-on-chain-only-hashes"></a>

### O que vai on-chain (somente hashes)

- **bundle_hash** (por exemplo, `sha256:<hex>`) ou **merkle_root** das audit_entries. Um hash por âncora.
- Opcionalmente: **o hash de um RevocationRecord** (para que os verificadores possam obter da cadeia uma lista de hashes de revogação e conferi-la localmente).
- **Nada além disso:** nem o bundle completo, nem o agent_id, nem o human_id, nem o payload do RPR ou do AP. A cadeia só vê hashes. Hashes não são anônimos: quem tiver o bundle pode encontrar o hash dele na cadeia, e o mesmo hash vincula todos os registros que o trazem.

<a id="implementation-options"></a>

### Opções de implementação

| Cadeia / sistema | Método | Formato | Observações |
|----------------|--------|--------|--------|
| **Bitcoin** | Saída OP_RETURN (ou compromisso taproot). Uma transação por hash, ou muitos hashes agrupados numa árvore de Merkle com o compromisso da raiz. | 32 bytes (SHA-256) na saída. | Barato e imutável; tamanho de payload limitado por transação. Em lote: uma raiz por transação, provas fora da cadeia. |
| **Ethereum (ou L2)** | Contrato que emite um evento com `bytes32 bundleHash` (e um timestamp opcional). | Evento: `Anchored(bytes32 bundleHash, uint256 timestamp)`. | O verificador lê os eventos; não é preciso confiar num servidor central. Custo em gas. |
| **Log de transparência (por exemplo, no estilo CT)** | Log somente de acréscimo: cada entrada = hash (+ timestamp opcional). Árvore de Merkle sobre as entradas; a raiz pode ser publicada periodicamente no Bitcoin/Ethereum. | Entrada do log = hash de 32 bytes. Prova de inclusão = caminho de Merkle. | Acrescentar é muito barato; o verificador confere a prova de inclusão. Pode ser operado por terceiros. |
| **IPFS** | Publicar só o hash como conteúdo (por exemplo, um nó DAG). Fixá-lo a partir de vários nós. | CID ou hash bruto. | Não é uma blockchain, mas é descentralizado; o verificador resolve o CID para obter o hash e o compara. |

<a id="concrete-flow-bitcoin-op_return"></a>

### Fluxo concreto (OP_RETURN do Bitcoin)

1. O titular tem o Signed Bundle; o `bundle_hash` já está em `signature.bundle_hash`.
2. O titular (ou qualquer terceiro) cria uma transação de Bitcoin com uma saída OP_RETURN contendo os 32 bytes em hexadecimal (ou um prefixo como `dcp:v1:` + hex para identificar o protocolo).
3. O titular guarda o **anchor_receipt**: `{ chain: "bitcoin", network: "mainnet", tx_id: "<txid>", block_height: N }` (e, opcionalmente, a prova de Merkle se houver agrupamento em lote).
4. Verificador: dados um Signed Bundle e um anchor_receipt, (a) calcula o bundle_hash a partir do bundle, (b) obtém a transação da cadeia (ou de um explorador de blocos público ou do próprio nó) e (c) confere que a saída OP_RETURN corresponde ao bundle_hash. A verificação é local + dados públicos da cadeia.

<a id="anchoring-by-users-or-third-parties"></a>

### Ancoragem por usuários ou terceiros

A ancoragem é feita por **usuários** ou por **serviços de ancoragem de terceiros** sobre cadeias existentes. A CLI de referência não tem nenhum comando de ancoragem, e o serviço de ancoragem de referência (`services/anchor/`) ainda não envia a nenhuma cadeia: ele agrupa hashes em lotes e os registra localmente, em memória. `contracts/ethereum/` tem um contrato para implantar no Ethereum ou numa L2.

<a id="revocation-p2p"></a>

## Revogação (P2P)

- Um **RevocationRecord** assinado (veja [spec/DCP-01.md](../../../spec/DCP-01.md)) declara que um agente (ou um assinante) está revogado.
- Os verificadores mantêm um **conjunto local** de RevocationRecords assinados (de um arquivo, de um par, do IPFS ou ancorados on-chain por hash). Eles conferem o assinante ou o agent_id do bundle contra esse conjunto. Não há servidor central de revogação.
- Um comando local de verificação de revogações (por exemplo, `dcp verify-revocation <signed_bundle> <revocation_record.json>`) é uma ferramenta possível; a CLI de referência não o tem.

<a id="jurisdictional-revocation-list"></a>

## Lista de revogações jurisdicional

Uma jurisdição (um governo, uma autoridade reguladora ou um emissor credenciado) pode publicar uma **lista de revogações assinada**: um arquivo JSON que lista os agentes revogados nessa jurisdição.

**Formato sugerido:**

```json
{
  "issuer": "authority-us-ai-registry",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-abc-123", "revoked_at": "2026-01-15T12:00:00Z", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**Publicação:** numa URL conhecida, por exemplo, `https://<authority>/.well-known/dcp-revocations.json`. Não é obrigatório; é uma convenção. Qualquer URL serve.

O formato acima é um projeto sugerido. Nenhuma ferramenta deste repositório o produz nem verifica a assinatura dele.

**Implementação de referência:** `services/revocation/` neste repositório (imagem Docker `ghcr.io/dcp-ai-protocol/dcp-ai/revocation:latest`, configuração do Fly.io em `deploy/fly/revocation.toml`) serve outra lista em `/.well-known/dcp-revocations.json`: `{ dcp_version, updated_at, revocations, kid_revocations }`, **sem assinatura** sobre a lista. Um verificador que a lê confia no operador dessa URL e no transporte (HTTPS, e o cabeçalho `Authorization` opcional que a fonte de revogação da admissão envia). O perfil de admissão lê esse formato como lista de bloqueio, falha quando não consegue baixá-la e nunca trata uma resposta ausente como «não revogado» ([ADMISSION.md](../../../docs/ADMISSION.md#revocation-sources)).

**Integração proposta:** o operador escolhe uma autoridade e uma URL confiáveis para a jurisdição pertinente; o SDK não descobre nenhuma autoridade a partir do campo `jurisdiction` do RPR. Com o formato assinado proposto acima, a aplicação precisa verificar a assinatura do emissor com uma chave confiável obtida por outro canal, em vez de confiar na chave fornecida pela própria lista. Depois, procura o `agent_id` ou o assinante do bundle entre as entradas e recusa os bundles revogados. A fonte de admissão existente consome, em vez disso, a lista de bloqueio de referência sem assinatura descrita acima. Uma lista em cache só é tão atual quanto o último download dela: recuse continuar quando não for possível baixar uma lista suficientemente recente.

**O que é preciso:** um arquivo JSON servido por um servidor web ou uma CDN, mantido atualizado pelo emissor.

<a id="jurisdictional-transparency-log"></a>

## Log de transparência jurisdicional

Uma jurisdição ou um operador credenciado pode operar um **log de transparência**: um log somente de acréscimo, baseado em árvore de Merkle, de valores `bundle_hash` dos agentes verificados nessa jurisdição. Inspirado no Certificate Transparency (RFC 6962).

**O que é armazenado:** apenas o `bundle_hash` (SHA-256 em hexadecimal) e um timestamp por entrada. Nada de agent_id, human_id ou conteúdo do bundle. Isso limita o que o log revela, mas hashes não são anônimos: quem tiver um bundle pode verificar se ele foi registrado, e o mesmo hash vincula as entradas que o trazem.

**API sugerida:**

- `POST /add` — recebe `{ bundle_hash }`; retorna `{ log_index, timestamp }`.
- `GET /proof/:log_index` — retorna uma prova de inclusão de Merkle (array de hashes irmãos + raiz atual).
- `GET /root` — retorna a raiz de Merkle atual e o tamanho do log.
- `GET /root/signed` — retorna a raiz assinada pelo operador do log (para auditoria).

**Verificação das entradas do log:** um verificador recebe `bundle_hash` + `log_index` + `merkle_proof` (do titular do agente ou do log). O verificador confere localmente a prova de inclusão de Merkle contra a raiz assinada. Nenhuma chamada ao vivo à API do log é necessária se o verificador tiver uma raiz assinada recente.

**Ancoragem da raiz do log:** o operador do log pode ancorar periodicamente a raiz assinada no Bitcoin (via OP_RETURN) ou no Ethereum (via evento de contrato) para obter imutabilidade pública independente do servidor do operador.

**anchor_receipt para o log:** `{ log_url, log_index, merkle_proof, root_anchor: { chain, tx_id, block_height } }`.

**O que é preciso:** um servidor com armazenamento durável (SQLite ou PostgreSQL), a chave de assinatura do operador e auditores que comparem as raízes. O [Trillian](https://github.com/google/trillian), do Google, é uma implementação de código aberto desse padrão.

**Implementação de referência:** este repositório traz `services/transparency-log/` (código-fonte) e a imagem Docker correspondente em `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log:latest`. Ele assina as cabeças de árvore com Ed25519 e inclui gossip entre logs irmãos para que ataques de visão dividida sejam detectáveis (DCP-03 §4). Ele mantém o log em memória, então um reinício o esvazia. Há uma configuração do Fly.io em `deploy/fly/transparency-log.toml`.

<a id="comparison-anchoring-methods"></a>

## Comparação (métodos de ancoragem)

Este repositório não mediu as taxas; elas mudam com o mercado de cada cadeia, então confira-as antes de escolher.

1. **Somente log de transparência** (sem blockchain): o operador assina a raiz. Sem taxas de cadeia. A confiança está no operador + auditores. Adequado quando o operador é uma autoridade confiável (por exemplo, um governo).
2. **Log de transparência + ancoragem em lote no Bitcoin**: o log acumula entradas e ancora a raiz no Bitcoin a cada N horas (uma transação OP_RETURN). A taxa é paga por transação, não por entrada, então é compartilhada pelo lote inteiro. Imutabilidade pública para todo um log nacional.
3. **OP_RETURN do Bitcoin por hash**: uma transação por bundle_hash, ou seja, uma taxa por hash. Só é prático para bundles de baixo volume ou de alto valor.
4. **L2 do Ethereum (Arbitrum, Base, Optimism)**: um evento por hash ou por raiz de lote, pago em gas da L2. Consultável por contratos inteligentes.
5. **Rede principal do Ethereum**: gas por evento na rede principal. Só se justifica se for necessário consultar on-chain a partir de contratos da rede principal.

Para um log em escala governamental, a opção 2 (log + lote no Bitcoin) paga uma taxa por lote em troca de verificabilidade pública.

<a id="published-artefacts-current-state"></a>

## Artefatos publicados (estado atual)

O protocolo não exige nada do que segue: são distribuições de conveniência para que os operadores não precisem compilar a partir do código-fonte. Executar tudo fora do repositório continua sendo totalmente suportado.

- **Repositório:** `github.com/dcp-ai-protocol/dcp-ai` (Apache-2.0). Qualquer pessoa pode espelhá-lo ou bifurcá-lo.
- **SDKs:** publicados nos registros nativos (npm, PyPI, crates.io, módulos Go). As versões deles diferem e podem estar atrás de `main`: veja o [README](../../../README.md) e a seção *Release status* de cada SDK.
- **Imagens de serviços:** os quatro serviços opcionais (verificação, ancoragem, log de transparência, registro de revogações) são distribuídos como imagens Docker multiarquitetura no GHCR. São serviços de referência: guardam o estado em memória (o serviço de revogação pode usar um arquivo), e o serviço de ancoragem ainda não envia a nenhuma cadeia ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)):
    - `ghcr.io/dcp-ai-protocol/dcp-ai/verification`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/anchor`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/transparency-log`
    - `ghcr.io/dcp-ai-protocol/dcp-ai/revocation`
- **Contrato inteligente:** `contracts/ethereum/DCPAnchor.sol` é um projeto Foundry, pronto para implantar no Base, no Optimism ou no Arbitrum. Veja [`contracts/ethereum/DEPLOY.md`](../../../contracts/ethereum/DEPLOY.md).
- **Nenhum registro canônico:** o DCP-AI não opera nenhum «registro DCP» central nem endpoint de verificação hospedado. `dcp-ai.org` serve a página inicial, a documentação, o playground e o contexto JSON-LD para VCs (`/credentials/v2`); ele não verifica bundles para ninguém.
- **Resumo:** cada peça de infraestrutura de que uma implantação precisa está disponível como um SDK que você embute ou como um contêiner que você mesmo executa. A ancoragem continua usando cadeias públicas existentes; nenhum dos artefatos publicados é uma dependência do protocolo.

---

<a id="v20-storage-extensions"></a>

## Extensões de armazenamento da V2.0

O DCP v2.0 introduz cadeias de hash duplo, checkpoints PQ e um manifesto do bundle estendido para a prontidão pós-quântica.

<a id="dual-hash-chains"></a>

### Cadeias de hash duplo

As trilhas de auditoria da V2.0 mantêm duas cadeias de hash paralelas como defesa em profundidade:

```
Entry N:
  primary_hash   = SHA-256(canonical(entry_N))
  secondary_hash = SHA3-256(canonical(entry_N))
  prev_hash      = SHA-256(canonical(entry_N-1))       // or "GENESIS"
  prev_hash_secondary = SHA3-256(canonical(entry_N-1)) // or "GENESIS"
```

A cadeia secundária é opcional (`prev_hash_secondary` e `intent_hash_secondary` no esquema da entrada de auditoria). A especificação exige a verificação independente da cadeia secundária quando ela está presente ([VERIFICATION.md, V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)). É um projeto de defesa em profundidade: a proteção dele depende de realmente conferir as duas cadeias e de preservar compromissos confiáveis.

**Estado da implementação (28/10/2026):** as verificações descritas no estado de 27/10/2026 a seguir, mantido como histórico, estão publicadas desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1 ([Versões publicadas](../../../docs/README.md#published-versions)). Os campos ausentes continuam não sendo exigidos, então uma verificação bem-sucedida não mostra uma cadeia secundária completa; as versões anteriores não verificam os campos secundários. Os adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a` 2.1.0 não foram republicados: dependem de `@dcp-ai/sdk` `^2.2.0` e obtêm as verificações secundárias quando seu lockfile resolve `@dcp-ai/sdk` 2.2.1 ou posterior.

**Estado da implementação (27/10/2026):** no código-fonte ainda não publicado, os verificadores de bundles V2 em TypeScript, Python, Go e Rust, e a compilação WASM a partir do SDK de Rust, verificam todos os campos secundários presentes ([VERIFICATION.md V2-11 e sua errata](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present)): cada `prev_hash_secondary` contra a entrada anterior, cada `intent_hash_secondary` contra a intenção e `audit_merkle_root_secondary` contra as entradas. Os campos ausentes não são exigidos, então uma verificação bem-sucedida não mostra que um bundle contém uma cadeia secundária completa. As rotas do candidato experimental reutilizam essas verificações. Os pacotes publicados listados em [Versões publicadas](../../../docs/README.md#published-versions) são anteriores a essa mudança e não verificam os campos secundários: até que uma publicação a inclua, não interprete a verificação bem-sucedida deles como evidência de que a cadeia secundária é consistente.

A árvore de Merkle é calculada sobre a cadeia primária (SHA-256). Uma raiz de Merkle secundária sobre os hashes SHA3-256 é incluída no manifesto do bundle como `audit_merkle_root_secondary`.

<a id="pq-checkpoints"></a>

### Checkpoints PQ

A V2.0 introduz checkpoints pós-quânticos sobre a trilha de auditoria: registros que cobrem uma sequência de entradas de auditoria, assinados pelo agente com uma assinatura composta (Ed25519 + ML-DSA-65). A forma deles é [`schemas/v2/pq_checkpoint.schema.json`](../../../schemas/v2/pq_checkpoint.schema.json):

```json
{
  "checkpoint_id": "ckpt:...",
  "session_nonce": "a1b2c3d4e5f67890...",
  "event_range": { "from_audit_id": "audit:...", "to_audit_id": "audit:...", "count": 10 },
  "merkle_root": "sha256:...",
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

O bundle traz os checkpoints em `pq_checkpoints`, e o manifesto assinado lista os ids deles; os verificadores os conferem como em `spec/VERIFICATION.md` V2-12.

A frequência dos checkpoints depende do nível de segurança:

| Nível | Intervalo de checkpoints | Finalidade |
|------|-------------------|---------|
| Routine | A cada 50 eventos | Garantia leve |
| Standard | A cada 10 eventos | Validação PQ regular |
| Elevated | A cada evento | Integridade PQ contínua |
| Maximum | A cada evento + verificação | Verificação PQ imediata |

Com uma chave de verificação PQ confiável e uma assinatura PQ válida, um checkpoint autentica o compromisso de Merkle das entradas de auditoria que ele cobre, mesmo se as assinaturas clássicas forem quebradas mais tarde. O esquema do checkpoint não tem campo de timestamp, e a assinatura não estabelece quando os eventos ocorreram.

<a id="v20-bundle-manifest"></a>

### Manifesto do bundle da V2.0

Os bundles da V2.0 incluem um manifesto que pré-calcula os hashes de todos os artefatos:

```json
{
  "dcp_bundle_version": "2.0",
  "manifest": {
    "session_nonce": "a1b2c3d4e5f67890...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 50,
    "pq_checkpoints": ["ckpt:..."]
  }
}
```

Os campos são os de [`schemas/v2/bundle_manifest.schema.json`](../../../schemas/v2/bundle_manifest.schema.json); ele também tem `session_issued_at`, `session_expires_at` e `intended_verifier` opcionais. O `session_nonce` (aleatório de 256 bits) vincula todos os artefatos a uma única sessão, de modo que artefatos de uma sessão não podem ser misturados em outra. Ele não impede que o bundle inteiro seja apresentado de novo ([SECURITY_MODEL.md](../../../docs/SECURITY_MODEL.md#9-cross-artifact-replay)). O manifesto está incluído na assinatura do bundle, garantindo a integridade dele.

<a id="bundle-size-considerations-v20"></a>

### Considerações sobre o tamanho do bundle (V2.0)

Os bundles da V2.0 são maiores que os da V1 por causa das assinaturas compostas e dos hashes duplos:

| Componente | Tamanho na V1 | Tamanho na V2 | Observações |
|-----------|---------|---------|-------|
| Assinatura Ed25519 | 64 bytes | 64 bytes | Inalterado |
| Assinatura ML-DSA-65 | — | ~3.300 bytes | Novo na V2 |
| Hashes SHA-256 | ~32 bytes cada | ~32 bytes cada | Inalterado |
| Hashes SHA3-256 | — | ~32 bytes cada | Novo na V2 |
| Checkpoint PQ | — | ~3.500 bytes | Novo na V2 |
| Manifesto | — | ~500 bytes | Novo na V2 |
| **Bundle típico** | **~1–2 KB** | **~10–50 KB** | Estimativas; depende do tamanho da trilha de auditoria e do nível (spec §14.1) |

Para ambientes com largura de banda limitada, a V2.0 define um formato de transmissão CBOR (RFC 8949), menor que o JSON; este repositório não publicou uma medição da economia.

<a id="anchoring-v20-bundles"></a>

### Ancoragem de bundles da V2.0

O modelo de ancoragem continua o mesmo (somente hashes on-chain), mas a V2.0 acrescenta:
- **Ancoragem de hash duplo** (projeto): um hash SHA3-256 do bundle poderia ser ancorado ao lado do SHA-256; nenhum artefato ou ferramenta deste repositório o define ainda
- **Raízes de log assinadas com PQ** (projeto): as raízes do log de transparência poderiam trazer assinaturas compostas; o log de referência as assina só com Ed25519
- **Formato OP_RETURN** (convenção sugerida): `dcp:v2:<sha256_hex>` (em vez do `dcp:v1:<sha256_hex>` da V1)

Veja [NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) para os detalhes de conformidade dos algoritmos pós-quânticos.
Veja [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md) para migrar os dados V1 já ancorados.

<a id="reference"></a>

## Referências

- Checklist de verificação: [spec/VERIFICATION.md](../../../spec/VERIFICATION.md)
- Formato do bundle: [spec/BUNDLE.md](../../../spec/BUNDLE.md)
- Arquitetura técnica: [TECHNICAL_ARCHITECTURE.md](../../../docs/TECHNICAL_ARCHITECTURE.md)
