<sub>[English](../../../docs/AGENT_CREATION_AND_CERTIFICATION.md) · [中文](../../zh-CN/docs/AGENT_CREATION_AND_CERTIFICATION.md) · [Español](../../es/docs/AGENT_CREATION_AND_CERTIFICATION.md) · [日本語](../../ja/docs/AGENT_CREATION_AND_CERTIFICATION.md) · **Português**</sub>

<a id="agent-creation-and-certification--p2p-no-central-service"></a>
<a id="agent-creation-and-certification-p2p-no-central-service"></a>

# Criação e certificação de agentes — P2P, sem serviço central

> Tradução informativa da [versão em inglês](../../../docs/AGENT_CREATION_AND_CERTIFICATION.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Um sistema que cria agentes pode produzir, por padrão, agentes **certificados DCP**: vinculados a uma pessoa, com passaporte emitido e bundle assinado. **Sem registro em nenhum serviço central.** A verificação é local. Opcional: ancorar o bundle_hash num log ou cadeia pública (usando uma blockchain existente ou um serviço de terceiros).

Nesta página, «certificado DCP» significa que um bundle passa nas verificações locais definidas abaixo. Não é um certificado emitido por uma autoridade, não confirma quem o principal realmente é e não decide se um verificador deve aceitar o agente: isso é a admissão, uma etapa à parte ([ADMISSION.md](../../../docs/ADMISSION.md)).

> **Ferramentas desta página.** `dcp` é a CLI de referência de uma cópia do repositório, `node /path/to/dcp-ai/bin/dcp.js`; ela só lê e grava dentro do diretório atual. O assistente interativo `@dcp-ai/cli init` é uma demonstração que não cria uma identidade V2 válida: veja [Assistente da CLI (somente demonstração)](#cli-wizard-demo-only).

<a id="certification-flow-p2p-no-registry"></a>

## Fluxo de certificação (P2P, sem registro)

```
Human → Onboard (identity / pseudonymous, jurisdiction)
     → System: keygen human, build RPR, sign RPR

Human → Create agent (capabilities, risk_tier)
     → System: keygen agent, build AP, build bundle, sign bundle
     → Optional: publish bundle_hash only to existing chain/log (user or third party)
     → System: issue signed bundle + keys (+ optional anchor_receipt)

Agent → On each action: build Intent, PolicyDecision, AuditEntry (intent_hash, prev_hash chain)
      → append to audit trail; present signed bundle to verifier
      → Optional: anchor new bundle_hash for audit trail (user or third party)
```

- **A verificação é local; nenhum servidor central é necessário.** A ancoragem opcional é feita pelos usuários ou por serviços de ancoragem de terceiros sobre cadeias ou logs existentes.

<a id="definition-of-dcp-certified"></a>

## Definição de «certificado DCP»

- **Certificado (local):** Citizenship Bundle válido (conforme o esquema), Signed Bundle (assinatura válida), RPR e AP com assinaturas válidas, AP.status = active, RPR não expirado. O verificador pode verificar offline. **Sem servidor.**
- **Certificado + ancorado (opcional):** o anterior + bundle_hash (ou merkle_root) ancorado num log ou cadeia pública; o verificador pode, opcionalmente, conferir que o hash foi ancorado num dado momento. Continua sem haver uma API central que conheça agent_id/human_id. A ancoragem usa uma blockchain **existente** ou um log **de terceiros**.

Qual ferramenta verifica o quê:

- **V1:** `dcp verify-bundle` e `verifySignedBundle` verificam os esquemas, a assinatura do bundle, `bundle_hash`, `merkle_root` e a cadeia de auditoria. As assinaturas do RPR e do passaporte, o `status` do passaporte e o `expires_at` do RPR ficam a cargo de quem chama; os inícios rápidos mostram as verificações de assinatura.
- **V2:** `verifySignedBundleV2` também verifica a assinatura composta de cada artefato, o status do passaporte (aceita `active` e `declining`) e a expiração do RPR. Veja [spec/VERIFICATION.md](../../../spec/VERIFICATION.md).

<a id="integration-points-no-registry"></a>

## Pontos de integração (sem registro)

<a id="on-human-onboarding"></a>

### Na integração da pessoa

- Gerar ou aceitar o par de chaves da pessoa (por exemplo, `dcp keygen keys/human`).
- Construir o RPR (human_id pode ser pseudônimo: hash, UUID ou DID).
- Assinar o RPR com a chave secreta da pessoa, sobre o RPR sem o campo `signature` (por exemplo, `signObject(rprBody, humanSecretKeyB64)`).
- Armazenar localmente; não enviar por POST a nenhum servidor central.

<a id="on-agent-creation"></a>

### Na criação do agente

- Gerar o par de chaves do agente (por exemplo, `dcp keygen keys/agent` ou um segundo par de chaves).
- Construir o AP: principal_binding_reference = RPR.human_id, public_key = chave pública do agente (Ed25519 em base64). Assinar o AP com a chave secreta do agente, sobre o AP sem o campo `signature`.
- Construir um bundle mínimo: RPR + AP + intent + policy_decision + audit_entries (pelo menos uma; usar intent_hash reais e a cadeia prev_hash conforme [spec/DCP-03.md](../../../spec/DCP-03.md)).
- Assinar o bundle com a chave secreta da **pessoa** (por exemplo, `dcp sign-bundle bundle.json keys/human/secret_key.txt out.signed.json`).
- Opcionalmente, ancorar o bundle_hash num log ou cadeia pública (OP_RETURN do Bitcoin, evento do Ethereum ou log de transparência de terceiros). Se usado, guardar o anchor_receipt junto ao bundle.
- Devolver ao usuário: o bundle assinado, a chave secreta do agente e, opcionalmente, o anchor_receipt.

<a id="at-runtime-agent-execution"></a>

### Em tempo de execução (execução do agente)

- Antes de cada ação: construir Intent → PolicyDecision → AuditEntry (intent_hash real = SHA-256(canonical(intent)), cadeia prev_hash: GENESIS e depois SHA-256(canonical(entrada anterior))).
- Acrescentar à trilha de auditoria; opcionalmente, assinar de novo o bundle ou produzir um novo bundle assinado para a trilha de auditoria atualizada.
- Apresentar o bundle assinado ao verificador (por exemplo, no cabeçalho ou no corpo de uma requisição de API). O verificador executa a verificação local (veja [spec/VERIFICATION.md](../../../spec/VERIFICATION.md)); opcionalmente confere o conjunto de revogações (lista P2P ou ancorada por hash) e a âncora opcional.

<a id="reference-implementation"></a>

## Implementação de referência

- **Script:** [scripts/generate-production-examples.js](../../../scripts/generate-production-examples.js) — gera RPR, AP, intenção, política, duas entradas de auditoria (com intent_hash reais e cadeia prev_hash) e bundle assinado reais, sem servidor e sem registro. Ele regenera os próprios exemplos V1 do repositório (`npm run examples:generate`) e lê a chave da pessoa de `keys/secret_key.txt`, que não está no repositório (só `keys/public_key.txt` está), então numa cópia recém-clonada ele para aí. Leia-o como referência da ordem das etapas. A chave do agente vem de `keys/agent_secret_key.txt` / `keys/agent_public_key.txt`, geradas quando ausentes.
- **CLI:** `dcp keygen`, `dcp sign-bundle`, `dcp verify-bundle`, `dcp intent-hash`, `dcp bundle-hash`, `dcp merkle-root`. A etapa opcional de ancoragem não está na CLI gênesis; usuários ou ferramentas de terceiros publicam os hashes em cadeias existentes.

<a id="checklist-for-agent-creation-systems"></a>

## Checklist para sistemas de criação de agentes

1. Gerar chaves da pessoa e do agente (ou aceitar chaves).
2. Construir e assinar o RPR (chave da pessoa).
3. Construir e assinar o AP (chave do agente; public_key = chave pública do agente).
4. Construir intent, policy_decision e audit_entries (intent_hash reais, cadeia prev_hash).
5. Construir o Citizenship Bundle; assiná-lo com a chave da pessoa → Signed Bundle.
6. Opcionalmente, ancorar o bundle_hash (cadeia existente ou log de terceiros); guardar o anchor_receipt.
7. Entregar o bundle assinado e a chave secreta do agente ao agente ou ao seu ambiente de execução.
8. Em tempo de execução: construir intent → policy → entrada de auditoria; acrescentá-la; apresentar o bundle assinado aos verificadores. Os verificadores verificam localmente; sem chamadas a um servidor central.

---

<a id="v20-agent-creation"></a>

## Criação de agentes na V2.0

O DCP v2.0 introduz criptografia híbrida pós-quântica e níveis de segurança adaptativos.

<a id="recommended-path-the-sdks"></a>

### Caminho recomendado: os SDKs

Crie identidades e bundles V2 com um SDK, como nos inícios rápidos testados:

- TypeScript: [Quick Start (V2)](../../../sdks/typescript/README.md#quick-start-v2) do SDK TypeScript, e [QUICKSTART.md](../../../docs/QUICKSTART.md)
- Python: [V2 Bundles](../../../sdks/python/README.md#v2-bundles) no README do SDK Python

Eles seguem `main`: compile o SDK a partir de uma cópia do repositório como explica a seção *Release status* de cada README.

Para gerar chaves híbridas reais a partir de uma cópia do repositório, `dcp keygen --hybrid <out_dir>` grava um par de chaves Ed25519 e um ML-DSA-65 (ML-DSA-65 do `@noble/post-quantum`) com seus kids, e grava os arquivos de chaves secretas com modo `0600`.

<a id="cli-wizard-demo-only"></a>

### Assistente da CLI (somente demonstração)

`npx @dcp-ai/cli init` (o `@dcp-ai/cli` publicado era a 2.1.0 em 26/10/2026, e seus arquivos de `init` eram idênticos aos deste repositório) faz algumas perguntas e grava:

- `.dcp/config.json` — Configuração do agente
- `.dcp/keys/` — um par de chaves Ed25519, mais um par de chaves «ML-DSA-65» se você escolher chaves híbridas
- `.dcp/identity.json` — um registro com forma de RPR
- `.dcp/passport.json` — um registro com forma de passaporte

Use-o para explorar, não para criar a identidade de um agente:

- **As chaves «ML-DSA-65» são simuladas.** São bytes aleatórios do tamanho certo, não chaves ML-DSA; o assistente avisa isso ao rodar. Não assine com elas nem as publique como chaves pós-quânticas.
- **`identity.json` e `passport.json` não são artefatos V2.** Não são assinados e não seguem os esquemas V2: o RPR tem `entity_name` e `keys` onde o esquema exige `legal_name`, `binding_keys`, `liability_mode`, `override_rights`, `issued_at` e `expires_at`; o passaporte tem `owner_rpr_hash` onde o esquema exige `principal_binding_reference` e `risk_tier`. Um bundle construído com eles falha na validação.
- **Seus tokens de revogação não podem ser usados.** O `revocation_token` do RPR é o hash de um segredo que não é guardado, e o `emergency_revocation_token` do passaporte é aleatório, não o hash de algum segredo que você tenha.
- **Os arquivos de chaves secretas recebem as permissões padrão** (`0644` com a umask habitual `022`). Execute `chmod 600 .dcp/keys/*_secret.key` e mantenha `.dcp/keys/` fora do controle de versão.
- **`dcp-ai sign` não é uma assinatura de bundle DCP.** Ele assina o `JSON.stringify` do arquivo, não a sua forma canônica `dcp-jcs-v1`, e acrescenta a assinatura a um array `signatures`.

<a id="v2-certification-flow"></a>

### Fluxo de certificação V2

```
Human → Onboard (identity, jurisdiction)
     → System: generate hybrid keypair (Ed25519 + ML-DSA-65)
     → System: build RPR with binding_keys[] (KeyEntry array), sign with composite signature
     → Optional: recovery configuration (Shamir SSS, spec §11.2)

Human → Create agent (capabilities, risk_tier)
     → System: generate agent hybrid keypair
     → System: build AgentPassport with keys[], principal_binding_reference (the RPR's human_id),
               capabilities and risk_tier; optional emergency_revocation_token (spec §11.3)
     → System: build bundle with session_nonce and manifest
     → System: composite-sign bundle (Ed25519 + ML-DSA-65, pq_over_classical binding)
     → Optional: anchor bundle_hash

Agent → On each action:
      → Build IntentV2 (with action_type, data_classes, estimated_impact; optional security_tier)
      → Evaluate PolicyDecisionV2 (with risk_score; optional resolved_tier)
      → Compute the security tier (routine/standard/elevated/maximum) of the action
      → Build AuditEventV2 (SHA-256 prev_hash chain; optional SHA3-256 secondary chain)
      → Generate PQ checkpoint every N events (tier-dependent)
      → Present signed bundle to verifier

Agent → Lifecycle management (DCP-05):
      → Initial state: commissioned → active (via lifecycle transition)
      → Submit periodic VitalityReport (health metrics, performance)
      → On decline: active → declining (time to prepare succession, DCP-06); declining → active on recovery
      → On end-of-life: → decommissioned (DecommissioningRecord with data_disposition)
```

<a id="v2-key-structure"></a>

### Estrutura de chaves V2

Os agentes V2 usam pares de chaves híbridos com identificadores de chave determinísticos:

```json
{
  "keys": [
    {
      "kid": "a1b2c3d4e5f6...",
      "alg": "ed25519",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    },
    {
      "kid": "f6e5d4c3b2a1...",
      "alg": "ml-dsa-65",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    }
  ]
}
```

Derivação do ID de chave: `kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`

<a id="v2-security-tier-selection"></a>

### Seleção do nível de segurança V2

O nível de segurança é calculado automaticamente a partir do `risk_score` da decisão de política e dos `data_classes`, `action_type` e `estimated_impact` da intenção (spec §14.2):

| Condição | Nível |
|-----------|------|
| risk_score >= 800 OU data_classes inclui credentials/children_data | Maximum |
| risk_score >= 500 OU data_classes inclui pii/financial_data/health_data OU initiate_payment OU estimated_impact high OU um valor desconhecido ou ausente | Elevated |
| risk_score >= 200 OU estimated_impact medium | Standard |
| Padrão | Routine |

Um `security_tier` explícito na intenção só pode elevar o nível.

O nível determina: o modo de verificação, a frequência dos checkpoints PQ e o modo de apresentação do bundle sugerido.

<a id="v2-checklist-for-agent-creation-systems"></a>

### Checklist V2 para sistemas de criação de agentes

1. Gerar um par de chaves híbrido: Ed25519 + ML-DSA-65 (provedores dos SDKs, ou `dcp keygen --hybrid` a partir de uma cópia do repositório; não `@dcp-ai/cli init`, cujas chaves ML-DSA são simuladas)
2. Construir o RPR com o array `binding_keys[]` (formato KeyEntry) e assiná-lo com assinatura composta
3. Opcionalmente, colocar um `emergency_revocation_token` no passaporte (spec §11.3): `generateEmergencyRevocationToken()` retorna o token e o segredo, que você guarda offline; opcionalmente, configurar a recuperação Shamir SSS (`RecoveryConfig`, spec §11.2)
4. Construir o AgentPassport com `keys[]`, `principal_binding_reference`, `capabilities` e `risk_tier`
5. Construir o IntentV2 com `action_type`, `data_classes` e `estimated_impact`, e calcular `security_tier`
6. Construir o PolicyDecisionV2 com `risk_score` (inteiro de 0 a 1000) e, opcionalmente, `resolved_tier`
7. Construir as entradas AuditEventV2 com a cadeia `prev_hash` (SHA-256; cadeia secundária SHA3-256 opcional)
8. Gerar checkpoints PQ conforme o intervalo do nível
9. Construir o CitizenshipBundleV2 com `session_nonce` e o manifesto (todos os hashes dos artefatos)
10. Assinar o bundle com assinatura composta: Ed25519 + ML-DSA-65 com vinculação `pq_over_classical`
11. Opcionalmente, ancorar o bundle_hash
12. Inicializar o estado do ciclo de vida: criar um `CommissioningCertificate` com `commissioning_authority`, `purpose` e `initial_capabilities` (DCP-05)
13. Configurar a sucessão: opcionalmente, criar um `DigitalTestament` com `successor_preferences` e `memory_classification` (DCP-06)
14. Declarar direitos: criar uma `RightsDeclaration` com os itens `RightEntry` aplicáveis e um `ObligationRecord` (DCP-08)
15. Configurar a delegação: se o agente atuar como delegado, criar um `DelegationMandate` com `authority_scope` (DCP-09)
16. Configurar os limiares de atenção: definir um `AwarenessThreshold` com `threshold_rules` para os gatilhos de intervenção humana (DCP-09)

Veja [QUICKSTART.md](../../../docs/QUICKSTART.md) para exemplos de código e [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md) para atualizar a partir da V1.

<a id="reference"></a>

## Referências

- Armazenamento e ancoragem: [STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)
- Checklist de verificação: [spec/VERIFICATION.md](../../../spec/VERIFICATION.md)
