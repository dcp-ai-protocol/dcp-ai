<sub>[English](OPERATOR_GUIDE.md) · [中文](OPERATOR_GUIDE.zh-CN.md) · [Español](OPERATOR_GUIDE.es.md) · [日本語](OPERATOR_GUIDE.ja.md) · **Português**</sub>

<a id="operator-guide--running-a-verification-service"></a>
<a id="operator-guide-running-a-verification-service"></a>

# Guia do operador — executar um serviço de verificação

> Tradução informativa da [versão em inglês](OPERATOR_GUIDE.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Este guia é para **terceiros** que queiram executar um serviço de «agente verificado»: uma API HTTP que verifica Signed Bundles do DCP (e, opcionalmente, ancora hashes numa blockchain). O protocolo **não** exige nenhum servidor central; a verificação sempre pode ser feita localmente com `dcp verify-bundle`. Este serviço é **opcional** e executado por escolha do operador.

<a id="what-is-an-agent-verified-service"></a>

## O que é um serviço de «agente verificado»?

Um **serviço de verificação de agentes** é uma API HTTP que:

1. **Verifica** um Signed Bundle: executa o mesmo checklist normativo de [spec/VERIFICATION.md](../spec/VERIFICATION.md) (validação de esquema, assinatura, intent_hash, cadeia de auditoria, merkle_root opcional).
2. Opcionalmente **confere** um `anchor_receipt` contra uma blockchain pública ou um log de transparência (usando apenas dados públicos).
3. Opcionalmente **ancora** um `bundle_hash` numa cadeia existente e retorna um `anchor_receipt` ao cliente.

O serviço **não tem estado**: cada requisição recebe um bundle (e opcionalmente uma chave pública), verifica-o e retorna um resultado. Não há registro central de agentes; o protocolo não define uma URL canônica (por exemplo, não há nenhum endpoint «dcp.ai» obrigatório).

`verified: true` significa que o bundle está intacto e assinado pelas chaves que ele nomeia. Isso não diz quem é o principal nem se você deve agir com base no bundle: aceitar bundles apenas de principais em que você confia é a admissão, uma etapa à parte (`POST /v2/admit` no servidor de referência, veja [ADMISSION.md](ADMISSION.md), não publicada).

<a id="who-runs-it"></a>

## Quem o executa?

**Terceiros.** Qualquer pessoa pode implantar este serviço com este repositório (esquemas + especificação + CLI ou API programática). O autor do protocolo não opera nenhum servidor central de verificação.

<a id="requirements"></a>

## Requisitos

- Uma cópia deste repositório: esquemas em `schemas/v1/` e `schemas/v2/`, especificação em `spec/`, e a CLI de referência e a
  biblioteca de verificação do pacote raiz, que não é publicado no npm.
- Capacidade de executar a verificação: a CLI (`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`) ou a API programática do repositório: `verifySignedBundle` (assíncrona) e `validateBundle` em `lib/verify.js`. Lá, os bundles V2 são validados contra o esquema e depois verificados pelo `@dcp-ai/sdk`.
- Opcional, para a ancoragem: acesso RPC ou a um explorador de blocos de uma cadeia existente (Bitcoin, Ethereum ou um log de transparência). Veja [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md).

<a id="suggested-api-contract"></a>

## Contrato de API sugerido

Para que clientes e operadores possam interoperar, esta seção sugere um contrato mínimo. As implementações podem estendê-lo.

### POST /verify

Verifica um Signed Bundle segundo o checklist normativo (esquema, assinatura, intent_hash, cadeia de auditoria, merkle opcional).

- **Requisição (JSON):**
  - `signed_bundle` (objeto): o Signed Bundle a verificar.
  - `public_key_b64` (string, opcional): na V1, a chave pública do assinante quando o bundle não a inclui; caso contrário, usa-se `signature.signer.public_key_b64` do bundle. Na V2, fixa o assinante clássico (recusado no modo `pq_only`).

- **Resposta (JSON):**
  - `verified` (booleano): `true` se todas as verificações passarem.
  - `errors` (array de strings, opcional): se `verified` for `false`, mensagens de erro legíveis.

Exemplo:

```json
// Request
{ "signed_bundle": { "bundle": { ... }, "signature": { ... } } }

// Response (success)
{ "verified": true }

// Response (failure)
{ "verified": false, "errors": ["SIGNATURE INVALID", "Hint: Check that the public key ..."] }
```

O servidor de referência (`server/`) implementa isso como `POST /verify`. A resposta dele sempre traz `dcp_version` e `errors`; na V2 acrescenta `warnings`, `verifier_policy_hash` e `resolved_tier`. Os corpos das requisições são JSON.

<a id="post-anchor-optional"></a>

### POST /anchor (opcional)

Ancora um `bundle_hash` numa cadeia e retorna um `anchor_receipt`. O operador configura a cadeia e as credenciais (por exemplo, carteira, URL de RPC). Veja [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) para o formato do recibo.

- **Requisição (JSON):**
  - `bundle_hash` (string): por exemplo, `sha256:<hex>`.
  - `chain` (string): por exemplo, `"bitcoin"`, `"ethereum"`.

- **Resposta (JSON):**
  - `anchor_receipt` (objeto): por exemplo, `{ "chain": "bitcoin", "tx_id": "...", "block_height": N }` ou campos no estilo do Ethereum.

A implementação de `/anchor` depende da cadeia e das ferramentas do operador (OP_RETURN do Bitcoin, evento de contrato do Ethereum etc.). O serviço de ancoragem de referência (`services/anchor`) ainda não a implementa: ele registra os hashes localmente, em memória, com `tx_hash: null` e `onchain: false`, e não retorna nenhum `anchor_receipt`. O servidor de verificação de referência responde a `POST /anchor` com 501.

<a id="deployment"></a>

## Implantação

O servidor de verificação de referência, o serviço de ancoragem, o log de transparência e o registro de revogações são **publicados como imagens Docker** no GitHub Container Registry. Na maioria dos casos você nem precisa clonar o repositório: `docker run` basta.

<a id="option-1--pull-the-reference-image-fastest"></a>
<a id="option-1-pull-the-reference-image-fastest"></a>

### Opção 1 — baixar a imagem de referência (o mais rápido)

```bash
docker run -d -p 3000:3000 ghcr.io/dcp-ai-protocol/dcp-ai/verification:latest
curl http://localhost:3000/health
```

Multiarquitetura (`linux/amd64` + `linux/arm64`). Tags: `:latest`, as tags semver de cada versão (`:<major>.<minor>.<patch>`, `:<major>.<minor>`, `:<major>`) e `:sha-<short>`. A pilha completa (verificação + ancoragem + dois logs de transparência + revogação, cinco contêineres) pode ser levantada com um único `docker compose up -d` executado em `docker/`, ou com `docker compose -f docker/docker-compose.yml up -d` a partir da raiz do repositório.

<a id="option-2--managed-paas"></a>
<a id="option-2-managed-paas"></a>

### Opção 2 — PaaS gerenciado

Há configurações prontas para o Fly.io em [`deploy/fly/`](../deploy/fly/); o [guia de implantação](../deploy/README.md) também cobre padrões para Google Cloud Run e Railway.

<a id="option-3--embed-the-verifier-in-your-own-service"></a>
<a id="option-3-embed-the-verifier-in-your-own-service"></a>

### Opção 3 — embutir o verificador no seu próprio serviço

Se você quer a verificação dentro da sua aplicação atual (sem um serviço HTTP separado), instale o SDK da sua linguagem e chame o verificador dele diretamente (`verifySignedBundleV2` em TypeScript, `verify_signed_bundle_v2` em Python e Rust, `v2.VerifySignedBundleV2` em Go). Estes comandos instalam as versões publicadas:

```bash
npm install @dcp-ai/sdk        # TypeScript / Node.js
pip install dcp-ai             # Python
cargo add dcp-ai@2.11.1
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
```

Veja o README de cada SDK para o caminho de importação exato e a superfície da API, e o *Release status* dele para o que falta na versão publicada. Em `main`, os SDKs TypeScript, Python, Go e Rust verificam nativamente bundles V1 e V2, e `@dcp-ai/wasm` expõe o verificador V2 do Rust. Os verificadores V2 deles seguem o checklist de [VERIFICATION.md](../spec/VERIFICATION.md), inclusive a assinatura de cada artefato (etapa V2-8) e os checkpoints PQ (etapa V2-12), e, desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1, os campos secundários da etapa V2-11 que estejam presentes: as versões anteriores verificam a cadeia de auditoria primária e a raiz de Merkle, mas não a cadeia secundária opcional nem `audit_merkle_root_secondary` (veja [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)).

<a id="stateless-by-design"></a>

### Sem estado por projeto

- **Nenhum banco de dados é necessário** para a verificação: cada requisição é autocontida.
- **A persistência** é necessária para todo o resto: os registros de passaportes e chaves do gateway, a fila de ancoragem, o log de transparência e o registro de revogações.

<a id="reference-services-keep-state-in-memory-only"></a>

### Os serviços de referência guardam o estado só em memória

O gateway de referência (`server/`) e os serviços (`services/`) não têm armazenamento persistente, exceto que o serviço de revogação pode guardar o estado num arquivo (`REVOCATION_STATE_PATH`: desativado por padrão no serviço, ativado no arquivo compose de `docker/`, que o coloca num volume). **Um reinício, uma implantação ou uma queda apagam o estado deles**, inclusive uma queda por falta de memória. Esse estado é:

- os passaportes, chaves e tokens de emergência registrados;
- as revogações;
- o log de transparência;
- as âncoras pendentes e os registros locais de ancoragem.

A única exceção é o serviço de revogação com `REVOCATION_STATE_PATH` em armazenamento persistente (um volume): os registros e revogações dele sobrevivem a um reinício.

Depois de um apagamento, o que foi registrado se perde, mas os controles permanecem:

- **Registro.** Registrar um `agent_id` continua exigindo o token do operador, também para um `agent_id` registrado antes do apagamento, já que todos voltam a ser novos.
- **Consultas de revogação.** O serviço de revogação deixa de conhecer as revogações que registrou:
  - `GET /check/<agent_id>` responde `revoked: false` para um agente revogado antes do apagamento;
  - `/.well-known/dcp-revocations.json` deixa de listá-lo, então uma fonte de revogação baseada em lista de bloqueio o lê como não revogado;
  - `GET /v2/check/kid/<kid>` responde 404 (status desconhecido) para as chaves dele.
- **O gateway** esquece seus passaportes, chaves (inclusive as revogadas e aposentadas) e tokens de emergência.
- **Nenhuma confiança é ganha.** Um apagamento sozinho não torna um principal confiável nem um bundle admitido: a admissão continua exigindo o conjunto de confiança do operador e, sob strict-v1, um snapshot de revogação.

Adicione armazenamento persistente antes de depender desses serviços em produção.

Para manter a memória limitada, os registros de identidades, chaves e revogações recusam trabalho em vez de descartar estado:

| Serviço | Limite | Configuração |
|---------|-------|---------|
| Gateway | Registrar um `agent_id` novo exige o token do operador (401) | `OPERATOR_TOKEN` |
| Gateway | 20 registros de passaporte por cliente por hora (429) | `REGISTRATIONS_PER_HOUR` |
| Gateway | 10.000 chaves registradas; depois disso, agentes novos recebem 507 (uma rotação descarta antes uma chave aposentada, então ainda cabe) | `MAX_REGISTERED_KEYS` |
| Gateway | 4 chaves rotacionadas mantidas por agente; as mais antigas continuam revogadas como lápides | — |
| Gateway | 64 chaves por agente ao longo da vida; rotações posteriores recebem 409 (aumente para agentes que rotacionam com frequência) | `MAX_KEYS_PER_AGENT` |
| Gateway | 100 requisições POST por cliente por minuto, 5 revogações de emergência por minuto | — |
| Revogação | Registrar um `agent_id` novo exige o token do operador (401) | `OPERATOR_TOKEN` |
| Revogação | 20 registros por cliente por hora (429) | `REGISTRATIONS_PER_HOUR` |
| Revogação | 10.000 agentes registrados; depois disso, os novos recebem 507 | `MAX_AGENTS` |
| Revogação | Campos de texto de no máximo 256 caracteres; 5 revogações de emergência por cliente por minuto | — |
| Log de transparência | As trocas de gossip exigem uma cabeça de árvore assinada por um par fixado (`GOSSIP_PEERS=<url>#<key>`); corpos de 16 KB; os últimos 100 alertas distintos; as sondagens leem no máximo 16 KB, expiram após um intervalo e nunca se sobrepõem | `GOSSIP_PEERS` |
| Endpoints que leem um corpo | Corpos de requisição de 1 MB (413); `POST /v2/disputes/:id/escalate` e `POST /v2/delegation/mandate/:id/revoke` não leem o deles | — |

Duas partes do gateway se comportam de outro jeito:

- **Os armazenamentos de registros do DCP-05–09 descartam.** São os armazenamentos de ciclo de vida, vitalidade, testamentos, sucessão, disputas, jurisprudência, objeções, direitos, obrigações, violações, mandatos, declarações de aconselhamento, espelhos, interações e limiares de atenção. Cada um guarda no máximo 10.000 entradas, e 10.000 por agente nas listas por agente, e descarta as mais antigas (FIFO): um registro descartado se perde, sem erro.
- **As cadeias de auditoria não têm limite próprio** (`POST /v2/audit/append`). Só os limites das requisições se aplicam a elas.

Os limites contam por IP de cliente. Atrás de um proxy que acrescenta o IP do cliente a `X-Forwarded-For`, defina `TRUST_PROXY=true`; caso contrário, todos os clientes compartilham o endereço do proxy.

<a id="environment-variables-verification-service"></a>

### Variáveis de ambiente (serviço de verificação)

- `PORT` — porta HTTP (padrão `3000`)
- `OPERATOR_TOKEN` — token bearer para os endpoints de administração (política, avisos, governança) e para registrar `agent_id` novos; sem defini-lo, eles continuam bloqueados
- `VERIFIER_MODE` — `classical_only` | `hybrid_preferred` | `hybrid_required` | `pq_only`
- `ALLOW_V1_BUNDLES` — `false` rejeita bundles V1
- `TRUST_PROXY`, `REGISTRATIONS_PER_HOUR`, `MAX_REGISTERED_KEYS`, `MAX_KEYS_PER_AGENT` — veja acima
- `DCP_TRUSTED_PRINCIPALS_FILE`, `DCP_ADMISSION_PROFILE_FILE`, `DCP_REVOCATION_LIST_URL`, `DCP_REVOCATION_LIST_AUTHORIZATION`, `DCP_REVOCATION_TIMEOUT_MS` — admissão para `POST /v2/admit`, veja [ADMISSION.md](ADMISSION.md)
- `REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS` e `PQ_CHECKPOINT_INTERVAL` aparecem nas configurações de implantação, mas ainda não são lidas

Para as variáveis de ambiente de `anchor`, `transparency-log` e `revocation`, veja os respectivos README em [`services/`](../services/) ou o `fly.toml` de cada serviço em [`deploy/fly/`](../deploy/fly/).

<a id="blockchain-and-verification"></a>

## Blockchain e verificação

- **Somente verificação:** o serviço pode se limitar ao POST `/verify`, aplicando o checklist de [VERIFICATION.md](../spec/VERIFICATION.md) (esquema, assinatura, intent_hash, cadeia de auditoria, merkle; os verificadores dos SDKs desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1 também verificam os campos da cadeia secundária opcional que estejam presentes; as versões anteriores não). Nenhuma blockchain é necessária.
- **Verificar anchor_receipt:** se o cliente enviar um `anchor_receipt` com o bundle, o serviço pode, opcionalmente, conferir que o `bundle_hash` aparece na cadeia ou no índice do log indicados usando **apenas dados públicos** (por exemplo, buscando a transação num explorador de blocos). Nenhum servidor central do protocolo está envolvido.
- **Ancorar (gravação):** o operador executa um nó ou usa RPC e grava hashes numa cadeia existente; o serviço retorna o `anchor_receipt` ao cliente. Isso é opcional e específico de cada operador, e o serviço de ancoragem de referência ainda não o faz (veja [`services/anchor/README.md`](../services/anchor/README.md)).

---

<a id="v20-verification-service"></a>

## Serviço de verificação V2.0

O DCP v2.0 introduz criptografia híbrida pós-quântica, níveis de segurança adaptativos e assinaturas compostas. Os operadores que executam serviços de verificação precisam atualizar a configuração para suportar a V2.

<a id="verifier-policy-configuration"></a>

### Configuração da política do verificador

Os verificadores recebem uma `VerifierPolicy` ([`schemas/v2/verifier_policy.schema.json`](../schemas/v2/verifier_policy.schema.json)). O servidor de referência inicia com esta:

```json
{
  "default_mode": "hybrid_required",
  "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_required" },
  "min_classical": 1,
  "min_pq": 1,
  "accepted_classical_algs": ["ed25519"],
  "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
  "accepted_hash_algs": ["sha256", "sha384"],
  "require_session_binding": true,
  "require_composite_binding": true,
  "max_key_age_days": 365,
  "allow_v1_bundles": true,
  "allow_classical_fallback_disable": false,
  "warn_classical_only_deprecated": false,
  "advisory_rejected_algs": []
}
```

`risk_overrides` é indexado pelo `risk_tier` do passaporte. O servidor não tem arquivo de política: `VERIFIER_MODE` e `ALLOW_V1_BUNDLES` a definem na inicialização, `POST /v2/policy/mode` com `{ "mode": "<mode>" }` (token do operador) troca o modo em tempo de execução, os avisos aceitos são acrescentados a `advisory_rejected_algs` e `GET /v2/policy` retorna a política atual e o hash dela. Uma troca de modo define `default_mode` e todas as entradas de `risk_overrides` para esse modo. Para embutir um verificador com a sua própria política, passe uma política completa ao SDK: uma parcial é aceita, mas os campos que você omitir não são preenchidos com valores padrão (veja [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md), etapa 8).

Modos de verificação:
- `classical_only` — Apenas assinaturas Ed25519 são exigidas (compatibilidade com a V1)
- `hybrid_preferred` — Ed25519 é exigida, e ML-DSA-65 é verificada se estiver presente
- `hybrid_required` — A assinatura composta com Ed25519 e ML-DSA-65 é exigida
- `pq_only` — Apenas a assinatura pós-quântica é exigida e verificada; um bundle assinado `classical_only` é rejeitado, e uma chave clássica fixada (`public_key_b64`) é recusada. No servidor de referência, este modo também desativa os bundles V1.

Em todos os modos, uma assinatura PQ (ML-DSA-65 ou SLH-DSA-192f) presente precisa ser verificada; uma inválida é rejeitada.

### POST /verify (V2)

Os bundles V2 incluem `composite_sig` com os componentes clássico e pós-quântico:

```json
{
  "signed_bundle": {
    "bundle": {
      "dcp_bundle_version": "2.0",
      "manifest": {
        "session_nonce": "a1b2c3...",
        "rpr_hash": "sha256:...",
        "passport_hash": "sha256:...",
        "intent_hash": "sha256:...",
        "policy_hash": "sha256:...",
        "audit_merkle_root": "sha256:...",
        "audit_merkle_root_secondary": "sha3-256:...",
        "audit_count": 1
      },
      "responsible_principal_record": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "agent_passport": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "intent": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "policy_decision": { "payload": {...}, "payload_hash": "sha256:...", "composite_sig": {...} },
      "audit_entries": [ {...} ]
    },
    "signature": {
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }
}
```

A resposta V2 do servidor de referência inclui o nível de segurança resolvido. `POST /v2/bundle/verify` (somente V2; também aceita o bundle assinado como corpo inteiro) responde:

```json
{
  "verified": true,
  "dcp_version": "2.0",
  "errors": [],
  "warnings": [],
  "verifier_policy_hash": "sha256:...",
  "resolved_tier": "elevated",
  "verification_mode": "hybrid_required",
  "session_binding_valid": true,
  "manifest_valid": true
}
```

`POST /verify` fornece os mesmos campos até `resolved_tier`. `session_binding_valid` e `manifest_valid` são deduzidos das mensagens de erro, então use `verified` e `errors` para decidir.

<a id="security-tiers-in-verification"></a>

### Níveis de segurança na verificação

Cada nível de segurança corresponde a um modo de verificação e a um intervalo de checkpoints PQ (spec §14.1):

| Nível | Modo de verificação | Checkpoint PQ |
|------|------------------|---------------|
| Routine | `classical_only` | A cada 50 eventos |
| Standard | `hybrid_preferred` | A cada 10 eventos |
| Elevated | `hybrid_required` | A cada evento |
| Maximum | `hybrid_required` | A cada evento |

Não há um orçamento de tamanho por nível. O tamanho de um bundle depende dos algoritmos, das entradas de auditoria e dos checkpoints PQ
e da codificação JSON dele: meça os seus maiores bundles. Por exemplo, o bundle híbrido sintético
`signed_bundles.base` em `tests/interop/v2/admission_vectors.json` tem 32.996 bytes como JSON compacto; isso é uma
observação, não um limite. Envie os bundles num corpo de requisição JSON com um orçamento de tamanho explícito, não num cabeçalho (veja
[QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md#sending-dcp-bundles-from-a-client)).

O verificador pode **elevar** um nível (por exemplo, forçar `elevated` em operações financeiras), mas NÃO DEVE **rebaixá-lo**. Em `main`, os verificadores dos SDKs (TypeScript, Go, Rust, WASM e Python) verificam a assinatura do bundle e a de cada artefato pelo mais estrito entre o modo da política (a entrada de `risk_overrides` para o `risk_tier` do passaporte, ou `default_mode`) e o modo do nível (spec §14.3), então um passaporte que declara `risk_tier: "low"` ainda precisa de uma assinatura híbrida para uma intenção de pagamento. Eles também verificam os checkpoints PQ que o bundle traz (`spec/VERIFICATION.md` V2-12). As versões publicadas podem estar atrasadas: veja o *Release status* de cada SDK.

O servidor de referência verifica os bundles V2 por meio de `lib/verify.js`, que os entrega ao SDK TypeScript da mesma cópia com a política do servidor; as imagens Docker compilam esse SDK a partir do código-fonte (veja [`docker/Dockerfile`](../docker/Dockerfile)). O campo `verification_mode` dele é o modo do nível, não o modo efetivo.

<a id="capabilities-endpoint-v2"></a>

### Endpoint de capacidades (V2)

Os serviços V2 expõem `GET /.well-known/dcp-capabilities.json`. O servidor de referência responde:

```json
{
  "supported_versions": ["1.0", "2.0"],
  "supported_algs": {
    "signing": ["ed25519", "ml-dsa-65", "slh-dsa-192f"],
    "kem": ["x25519", "ml-kem-768", "x25519-ml-kem-768"],
    "hash": ["sha256", "sha3-256", "sha384"]
  },
  "supported_wire_formats": ["application/json", "application/cbor"],
  "features": {
    "composite_signatures": true,
    "session_binding": true,
    "blinded_rpr": true,
    "dual_hash_chains": true,
    "pq_checkpoints": true,
    "emergency_revocation": true,
    "multi_party_auth": true,
    "pq_only_mode": true,
    "advisory_auto_response": true,
    "governance_keys": true,
    "hsm_provider": true,
    "agent_lifecycle": true,
    "succession": true,
    "dispute_resolution": true,
    "rights_obligations": true,
    "delegation": true
  },
  "verifier_policy_hash": "sha256:...",
  "min_accepted_version": "1.0"
}
```

Isso é o que o servidor anuncia, não uma lista de garantias verificadas. Os endpoints dele só leem corpos JSON, embora `application/cbor` seja listado. `hsm_provider: true` é anunciado, mas o provedor HSM do repositório é uma simulação sem suporte de hardware ([SECURITY_MODEL.md](SECURITY_MODEL.md)).

<a id="observability"></a>

### Observabilidade

Os serviços V2 devem expor métricas para monitoramento:

- **Latência**: latência de verificação p50/p95/p99 por nível de segurança
- **Vazão**: bundles verificados por segundo
- **Cache**: proporção de acertos e falhas do cache de verificação
- **Checkpoints PQ**: número de checkpoints PQ verificados
- **Erros**: contagem de erros por código de erro DCP (DCP-E001 a DCP-E902)
- **Níveis**: distribuição das requisições de verificação por nível de segurança

Recomendado: use o módulo `dcpTelemetry` integrado ao SDK com exportadores compatíveis com OpenTelemetry ([OBSERVABILITY.md](OBSERVABILITY.md)). O servidor de referência não emite essas métricas por conta própria.

<a id="migration-for-existing-v1-operators"></a>

### Migração para operadores V1 existentes

Os operadores V1 existentes podem atualizar de forma incremental:

1. Atualizar para o SDK do DCP v2.0
2. Definir `default_mode: 'classical_only'` (`VERIFIER_MODE=classical_only` no servidor de referência); o nível de segurança continua elevando o modo para `hybrid_required` nas ações elevated e maximum
3. Ativar gradualmente `hybrid_preferred` para os agentes novos
4. Passar para `hybrid_required` quando a adoção de PQ for suficiente

Veja [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) para as etapas detalhadas de migração.

<a id="dcp-0509-service-endpoints"></a>

## Endpoints de serviço do DCP-05–09

O DCP v2.0 estende o servidor de verificação com 31 endpoints para gestão do ciclo de vida, sucessão digital, resolução de disputas, marco de direitos e representação pessoal.

> **Sem autenticação e sem verificação.** Estes endpoints conferem cada registro contra o esquema dele e o formato dos IDs. Eles não verificam nenhum `composite_sig` e não exigem token do operador. Qualquer pessoa que alcance o servidor pode, por exemplo, descomissionar ou recomissionar um agente, revogar um mandato revogável ou marcar uma disputa como resolvida. Definir `OPERATOR_TOKEN` não os protege: ele só protege as rotas de administração e os registros de `agent_id` novos. Não os exponha a clientes não confiáveis: coloque-os atrás da sua própria autorização, ou não os exponha de forma alguma, e trate o que eles armazenam como registros não verificados.

Cada POST recebe o registro sob a chave indicada na tabela (por exemplo, `{ "commissioning_certificate": { ... } }`). `:agent_id` e `:id` são codificados para URL.

<a id="dcp-05-agent-lifecycle-management"></a>

### DCP-05: gestão do ciclo de vida do agente

| Método | Endpoint | Chave do corpo | Descrição |
|--------|----------|----------|-------------|
| POST | `/v2/lifecycle/commission` | `commissioning_certificate` | Coloca o agente no estado `commissioned`; para um agente já conhecido, redefine o estado e o histórico dele |
| POST | `/v2/lifecycle/vitality` | `vitality_report` | Armazena um relatório de vitalidade; um `state` diferente no relatório é uma transição do ciclo de vida |
| POST | `/v2/lifecycle/decommission` | `decommissioning_record` | Passa o agente para `decommissioned` e marca como `decommissioned` um passaporte registrado |
| GET | `/v2/lifecycle/:agent_id` | — | Estado atual, histórico e número de relatórios de vitalidade |

Transições do ciclo de vida que o servidor aceita: `commissioned → active`, `active → declining`, `active → decommissioned`, `declining → decommissioned`. A máquina de estados do SDK também permite `commissioned → decommissioned` e `declining → active`.

<a id="dcp-06-digital-succession--inheritance"></a>
<a id="dcp-06-digital-succession-inheritance"></a>

### DCP-06: sucessão digital e herança

| Método | Endpoint | Chave do corpo | Descrição |
|--------|----------|----------|-------------|
| POST | `/v2/succession/testament` | `digital_testament` | Armazena o testamento do agente (um por agente) |
| GET | `/v2/succession/testament/:agent_id` | — | O testamento do agente |
| POST | `/v2/succession/execute` | `succession_record` | Registra uma sucessão; o predecessor precisa estar em `declining` ou `decommissioned` quando o servidor conhece o estado dele |
| POST | `/v2/succession/memory-transfer` | `memory_transfer_manifest` | Valida o manifesto e responde com contagens; ele não é armazenado |
| GET | `/v2/succession/:agent_id` | — | Sucessões registradas para um predecessor |

<a id="dcp-07-conflict-resolution--dispute-arbitration"></a>
<a id="dcp-07-conflict-resolution-dispute-arbitration"></a>

### DCP-07: resolução de conflitos e arbitragem de disputas

| Método | Endpoint | Chave do corpo | Descrição |
|--------|----------|----------|-------------|
| POST | `/v2/disputes/create` | `dispute_record` | Armazena uma disputa |
| POST | `/v2/disputes/:id/escalate` | — | Passa a disputa para o próximo nível de escalonamento |
| POST | `/v2/disputes/:id/resolve` | `arbitration_resolution` (opcional) | Marca a disputa como resolvida; a resolução, quando fornecida, é armazenada como está |
| GET | `/v2/disputes/:id` | — | A disputa |
| POST | `/v2/objections/create` | `objection_record` | Armazena uma objeção |
| POST | `/v2/jurisprudence` | `jurisprudence_bundle` | Armazena um bundle de jurisprudência |
| GET | `/v2/jurisprudence` | — | Todos os bundles de jurisprudência armazenados |

<a id="dcp-08-rights--obligations-framework"></a>
<a id="dcp-08-rights-obligations-framework"></a>

### DCP-08: marco de direitos e obrigações

| Método | Endpoint | Chave do corpo | Descrição |
|--------|----------|----------|-------------|
| POST | `/v2/rights/declare` | `rights_declaration` | Armazena a declaração de direitos do agente (uma por agente) |
| GET | `/v2/rights/:agent_id` | — | A declaração de direitos do agente |
| POST | `/v2/obligations/record` | `obligation_record` | Acrescenta um registro de obrigação |
| GET | `/v2/obligations/:agent_id` | — | Os registros de obrigações do agente |
| POST | `/v2/rights/violation` | `violation_report` | Armazena um relatório de violação de direitos |

<a id="dcp-09-personal-representation--delegation"></a>
<a id="dcp-09-personal-representation-delegation"></a>

### DCP-09: representação pessoal e delegação

| Método | Endpoint | Chave do corpo | Descrição |
|--------|----------|----------|-------------|
| POST | `/v2/delegation/mandate` | `delegation_mandate` | Armazena um mandato |
| GET | `/v2/delegation/mandate/:id` | — | O mandato, com `revoked` |
| POST | `/v2/delegation/mandate/:id/revoke` | — | Revoga um mandato cujo `revocable` é true |
| POST | `/v2/agent-advisory/declare` | `advisory_declaration` | Armazena uma declaração de aconselhamento |
| GET | `/v2/agent-advisory/:id` | — | A declaração de aconselhamento |
| POST | `/v2/mirror/generate` | `principal_mirror` | Acrescenta um espelho do principal |
| GET | `/v2/mirror/:agent_id` | — | Os espelhos do principal do agente |
| POST | `/v2/interactions/record` | `interaction_record` | Armazena um registro de interação |
| POST | `/v2/awareness/threshold` | `awareness_threshold` | Armazena o limiar de atenção do agente (um por agente) |
| GET | `/v2/awareness/threshold/:agent_id` | — | O limiar de atenção do agente |

Um registro armazenado por ID, ou um por agente, é substituído por um POST posterior para o mesmo ID ou agente. Objeções, relatórios de violação e registros de interação não têm endpoint GET.

<a id="production-hardening"></a>

### Reforço para produção

Os endpoints do DCP-05–09 têm:

- **Validação com JSON Schema** — Cada POST que envia um registro é validado contra o esquema dele antes do armazenamento. `escalate` e `revoke` não recebem registro; `resolve` recebe um `arbitration_resolution` opcional, que armazena sem validar
- **Limitação de taxa** — 100 requisições/minuto/IP em todos os endpoints POST
- **Limites de tamanho do corpo** — corpo de requisição de no máximo 1 MB (retorna 413) onde o corpo é lido; `escalate` e `revoke` não o leem
- **Validação dos IDs de entrada** — Os IDs que o servidor usa como chave precisam corresponder a `^[\w:.\-]{1,256}$`; outros caracteres são rejeitados
- **Armazenamento limitado** — cada armazenamento em memória guarda no máximo 10.000 entradas e descarta as mais antigas (FIFO): um registro descartado se perde. Os registros de identidades, por outro lado, recusam (507); veja [Os serviços de referência guardam o estado só em memória](#reference-services-keep-state-in-memory-only)
- **Cabeçalhos de segurança** — X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, Cache-Control

Eles **não** incluem verificação de assinatura dos registros nem qualquer autenticação (veja a nota no início desta seção).

<a id="reference"></a>

## Referências

- Checklist de verificação: [spec/VERIFICATION.md](../spec/VERIFICATION.md)
- Armazenamento e ancoragem: [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- Formato do bundle: [spec/BUNDLE.md](../spec/BUNDLE.md)
