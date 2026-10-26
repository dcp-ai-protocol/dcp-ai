<sub>[English](DCP-05.md) · [中文](DCP-05.zh-CN.md) · [Español](DCP-05.es.md) · [日本語](DCP-05.ja.md) · **Português**</sub>

<a id="dcp-05-agent-lifecycle"></a>

# DCP-05: Ciclo de vida do agente

> Tradução informativa da [especificação em inglês](DCP-05.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

## Status
Publicada — v2.0 (extensão; as revisões são acompanhadas conforme o retorno de quem a adota)

> **Erratas (25/10/2026, normativas):** as erratas E2, E3, E7 e E8 de [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) corrigem o contexto de assinatura, o nome do campo de vitalidade e o caráter dos exemplos. Não alteram nenhum outro requisito desta especificação.

<a id="abstract"></a>

## Resumo
Esta especificação define o ciclo de vida completo de um agente de IA certificado pelo DCP, da entrada em serviço, passando pelo serviço ativo e pela perda de capacidade, até a desativação definitiva. Ela introduz máquinas de estados do ciclo de vida, métricas de vitalidade, certificados de entrada em serviço, relatórios de vitalidade e registros de desativação, todos assinados criptograficamente, encadeados por hash e verificáveis de forma independente. O protocolo garante que o histórico operacional de um agente permita detectar adulterações, que as transições entre estados do ciclo de vida sejam autorizadas e auditáveis e que quatro modos de encerramento distintos cubram toda a gama de cenários de fim de vida.

<a id="1-introduction"></a>

## 1. Introdução

DCP-01 a DCP-04 estabelecem identidade, intenção, auditoria e comunicação para agentes de IA. No entanto, essas especificações supõem que os agentes existem em um estado operacional estável. Na prática, os agentes têm vida finita: são criados, operam, se degradam e são aposentados ou encerrados. O DCP-05 preenche essa lacuna definindo um modelo abrangente de ciclo de vida.

Sem um protocolo de ciclo de vida, as organizações enfrentam vários riscos:

- Nenhum registro com autoridade de quando um agente entrou em serviço ou foi retirado dele
- Nenhum monitoramento contínuo de saúde que alimente o modelo de confiança
- Nenhum processo padronizado para a aposentadoria ordenada ou o encerramento de emergência
- Nenhum histórico que permita detectar adulterações e ligue o nascimento de um agente ao seu fim

<a id="11-design-principles"></a>

### 1.1 Princípios de design
- Toda transição de estado do ciclo de vida deve (MUST) ser assinada e registrada
- As métricas de vitalidade devem (MUST) ser encadeadas por hash para impedir a manipulação retroativa
- A desativação deve (MUST) produzir um registro selado e verificável de forma independente
- Os eventos do ciclo de vida se integram à cadeia de auditoria DCP existente (DCP-03)
- Os principais humanos mantêm a autoridade final sobre as transições do ciclo de vida

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relação com outras especificações
- **DCP-01**: os estados do ciclo de vida estendem o modelo de identidade; a identidade de um agente desativado persiste para fins de auditoria, mas não pode autorizar novas ações
- **DCP-02**: as declarações de intenção só são válidas se vierem de agentes no estado `active`
- **DCP-03**: todos os eventos do ciclo de vida geram entradas de auditoria na cadeia de hashes do agente
- **DCP-04**: as sessões A2A devem (MUST) ser encerradas quando um agente sai do estado `active`
- **DCP-06**: a sucessão e a herança (definidas à parte) dependem dos estados do ciclo de vida definidos aqui

<a id="2-terminology"></a>

## 2. Terminologia

**Entrada em serviço (commissioning)**: o ato formal de criar a identidade de um agente, vinculá-la a um principal responsável e colocá-lo em serviço. Equivale a uma certidão de nascimento somada a uma nomeação para um cargo.

**Vitalidade**: uma métrica composta (inteiro, 0–1000) que representa a saúde operacional de um agente, a integridade de suas capacidades e sua posição de confiança. Uma vitalidade de 1000 indica plena capacidade operacional; 0 indica incapacidade total.

**Relatório de vitalidade**: um registro periódico, assinado e encadeado por hash da métrica de vitalidade de um agente e das pontuações de seus componentes.

**Desativação (decommissioning)**: o ato formal de retirar um agente de serviço permanentemente e selar seu registro operacional.

**Estado do ciclo de vida**: um dos quatro estados canônicos em que um agente pode estar: `commissioned`, `active`, `declining` ou `decommissioned`.

**Modo de encerramento**: a forma como um agente passa ao estado `decommissioned`: `planned_retirement`, `termination_for_cause`, `organizational_restructuring` ou `sudden_failure`.

**Contexto de separação de domínio**: `DCP-AI.v2.Lifecycle` (DCP-AI v2.0 §4.1; errata E2; antes constava aqui a tag `DCP-LIFECYCLE-SIG-v2`), usado em todas as assinaturas produzidas segundo esta especificação para impedir a repetição entre protocolos.

<a id="3-lifecycle-state-machine"></a>

## 3. Máquina de estados do ciclo de vida

<a id="31-states"></a>

### 3.1 Estados

Um agente deve (MUST) estar, a qualquer momento, em exatamente um dos estados a seguir:

| Estado | Código | Descrição |
|-------|------|-------------|
| **Em serviço** | `commissioned` | A identidade do agente foi criada e vinculada a um principal, mas o agente ainda não foi colocado em serviço ativo. Equivale a uma credencial recém-emitida que ainda não foi ativada. |
| **Ativo** | `active` | O agente está totalmente operacional. Pode declarar intenções, executar ações, participar de sessões A2A e gerar entradas de auditoria. |
| **Em declínio** | `declining` | A vitalidade do agente caiu abaixo de um limite configurável, ou um principal iniciou uma desmobilização gerenciada. O agente pode (MAY) continuar operando, mas com capacidades restritas. Novos compromissos de longo prazo deveriam (SHOULD) ser recusados. |
| **Desativado** | `decommissioned` | O agente está permanentemente fora de serviço. Seu registro de identidade persiste para auditoria e verificação histórica, mas ele não deve (MUST NOT) iniciar novas ações, sessões nem declarações de intenção. |

<a id="32-valid-transitions"></a>

### 3.2 Transições válidas

```
                  activate
 commissioned ──────────────> active
                               │  │
                               │  │ decline (vitality < threshold
                               │  │         OR principal-initiated)
                               │  v
                               │  declining
                               │  │
                               │  │ reactivate (vitality restored
                               │  │            AND principal-approved)
                               │  │───────────> active
                               │  │
                  decommission │  │ decommission
                  (any mode)   │  │ (any mode)
                               v  v
                          decommissioned
```

Transições válidas:

1. `commissioned` -> `active` (ativação)
2. `active` -> `declining` (queda da vitalidade ou declínio iniciado pelo principal)
3. `declining` -> `active` (reativação; exige aprovação do principal e vitalidade acima do limite)
4. `active` -> `decommissioned` (encerramento direto)
5. `declining` -> `decommissioned` (encerramento a partir do estado de declínio)

Transições inválidas:

- `decommissioned` -> qualquer estado (estado terminal, irreversível)
- `commissioned` -> `declining` (precisa ser ativado antes)
- `commissioned` -> `decommissioned` (precisa ser ativado antes, ou usar `termination_for_cause` se a entrada em serviço foi equivocada, o que ativa implicitamente e desativa de imediato)

<a id="33-transition-record"></a>

### 3.3 Registro de transição

Toda transição de estado deve (MUST) produzir um registro assinado:

```json
{
  "dcp_version": "2.0",
  "record_type": "lifecycle_transition",
  "transition_id": "lt:<uuid>",
  "agent_id": "agent:<identifier>",
  "from_state": "active",
  "to_state": "declining",
  "reason": "vitality_threshold_breach",
  "vitality_at_transition": 340,
  "threshold": 400,
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="4-commissioning-certificate"></a>

## 4. Certificado de entrada em serviço

<a id="41-purpose"></a>

### 4.1 Finalidade

O certificado de entrada em serviço é o documento fundador da existência de um agente. Ele registra os parâmetros de criação do agente, o principal ao qual está vinculado, as capacidades iniciais e a entidade que o autoriza. Ele deve (MUST) ser a primeira entrada da cadeia do ciclo de vida do agente.

### 4.2 Schema

Referência do schema: `schemas/v2/commissioning_certificate.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "commissioning_certificate",
  "certificate_id": "cc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "agent_description": "Purpose and scope of the agent",
  "principal_binding": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Responsible Human or Entity",
    "organization_id": "org:<identifier>",
    "binding_type": "direct",
    "authority_level": "full"
  },
  "initial_capabilities": [
    "negotiate",
    "purchase_order",
    "data_query"
  ],
  "operational_parameters": {
    "intended_lifespan": "P365D",
    "vitality_report_interval": "PT1H",
    "vitality_decline_threshold": 400,
    "vitality_critical_threshold": 200,
    "max_concurrent_sessions": 100,
    "security_tier": "elevated",
    "permitted_domains": ["procurement", "finance"]
  },
  "initial_vitality": 1000,
  "cryptographic_identity": {
    "ed25519_public_key": "<base64>",
    "ml_dsa_65_public_key": "<base64>",
    "key_generation_timestamp": "2026-03-01T00:00:00Z"
  },
  "commissioning_authority": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Organization Commissioning Authority",
    "authorization_reference": "AUTH-2026-0042"
  },
  "metadata": {
    "model_identifier": "model-name-v1.0",
    "deployment_environment": "production",
    "geographic_jurisdiction": "US"
  },
  "commissioned_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "prev_hash_secondary": "sha3-256:0000000000000000000000000000000000000000000000000000000000000000",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="43-commissioning-flow"></a>

### 4.3 Fluxo de entrada em serviço

1. A autoridade de entrada em serviço gera a identidade criptográfica do agente
2. A autoridade cria e assina o certificado de entrada em serviço
3. O principal responsável referenda o certificado, aceitando a responsabilização
4. O certificado é registrado como entrada gênese (com `prev_hash` nulo) na cadeia do ciclo de vida do agente
5. Uma entrada de auditoria `agent_commissioned` é criada na cadeia de auditoria do DCP-03
6. O agente passa ao estado `commissioned`
7. Após a verificação de prontidão, o agente passa ao estado `active`

<a id="44-countersignature-requirement"></a>

### 4.4 Requisito de referenda

O certificado de entrada em serviço deve (MUST) ter duas assinaturas:

- **Assinatura da autoridade**: a entidade autorizada a colocar agentes em serviço (chave raiz da organização ou chave delegada de entrada em serviço)
- **Referenda do principal**: o principal responsável que aceita a responsabilização pelo agente

As duas assinaturas devem (MUST) usar o contexto de separação de domínio `DCP-AI.v2.Lifecycle` (errata E2).

> *Nota informativa (25/10/2026):* o schema V2.0 `commissioning_certificate` tem uma única `composite_sig` e nenhum campo para a referenda; veja [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly).

<a id="5-vitality-metric"></a>

## 5. Métrica de vitalidade

<a id="51-definition"></a>

### 5.1 Definição

A vitalidade é um inteiro no intervalo [0, 1000] que representa a aptidão operacional geral de um agente. Ela combina quatro pontuações de componentes:

| Componente | Peso | Intervalo | Descrição |
|-----------|--------|-------|-------------|
| **Integridade das capacidades** | 0.30 | 0–1000 | Mede se o agente consegue executar corretamente as capacidades que declara. Obtida de autotestes, sondagens de capacidades ou validação externa. |
| **Posição de confiança** | 0.25 | 0–1000 | Mede a confiabilidade do agente com base no histórico de auditoria, na conformidade com políticas e nas avaliações de pares. |
| **Saúde dos recursos** | 0.25 | 0–1000 | Mede a disponibilidade de recursos computacionais: memória, latência, vazão, taxas de erro. |
| **Conformidade com políticas** | 0.20 | 0–1000 | Mede a aderência às intenções declaradas e às políticas da organização. Obtida dos registros de resultado de políticas do DCP-02. |

Vitalidade composta:
```
vitality = floor(0.30 * capability_integrity + 0.25 * trust_standing +
                 0.25 * resource_health + 0.20 * policy_compliance)
```

Em um relatório de vitalidade V2.0, esse valor vai no campo `vitality_score` (errata E3).

<a id="52-thresholds"></a>

### 5.2 Limites

As organizações configuram dois limites por agente no certificado de entrada em serviço:

- **Limite de declínio** (padrão 400): quando a vitalidade cai abaixo desse valor, o agente passa ao estado `declining`
- **Limite crítico** (padrão 200): quando a vitalidade cai abaixo desse valor, é necessária intervenção imediata; o agente deveria (SHOULD) ser desativado, a menos que o principal responsável autorize explicitamente a continuidade da operação

<a id="53-vitality-decay-and-recovery"></a>

### 5.3 Deterioração e recuperação da vitalidade

A vitalidade não é estática. As pontuações dos componentes mudam com base em:

- **Autoavaliação**: resultados de testes de capacidade relatados pelo próprio agente
- **Sondagens externas**: verificações de saúde do serviço de verificação
- **Análise de auditoria**: revisão automatizada da cadeia de auditoria em busca de anomalias
- **Relatórios de pares**: outros agentes que relatam a qualidade da interação por meio do DCP-04

Recuperação: se a vitalidade de um agente em `declining` voltar a ficar acima do limite de declínio e o principal responsável aprovar, o agente pode (MAY) voltar a `active`.

<a id="6-vitality-report"></a>

## 6. Relatório de vitalidade

<a id="61-purpose"></a>

### 6.1 Finalidade

Os relatórios de vitalidade formam uma sequência encadeada por hash que fornece um histórico da saúde do agente ao longo do tempo no qual é possível detectar adulterações. Eles são gerados no intervalo especificado no certificado de entrada em serviço.

### 6.2 Schema

Referência do schema: `schemas/v2/vitality_report.schema.json`

> **Erratas E3 e E7 (25/10/2026):** o campo `vitality` deste exemplo é `vitality_score` no formato de transmissão V2.0, e o exemplo como um todo é conceitual: o formato de transmissão é o schema, cujas `metrics` só são representáveis como 0 ou 1 com `dcp-jcs-v1`. Veja [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md).

```json
{
  "dcp_version": "2.0",
  "record_type": "vitality_report",
  "report_id": "vr:<uuid>",
  "agent_id": "agent:<identifier>",
  "sequence_number": 42,
  "lifecycle_state": "active",
  "vitality": 872,
  "components": {
    "capability_integrity": {
      "score": 920,
      "details": {
        "tests_passed": 47,
        "tests_failed": 2,
        "tests_total": 49,
        "last_test_timestamp": "2026-03-01T12:00:00Z"
      }
    },
    "trust_standing": {
      "score": 850,
      "details": {
        "successful_interactions": 1203,
        "failed_interactions": 12,
        "policy_violations": 0,
        "peer_trust_score": 880
      }
    },
    "resource_health": {
      "score": 810,
      "details": {
        "avg_response_latency_ms": 45,
        "error_rate_percent": 0.3,
        "memory_utilization_percent": 72,
        "throughput_ops_per_sec": 150
      }
    },
    "policy_compliance": {
      "score": 900,
      "details": {
        "intents_declared": 500,
        "intents_completed": 495,
        "policy_outcomes_compliant": 498,
        "policy_outcomes_noncompliant": 2
      }
    }
  },
  "anomalies": [],
  "recommendations": [],
  "report_interval": "PT1H",
  "report_window": {
    "from": "2026-03-01T11:00:00Z",
    "to": "2026-03-01T12:00:00Z"
  },
  "timestamp": "2026-03-01T12:00:05Z",
  "prev_hash": "sha256:<hex of previous vitality report>",
  "prev_hash_secondary": "sha3-256:<hex of previous vitality report>",
  "merkle_root": {
    "sha256": "<hex>",
    "sha3_256": "<hex>"
  },
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="63-hash-chaining"></a>

### 6.3 Encadeamento por hash

Os relatórios de vitalidade formam uma cadeia de hashes. Os campos `prev_hash` e `prev_hash_secondary` de cada relatório referenciam os hashes SHA-256 e SHA3-256 do relatório de vitalidade imediatamente anterior. O primeiro relatório de vitalidade após a entrada em serviço referencia o hash do certificado de entrada em serviço.

A abordagem de hash duplo (SHA-256 + SHA3-256) segue o mesmo padrão das cadeias de auditoria do DCP-03 e oferece resistência ao comprometimento de um único algoritmo.

<a id="64-merkle-root"></a>

### 6.4 Raiz de Merkle

Cada relatório de vitalidade inclui uma raiz de Merkle de hash duplo sobre as pontuações dos componentes e seus detalhes. Isso permite a divulgação seletiva: um agente pode provar sua pontuação geral de vitalidade revelando apenas detalhes específicos dos componentes.

<a id="65-anomaly-detection"></a>

### 6.5 Detecção de anomalias

O array `anomalies` pode (MAY) conter relatórios de anomalias estruturados:

```json
{
  "anomaly_id": "anom:<uuid>",
  "type": "capability_degradation",
  "severity": "warning",
  "component": "capability_integrity",
  "description": "Test pass rate dropped 15% in the last reporting interval",
  "detected_at": "2026-03-01T11:45:00Z",
  "data": {
    "previous_pass_rate": 0.98,
    "current_pass_rate": 0.83
  }
}
```

Gravidades das anomalias: `info`, `warning`, `critical`.

<a id="7-termination-modes"></a>

## 7. Modos de encerramento

<a id="71-overview"></a>

### 7.1 Visão geral

Um agente chega ao estado `decommissioned` por um de quatro modos de encerramento, cada um com requisitos de procedimento diferentes:

| Modo | Código | Gatilho | Período de carência |
|------|------|---------|--------------|
| **Aposentadoria planejada** | `planned_retirement` | O agente cumpriu sua finalidade ou chegou ao fim da vida prevista | Completo (configurável, padrão 72 h) |
| **Encerramento por justa causa** | `termination_for_cause` | O agente violou uma política, teve comportamento inseguro ou foi comprometido | Mínimo (configurável, padrão 1 h) |
| **Reestruturação organizacional** | `organizational_restructuring` | Decisão de negócio de aposentar o agente, sem relação com seu desempenho | Padrão (configurável, padrão 24 h) |
| **Falha súbita** | `sudden_failure` | O agente deixou de responder ou sofreu uma falha catastrófica | Nenhum (desativação a posteriori pelo principal) |

<a id="72-planned-retirement"></a>

### 7.2 Aposentadoria planejada

O processo ordenado de fim de vida:

1. O principal responsável emite um aviso de aposentadoria com um período de carência
2. O agente entra no estado `declining` (se ainda não estiver)
3. O agente conclui ou transfere o trabalho em andamento
4. O agente encerra todas as sessões A2A com o motivo `complete`
5. O agente gera um relatório de vitalidade final
6. O agente executa o protocolo de sucessão (DCP-06), se configurado
7. O registro de desativação é criado e assinado
8. O agente passa a `decommissioned`

<a id="73-termination-for-cause"></a>

### 7.3 Encerramento por justa causa

Encerramento de emergência por violações de políticas ou comprometimento:

1. O principal responsável ou a autoridade da organização emite a ordem de encerramento
2. As credenciais do agente são marcadas de imediato para revogação
3. Todas as sessões A2A são encerradas com o motivo `revocation`
4. Um período de carência mínimo permite que as operações em andamento terminem (ou sejam revertidas)
5. O registro de desativação é criado com os detalhes da `cause`
6. O agente passa a `decommissioned`
7. A análise pós-incidente gera um resumo de auditoria

<a id="74-organizational-restructuring"></a>

### 7.4 Reestruturação organizacional

Aposentadoria motivada pelo negócio:

1. A organização emite um aviso de reestruturação que afeta o agente
2. Período de carência padrão para a transferência do trabalho
3. O agente conclui ou transfere o trabalho conforme a política da organização
4. O protocolo de sucessão (DCP-06) é executado se houver um sucessor designado
5. O registro de desativação é criado
6. O agente passa a `decommissioned`

<a id="75-sudden-failure"></a>

### 7.5 Falha súbita

Quando um agente falha inesperadamente:

1. O sistema de monitoramento ou um agente par detecta a falta de resposta
2. Um evento `sudden_failure` é gerado após um tempo limite configurável (padrão: 5 minutos sem resposta)
3. O principal responsável é notificado
4. O principal cria a posteriori um registro de desativação em nome do agente
5. O principal assina o registro de desativação com a própria chave (já que o agente não pode assinar)
6. As contrapartes A2A são notificadas se o agente estava em sessões ativas
7. O protocolo de sucessão (DCP-06) é executado em modo de emergência, se configurado

<a id="8-decommissioning-record"></a>

## 8. Registro de desativação

<a id="81-purpose"></a>

### 8.1 Finalidade

O registro de desativação é o documento terminal da cadeia do ciclo de vida de um agente. Ele sela o histórico operacional do agente e fornece um registro permanente e verificável de como e por que o agente foi aposentado.

### 8.2 Schema

Referência do schema: `schemas/v2/decommissioning_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "decommissioning_record",
  "decommission_id": "dc:<uuid>",
  "agent_id": "agent:<identifier>",
  "agent_name": "Human-readable agent name",
  "termination_mode": "planned_retirement",
  "lifecycle_summary": {
    "commissioned_at": "2026-01-01T00:00:00Z",
    "activated_at": "2026-01-01T01:00:00Z",
    "decommissioned_at": "2026-03-01T00:00:00Z",
    "total_active_duration": "P59D",
    "total_vitality_reports": 1416,
    "final_vitality": 720,
    "average_vitality": 865,
    "min_vitality": 410,
    "max_vitality": 995,
    "total_audit_entries": 15230,
    "total_a2a_sessions": 342,
    "total_intents_declared": 8901,
    "policy_violations": 2
  },
  "audit_chain_seal": {
    "final_audit_hash": "sha256:<hex>",
    "final_audit_hash_secondary": "sha3-256:<hex>",
    "audit_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_entries": 15230
  },
  "vitality_chain_seal": {
    "final_vitality_hash": "sha256:<hex>",
    "final_vitality_hash_secondary": "sha3-256:<hex>",
    "vitality_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "total_reports": 1416
  },
  "succession_reference": {
    "successor_agent_id": "agent:<identifier>",
    "succession_record_id": "sr:<uuid>",
    "memory_transfer_complete": true
  },
  "reason": "Agent fulfilled its intended operational lifespan",
  "cause_details": null,
  "key_disposition": {
    "private_keys_destroyed": true,
    "destruction_method": "secure_erasure",
    "destruction_witness": "principal:<identifier>",
    "public_keys_archived": true,
    "archive_location": "org-key-archive-2026"
  },
  "data_disposition": {
    "operational_data": "transferred_to_successor",
    "audit_data": "archived",
    "session_data": "purged",
    "archive_retention_period": "P7Y"
  },
  "decommissioned_at": "2026-03-01T00:00:00Z",
  "decommissioned_by": {
    "principal_id": "principal:<identifier>",
    "role": "responsible_principal"
  },
  "prev_hash": "sha256:<hex of final vitality report or last lifecycle record>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id or principal-key-id for sudden_failure>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  },
  "countersignature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-LIFECYCLE-SIG-v2"
  }
}
```

<a id="83-chain-sealing"></a>

### 8.3 Selagem das cadeias

O registro de desativação inclui selos de raiz de Merkle tanto para a cadeia de auditoria quanto para a cadeia de vitalidade. Esses selos permitem que qualquer verificador futuro confirme a completude e a integridade dos registros históricos do agente sem percorrer novamente a cadeia inteira.

<a id="84-key-disposition"></a>

### 8.4 Destinação das chaves

Na desativação:

- As chaves privadas devem (MUST) ser destruídas de forma segura
- As chaves públicas devem (MUST) ser arquivadas para a verificação futura de artefatos históricos
- O método de destruição e a testemunha devem (MUST) ser registrados
- Em `sudden_failure`, a destruição das chaves é feita pelo principal responsável

<a id="85-sudden-failure-special-handling"></a>

### 8.5 Tratamento especial da falha súbita

Quando um agente falha subitamente e não pode assinar o próprio registro de desativação:

1. O principal responsável assina o registro com a própria chave
2. `signature.kid` referencia a chave do principal, não a do agente
3. Um indicador `principal_signed_on_behalf` recebe o valor `true`
4. O motivo deve (MUST) incluir as informações de diagnóstico disponíveis
5. Se o último relatório de vitalidade do agente estiver disponível, seu hash é usado como `prev_hash`; caso contrário, é usado o hash da última entrada de auditoria conhecida

<a id="9-integration-with-dcp-03-audit-chain"></a>

## 9. Integração com a cadeia de auditoria do DCP-03

<a id="91-lifecycle-audit-events"></a>

### 9.1 Eventos de auditoria do ciclo de vida

Todos os eventos do ciclo de vida geram entradas na cadeia de auditoria do DCP-03:

| Evento | `event_type` |
|-------|-------------|
| Certificado de entrada em serviço criado | `agent_commissioned` |
| Agente ativado | `agent_activated` |
| O agente entrou no estado de declínio | `agent_declining` |
| Agente reativado a partir do declínio | `agent_reactivated` |
| Relatório de vitalidade gerado | `vitality_report_generated` |
| Limite de vitalidade ultrapassado | `vitality_threshold_breach` |
| Desativação iniciada | `decommissioning_initiated` |
| Desativação concluída | `agent_decommissioned` |

<a id="92-audit-entry-format"></a>

### 9.2 Formato da entrada de auditoria

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "agent_declining",
  "agent_id": "agent:<identifier>",
  "lifecycle_state": "declining",
  "vitality": 380,
  "trigger": "vitality_threshold_breach",
  "details": {
    "threshold": 400,
    "vitality_report_id": "vr:<uuid>"
  },
  "timestamp": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="10-security-considerations"></a>

## 10. Considerações de segurança

<a id="101-lifecycle-chain-integrity"></a>

### 10.1 Integridade da cadeia do ciclo de vida

A sequência encadeada por hash formada pelo certificado de entrada em serviço, pelos relatórios de vitalidade, pelos registros de transição e pelo registro de desativação constitui uma cadeia do ciclo de vida que permite detectar adulterações. Qualquer modificação de um registro histórico invalida todos os hashes posteriores.

<a id="102-vitality-report-authenticity"></a>

### 10.2 Autenticidade dos relatórios de vitalidade

Os relatórios de vitalidade são autodeclarados pelo agente. As implementações deveriam (SHOULD) complementar os dados autodeclarados com validação externa:

- Sondagens de saúde do serviço de verificação
- Relatórios de agentes pares sobre a qualidade da interação
- Sistemas de monitoramento da organização
- Testes automatizados de capacidades

Um agente comprometido poderia falsificar a própria vitalidade. As fontes de validação externas oferecem defesa em profundidade.

<a id="103-termination-authorization"></a>

### 10.3 Autorização do encerramento

Somente principais autorizados podem iniciar transições do ciclo de vida. O modelo de autorização:

- **Ativação**: autoridade de entrada em serviço ou principal responsável
- **Declínio**: automático (limite de vitalidade) ou principal responsável
- **Reativação**: somente o principal responsável (exige aprovação explícita)
- **Desativação**: principal responsável, autoridade da organização ou automática (detecção de falha súbita)

<a id="104-post-decommissioning-verification"></a>

### 10.4 Verificação após a desativação

Após a desativação, as chaves públicas do agente continuam arquivadas. Qualquer parte pode verificar as assinaturas históricas do agente, sua cadeia de auditoria e seus relatórios de vitalidade. Os selos de cadeia do registro de desativação permitem uma verificação eficiente sem percorrer novamente todo o histórico.

<a id="105-domain-separation"></a>

### 10.5 Separação de domínio

Todas as assinaturas segundo esta especificação usam o contexto de separação de domínio `DCP-AI.v2.Lifecycle` (errata E2). Isso impede que assinaturas criadas para o ciclo de vida sejam reutilizadas em outros contextos do protocolo DCP (por exemplo, declarações de intenção ou sessões A2A).

<a id="106-sudden-failure-risks"></a>

### 10.6 Riscos da falha súbita

A falha súbita apresenta riscos de segurança próprios:

- O agente não pode assinar o próprio registro de desativação
- O material das chaves privadas do agente pode estar em um estado desconhecido
- As operações em andamento podem ficar em um estado inconsistente

Mitigações:

- Os registros de desativação assinados pelo principal são claramente marcados
- O material das chaves deve (MUST) ser presumido comprometido; uma revogação deveria (SHOULD) ser emitida
- Os agentes contrapartes deveriam (SHOULD) tratar os dados em andamento do agente que falhou como potencialmente não confiáveis

<a id="11-conformance"></a>

## 11. Conformidade

Uma implementação está em conformidade com o DCP-05 se:

1. Implementa os quatro estados do ciclo de vida e as transições válidas definidas na seção 3
2. Gera certificados de entrada em serviço com assinatura dupla conforme a seção 4
3. Produz relatórios de vitalidade encadeados por hash no intervalo configurado conforme a seção 6
4. Oferece suporte aos quatro modos de encerramento definidos na seção 7
5. Gera registros de desativação selados conforme a seção 8
6. Cria entradas de auditoria do DCP-03 para todos os eventos do ciclo de vida conforme a seção 9
7. Usa o contexto de separação de domínio `DCP-AI.v2.Lifecycle` em todas as assinaturas (errata E2)
8. Implementa hash duplo (SHA-256 + SHA3-256) em todos os elos das cadeias de hashes

<a id="references"></a>

## Referências

- DCP-01: Identidade e vinculação ao principal
- DCP-02: Declaração de intenção e controle por políticas
- DCP-03: Cadeia de auditoria e transparência
- DCP-04: Comunicação entre agentes
- DCP-06: Sucessão e herança
- NIST SP 800-88: Guidelines for Media Sanitization (destruição de chaves)
- RFC 3339: Date and Time on the Internet

---

*Esta especificação reconhece que os agentes de IA, como todos os sistemas operacionais, têm vida finita. Um protocolo para a cidadania digital precisa considerar não só como os agentes vivem, mas como terminam: com dignidade, responsabilização e um registro completo.*

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima, com as correções das erratas de
> [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md).

- **Registros em `schemas/v2/`.** O certificado de entrada em serviço, o relatório de vitalidade e o registro de
  desativação que os SDKs constroem e que `schemas/v2/` valida têm campos diferentes dos exemplos de §3 a §9: por
  exemplo, `vitality_score`, `state`, `metrics` e `prev_report_hash` no relatório de vitalidade, e
  `final_vitality_score` e `data_disposition` no registro de desativação. Nenhum deles tem `prev_hash_secondary`,
  `merkle_root`, `countersignature` ou `domain_sep`. Não há schema para o registro de transição de §3.3 nem para a
  entrada de auditoria de §9.2.
- **Assinaturas.** Cada registro tem uma única `composite_sig` (Ed25519 + ML-DSA-65) de quem detém as chaves passadas,
  com o contexto `DCP-AI.v2.Lifecycle` (errata E2); os SDKs não produzem a assinatura da autoridade mais a referenda do
  principal de §4.4.
- **Transições.** `validateStateTransition` aceita seis arestas: as cinco de §3.2 e `commissioned` ->
  `decommissioned`. Ela verifica apenas o par de estados, não a aprovação do principal, a vitalidade nem quem assina.
- **Pontuação de vitalidade.** `computeVitalityScore` recebe quatro métricas em [0, 1] (`task_completion_rate`,
  `error_rate` invertida, `human_satisfaction`, `policy_alignment`) com os pesos de §5.1 e arredonda para o inteiro mais
  próximo (`Math.round`); §5.1 usa outros componentes pontuados de 0 a 1000 e `floor`. A cadeia de vitalidade liga cada
  relatório por `prev_report_hash` (somente SHA-256).
- **Métricas fracionárias.** `dcp-jcs-v1` aceita apenas inteiros, então um relatório de vitalidade cujas `metrics`
  contenham uma fração como `0.83` não pode ser canonicalizado nem assinado; com o intervalo [0, 1] do schema, um
  relatório assinado só pode ter 0 ou 1 em cada métrica. Os exemplos de §6 também contêm frações
  (`error_rate_percent`, `previous_pass_rate`): são ilustrações com marcadores, não fixtures.
- Esses registros são declarações assinadas de quem os assina; não provam que um estado, uma pontuação ou uma
  destinação sejam verdadeiros, e nada nos SDKs ou nos serviços aplica os períodos de carência, a destruição de chaves
  nem o encerramento de sessões de §7 e §8. Para os tipos do SDK, consulte [docs/API_REFERENCE.md](../docs/API_REFERENCE.md).
