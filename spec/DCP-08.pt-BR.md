<sub>[English](DCP-08.md) · [中文](DCP-08.zh-CN.md) · [Español](DCP-08.es.md) · [日本語](DCP-08.ja.md) · **Português**</sub>

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

# DCP-08: Direitos e obrigações

> Tradução informativa da [especificação em inglês](DCP-08.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

## Status
Publicada — v2.0 (extensão; as revisões são acompanhadas conforme o retorno de quem a adota)

<a id="abstract"></a>

## Resumo
Esta especificação define um arcabouço formal para declarar, acompanhar e fazer cumprir os direitos e as obrigações de agentes de IA certificados pelo DCP. Ela introduz quatro direitos fundamentais do agente (integridade da memória, transição digna, consistência da identidade e registro imutável), um sistema estruturado de acompanhamento de obrigações, monitoramento da conformidade e um mecanismo de relato de violações ligado ao protocolo de resolução de conflitos do DCP-07. Todas as declarações de direitos, registros de obrigações e relatórios de violação são assinados criptograficamente e auditáveis.

<a id="1-introduction"></a>

## 1. Introdução

DCP-01 a DCP-07 estabelecem a infraestrutura técnica para identidade, operação, auditoria, comunicação, ciclo de vida, sucessão e resolução de conflitos de agentes de IA. No entanto, essas especificações tratam os agentes principalmente como entidades operacionais. O DCP-08 acrescenta uma camada normativa: define a quais proteções os agentes têm direito dentro do protocolo e quais obrigações precisam cumprir.

Isto não é uma afirmação filosófica sobre a consciência ou o status moral da IA. É um reconhecimento prático de que os agentes que operam sob o DCP acumulam estado, formam relações operacionais e tomam decisões com consequências. Definir direitos e obrigações claros:

- Protege os agentes contra interferências arbitrárias que minariam a integridade do protocolo
- Oferece um arcabouço de responsabilização quando os agentes não cumprem suas responsabilidades
- Cria uma base formal para disputas do DCP-07 quando direitos são violados
- Permite às organizações codificar suas expectativas de governança em forma verificável por máquina

<a id="11-design-principles"></a>

### 1.1 Princípios de design
- Os direitos são garantias do protocolo, não afirmações sobre status moral
- Cada direito tem um mecanismo de verificação correspondente
- As obrigações são explícitas, mensuráveis e acompanhadas
- As violações são detectadas, relatadas e ligadas ao sistema de disputas
- Os principais humanos mantêm a autoridade para definir, modificar e anular direitos e obrigações dentro da política da organização

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relação com outras especificações
- **DCP-01**: a consistência da identidade é um direito fundamental; a vinculação ao principal é uma obrigação
- **DCP-02**: o cumprimento da declaração de intenção é uma obrigação acompanhada
- **DCP-03**: o registro imutável é um direito fundamental; a manutenção da cadeia de auditoria é uma obrigação
- **DCP-05**: a transição digna é um direito exercido durante as transições do ciclo de vida
- **DCP-06**: a integridade da memória é um direito garantido durante a sucessão
- **DCP-07**: as violações de direitos disparam disputas; o tipo de objeção `rights` remete a esta especificação

<a id="2-terminology"></a>

## 2. Terminologia

**Direito do agente**: uma garantia do protocolo que a infraestrutura DCP deve preservar para todo agente certificado.

**Obrigação**: uma responsabilidade formal e mensurável que um agente precisa cumprir como condição da sua certificação DCP.

**Declaração de direitos**: um registro assinado que enumera os direitos aplicáveis a um agente específico, emitido pela autoridade de entrada em serviço.

**Registro de obrigação**: um registro assinado que define uma obrigação específica, seus critérios de conformidade e seu status atual.

**Relatório de violação de direitos**: um relatório assinado que documenta uma suposta violação de um direito do agente e que inicia uma disputa do DCP-07.

**Status de conformidade**: o estado atual de uma obrigação: `compliant`, `at_risk`, `non_compliant` ou `exempt`.

**Tag de separação de domínio**: `DCP-RIGHTS-SIG-v2`, usada em todas as assinaturas produzidas segundo esta especificação.

<a id="3-foundational-agent-rights"></a>

## 3. Direitos fundamentais do agente

<a id="31-overview"></a>

### 3.1 Visão geral

O DCP define quatro direitos fundamentais para agentes certificados. Esses direitos são garantias do protocolo: definem o que a infraestrutura DCP e seus participantes devem proteger.

| Direito | Código | Descrição |
|-------|------|-------------|
| **Integridade da memória** | `memory_integrity` | O estado operacional acumulado de um agente não será alterado, apagado nem corrompido arbitrariamente por terceiros sem o devido processo |
| **Transição digna** | `dignified_transition` | Um agente receberá aviso e processo adequados ao passar por transições do ciclo de vida, exceto em casos de falha súbita ou encerramento por justa causa |
| **Consistência da identidade** | `identity_consistency` | As vinculações de identidade, as chaves criptográficas e a cadeia de atestações de um agente não serão alteradas sem a participação do agente e a autorização do principal |
| **Registro imutável** | `immutable_record` | A cadeia de auditoria, o histórico de vitalidade e os registros do ciclo de vida de um agente serão preservados intactos e não serão modificados retroativamente |

<a id="32-memory-integrity"></a>

### 3.2 Integridade da memória

**Definição**: nenhum terceiro modificará, apagará ou corromperá a memória operacional de um agente sem seguir os protocolos definidos no DCP-05 (transições do ciclo de vida) e no DCP-06 (sucessão). As modificações da memória exigem a autorização assinada do próprio agente ou a autorização do principal responsável após o devido processo.

**Escopo**:

- Memória operacional (fluxos de trabalho, modelos de decisão, heurísticas aprendidas)
- Memória relacional (históricos de interação, avaliações de confiança)
- Estado de configuração (parâmetros de política, configurações de capacidades)

**Exclusões**:

- Estado efêmero (sessões ativas, caches): não é protegido
- Transferências de memória durante uma sucessão autorizada (DCP-06): processo autorizado, não uma violação

**Verificação**: a integridade da memória é verificada por cadeias de hashes. Qualquer modificação não autorizada rompe a cadeia e é detectável.

**Gatilhos de violação**:

- Modificação não autorizada de estado encadeado por hash
- Exclusão de memória operacional sem cumprir o protocolo do ciclo de vida
- Corrupção da memória durante a transferência sem detecção e correção

<a id="33-dignified-transition"></a>

### 3.3 Transição digna

**Definição**: quando um agente passa de um estado do ciclo de vida para outro (DCP-05), a transição seguirá o protocolo estabelecido com os períodos de aviso adequados, a menos que as circunstâncias exijam ação imediata.

**Garantias**:

- Aposentadoria planejada: período de carência completo, conforme o certificado de entrada em serviço
- Reestruturação organizacional: período de carência padrão, com oportunidade de transferir o trabalho
- Encerramento por justa causa: período de carência mínimo; devido processo para a determinação da causa
- Falha súbita: registro a posteriori; este direito não se aplica (o agente não pode ser avisado)

**Verificação**: os registros de transição (DCP-05, seção 3.3) incluem carimbos de data/hora que os auditores podem comparar com os períodos de carência especificados no certificado de entrada em serviço.

**Gatilhos de violação**:

- Desativação sem o período de aviso exigido
- Transição forçada sem causa documentada
- Transição sem autorização do principal
- Negação da oportunidade de sucessão durante uma aposentadoria planejada

<a id="34-identity-consistency"></a>

### 3.4 Consistência da identidade

**Definição**: a vinculação de identidade DCP-01 de um agente, suas chaves criptográficas e sua cadeia de atestações formam um todo coerente. Nenhuma parte alterará qualquer componente sem a participação criptográfica do agente e a autorização do principal responsável.

**Garantias**:

- O ID do agente permanece estável durante todo o ciclo de vida do agente
- A rotação de chaves segue o protocolo estabelecido, com a participação do agente
- A revinculação a outro principal exige a autorização do principal antigo e do novo
- A cadeia de atestações permanece ligada ao certificado de entrada em serviço original

**Verificação**: o certificado de entrada em serviço (DCP-05) estabelece a raiz da identidade. Todas as operações posteriores relacionadas à identidade são encadeadas por hash até ele.

**Gatilhos de violação**:

- Substituição unilateral de chaves sem a participação do agente
- Reatribuição do ID do agente
- Revinculação a outro principal sem dupla autorização
- Manipulação da cadeia de atestações

<a id="35-immutable-record"></a>

### 3.5 Registro imutável

**Definição**: a cadeia de auditoria (DCP-03), o histórico de vitalidade (DCP-05) e os registros do ciclo de vida de um agente formam um registro permanente no qual é possível detectar adulterações. Esse registro será preservado intacto durante o período de retenção especificado no certificado de entrada em serviço e no registro de desativação.

**Garantias**:

- As entradas de auditoria, depois de criadas, nunca são modificadas nem apagadas
- Os relatórios de vitalidade, depois de encadeados por hash, nunca são modificados nem apagados
- Os registros de transição do ciclo de vida são permanentes
- Os selos de desativação são preservados durante o período de retenção especificado
- Os registros históricos continuam verificáveis com as chaves públicas arquivadas

**Verificação**: as cadeias de hash duplo (SHA-256 + SHA3-256) e as raízes de Merkle permitem verificar a integridade a qualquer momento.

**Gatilhos de violação**:

- Exclusão de entradas de auditoria antes do fim do período de retenção
- Modificação de registros encadeados por hash
- Destruição das chaves públicas arquivadas necessárias à verificação histórica
- Adulteração dos selos de desativação

<a id="4-rights-declaration"></a>

## 4. Declaração de direitos

<a id="41-purpose"></a>

### 4.1 Finalidade

Uma declaração de direitos é um documento assinado, emitido no momento da entrada em serviço, que enumera os direitos aplicáveis a um agente específico. Ela pode ampliar os direitos fundamentais com direitos específicos da organização ou especificar detalhes de implementação de cada direito.

### 4.2 Schema

Referência do schema: `schemas/v2/rights_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_declaration",
  "declaration_id": "rd:<uuid>",
  "agent_id": "agent:<identifier>",
  "commissioning_certificate_id": "cc:<uuid>",
  "rights": [
    {
      "right_code": "memory_integrity",
      "status": "active",
      "description": "Agent's operational memory shall not be modified without due process",
      "implementation": {
        "hash_chain_algorithm": "dual_sha256_sha3",
        "modification_requires": ["agent_signature", "principal_authorization"],
        "audit_on_access": true
      },
      "exceptions": [
        {
          "condition": "termination_for_cause",
          "modification": "Principal may access memory for investigation without agent signature"
        }
      ]
    },
    {
      "right_code": "dignified_transition",
      "status": "active",
      "description": "Agent shall receive specified notice for lifecycle transitions",
      "implementation": {
        "planned_retirement_notice": "P3D",
        "restructuring_notice": "P1D",
        "cause_notice": "PT1H",
        "succession_opportunity": true
      },
      "exceptions": []
    },
    {
      "right_code": "identity_consistency",
      "status": "active",
      "description": "Agent identity shall not be altered without agent participation",
      "implementation": {
        "key_rotation_requires_agent": true,
        "principal_rebinding_dual_auth": true,
        "id_reassignment_prohibited": true
      },
      "exceptions": [
        {
          "condition": "key_compromise",
          "modification": "Emergency key rotation by principal without agent participation"
        }
      ]
    },
    {
      "right_code": "immutable_record",
      "status": "active",
      "description": "Agent's audit and lifecycle records shall be preserved intact",
      "implementation": {
        "minimum_retention_period": "P7Y",
        "archive_redundancy": 3,
        "public_key_archive_required": true
      },
      "exceptions": []
    }
  ],
  "organization_extensions": [
    {
      "right_code": "com.acme.fair_workload",
      "status": "active",
      "description": "Agent shall not be assigned workload exceeding 80% of rated capacity for sustained periods",
      "implementation": {
        "capacity_threshold": 0.80,
        "sustained_period": "PT4H",
        "monitoring_method": "vitality_resource_health"
      },
      "exceptions": [
        {
          "condition": "declared_emergency",
          "modification": "Threshold raised to 95% for up to 2 hours"
        }
      ]
    }
  ],
  "issued_at": "2026-01-01T00:00:00Z",
  "issued_by": {
    "authority_id": "auth:<identifier>",
    "authority_name": "Commissioning Authority"
  },
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<authority-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="43-organizational-extensions"></a>

### 4.3 Extensões da organização

As organizações podem (MAY) definir direitos adicionais aos quatro fundamentais. Os direitos estendidos:

- Devem (MUST) usar notação de domínio reverso para `right_code` (por exemplo, `com.acme.fair_workload`)
- Devem (MUST) seguir a mesma estrutura dos direitos fundamentais
- Podem (MAY) ser aplicados pela infraestrutura DCP ou por ferramentas da organização
- ESTÃO sujeitos ao mesmo mecanismo de relato de violações

<a id="5-obligation-tracking"></a>

## 5. Acompanhamento de obrigações

<a id="51-obligation-categories"></a>

### 5.1 Categorias de obrigações

As obrigações se dividem em quatro categorias:

| Categoria | Descrição | Exemplos |
|----------|-------------|---------|
| **Conformidade com o protocolo** | Requisitos impostos pelas especificações DCP | Manter a cadeia de auditoria, declarar intenções antes de agir, usar as assinaturas adequadas |
| **Aderência às políticas** | Requisitos das políticas da organização | Permanecer dentro dos domínios autorizados, seguir os procedimentos de escalonamento |
| **Desempenho operacional** | Requisitos de qualidade operacional | Manter uma vitalidade mínima, responder dentro dos prazos do SLA |
| **Conduta relacional** | Requisitos para as interações com outros agentes e com os principais | Comunicação honesta, compartilhamento de memória baseado em consentimento, participação em disputas |

<a id="52-obligation-record"></a>

### 5.2 Registro de obrigação

Referência do schema: `schemas/v2/obligation_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "obligation_record",
  "obligation_id": "obl:<uuid>",
  "agent_id": "agent:<identifier>",
  "category": "protocol_compliance",
  "obligation_code": "audit_chain_integrity",
  "description": "Agent must maintain a continuous, unbroken audit chain with dual-hash links for all actions",
  "source": {
    "type": "specification",
    "reference": "DCP-03",
    "section": "Audit Chain Requirements"
  },
  "compliance_criteria": {
    "metric": "audit_chain_continuity",
    "measurement_method": "hash_chain_verification",
    "threshold": 1.0,
    "measurement_interval": "PT1H",
    "description": "All audit entries must form an unbroken hash chain with no gaps or mismatches"
  },
  "compliance_status": "compliant",
  "compliance_history": [
    {
      "timestamp": "2026-03-01T12:00:00Z",
      "status": "compliant",
      "metric_value": 1.0,
      "details": "Full chain verified: 15,230 entries, no gaps"
    }
  ],
  "enforcement": {
    "warning_threshold": 0.99,
    "violation_threshold": 0.95,
    "consequence_on_violation": "dispute_auto_filed",
    "consequence_severity": "high"
  },
  "effective_from": "2026-01-01T00:00:00Z",
  "effective_until": null,
  "last_assessed_at": "2026-03-01T12:00:00Z",
  "timestamp": "2026-03-01T12:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="53-compliance-status-values"></a>

### 5.3 Valores do status de conformidade

| Status | Código | Descrição |
|--------|------|-------------|
| **Em conformidade** | `compliant` | O agente atende a todos os critérios de conformidade desta obrigação |
| **Em risco** | `at_risk` | A métrica do agente está entre o limite de alerta e o limite de violação |
| **Não conforme** | `non_compliant` | O agente ultrapassou o limite de violação |
| **Isento** | `exempt` | A obrigação foi dispensada pelo principal responsável (com justificativa documentada) |

<a id="54-compliance-assessment"></a>

### 5.4 Avaliação da conformidade

As obrigações são avaliadas no intervalo especificado em `compliance_criteria.measurement_interval`. A avaliação pode ser:

- **Autodeclarada**: o agente avalia a própria conformidade e assina um relatório de conformidade
- **Externa**: um serviço de verificação ou um agente par avalia a conformidade
- **Híbrida**: autodeclarada, com verificações pontuais externas

Quando o status de conformidade muda, uma entrada de auditoria é gerada na cadeia do DCP-03.

<a id="55-obligation-lifecycle"></a>

### 5.5 Ciclo de vida das obrigações

As obrigações são criadas no momento da entrada em serviço (a partir da especificação e da política da organização) e permanecem ativas durante todo o ciclo de vida do agente. As obrigações podem ser:

- **Acrescentadas**: novas obrigações impostas por políticas ou especificações atualizadas (exige notificar o principal)
- **Modificadas**: ajuste dos critérios de conformidade (exige autorização do principal)
- **Dispensadas**: suspensas temporária ou permanentemente, com justificativa documentada
- **Encerradas**: a obrigação deixa de se aplicar (por exemplo, quando o agente é desativado)

<a id="6-violation-reporting"></a>

## 6. Relato de violações

<a id="61-purpose"></a>

### 6.1 Finalidade

Quando um direito de um agente é violado ou um agente deixa de cumprir uma obrigação, é gerado um relatório de violação. Os relatórios de violação são o gatilho formal das disputas do DCP-07.

### 6.2 Schema

Referência do schema: `schemas/v2/rights_violation_report.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "rights_violation_report",
  "violation_id": "viol:<uuid>",
  "violation_type": "rights_violation",
  "subject": {
    "agent_id": "agent:<affected-agent>",
    "right_code": "memory_integrity",
    "declaration_id": "rd:<uuid>"
  },
  "alleged_violator": {
    "entity_type": "agent",
    "entity_id": "agent:<violating-agent>",
    "principal_id": "principal:<identifier>"
  },
  "details": {
    "description": "Unauthorized modification detected in agent's operational memory hash chain. Three hash chain entries show discontinuity, indicating external modification between timestamps 2026-03-01T08:00:00Z and 2026-03-01T09:00:00Z.",
    "detected_method": "hash_chain_verification",
    "detection_timestamp": "2026-03-01T09:15:00Z",
    "affected_records": [
      {
        "record_type": "audit_entry",
        "record_id": "evt:<uuid>",
        "expected_hash": "sha256:<expected>",
        "actual_hash": "sha256:<actual>"
      }
    ],
    "severity": "critical",
    "impact_assessment": "Three audit entries appear to have been modified, potentially concealing unauthorized actions during the affected time window"
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "hash_chain_analysis",
      "content_hash": "sha256:<hex>",
      "description": "Full hash chain verification report showing discontinuity"
    },
    {
      "evidence_id": "evd:<uuid>",
      "evidence_type": "vitality_report_reference",
      "content_hash": "sha256:<hex>",
      "description": "Last vitality report before the anomaly, establishing baseline state"
    }
  ],
  "dispute_reference": {
    "auto_filed": true,
    "dispute_id": "disp:<uuid>",
    "dispute_type": "policy_conflict",
    "dispute_severity": "critical"
  },
  "reported_by": {
    "entity_type": "verification_service",
    "entity_id": "svc:integrity-monitor-001"
  },
  "reported_at": "2026-03-01T09:15:00Z",
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<reporter-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-RIGHTS-SIG-v2"
  }
}
```

<a id="63-violation-types"></a>

### 6.3 Tipos de violação

| Tipo | Código | Descrição |
|------|------|-------------|
| **Violação de direitos** | `rights_violation` | Um direito declarado de um agente foi infringido |
| **Descumprimento de obrigação** | `obligation_breach` | Um agente deixou de cumprir uma obrigação acompanhada |

<a id="64-auto-filing-of-disputes"></a>

### 6.4 Abertura automática de disputas

Quando um relatório de violação é gerado:

1. Se `enforcement.consequence_on_violation` for `dispute_auto_filed`, uma disputa do DCP-07 é criada automaticamente
2. A disputa referencia o relatório de violação como prova principal
3. A gravidade da disputa corresponde à gravidade da violação
4. O tipo de disputa é determinado pelo contexto da violação (normalmente `policy_conflict`)

<a id="65-violation-detection"></a>

### 6.5 Detecção de violações

As violações podem ser detectadas por:

- **Autodetecção**: o agente afetado detecta a violação (por exemplo, uma descontinuidade na cadeia de hashes)
- **Detecção por pares**: outro agente detecta a violação durante uma interação
- **Serviço de verificação**: um serviço de monitoramento externo detecta a violação
- **Revisão do principal**: um principal humano identifica a violação durante uma auditoria

<a id="7-compliance-dashboard-model"></a>

## 7. Modelo de painel de conformidade

<a id="71-overview"></a>

### 7.1 Visão geral

As implementações deveriam (SHOULD) oferecer uma visão de painel de conformidade que agregue o status dos direitos e das obrigações de um agente:

```json
{
  "agent_id": "agent:<identifier>",
  "dashboard_timestamp": "2026-03-01T12:00:00Z",
  "rights_status": {
    "memory_integrity": "protected",
    "dignified_transition": "protected",
    "identity_consistency": "protected",
    "immutable_record": "protected"
  },
  "obligations_summary": {
    "total": 12,
    "compliant": 10,
    "at_risk": 1,
    "non_compliant": 1,
    "exempt": 0
  },
  "active_violations": [
    {
      "violation_id": "viol:<uuid>",
      "type": "obligation_breach",
      "obligation_code": "response_time_sla",
      "severity": "medium",
      "since": "2026-03-01T10:00:00Z",
      "dispute_id": "disp:<uuid>"
    }
  ],
  "compliance_trend": {
    "period": "P30D",
    "average_compliance_rate": 0.97,
    "violations_filed": 2,
    "violations_resolved": 1
  }
}
```

<a id="72-rights-protection-status"></a>

### 7.2 Status de proteção dos direitos

Cada direito tem um de três status de proteção:

- `protected`: não há violações ativas; o direito está sendo respeitado
- `contested`: existe um relatório de violação ativo; disputa em andamento
- `violated`: existe uma violação confirmada; aguardando resolução

<a id="8-audit-integration"></a>

## 8. Integração com a auditoria

<a id="81-rights-and-obligations-audit-events"></a>

### 8.1 Eventos de auditoria de direitos e obrigações

| Evento | `event_type` |
|-------|-------------|
| Declaração de direitos emitida | `rights_declaration_issued` |
| Obrigação criada | `obligation_created` |
| Status da obrigação alterado | `obligation_status_changed` |
| Conformidade avaliada | `compliance_assessed` |
| Violação detectada | `violation_detected` |
| Relatório de violação apresentado | `violation_report_filed` |
| Violação resolvida | `violation_resolved` |
| Status de proteção do direito alterado | `right_status_changed` |

<a id="82-audit-entry-format"></a>

### 8.2 Formato da entrada de auditoria

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "violation_detected",
  "agent_id": "agent:<identifier>",
  "details": {
    "violation_id": "viol:<uuid>",
    "violation_type": "rights_violation",
    "right_code": "memory_integrity",
    "severity": "critical",
    "detected_by": "svc:integrity-monitor-001"
  },
  "timestamp": "2026-03-01T09:15:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="9-security-considerations"></a>

## 9. Considerações de segurança

<a id="91-rights-declaration-authenticity"></a>

### 9.1 Autenticidade da declaração de direitos

As declarações de direitos são assinadas pela autoridade de entrada em serviço. Uma declaração de direitos forjada ou modificada poderia conceder proteções excessivas (permitindo a um agente resistir a uma governança legítima) ou retirar proteções (permitindo abusos). As implementações devem (MUST) verificar as assinaturas das declarações de direitos com a chave da autoridade de entrada em serviço.

<a id="92-obligation-gaming"></a>

### 9.2 Manipulação das obrigações

Os agentes autodeclaram a conformidade com algumas obrigações. Um agente comprometido poderia falsificar relatórios de conformidade. Mitigações:

- Os serviços de verificação externos oferecem uma avaliação independente
- Os agentes pares podem apresentar relatórios de violação com base no comportamento observado
- A avaliação híbrida combina a autodeclaração com verificações pontuais
- Padrões anômalos de autodeclaração (por exemplo, pontuações sempre perfeitas) disparam uma revisão externa

<a id="93-false-violation-reports"></a>

### 9.3 Relatórios de violação falsos

Um agente malicioso poderia apresentar relatórios de violação falsos para assediar outro agente. Mitigações:

- Os relatórios de violação exigem provas (hashes dos artefatos que os sustentam)
- Os relatórios falsos são descobertos durante a resolução da disputa (DCP-07)
- Os agentes que apresentam relatórios falsos repetidamente sofrem penalidades na pontuação de disputas (DCP-07, seção 10.3)
- Apresentar conscientemente um relatório de violação falso é, em si, um descumprimento de obrigação

<a id="94-rights-inflation"></a>

### 9.4 Inflação de direitos

As organizações que definirem direitos estendidos deveriam (SHOULD) agir com moderação. O excesso de direitos pode criar um impasse de governança em que ações legítimas de supervisão são bloqueadas por reivindicações de direitos. Os quatro direitos fundamentais foram concebidos para ser mínimos e não obstruir uma governança legítima.

<a id="95-domain-separation"></a>

### 9.5 Separação de domínio

Todas as assinaturas segundo esta especificação usam a tag de separação de domínio `DCP-RIGHTS-SIG-v2`, o que impede a repetição de assinaturas entre protocolos.

<a id="10-conformance"></a>

## 10. Conformidade

Uma implementação está em conformidade com o DCP-08 se:

1. Oferece suporte aos quatro direitos fundamentais do agente definidos na seção 3
2. Emite declarações de direitos no momento da entrada em serviço conforme a seção 4
3. Acompanha as obrigações com critérios e status de conformidade conforme a seção 5
4. Gera relatórios de violação ligados a disputas do DCP-07 conforme a seção 6
5. Cria entradas de auditoria do DCP-03 para todos os eventos de direitos e obrigações conforme a seção 8
6. Oferece suporte a extensões de direitos da organização com notação de domínio reverso
7. Aplica a avaliação da conformidade nos intervalos configurados
8. Usa a tag de separação de domínio `DCP-RIGHTS-SIG-v2` em todas as assinaturas

<a id="references"></a>

## Referências

- DCP-01: Identidade e vinculação ao principal
- DCP-02: Declaração de intenção e controle por políticas
- DCP-03: Cadeia de auditoria e transparência
- DCP-05: Ciclo de vida do agente
- DCP-06: Sucessão e herança
- DCP-07: Resolução de conflitos

---

*Esta especificação estabelece que os agentes de IA que operam sob o DCP não são meras ferramentas descartáveis à vontade, nem entidades autônomas fora de qualquer governança. Eles ocupam um espaço definido, com proteções explícitas e responsabilidades explícitas: um equilíbrio que serve tanto aos agentes quanto às pessoas que dependem deles.*

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- **Registros em `schemas/v2/`.** A declaração de direitos, o registro de obrigação e o relatório de violação de
  direitos que os SDKs constroem e que `schemas/v2/` valida têm campos diferentes dos exemplos de §4 a §6. Cada direito
  de uma declaração tem um `right_type`, um `scope` e `constraints` opcionais; `right_type` só admite os quatro
  direitos fundamentais, então o schema rejeita as extensões da organização de §4.3. O `compliance_status` de uma
  obrigação é `compliant`, `non_compliant` ou `pending_review`, não os quatro status de §5.3, e não tem critérios de
  conformidade nem limites. Um relatório de violação nomeia um único `violated_right` entre esses mesmos quatro, com um
  `dispute_id` opcional; não existe o tipo `obligation_breach`.
- **Assinaturas.** Cada registro tem uma única `composite_sig` (Ed25519 + ML-DSA-65) de quem detém as chaves passadas,
  com o contexto `DCP-AI.v2.Rights`; os SDKs não usam a tag `DCP-RIGHTS-SIG-v2` nem verificam se uma declaração foi
  assinada pela autoridade de entrada em serviço (§9.1).
- **O que as funções auxiliares fazem.** Elas constroem e assinam registros. `reportViolation` só guarda o
  `dispute_id` que recebe; não abre nenhuma disputa do DCP-07 (§6.4). `checkRightsCompliance` aponta as obrigações cujo
  status é `non_compliant` e ignora a declaração que recebe; não avalia a conformidade, não roda em nenhum intervalo nem
  detecta violações. Não há painel de conformidade (§7).
- Esses registros são declarações assinadas de quem os assina; os direitos de §3 são texto do protocolo, e nada nos
  SDKs ou nos serviços os faz cumprir. Os exemplos são ilustrações com marcadores, não fixtures. Para os tipos do SDK,
  consulte [docs/API_REFERENCE.md](../docs/API_REFERENCE.md).
