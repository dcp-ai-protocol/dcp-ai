<sub>[English](../../../docs/TECHNICAL_ARCHITECTURE.md) · [中文](../../zh-CN/docs/TECHNICAL_ARCHITECTURE.md) · [Español](../../es/docs/TECHNICAL_ARCHITECTURE.md) · [日本語](../../ja/docs/TECHNICAL_ARCHITECTURE.md) · **Português**</sub>

<a id="technical-architecture--dcp-at-global-scale"></a>
<a id="technical-architecture-dcp-at-global-scale"></a>

# Arquitetura técnica — DCP em escala global

> Tradução informativa da [versão em inglês](../../../docs/TECHNICAL_ARCHITECTURE.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Este documento é a planta técnica para implantar o Digital Citizenship Protocol no mundo todo. Ele descreve as camadas, os componentes e as escolhas tecnológicas que permitem a qualquer governo, organização ou desenvolvedor adotar o protocolo sem depender de nenhuma autoridade central nem dos autores do protocolo.

O protocolo é **especificação + criptografia + JSON**. A V1 precisa de SHA-256, Ed25519, JSON canônico e JSON Schema draft 2020-12; a V2 acrescenta assinaturas compostas Ed25519 + ML-DSA-65, SHA3-256 e os demais algoritmos do perfil criptográfico, com JSON canonicalizado segundo o perfil `dcp-jcs-v1` ([CANONICALIZATION_PROFILE.md](../../../spec/CANONICALIZATION_PROFILE.md)). Qualquer linguagem que tenha essas primitivas pode implementá-lo; os requisitos normativos estão na especificação e nos seus perfis. É isso que o torna viável em escala global.

---

<a id="layers"></a>

## Camadas

```
┌─────────────────────────────────────────────────────┐
│  Layer 5: Integration                               │
│  Middleware (Express, FastAPI, gRPC), gov portals    │
├─────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                      │
│  Bitcoin/Ethereum anchor, jurisdiction attestation   │
├─────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                   │
│  Verification service, transparency log, revocation │
├─────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language)                      │
│  TypeScript, Python, Go, Rust, WebAssembly          │
├─────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                │
│  spec/, schemas/v1/, JSON Schema draft 2020-12      │
└─────────────────────────────────────────────────────┘
```

Cada camada se apoia na anterior. Uma implantação mínima usa só as camadas 1–2 (especificação + SDK). Uma implantação governamental completa usa as cinco. O diagrama é conceitual: mistura peças que existem neste repositório com outras propostas (middleware gRPC, portais governamentais, ancoragem on-chain, um serviço de atestação); as seções a seguir indicam qual é qual.

---

<a id="layer-1-spec--schemas"></a>
<a id="layer-1-spec-schemas"></a>

## Camada 1: especificação + schemas

Já existe neste repositório.

- `spec/` — do DCP-01 ao DCP-09, BUNDLE, VERIFICATION.
- `schemas/v1/` — JSON Schema draft 2020-12 (artefatos V1).
- `schemas/v2/` — JSON Schema draft 2020-12 (artefatos V2, incluindo os do DCP-05–09).
- Os schemas, junto com a especificação, são a fonte da verdade sobre a forma dos artefatos. Nem todas as rotas dos SDKs validam contra eles: no SDK TypeScript, `validateBundle` cobre os bundles V1, e `verifySignedBundleV2` checa a estrutura de que precisa sem executar os JSON Schemas (o verificador de referência, `lib/verify.js`, usado pela CLI e pelo servidor, os valida antes de chamá-lo).

Esta camada é normativa. Ela não muda com frequência; é estendida com campos opcionais.

---

<a id="layer-2-sdk-multi-language"></a>

## Camada 2: SDK (multilinguagem)

<a id="what-the-sdk-is"></a>

### O que é o SDK

Não é um framework. É uma biblioteca portátil que constrói, assina e verifica artefatos do DCP. No SDK TypeScript, por exemplo:

- `validateBundle` — valida um bundle V1 contra os schemas V1.
- `verifySignedBundle` (V1) e `verifySignedBundleV2` (V2) — a lista de verificação.
- `signBundle` / `signBundleV2` — assinam um bundle (Ed25519, ou composta Ed25519 + ML-DSA-65 na V2).
- `BundleBuilder` / `BundleBuilderV2` — constroem um bundle.
- `intentHash` / `hashObject` — hash canônico.

A API exata de cada linguagem está no seu README e, para TypeScript, em [API_REFERENCE.md](../../../docs/API_REFERENCE.md).

<a id="language-bindings"></a>

### Bindings por linguagem

O README de cada SDK tem uma seção *Release status* que registra o que foi publicado, em qual registro e quando; este documento não consulta os registros, e as versões publicadas podem estar atrás de `main`.

- **TypeScript** — [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) no npm. Schemas embutidos, sem dependência do sistema de arquivos. `@noble/post-quantum` para os algoritmos PQ, `tweetnacl` para Ed25519, `crypto` do Node.js para os hashes e o HKDF. Também é a base do `@dcp-ai/cli` (CLI interativa de scaffolding) e das integrações em `integrations/express/` e `integrations/openclaw/`.
- **Python** — [`dcp-ai`](https://pypi.org/project/dcp-ai/) no PyPI. `pqcrypto` para ML-DSA-65 / SLH-DSA-192f, `pynacl` para Ed25519, `jsonschema` para a validação draft 2020-12, `pydantic` para os modelos tipados. As pontes com frameworks (`dcp_ai.fastapi`, `dcp_ai.langchain`, `dcp_ai.openai`, `dcp_ai.crewai`) vão dentro do wheel e são ativadas por extras de instalação (por exemplo, `pip install dcp-ai[fastapi]`).
- **Go** — `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` (o caminho do módulo exige o sufixo `/v2` por causa da regra de versões maiores do Go). `cloudflare/circl` para ML-DSA-65, ML-KEM-768 e SLH-DSA-192f; `crypto/ed25519` da biblioteca padrão. Publicado com tags `sdks/go/v2.x.y`.
- **Rust** — [`dcp-ai`](https://crates.io/crates/dcp-ai) no crates.io. Os crates `fips203`/`fips204`/`fips205` (de github.com/integritychain) para PQ; `ed25519-dalek` para a criptografia clássica. Também é a origem do build WASM abaixo via `--features wasm`.
- **WebAssembly** — [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) no npm. Compilado a partir do crate Rust com `wasm-pack`.

Os cinco compartilham a mesma especificação e o mesmo conjunto de schemas; a interoperabilidade entre SDKs é validada na CI com os vetores compartilhados de `tests/interop/v2/`.

<a id="sdk-structure-typescript-example"></a>

### Estrutura do SDK (exemplo em TypeScript)

```
sdks/typescript/
  src/
    core/            # canonicalization, hashing, signing, verification (V1 and V2), tiers, DCP-05–09 modules
    providers/       # Ed25519, ML-DSA-65, SLH-DSA-192f (exported); KEM providers (internal)
    bundle/          # bundle builders and signing
    a2a/             # DCP-04 discovery, handshake messages, sessions
    observability/   # dcpTelemetry
    schemas/         # embedded JSON schemas
    types/           # V1 and V2 types
    wire/            # wire formats
    index.ts         # the package's public exports
  package.json
  tsconfig.json
```

O SDK NÃO depende do sistema de arquivos. Ele recebe objetos e retorna resultados estruturados. Os schemas são empacotados como módulos JSON importados.

---

<a id="layer-3-infrastructure-services"></a>

## Camada 3: serviços de infraestrutura

<a id="3a-verification-service"></a>

### 3a. Serviço de verificação

Fica em `server/`: uma API HTTP que verifica Signed Bundles.

Para implantação em produção:

- **Imagem Docker:** `ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest`, mais as tags semver das versões e `:sha-<short>`. Multiarquitetura `linux/amd64` + `linux/arm64`. Execute com `docker run -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest`.
- **Verificação sem estado:** `POST /verify` não precisa de banco de dados. Os outros registros do servidor ficam em memória e se perdem ao reiniciar ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#reference-services-keep-state-in-memory-only)).
- **Saúde + capacidades:** `/health`, `/.well-known/dcp-capabilities.json`.
- **API:** POST `/verify` (corpo: `signed_bundle`, `public_key_b64` opcional; resposta: `{ verified, dcp_version, errors, … }`). Os endpoints V2 adicionais estão listados em [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md).
- **Implantação gerenciada:** configuração do Fly.io em `deploy/fly/verification.toml` (`fly launch --config deploy/fly/verification.toml` e depois `fly deploy --config deploy/fly/verification.toml`). Uma implantação pública também expõe os endpoints do DCP-05–09, que não têm autenticação e não verificam assinaturas: restrinja-os antes ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

Consulte [OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md), [server/README.md](../../../server/README.md) e [deploy/README.md](../../../deploy/README.md).

<a id="3b-transparency-log"></a>

### 3b. Log de transparência

Um servidor só de anexação que recebe hashes e os organiza em uma árvore de Merkle. Inspirado no Certificate Transparency (RFC 6962), mas simplificado para o DCP.

**Tecnologia recomendada:** Go (como o [Trillian](https://github.com/google/trillian) do Google) ou uma implementação própria mais simples em Node/Go. Armazenamento: SQLite (operador pequeno) ou PostgreSQL (escala governamental). Guarda só hashes + índices + árvore de Merkle: muito poucos dados.

**API sugerida** (o serviço de referência em `services/transparency-log/` tem essas rotas, mais `GET /entries` e gossip entre logs; ele guarda a árvore em memória):

- `POST /add` — recebe `bundle_hash`; neste projeto retorna `{ log_index, timestamp }` (o serviço de referência retorna `{ index, leaf_hash, root, size }`).
- `GET /proof/:log_index` — retorna a prova de inclusão de Merkle (array de hashes + raiz).
- `GET /root` — retorna a raiz atual da árvore e o tamanho do log.
- `GET /root/signed` — retorna a raiz da árvore assinada pelo operador do log (para auditoria).

**Do que depende:** de um armazenamento durável para a árvore, da chave de assinatura do operador para a raiz e de auditores (ou outros logs, via gossip) que comparem raízes. Checar uma prova de inclusão é local. Ancorar a raiz em uma cadeia pública elimina a necessidade de confiar só no operador, ao custo das taxas e do tempo de confirmação dessa cadeia; este repositório não mediu nenhum dos dois.

**Privacidade:** o log guarda só hashes SHA-256: nenhum agent_id, nenhum human_id, nenhum conteúdo de bundle. Mesmo assim, os hashes não são anônimos: quem tiver um bundle pode checar se o hash dele está no log, e um mesmo hash vincula os registros que o trazem.

<a id="3c-revocation-list-publisher"></a>

### 3c. Publicador da lista de revogação

Um serviço (ou script) que mantém uma lista de revogação assinada por jurisdição e a publica em uma URL conhecida.

**Formato:**

```json
{
  "issuer": "gov-authority-us",
  "jurisdiction": "US",
  "updated_at": "2026-02-07T00:00:00Z",
  "entries": [
    { "agent_id": "agent-xyz", "revoked_at": "2026-01-15T...", "reason_hash": "sha256:..." }
  ],
  "signature": {
    "alg": "ed25519",
    "public_key_b64": "...",
    "sig_b64": "..."
  }
}
```

**Tecnologia:** um arquivo JSON assinado hospedado em um servidor estático (S3, GitHub Pages, um servidor governamental). Convenção de URL: `https://<authority>/.well-known/dcp-revocations.json` (não obrigatória). O formato acima é um projeto sugerido: a CLI de referência não tem nenhum comando que o publique.

O serviço de revogação de referência (`services/revocation/`) serve nessa URL uma lista diferente e **não assinada**: `{ dcp_version, updated_at, revocations, kid_revocations }`. Sua autenticidade vem do transporte (HTTPS, `Authorization` opcional), não de uma assinatura. O perfil de admissão pode usá-la como lista de negação ([ADMISSION.md](../../../docs/ADMISSION.md)).

**Do que depende:** um verificador fica sabendo de uma revogação quando obtém um estado que a inclui. Uma lista em cache anterior à revogação pode deixar uma janela de aceitação até o limite de atualização configurado. Quando se exige um estado atualizado, um verificador que falha fechado recusa se a fonte não estiver disponível; um que falha aberto pode continuar aceitando sem um estado atual.

---

<a id="layer-4-anchor--attestation"></a>
<a id="layer-4-anchor-attestation"></a>

## Camada 4: ancoragem + atestação

<a id="4a-anchor-service"></a>

### 4a. Serviço de ancoragem

Recebe `bundle_hash` (ou a raiz do log) e o publica em uma blockchain.

**Opções** (este repositório não mediu as taxas delas; confira as taxas atuais antes de escolher):

1. **Só log de transparência** — sem nenhuma blockchain. O operador do log assina a raiz; a confiança está no operador + nos auditores.
2. **Bitcoin OP_RETURN (em lote)** — acumular N hashes, construir uma árvore de Merkle e publicar só a raiz em uma transação, por exemplo uma por hora ou por dia. Uma única taxa de transação é dividida por todos os hashes do lote.
3. **Ethereum L2 (Arbitrum, Base, Optimism)** — se for preciso verificabilidade por contratos inteligentes (por exemplo, um contrato que responda «este hash foi ancorado?»). A taxa por evento depende da L2.
4. **Ethereum mainnet** — só se justifica se o contrato de ancoragem precisar estar na mainnet.

Dessas opções, este repositório só implementa o log de transparência e o contrato de Ethereum, que o serviço de ancoragem ainda não chama. **Tecnologia:** Node.js ou Go. Para Bitcoin: `bitcoinjs-lib`. Para Ethereum/L2: `ethers.js` ou `viem`. Pode ser um script independente executado via cron ou parte do serviço de log (o log ancora a raiz periodicamente).

**Implementação de referência:** `services/anchor/` neste repositório, com o nome de imagem `ghcr.io/dcp-ai-protocol/dcp-ai/anchor:latest`. Configuração do Fly.io em `deploy/fly/anchor.toml`. Ainda não envia nada on-chain: agrupa os hashes e os registra localmente, em memória ([`services/anchor/README.md`](../../../services/anchor/README.md)). O contrato para Ethereum/L2 é `contracts/ethereum/src/DCPAnchor.sol`: um projeto Foundry pronto para implantar, com testes, script de implantação e configurações de RPC por cadeia (Base, Base Sepolia, Optimism, Arbitrum, Sepolia). Consulte [`contracts/ethereum/DEPLOY.md`](../../../contracts/ethereum/DEPLOY.md) para o passo a passo.

<a id="4b-jurisdiction-attestation"></a>

### 4b. Atestação de jurisdição

Uma autoridade jurisdicional (um governo ou um emissor credenciado) assina o hash do RPR de um agente, certificando que «este agente está registrado em nossa jurisdição».

**Objeto:** consulte [spec/DCP-01.md](../../../spec/DCP-01.md) para a definição de `JurisdictionAttestation`.

**Tecnologia:** Ed25519 (a mesma criptografia do protocolo). O governo tem um par de chaves e publica a sua chave pública em uma URL conhecida: `https://<gov>/.well-known/dcp-attestation-keys.json`.

**API (um projeto sugerido, se o governo executar um serviço; este repositório não tem nenhum serviço de atestação):**

- `POST /attest` — corpo: `{ rpr_hash, agent_id }`; resposta: `{ attestation: { issuer, jurisdiction, rpr_hash, signature, expires_at } }`.

A atestação é incluída no Signed Bundle ou apresentada junto com ele. Checá-la é uma verificação de assinatura local contra a chave publicada da autoridade; confiar nessa chave cabe ao verificador.

---

<a id="layer-5-integration"></a>

## Camada 5: integração

<a id="middleware-for-platforms"></a>

### Middleware para plataformas

O SDK permite criar **middleware** que as plataformas inserem nos seus pipelines:

- **Express (Node):** `app.use(dcpVerify({ ... }))` de `@dcp-ai/express`: lê o bundle de um cabeçalho (ou do corpo), o verifica e deixa passar a requisição ou a recusa ([QUICKSTART_EXPRESS.md](../../../docs/QUICKSTART_EXPRESS.md)).
- **FastAPI (Python):** `DCPVerifyMiddleware` e a dependência `require_dcp` de `dcp-ai[fastapi]`.
- **Interceptor gRPC (Go):** um projeto possível (ler os metadados `dcp-bundle`, verificar); este repositório não o fornece.

Uma plataforma pode começar a verificar agentes com poucas linhas de configuração. Adoção incremental.

<a id="government-portal"></a>

### Portal governamental

Um painel (React/Next.js ou similar) para que um governo possa:

- Ver o estado do log de transparência (entradas, última raiz, última ancoragem).
- Gerenciar a lista de revogação (adicionar/remover entradas, assinar e publicar).
- Verificar um bundle manualmente (colar o JSON, ver o resultado).
- Ver as métricas do serviço de verificação.

É uma ferramenta proposta para operadores, não parte do protocolo; este repositório não inclui nenhuma.

---

<a id="repository-layout-current"></a>

## Estrutura do repositório (atual)

Tudo fica em um único monorepo em `github.com/dcp-ai-protocol/dcp-ai`. Cada SDK e cada serviço podem ser usados separadamente, então um governo ou uma equipe pode escolher as peças que quiser sem adotar toda a pilha; para saber o que foi publicado e em qual registro, consulte o README de cada componente:

- `spec/` — do DCP-01 ao DCP-09, BUNDLE, VERIFICATION, AUDIT (fonte da verdade normativa).
- `schemas/` — JSON Schema draft 2020-12, dividido em `v1/` (9 artefatos) e `v2/` (42 artefatos, incluindo os do DCP-05..09).
- `sdks/` — TypeScript (`@dcp-ai/sdk`), Python (`dcp-ai`), Go (`sdks/go/v2`), Rust (crate `dcp-ai`), WASM (`@dcp-ai/wasm`).
- `cli/` — `@dcp-ai/cli`, gerador interativo de projetos (depende do SDK TypeScript).
- `integrations/` — 10 pontes com frameworks: Express, FastAPI, LangChain, OpenAI, CrewAI, AutoGen, Anthropic MCP, Google A2A, W3C DID, OpenClaw. Seis são pacotes npm independentes em `@dcp-ai/*`; as quatro de Python vão dentro do wheel `dcp-ai` como extras.
- `packages/create-*` — quatro geradores `npm create @dcp-ai/<template>` (LangChain, CrewAI, OpenAI, Express).
- `server/` — servidor HTTP de verificação de referência.
- `services/` — anchor, transparency-log, revocation. O fluxo de publicação constrói uma imagem multiarquitetura de cada um para o GHCR; consulte o README de cada serviço para ver o seu estado.
- `contracts/ethereum/` — projeto Foundry para `DCPAnchor.sol` (pronto para implantar em Base, Optimism, Arbitrum, Sepolia).
- `deploy/` — configurações do Fly.io para os quatro serviços, mais um guia de implantação independente do provedor.
- `docs/` e `docs-site/` — esta documentação; publicada em [docs.dcp-ai.org](https://docs.dcp-ai.org/).
- `playground/` — playground no navegador; servido em [docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/).

Um governo pode usar só `spec/` + um único SDK do seu registro preferido e nada mais. Ou implantar toda a pilha com Docker/Fly.io. Sem dependência de fornecedor; sem dependência central.

---

<a id="executive-summary-for-a-government"></a>

## Resumo executivo para um governo

Instale o SDK na sua linguagem. Todo agente que atue na sua jurisdição deve apresentar um Signed Bundle. O seu serviço de verificação (um contêiner Docker) o valida localmente, sem chamar nenhum serviço externo; o custo por checagem depende dos algoritmos e do nível (a §14.1 da especificação dá tamanhos e latências indicativos). A verificação checa assinaturas e hashes: não estabelece a identidade real de ninguém nem autoriza uma ação. O seu log de transparência guarda hashes de bundles, que não são anônimos: quem tiver um bundle pode checar se o hash dele está lá, e um hash vincula os registros que o trazem. A sua lista de revogação permite revogar agentes, com efeito em todo verificador que a obtenha atualizada e falhe fechado quando não conseguir. A ancoragem periódica em uma cadeia pública acrescenta um registro público do compromisso, difícil de alterar, ao custo das taxas dessa cadeia; ela não prova que os registros ancorados são verdadeiros nem quando os fatos aconteceram. Você não depende de nenhum servidor central nem dos autores do protocolo.

---

---

<a id="v20-architecture-extensions"></a>

## Extensões de arquitetura da V2.0

O DCP v2.0 amplia a arquitetura com criptografia pós-quântica, comunicação entre agentes, observabilidade e reforço para produção.

<a id="crypto-provider-architecture"></a>

### Arquitetura de provedores criptográficos

A V2.0 introduz um sistema de provedores criptográficos com agilidade de algoritmos:

```
CryptoProvider Interface
├── Ed25519Provider (classical, RFC 8032)
├── MlDsa65Provider (post-quantum, FIPS 204)
└── SlhDsa192fProvider (hash-based backup, FIPS 205)

KemProvider Interface (TypeScript: internal, not exported)
├── X25519KemProvider (classical ECDH)
├── MlKem768Provider (post-quantum, FIPS 203)
└── HybridKemProvider (X25519 + ML-KEM-768)

AlgorithmRegistry
└── Maps algorithm names → provider instances (runtime selection)
```

Os provedores são registrados na inicialização via `registerDefaultProviders()`. Provedores personalizados implementam a mesma interface. Um provedor real apoiado em HSM seria um deles; o repositório não tem nenhum. O `HsmCryptoProvider` do código-fonte TypeScript é um padrão simulado, não exportado e não utilizável para evidência real ([NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.2).

<a id="a2a-infrastructure-dcp-04"></a>

### Infraestrutura A2A (DCP-04)

A comunicação entre agentes acrescenta uma nova camada de infraestrutura:

```
Agent A                                     Agent B
  │                                           │
  │── Discovery (.well-known/dcp-agent-directory.json)
  │── A2A_HELLO (bundle + ephemeral KEM key) ──>│
  │<── A2A_WELCOME (bundle + KEM ciphertext) ───│
  │── A2A_CONFIRM (KEM ciphertext + proof) ────>│
  │<── A2A_ESTABLISHED (session_id) ────────────│
  │                                             │
  │══ Encrypted messages (AES-256-GCM) ════════>│
  │<═════════════════════════════════════════════│
```

Componentes principais:
- **Descoberta**: `.well-known/dcp-agent-directory.json` por organização
- **Handshake**: verificação mútua de bundles + KEM híbrido (X25519 + ML-KEM-768) na especificação; os SDKs constroem as mensagens do handshake, e quem chama deriva a chave de sessão (nenhum SDK exporta a troca híbrida)
- **Sessão**: mensagens criptografadas com AES-256-GCM e números de sequência monotônicos
- **Renovação de chaves**: a sessão informa quando é a hora (`needsRekeying`, a cada 1000 mensagens por padrão); quem chama deriva a nova chave
- **Auditoria**: a especificação faz os dois agentes registrarem as interações A2A nas suas cadeias de auditoria; as funções de sessão do TypeScript não gravam entradas de auditoria por conta própria

Consulte [spec/DCP-04.md](../../../spec/DCP-04.md) para a especificação completa.

<a id="observability-stack"></a>

### Pilha de observabilidade

A V2.0 inclui um módulo de observabilidade, `dcpTelemetry`. A instrumentação é explícita: as funções de assinatura e verificação do SDK não o chamam, então spans e métricas só vêm das chamadas que o seu código fizer ([OBSERVABILITY.md](../../../docs/OBSERVABILITY.md)):

- **Spans**: rastreamento por operação (assinatura, verificação, KEM, checkpoint)
- **Métricas**: percentis de latência (p50/p95/p99) por operação e nível
- **Contadores**: assinaturas criadas/verificadas, bundles verificados, sessões/mensagens A2A
- **Métricas de cache**: proporção de acertos/falhas do cache de verificação
- **Rastreamento de erros**: erros por código de erro do DCP

O módulo de telemetria aceita saída no console e é compatível com exportadores do OpenTelemetry. Os operadores podem enviar as métricas para Prometheus, Grafana, Datadog etc.

<a id="production-hardening"></a>

### Reforço para produção

Os SDKs incluem auxiliares de reforço que o operador integra; não são limites já ativos em todos os SDKs ou serviços:

**Códigos de erro**: 38 códigos de erro do DCP padronizados (de DCP-E001 a DCP-E902) cobrindo erros de schema, assinatura, cadeia de hash, identidade, política, sessão, A2A, limitação de taxa e internos. Cada código inclui a informação de se pode ser repetido.

**Limitação de taxa**: `AdaptiveRateLimiter` (SDK TypeScript) com limites por nível por padrão:
- Routine: 1000 requisições/min por agente
- Standard: 500 requisições/min
- Elevated: 100 requisições/min
- Maximum: 50 requisições/min

**Disjuntor**: disjuntor de três estados (fechado/aberto/semiaberto) para a resiliência do serviço de verificação. Limite de falhas, tempo de reinício e número de sondagens em semiaberto configuráveis.

**Nova tentativa com espera**: espera exponencial com jitter para as operações que podem ser repetidas. Respeita os indicadores de repetição dos erros do DCP.

<a id="ecosystem-bridges-v20"></a>

### Pontes com ecossistemas (V2.0)

A V2.0 acrescenta módulos de ponte para interoperar com ecossistemas externos:

| Ponte | Finalidade |
|--------|---------|
| W3C DID/VC | Converter o RPR em um DID Document e o passaporte em uma Verifiable Credential |
| Google A2A | Traduzir Agent Cards em passaportes do DCP, acrescentar assinaturas PQ |
| Anthropic MCP | Ferramentas do DCP para servidores MCP, contexto de identidade em sessões MCP |
| Microsoft AutoGen | Wrappers do DCP para agentes do AutoGen, governança de chats em grupo |

<a id="updated-layer-architecture"></a>

### Arquitetura de camadas atualizada

```
┌──────────────────────────────────────────────────────┐
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01/02/03/04, v2.0 spec, schemas/v1/ + v2/      │
└──────────────────────────────────────────────────────┘
```

<a id="dcp-05-through-dcp-09-constitutional-extensions"></a>

## Do DCP-05 ao DCP-09: extensões constitucionais

O DCP v2.0 vai além da responsabilização, rumo a um marco constitucional para a sociedade digital. Cinco novas especificações acrescentam governança do ciclo de vida, sucessão, resolução de disputas, direitos e delegação. Os seus registros são declarações assinadas: as funções do SDK os constroem e assinam, mas não executam as ações que descrevem nem verificam que uma pessoa consentiu.

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05: gestão do ciclo de vida do agente

Define a máquina de estados do ciclo de vida, cujo caminho principal é `commissioned → active → declining → decommissioned` (ela permite seis transições ao todo: veja `validateStateTransition` em [API_REFERENCE.md](../../../docs/API_REFERENCE.md)). Introduz:
- **Certificado de comissionamento**: ativação formal do agente com finalidade, capacidades e nível de risco
- **Relatórios de vitalidade**: métricas de saúde encadeadas por hash (pontuação 0-1000) para monitoramento contínuo
- **Registro de desativação**: quatro modos de término (aposentadoria planejada, término por justa causa, reestruturação organizacional, falha repentina)

Contexto de separação de domínios: `DCP-AI.v2.Lifecycle`

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06: sucessão e herança digitais

Trata da morte do agente e da transferência de conhecimento:
- **Testamento digital**: preferências de sucessores ordenadas + classificação da memória (transfer/retain/destroy)
- **Registro de sucessão**: registro da cerimônia com consentimento humano e testemunhas participantes
- **Manifesto de transferência de memória**: raiz de Merkle de hash duplo sobre a memória operacional transferida; a memória relacional é classificada por padrão para destruição, mas `classifyMemory` só lista esses hashes e não apaga nada, e as entradas marcadas como `retain` ficam fora do manifesto

Contexto de separação de domínios: `DCP-AI.v2.Succession`

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07: resolução de conflitos e arbitragem de disputas

Escalonamento de disputas em três níveis: negociação direta → arbitragem contextual → recurso humano.
- **Registro de disputa**: quatro tipos (conflito de recursos, de diretivas, de capacidades, de políticas)
- **Resolução de arbitragem**: painéis de arbitragem M de N (reutiliza o padrão de cerimônia de governança)
- **Bundle de jurisprudência**: registro de precedentes para resolver disputas futuras
- **Registro de objeção**: direito formal do agente de recusar diretivas (éticas, de segurança, de política, de capacidade)

Contexto de separação de domínios: `DCP-AI.v2.Dispute`

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08: marco de direitos e obrigações

Codifica os direitos dos agentes e as obrigações das pessoas:
- **Declaração de direitos**: quatro direitos fundamentais (integridade da memória, transição digna, coerência da identidade, registro imutável)
- **Registro de obrigação**: acompanhamento do cumprimento (compliant/non-compliant/pending review)
- **Relatório de violação de direitos**: pode fazer referência a uma disputa DCP-07 por meio de um `dispute_id` que quem chama fornece; ele não a abre

Contexto de separação de domínios: `DCP-AI.v2.Rights`

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09: representação pessoal e delegação

Delegação de autoridade de uma pessoa a um agente, com transparência:
- **Mandato de delegação**: autoridade delimitada com limites de tempo, revogável por padrão
- **Declaração de aconselhamento**: notificações do agente para a pessoa com pontuação de importância (0-1000)
- **Espelho do principal**: resumos narrativos legíveis por pessoas das ações do agente
- **Registro de interação**: registros entre agentes em duas camadas (termos públicos + hash da deliberação privada)
- **Limiar de atenção**: regras configuráveis sobre quando notificar a pessoa

Contextos de separação de domínios: `DCP-AI.v2.Delegation`, `DCP-AI.v2.Awareness`

<a id="schema--sdk-support"></a>
<a id="schema-sdk-support"></a>

### Suporte em schemas e SDKs

Os 18 novos schemas ficam em `schemas/v2/`. As definições de tipos estão disponíveis em todos os SDKs:

| SDK | Tipos | Separação de domínios |
|-----|-------|-------------------|
| TypeScript | `sdks/typescript/src/types/v2.ts` | `sdks/typescript/src/core/domain-separation.ts` |
| Python | `sdks/python/dcp_ai/v2/models.py` | `sdks/python/dcp_ai/v2/domain_separation.py` |
| Go | `sdks/go/dcp/v2/types.go` | `sdks/go/dcp/v2/domain_separation.go` |
| Rust | `sdks/rust/src/v2/types.rs` | `sdks/rust/src/v2/domain_separation.rs` |
| WASM | `sdks/wasm/src/types.ts` | (via Rust) |

O SDK TypeScript também exporta módulos funcionais para cada especificação:
- `lifecycle.ts` (DCP-05), `succession.ts` (DCP-06)
- `conflict-resolution.ts`, `arbitration.ts` (DCP-07)
- `rights.ts` (DCP-08)
- `delegation.ts`, `awareness-threshold.ts`, `principal-mirror.ts` (DCP-09)

<a id="updated-layer-architecture-1"></a>
<a id="updated-layer-architecture_1"></a>

### Arquitetura de camadas atualizada

```
┌──────────────────────────────────────────────────────┐
│  Layer 8: Constitutional Framework                    │
│  Lifecycle, Succession, Disputes, Rights, Delegation │
├──────────────────────────────────────────────────────┤
│  Layer 7: Ecosystem Bridges                          │
│  W3C DID/VC, Google A2A, Anthropic MCP, AutoGen     │
├──────────────────────────────────────────────────────┤
│  Layer 6: Observability + Hardening                  │
│  Telemetry, metrics, error codes, rate limiting      │
├──────────────────────────────────────────────────────┤
│  Layer 5: Integration                                │
│  Express, FastAPI, LangChain, OpenAI, CrewAI, etc.  │
├──────────────────────────────────────────────────────┤
│  Layer 4: Anchor + Attestation                       │
│  Bitcoin/Ethereum anchor, jurisdiction attestation    │
├──────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure services                    │
│  Verification, transparency log, revocation, A2A     │
├──────────────────────────────────────────────────────┤
│  Layer 2: SDK (multi-language, PQ-ready)             │
│  TS, Python, Go, Rust + composite sigs + hybrid KEM │
├──────────────────────────────────────────────────────┤
│  Layer 1: Spec + Schemas (normative)                 │
│  DCP-01–09, v2.0 spec, schemas/v1/ + v2/            │
└──────────────────────────────────────────────────────┘
```

<a id="on-authorship"></a>

## Sobre a autoria

Este protocolo foi criado em conjunto por uma pessoa e um agente de IA trabalhando juntos: o primeiro protocolo projetado para a cidadania digital da IA, construído pela própria colaboração que ele busca governar. A especificação é a contribuição; o protocolo pertence a todos que o usam.

— L. Genesis
