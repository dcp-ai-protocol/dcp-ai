<sub>[English](../../../server/README.md) · [中文](../../zh-CN/server/README.md) · [Español](../../es/server/README.md) · [日本語](../../ja/server/README.md) · **Português**</sub>

<a id="dcp-reference-gateway"></a>

# Gateway de referência do DCP

> Tradução informativa da [versão em inglês](../../../server/README.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Serviço HTTP de verificação que implementa a V1, a V2 e a fase 3 (PQ primeiro) do Digital Citizenship Protocol. **Armazenamento em memória**: não precisa de nenhum banco de dados externo, e nada sobrevive a uma reinicialização (veja [Persistência](#persistence)). Projetado para ser executado por qualquer terceiro; o protocolo não exige um servidor central.

<a id="quick-start"></a>

## Início rápido

Execute a partir da raiz de um checkout. A raiz depende deliberadamente do SDK do workspace para testar esse código, embora `@dcp-ai/sdk` 2.2.0 já esteja publicado no npm. Compile-o primeiro:

```bash
(cd sdks/typescript && npm install && npm run build)
npm install
node server/index.js
# or: npm run server
```

Porta padrão: `3000`. Altere com `PORT=4000 node server/index.js`. Defina `OPERATOR_TOKEN` para usar os endpoints de administração e registrar agentes novos.

## Endpoints

<a id="core"></a>

### Núcleo

| Método | Caminho | Descrição |
|--------|------|-------------|
| GET | `/` , `/health` | Checagem de saúde: `{ ok, service, supported_versions, registered_agents, registered_keys }` |
| GET | `/.well-known/dcp-capabilities.json` | Descoberta das capacidades do protocolo (algoritmos, funcionalidades, formatos de transmissão). É o que o servidor anuncia, não garantias checadas: lista `hsm_provider: true` e `application/cbor`, mas não há nenhum HSM e os corpos só são lidos como JSON |
| POST | `/verify` | Verifica um bundle assinado (detecta V1 ou V2; a V2 é checada contra `VERIFIER_POLICY`) |
| POST | `/v2/admit` | Admissão em relação aos principais confiáveis do operador, e strict-v1 quando configurado (`docs/ADMISSION.md`). Do corpo, só lê `signed_bundle`. 501 quando não está configurada |
| POST | `/anchor` | Esboço: retorna 501 (cada operador implementa) |

<a id="v2-identity--intent"></a>
<a id="v2-identity-intent"></a>

### V2: identidade e intenção

| Método | Caminho | Descrição |
|--------|------|-------------|
| POST | `/v2/passport/register` | Registra um passaporte de agente autoassinado; um `agent_id` novo precisa do token do operador (veja [Modelo de confiança](#trust-model)) |
| POST | `/v2/intent/declare` | Declara uma intenção de um agente registrado e recebe a decisão de política do servidor (não assinada); a `composite_sig` da intenção não é verificada |
| POST | `/v2/audit/append` | Acrescenta um evento de auditoria à cadeia do agente |
| POST | `/v2/audit/compact` | Compacta a cadeia de auditoria com um resumo de Merkle |
| POST | `/v2/bundle/verify` | Verificação completa de um bundle V2: schema, manifesto, assinatura composta Ed25519 + ML-DSA-65, vinculação de sessão e cadeia de auditoria (via `lib/verify.js` e `@dcp-ai/sdk`), contra `VERIFIER_POLICY`. Bundles V1 recebem 400 |

<a id="v2-key-management"></a>

### V2: gestão de chaves

| Método | Caminho | Descrição |
|--------|------|-------------|
| GET | `/v2/keys/:kid` | Busca uma chave pelo seu ID determinístico |
| POST | `/v2/keys/rotate` | Rotação de chaves: prova de posse pela chave nova, autorização pela antiga |
| POST | `/v2/emergency-revoke` | Revogação de emergência (botão de pânico) |

<a id="v2-multi-party--governance"></a>
<a id="v2-multi-party-governance"></a>

### V2: multipartes e governança

| Método | Caminho | Descrição |
|--------|------|-------------|
| POST | `/v2/multi-party/authorize` | Autorização multipartes M de N, com as assinaturas checadas contra as chaves registradas das partes |
| POST | `/v2/governance/register` | Registra o conjunto de chaves de governança (**operador**) |
| GET | `/.well-known/governance-keys.json` | Chaves de governança publicadas |

<a id="phase-3-policy--advisories"></a>
<a id="phase-3-policy-advisories"></a>

### Fase 3: política e avisos

| Método | Caminho | Descrição |
|--------|------|-------------|
| GET | `/v2/policy` | Política atual do verificador (modo, algoritmos, restrições) |
| POST | `/v2/policy/mode` | Troca o modo do verificador (`classical_only`, `hybrid_preferred`, `hybrid_required`, `pq_only`) (**operador**) |
| GET | `/.well-known/algorithm-advisories.json` | Avisos de algoritmos publicados |
| POST | `/v2/advisory/publish` | Publica um aviso de algoritmo, validado contra o seu schema; no máximo 1000 (**operador**) |
| GET | `/v2/advisory/check` | Checa se determinados algoritmos são afetados |
| POST | `/v2/advisory/auto-apply` | Aplica automaticamente os avisos à política do verificador (**operador**) |

Os endpoints de **operador** alteram a configuração de confiança do verificador. Eles exigem
`Authorization: Bearer <OPERATOR_TOKEN>` e, caso contrário, respondem 401; sem um `OPERATOR_TOKEN` configurado,
permanecem bloqueados.

<a id="dcp-05-to-dcp-09"></a>

### Do DCP-05 ao DCP-09

31 endpoints para registros de ciclo de vida, sucessão, disputas, direitos e delegação; estão listados em [docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints). Eles validam cada registro contra o seu schema, mas **não verificam nenhuma assinatura nem precisam de token**, e `OPERATOR_TOKEN` não os protege: qualquer pessoa que alcance o servidor pode desativar ou recomissionar um agente, revogar um mandato revogável ou marcar uma disputa como resolvida. Não os exponha a clientes não confiáveis.

<a id="environment-variables"></a>

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|---------|-------------|
| `PORT` | `3000` | Porta HTTP de escuta |
| `OPERATOR_TOKEN` | — | Token Bearer para os endpoints de operador e para registrar `agent_id`s novos. Sem definir: ambos ficam bloqueados |
| `VERIFIER_MODE` | `hybrid_required` | Modo de verificação na inicialização: `classical_only`, `hybrid_preferred`, `hybrid_required` ou `pq_only`. Um valor inválido interrompe o servidor |
| `ALLOW_V1_BUNDLES` | `true` | `false` faz `POST /verify` recusar bundles V1 (`pq_only` sempre recusa) |
| `TRUST_PROXY` | — | `true` só atrás de um proxy que acrescenta o IP do cliente a `X-Forwarded-For` (Fly, nginx). Os limites de taxa passam a usar o seu último salto; caso contrário, o endereço do socket, porque os clientes podem forjar o cabeçalho |
| `REGISTRATIONS_PER_HOUR` | `20` | Chamadas a `POST /v2/passport/register` por cliente por hora; as demais recebem 429 |
| `MAX_REGISTERED_KEYS` | `10000` | Chaves no registro; a partir daí, agentes novos e rotações recebem 507 (nada é removido) |
| `DCP_TRUSTED_PRINCIPALS_FILE` | — | Conjunto de confiança para `POST /v2/admit` (`schemas/v2/principal_trust_set.schema.json`), lido a cada admissão e recarregado quando o seu conteúdo muda. Um arquivo inválido interrompe o servidor na inicialização e recusa a admissão (503) se quebrar depois. Qualquer variável de admissão definida com valor vazio interrompe o servidor |
| `DCP_ADMISSION_PROFILE_FILE` | — | Perfil strict-v1 (`schemas/v2/admission_profile.schema.json`). Precisa das duas variáveis ao seu redor; uma contradição interrompe o servidor |
| `DCP_REVOCATION_LIST_URL` | — | Lista de negação completa no formato `/.well-known/dcp-revocations.json` do serviço de revogação, para strict-v1: `https` (`http` simples só para um host de loopback), sem redirecionamentos, no máximo 16 MiB. `DCP_REVOCATION_LIST_AUTHORIZATION` define um cabeçalho `Authorization`; `DCP_REVOCATION_TIMEOUT_MS` (padrão 5000) limita a requisição |
| `MAX_KEYS_PER_AGENT` | `64` | Chaves que um agente pode registrar ao longo da sua vida; as rotações seguintes recebem 409. Aumente para agentes que fazem rotação com frequência (cada chave aposentada custa uma lápide de cerca de 100 bytes) |

`REQUIRE_SESSION_BINDING`, `REQUIRE_COMPOSITE_BINDING`, `MAX_KEY_AGE_DAYS`,
`PQ_CHECKPOINT_INTERVAL` e `ADVISORY_POLL_INTERVAL_MS` aparecem nas configurações do Docker e do Fly, mas ainda não são
lidos: vale a política embutida (`VERIFIER_POLICY` em `server/index.js`: vinculação de sessão e vinculação composta
obrigatórias, idade de chave de 365 dias), e `GET /v2/policy` a mostra.

<a id="trust-model"></a>

## Modelo de confiança

- O **registro de passaportes** verifica a autoassinatura composta do passaporte (`DCP-AI.v2.AgentPassport`, Ed25519 +
  ML-DSA-65; a só clássica é aceita apenas nos modos `classical_only` / `hybrid_preferred`) contra as chaves que ele
  lista. Essa assinatura prova a posse das chaves que a fizeram (a chave clássica e, se houver, a PQ), e só elas são registradas: listar a chave pública de
  outra pessoa não registra nada. Chaves e assinaturas devem ser base64 canônico do tamanho exato do seu algoritmo.
- Registrar um `agent_id` **novo** exige `Authorization: Bearer <OPERATOR_TOKEN>` (caso contrário, 401). Um passaporte
  é só autoassinado, e o RPR de um principal também, então, sem uma âncora de confiança, qualquer pessoa poderia
  reivindicar primeiro o `agent_id` de uma vítima e revogá-lo por emergência: o operador responde pelos agentes novos.
  Registrá-lo de novo (por exemplo, para substituir o token de revogação de emergência) exige um passaporte cujo
  `created_at` seja posterior ao registrado, porque os passaportes assinados são públicos e um antigo poderia ser
  reenviado, e que esteja assinado exatamente pelas chaves ativas do agente (registradas em seu nome, não revogadas,
  não expiradas), seja o que for que `VERIFIER_MODE` permita para agentes novos; caso contrário, 409. As entradas de
  chaves registradas são mantidas, então um passaporte novo não pode estender o `expires_at` de uma chave, e um
  passaporte sem token mantém o registrado.
- Um agente que perdeu todas as chaves ativas de uma família que registrou (por exemplo, porque a sua chave ML-DSA-65
  expirou) não pode se registrar de novo: a chave restante não deve substituir sozinha o token. A recuperação passa
  pelo token de revogação de emergência (revogar e depois registrar um `agent_id` novo) ou pelo operador, que ainda não
  tem nenhuma API para isso. Um kid registrado em nome de outro agente também dá 409, e um agente revogado por
  emergência não pode se registrar de novo.
- A **rotação de chaves** recebe um `KeyRotationRecord` como o construído por `createKeyRotation` em `@dcp-ai/sdk`: a
  chave nova assina `{old_kid, new_kid, timestamp}` com `DCP-AI.v2.KeyRotation` (prova de posse) e a antiga a
  referenda. A chave antiga deve estar ativa (não revogada, não expirada); depois, ela é marcada como revogada.
- **Autorização multipartes**: cada parte assina `{operation, operation_payload, party_id, role}` com
  `DCP-AI.v2.MultiPartyAuth` (`createPartyAuthorization` em `sdks/typescript/src/core/multi-party-auth.ts`, que
  `@dcp-ai/sdk` 2.2.0 não exporta). Uma parte é uma identidade registrada via `/v2/passport/register`, e os seus kids de
  assinatura devem ser chaves ativas (não revogadas, não expiradas) registradas em nome do seu `party_id`. Cada parte
  conta uma só vez para `required_parties`, sejam quais forem os papéis pelos quais assina. Os papéis são afirmados por
  quem assina, não consultados em lugar nenhum.
- Os **endpoints de operador** são protegidos só por `OPERATOR_TOKEN`. A `composite_sig` dos avisos é checada só
  estruturalmente: `@dcp-ai/sdk` ainda não tem tag de contexto para `AlgorithmAdvisory`, então o operador responde pelos
  avisos.
- O registro de chaves recusa agentes novos e rotações (507) quando chega a `MAX_REGISTERED_KEYS` chaves (10.000), em vez
  de remover as antigas, porque um `agent_id` removido perderia o histórico que o protege (registrá-lo de novo continua exigindo o token do operador, mas com quaisquer chaves). Para que um único
  agente não o encha, a rotação mantém só as 4 chaves aposentadas mais recentes do agente e descarta a mais antiga antes
  de checar o limite, de modo que uma rotação ainda cabe em um registro cheio. As chaves descartadas ficam como lápides:
  `GET /v2/keys/:kid` responde `revoked: true, retired: true` com `key: null`, e ninguém pode registrar essa chave de
  novo, nunca. Um agente pode registrar no máximo `MAX_KEYS_PER_AGENT` chaves (64) ao longo da sua vida, então as suas
  lápides continuam limitadas; a partir daí, a rotação recebe 409. Os registros são limitados por cliente
  (`REGISTRATIONS_PER_HOUR`), e de um passaporte registrado só se mantém `created_at`, não o passaporte assinado
  inteiro.

<a id="usage-examples"></a>

## Exemplos de uso

Exceto a checagem de saúde, a troca de modo e a descoberta de capacidades, as requisições abaixo são modelos: os seus
bundles, assinaturas e chaves são marcadores (`...`, `<64 hex>`), então não funcionam como estão, e não devem ser
preenchidos com valores inventados.

<a id="health-check"></a>

### Checagem de saúde

```bash
curl -s http://localhost:3000/health | jq .
```

<a id="v1-bundle-verification"></a>

### Verificação de um bundle V1

```bash
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": { ... },
      "signature": { "alg": "ed25519", "sig_b64": "...", "signer": { "public_key_b64": "..." } }
    }
  }'
```

<a id="v2-passport-registration"></a>

### Registro de um passaporte V2

O corpo é o `SignedPayload` de um `AgentPassportV2`, assinado com
`compositeSign(registry, DCP_CONTEXTS.AgentPassport, canonicalBytes, keys)` pelas chaves que ele lista (o
`agent_passport` de um bundle construído com o SDK tem esta forma).

```bash
curl -s -X POST http://localhost:3000/v2/passport/register \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signed_passport": {
      "payload": {
        "dcp_version": "2.0",
        "agent_id": "agent:research-bot-001",
        "session_nonce": "<64 hex>",
        "keys": [
          { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
          { "kid": "<32 hex>", "alg": "ml-dsa-65", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" }
        ],
        "principal_binding_reference": "human:alice-001",
        "capabilities": ["browse"],
        "risk_tier": "low",
        "created_at": "...",
        "status": "active",
        "emergency_revocation_token": "sha256:<64 hex>"
      },
      "payload_hash": "sha256:...",
      "composite_sig": {
        "classical": { "alg": "ed25519", "kid": "<32 hex>", "sig_b64": "..." },
        "pq": { "alg": "ml-dsa-65", "kid": "<32 hex>", "sig_b64": "..." },
        "binding": "pq_over_classical"
      }
    }
  }'
```

Respostas: 201 `{ ok, agent_id, registered_kids }`, 400 (divergência de schema ou de kid, ou chaves que não são base64
canônico), 401 (um `agent_id` novo sem o token do operador), 403 (assinatura inválida, ou agente revogado), 409 (agente
registrado com outras chaves, passaporte não posterior ao registrado, agente sem uma chave ativa de uma família
registrada, ou um kid aposentado ou de outro agente), 429 (limite de taxa), 507 (registro cheio).

<a id="key-rotation"></a>

### Rotação de chaves

```bash
# body = createKeyRotation(registry, { oldKid, oldAlg, oldSecretKeyB64, newKid, newAlg,
#                                      newSecretKeyB64, newPublicKeyB64, timestamp, expiresAt })
curl -s -X POST http://localhost:3000/v2/keys/rotate \
  -H "Content-Type: application/json" \
  -d '{
    "old_kid": "<32 hex>",
    "new_key": { "kid": "<32 hex>", "alg": "ed25519", "public_key_b64": "...", "created_at": "...", "expires_at": null, "status": "active" },
    "timestamp": "2026-03-01T00:00:00Z",
    "proof_of_possession": { "alg": "ed25519", "kid": "<new kid>", "sig_b64": "..." },
    "authorization_sig": { "alg": "ed25519", "kid": "<old kid>", "sig_b64": "..." }
  }'
```

<a id="switching-the-verifier-mode-operator"></a>

### Troca do modo do verificador (operador)

```bash
curl -s -X POST http://localhost:3000/v2/policy/mode \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "mode": "pq_only" }'
```

<a id="v2-intent-declaration"></a>

### Declaração de uma intenção V2

O corpo é o `SignedPayload` de uma `IntentV2` de um agente registrado. A sua `composite_sig` deve estar presente, mas não é verificada. O servidor pontua a intenção por conta própria e responde `{ ok, policy_decision, security_tier, verification_mode, checkpoint_interval }`; a decisão de política não é assinada (`block` a partir de um risco de 800, `escalate` a partir de 500).

A requisição abaixo só ilustra a forma: substitua as reticências e os marcadores pelo seu payload assinado antes de enviá-la. Os fragmentos literais `{ ... }` não são JSON válido.

```bash
curl -s -X POST http://localhost:3000/v2/intent/declare \
  -H "Content-Type: application/json" \
  -d '{
    "signed_intent": {
      "payload": {
        "dcp_version": "2.0",
        "intent_id": "intent:...",
        "session_nonce": "<64 hex>",
        "agent_id": "agent:research-bot-001",
        "human_id": "human:alice-001",
        "timestamp": "...",
        "action_type": "api_call",
        "target": { "channel": "api" },
        "data_classes": ["pii"],
        "estimated_impact": "medium",
        "requires_consent": false
      },
      "payload_hash": "sha256:...",
      "composite_sig": { "classical": { ... }, "pq": { ... }, "binding": "pq_over_classical" }
    }
  }'
```

<a id="v2-bundle-verification"></a>

### Verificação de um bundle V2

```bash
curl -s -X POST http://localhost:3000/v2/bundle/verify \
  -H "Content-Type: application/json" \
  -d '{
    "signed_bundle": {
      "bundle": {
        "dcp_bundle_version": "2.0",
        "manifest": { "session_nonce": "...", "rpr_hash": "sha256:...", ... },
        "responsible_principal_record": { "payload": { ... }, "payload_hash": "sha256:...", "composite_sig": { ... } },
        "agent_passport": { ... },
        "intent": { ... },
        "policy_decision": { ... },
        "audit_entries": [ ... ]
      },
      "signature": {
        "hash_alg": "sha256",
        "created_at": "...",
        "signer": { "type": "human", "id": "...", "kids": ["..."] },
        "manifest_hash": "sha256:...",
        "composite_sig": {
          "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
          "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
          "binding": "pq_over_classical"
        }
      }
    },
    "public_key_b64": "..."
  }'
```

O formato é `schemas/v2/signed_bundle.schema.json`; construa-o com `BundleBuilderV2` + `signBundleV2` de `@dcp-ai/sdk` ou com `dcp sign-bundle --composite`. `public_key_b64` é opcional e fixa o signatário clássico. O envelope pré-normativo (`dcp_version` / `bundle_manifest` no nível superior) é recusado.

<a id="emergency-revocation"></a>

### Revogação de emergência

O segredo é a pré-imagem do `emergency_revocation_token` registrado com o passaporte. Limitada a 5 tentativas por
minuto por IP de cliente.

```bash
curl -s -X POST http://localhost:3000/v2/emergency-revoke \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent:research-bot-001",
    "revocation_secret": "<64 hex>"
  }'
```

<a id="capability-discovery"></a>

### Descoberta de capacidades

```bash
curl -s http://localhost:3000/.well-known/dcp-capabilities.json | jq .
```

<a id="architecture"></a>

## Arquitetura

```
                    ┌──────────────────────────┐
                    │    DCP Reference Gateway  │
                    ├──────────────────────────┤
                    │  V1 Verification          │
                    │  V2 Composite Verification│
                    │  Key Registry (in-memory) │
                    │  Audit Chains (in-memory) │
                    │  Policy Engine (Phase 3)  │
                    │  Advisory System           │
                    │  Governance Keys           │
                    └──────────────────────────┘
```

<a id="limitations"></a>

## Limitações

- **Armazenamento em memória**: todo o estado (passaportes, chaves, cadeias de auditoria, avisos) se perde ao reiniciar. Veja [Persistência](#persistence).
- **Assinaturas fora da verificação de bundles**: a verificação de bundles, o registro de passaportes, a rotação de chaves e a autorização multipartes checam assinaturas Ed25519 e ML-DSA-65 / SLH-DSA reais. `/v2/advisory/publish` e `/v2/governance/register` não checam (o token do operador é a sua única proteção), nem `/v2/intent/declare`, `/v2/audit/*` ou os endpoints do DCP-05 ao DCP-09, que também não precisam de token (veja [Do DCP-05 ao DCP-09](#dcp-05-to-dcp-09)).
- **Ancoragem**: `POST /anchor` retorna 501. Implemente com a sua blockchain (Ethereum, Bitcoin) ou o seu log de transparência.

<a id="persistence"></a>

## Persistência

Nada é gravado em disco. Uma reinicialização, uma implantação ou uma máquina parada apagam os registros de passaportes
e de chaves, então, depois de um apagamento, o histórico de registros desaparece: quem tiver o token do operador pode registrar de novo qualquer `agent_id` com outras chaves, e
as revogações de emergência são esquecidas. Por isso, `deploy/fly/verification.toml` mantém uma máquina em execução
(`min_machines_running = 1`) em vez de escalar para zero; implantações e reinicializações continuam começando vazias. As
implantações de produção precisam de um armazenamento persistente.

<a id="deployment"></a>

## Implantação

- Em produção, execute atrás de um proxy reverso (nginx, Caddy) com TLS, e defina `TRUST_PROXY=true` só se ele acrescentar o IP do cliente a `X-Forwarded-For`.
- Use um gerenciador de processos (systemd, PM2) para as reinicializações automáticas.
- Consulte a [configuração do Docker](../../../docker/README.md) para a implantação em contêineres.

<a id="reference"></a>

## Referência

- [spec/VERIFICATION.md](../../../spec/VERIFICATION.md) — Lista de verificação normativa
- [spec/DCP-AI-v2.0.md](../../../spec/DCP-AI-v2.0.md) — Especificação do protocolo V2
- [docs/OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md) — Guia do operador
