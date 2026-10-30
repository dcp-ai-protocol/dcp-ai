<sub>[English](../../../spec/DCP-06.md) · [中文](../../zh-CN/spec/DCP-06.md) · [Español](../../es/spec/DCP-06.md) · [日本語](../../ja/spec/DCP-06.md) · **Português**</sub>

<a id="dcp-06-succession--inheritance"></a>
<a id="dcp-06-succession-inheritance"></a>

# DCP-06: Sucessão e herança

> Tradução informativa da [especificação em inglês](../../../spec/DCP-06.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

## Status
Publicada — v2.0 (extensão; as revisões são acompanhadas conforme o retorno de quem a adota)

<a id="abstract"></a>

## Resumo
Esta especificação define os mecanismos com que agentes de IA se preparam para a sucessão e a executam: a transferência ordenada de responsabilidades, contexto operacional e conhecimento relacional de um agente para seu sucessor. Ela introduz testamentos digitais, cerimônias de sucessão e manifestos de transferência de memória, todos assinados criptograficamente e encadeados por hash. O protocolo garante a continuidade do serviço e preserva a fronteira de identidade entre o agente predecessor e o sucessor.

**Dependência**: esta especificação requer o DCP-05 (Ciclo de vida do agente). Os eventos de sucessão são disparados por transições de estado do ciclo de vida, e os registros de desativação referenciam os resultados da sucessão.

<a id="1-introduction"></a>

## 1. Introdução

Quando um agente de IA chega ao fim do seu ciclo de vida (DCP-05), o conhecimento operacional acumulado, as relações estabelecidas e os compromissos em andamento não simplesmente desaparecem. As organizações precisam de um protocolo formal para transferir o contexto relevante de um agente que se aposenta para seu sucessor, mantendo a integridade criptográfica dos registros dos dois agentes.

O DCP-06 trata de três desafios fundamentais:

1. **Continuidade**: garantir que um agente sucessor possa retomar as responsabilidades do predecessor sem interrupção
2. **Integridade**: preservar a fronteira criptográfica entre predecessor e sucessor; um sucessor é uma entidade nova, não uma continuação da anterior
3. **Seletividade**: nem todo conhecimento deve ser transferido; parte do contexto operacional é efêmera, parte é sensível e parte está fortemente ligada à identidade do predecessor

<a id="11-design-principles"></a>

### 1.1 Princípios de design
- Um agente sucessor é sempre uma identidade distinta, com sua própria vinculação DCP-01
- A transferência de memória é seletiva: o predecessor (ou seu principal) controla o que é transferido
- Os testamentos digitais têm versões e são encadeados por hash; prevalece a versão mais recente
- As cerimônias de sucessão produzem um registro assinado e auditável da transferência
- Três tipos de cerimônia atendem a diferentes níveis de urgência: planejada, forçada e de emergência

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relação com outras especificações
- **DCP-01**: os agentes sucessores têm suas próprias vinculações de identidade; eles não herdam a identidade do predecessor
- **DCP-03**: todos os eventos de sucessão são registrados nas cadeias de auditoria dos dois agentes
- **DCP-04**: as sessões A2A ativas do predecessor não são transferidas; o sucessor precisa estabelecer novas sessões
- **DCP-05**: a sucessão é disparada por transições do ciclo de vida; o registro de desativação referencia o resultado da sucessão

<a id="2-terminology"></a>

## 2. Terminologia

**Testamento digital**: um documento assinado e com versões que um agente prepara durante sua vida ativa, declarando suas preferências de sucessão, a classificação de sua memória e suas instruções de transferência. Equivale a um testamento.

**Cerimônia de sucessão**: o processo formal de transferir responsabilidades de um predecessor para um sucessor, envolvendo verificação, autorização e transferência de memória.

**Transferência de memória**: a transmissão seletiva de contexto operacional do predecessor para o sucessor, regida pelo testamento digital e pela política da organização.

**Predecessor**: o agente que está sendo desativado ou cujas responsabilidades estão sendo transferidas.

**Sucessor**: o agente que recebe as responsabilidades e o contexto operacional selecionado do predecessor.

**Classificação da memória**: um sistema de categorias para o conhecimento acumulado de um agente: `operational`, `relational`, `ephemeral` ou `restricted`.

**Tag de separação de domínio**: `DCP-SUCCESSION-SIG-v2`, usada em todas as assinaturas produzidas segundo esta especificação.

<a id="3-digital-testament"></a>

## 3. Testamento digital

<a id="31-purpose"></a>

### 3.1 Finalidade

Um testamento digital é a declaração de um agente sobre como suas responsabilidades e seu conhecimento devem ser tratados na desativação. Os agentes deveriam (SHOULD) criar e manter um testamento digital durante todo o ciclo de vida ativo. Os testamentos têm versões; cada nova versão substitui a anterior.

### 3.2 Schema

Referência do schema: `schemas/v2/digital_testament.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "digital_testament",
  "testament_id": "dt:<uuid>",
  "agent_id": "agent:<identifier>",
  "version": 3,
  "status": "active",
  "succession_preferences": {
    "preferred_successor_id": "agent:<identifier>",
    "alternate_successor_ids": [
      "agent:<alternate-1>",
      "agent:<alternate-2>"
    ],
    "successor_requirements": {
      "minimum_capabilities": ["negotiate", "purchase_order"],
      "minimum_security_tier": "elevated",
      "minimum_vitality": 800,
      "same_organization_required": true,
      "same_jurisdiction_required": false
    },
    "succession_mode_preferences": {
      "planned_retirement": "full_transfer",
      "termination_for_cause": "restricted_transfer",
      "organizational_restructuring": "full_transfer",
      "sudden_failure": "emergency_transfer"
    }
  },
  "memory_classification": {
    "operational": {
      "description": "Task-specific knowledge, procedures, and workflows",
      "transfer_policy": "transfer",
      "retention_after_transfer": "archive_7y",
      "items": [
        {
          "category": "workflow_procedures",
          "description": "Standard procurement workflows for vendor management",
          "data_reference": "mem:operational:workflows:001",
          "size_bytes": 524288,
          "classification": "operational",
          "transfer_priority": "high"
        }
      ]
    },
    "relational": {
      "description": "Knowledge about relationships with other agents and entities",
      "transfer_policy": "transfer_with_consent",
      "retention_after_transfer": "archive_3y",
      "items": [
        {
          "category": "agent_interaction_history",
          "description": "Interaction patterns and trust assessments for known agents",
          "data_reference": "mem:relational:interactions:001",
          "size_bytes": 131072,
          "classification": "relational",
          "transfer_priority": "medium"
        }
      ]
    },
    "ephemeral": {
      "description": "Temporary context that does not survive succession",
      "transfer_policy": "do_not_transfer",
      "retention_after_transfer": "purge",
      "items": [
        {
          "category": "active_session_state",
          "description": "Current in-flight session data",
          "data_reference": "mem:ephemeral:sessions:001",
          "size_bytes": 65536,
          "classification": "ephemeral",
          "transfer_priority": "none"
        }
      ]
    },
    "restricted": {
      "description": "Sensitive knowledge that requires principal authorization to transfer",
      "transfer_policy": "principal_approval_required",
      "retention_after_transfer": "archive_7y_encrypted",
      "items": [
        {
          "category": "security_observations",
          "description": "Anomaly patterns and security-relevant observations",
          "data_reference": "mem:restricted:security:001",
          "size_bytes": 32768,
          "classification": "restricted",
          "transfer_priority": "low"
        }
      ]
    }
  },
  "final_messages": [
    {
      "recipient_type": "principal",
      "recipient_id": "principal:<identifier>",
      "message": "Summary of unresolved items requiring human attention"
    },
    {
      "recipient_type": "agent",
      "recipient_id": "agent:<successor-identifier>",
      "message": "Key operational notes for successor"
    }
  ],
  "created_at": "2026-01-15T00:00:00Z",
  "updated_at": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hex of previous testament version>",
  "prev_hash_secondary": "sha3-256:<hex of previous testament version>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="33-testament-versioning"></a>

### 3.3 Versões do testamento

Cada atualização do testamento incrementa o campo `version`. As versões do testamento formam uma cadeia de hashes: o `prev_hash` de cada versão referencia o hash da versão anterior. O testamento gênese (versão 1) usa hashes nulos.

Somente a versão mais recente é operante. As versões anteriores são mantidas para fins de auditoria. Se for constatado que um testamento foi adulterado (cadeia de hashes rompida), a sucessão recorre a uma transferência dirigida pelo principal.

<a id="34-transfer-policies"></a>

### 3.4 Políticas de transferência

| Política | Código | Descrição |
|--------|------|-------------|
| **Transferir** | `transfer` | Os itens de memória são transferidos ao sucessor incondicionalmente |
| **Transferir com consentimento** | `transfer_with_consent` | A transferência exige o consentimento explícito das contrapartes afetadas |
| **Exige aprovação do principal** | `principal_approval_required` | A transferência exige a aprovação explícita do principal responsável |
| **Não transferir** | `do_not_transfer` | Os itens de memória nunca são transferidos; são expurgados ou arquivados |

<a id="4-succession-ceremony"></a>

## 4. Cerimônia de sucessão

<a id="41-overview"></a>

### 4.1 Visão geral

Uma cerimônia de sucessão é o processo formal de transferir responsabilidades do predecessor para o sucessor. Três tipos atendem a diferentes níveis de urgência:

| Tipo | Código | Gatilho | Duração |
|------|------|---------|----------|
| **Planejada** | `planned` | Aposentadoria planejada ou reestruturação organizacional | De horas a dias |
| **Forçada** | `forced` | Encerramento por justa causa | De minutos a horas |
| **De emergência** | `emergency` | Falha súbita | De segundos a minutos |

<a id="42-planned-succession"></a>

### 4.2 Sucessão planejada

O processo de transição ordenado:

1. **Início**: o predecessor (ou seu principal) declara a intenção de sucessão, referenciando o testamento digital
2. **Verificação do sucessor**: a identidade, as capacidades e a vitalidade do sucessor são verificadas em relação aos requisitos do testamento
3. **Autorização**: o principal responsável autoriza a sucessão
4. **Operação em paralelo** (opcional): predecessor e sucessor operam simultaneamente durante uma janela de transição, permitindo ao sucessor observar e aprender
5. **Transferência de memória**: a memória operacional e relacional é transferida conforme a classificação do testamento
6. **Notificação das contrapartes**: os agentes que interagiram com o predecessor são notificados da sucessão por meio do DCP-04
7. **Confirmação da passagem**: o sucessor confirma o recebimento e a prontidão operacional
8. **Selagem**: o registro de sucessão é criado e assinado pelos dois agentes e pelo principal

<a id="43-forced-succession"></a>

### 4.3 Sucessão forçada

Processo abreviado para o encerramento por justa causa:

1. **Início**: o principal ou a autoridade da organização ordena a sucessão
2. **Verificação do sucessor**: o sucessor é verificado (entre os suplentes do testamento ou designado pelo principal)
3. **Transferência restrita**: só a memória `operational` com a política `transfer` é transferida; a memória `relational` e `restricted` exige a aprovação explícita do principal
4. **Passagem imediata**: sem período de operação em paralelo
5. **Selagem**: o registro de sucessão é criado; o registro de desativação do predecessor anota o caráter forçado

<a id="44-emergency-succession"></a>

### 4.4 Sucessão de emergência

Processo mínimo para uma falha súbita:

1. **Detecção**: o sistema de monitoramento ou um agente par detecta a falha do predecessor (DCP-05, seção 7.5)
2. **Notificação do principal**: o principal responsável é alertado
3. **Ativação do sucessor**: se houver um sucessor preferido disponível, ele é ativado imediatamente; caso contrário, o principal designa um
4. **Transferência na medida do possível**: a memória é transferida a partir dos backups ou do estado replicado disponíveis; o predecessor não pode participar
5. **Verificação da recuperação**: o sucessor valida a integridade dos dados transferidos usando as raízes de Merkle do último relatório de vitalidade conhecido do predecessor
6. **Selagem**: o registro de sucessão é criado pelo principal e pelo sucessor (o predecessor não pode assinar)

<a id="45-succession-record"></a>

### 4.5 Registro de sucessão

Referência do schema: `schemas/v2/succession_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "succession_record",
  "succession_id": "sr:<uuid>",
  "ceremony_type": "planned",
  "predecessor": {
    "agent_id": "agent:<predecessor-identifier>",
    "final_vitality": 720,
    "lifecycle_state_at_succession": "declining",
    "decommission_id": "dc:<uuid>",
    "testament_id": "dt:<uuid>",
    "testament_version": 3,
    "testament_hash": "sha256:<hex>"
  },
  "successor": {
    "agent_id": "agent:<successor-identifier>",
    "vitality_at_succession": 980,
    "lifecycle_state_at_succession": "active",
    "commissioning_certificate_id": "cc:<uuid>"
  },
  "authorized_by": {
    "principal_id": "principal:<identifier>",
    "authorization_timestamp": "2026-03-01T00:00:00Z"
  },
  "memory_transfer": {
    "manifest_id": "mtm:<uuid>",
    "items_transferred": 12,
    "items_skipped": 5,
    "items_failed": 0,
    "total_bytes_transferred": 1048576,
    "transfer_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    },
    "transfer_verified": true
  },
  "counterparties_notified": [
    {
      "agent_id": "agent:<counterparty-1>",
      "notification_status": "acknowledged"
    },
    {
      "agent_id": "agent:<counterparty-2>",
      "notification_status": "pending"
    }
  ],
  "parallel_operation_window": {
    "start": "2026-02-28T00:00:00Z",
    "end": "2026-03-01T00:00:00Z"
  },
  "ceremony_started_at": "2026-02-28T00:00:00Z",
  "ceremony_completed_at": "2026-03-01T01:00:00Z",
  "timestamp": "2026-03-01T01:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="5-memory-transfer"></a>

## 5. Transferência de memória

<a id="51-memory-classification"></a>

### 5.1 Classificação da memória

A memória do agente é classificada em quatro categorias, cada uma com uma semântica de transferência diferente:

| Classificação | Descrição | Política de transferência padrão |
|---------------|-------------|------------------------|
| **Operacional** | Conhecimento específico das tarefas: fluxos de trabalho, procedimentos, heurísticas de decisão, modelos de domínio | `transfer` |
| **Relacional** | Conhecimento sobre relações: históricos de interação, avaliações de confiança, preferências de comunicação das contrapartes | `transfer_with_consent` |
| **Efêmera** | Estado temporário: sessões ativas, transações em andamento, cache de curto prazo | `do_not_transfer` |
| **Restrita** | Conhecimento sensível: observações de segurança, padrões de vulnerabilidade, registros de acesso privilegiado | `principal_approval_required` |

<a id="52-memory-transfer-manifest"></a>

### 5.2 Manifesto de transferência de memória

Referência do schema: `schemas/v2/memory_transfer_manifest.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "memory_transfer_manifest",
  "manifest_id": "mtm:<uuid>",
  "succession_id": "sr:<uuid>",
  "predecessor_agent_id": "agent:<predecessor>",
  "successor_agent_id": "agent:<successor>",
  "transfer_items": [
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:operational:workflows:001",
      "classification": "operational",
      "transfer_policy": "transfer",
      "transfer_status": "completed",
      "size_bytes": 524288,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:30:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:relational:interactions:001",
      "classification": "relational",
      "transfer_policy": "transfer_with_consent",
      "transfer_status": "completed",
      "consent_records": [
        {
          "counterparty_id": "agent:<counterparty>",
          "consent_given": true,
          "consent_timestamp": "2026-02-28T20:00:00Z"
        }
      ],
      "size_bytes": 131072,
      "content_hash": {
        "sha256": "<hex>",
        "sha3_256": "<hex>"
      },
      "encrypted": true,
      "encryption_alg": "aes-256-gcm",
      "transfer_timestamp": "2026-03-01T00:35:00Z"
    },
    {
      "item_id": "mti:<uuid>",
      "data_reference": "mem:ephemeral:sessions:001",
      "classification": "ephemeral",
      "transfer_policy": "do_not_transfer",
      "transfer_status": "skipped",
      "reason": "ephemeral_policy"
    }
  ],
  "transfer_merkle_root": {
    "sha256": "<hex over all transferred item content_hashes>",
    "sha3_256": "<hex>"
  },
  "summary": {
    "total_items": 17,
    "transferred": 12,
    "skipped": 5,
    "failed": 0,
    "total_bytes": 1048576
  },
  "transfer_started_at": "2026-03-01T00:15:00Z",
  "transfer_completed_at": "2026-03-01T00:45:00Z",
  "timestamp": "2026-03-01T00:45:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "predecessor_signature": {
    "alg": "ed25519",
    "kid": "<predecessor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  },
  "successor_signature": {
    "alg": "ed25519",
    "kid": "<successor-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-SUCCESSION-SIG-v2"
  }
}
```

<a id="53-merkle-root-verification"></a>

### 5.3 Verificação da raiz de Merkle

`transfer_merkle_root` é calculada como uma árvore de Merkle de hash duplo (SHA-256 + SHA3-256) sobre os valores `content_hash` de todos os itens transferidos com sucesso. Isso permite ao sucessor verificar que recebeu exatamente os itens listados no manifesto, sem que o predecessor precise estar disponível para uma nova verificação.

Construção:

1. Reunir os valores `content_hash.sha256` de todos os itens com `transfer_status: "completed"`, ordenados por `item_id`
2. Construir uma árvore de Merkle SHA-256; a raiz é `transfer_merkle_root.sha256`
3. Repetir com os valores `content_hash.sha3_256` para `transfer_merkle_root.sha3_256`

<a id="54-transfer-encryption"></a>

### 5.4 Cifragem da transferência

Todos os itens de memória transferidos devem (MUST) ser cifrados em trânsito com AES-256-GCM e uma chave de transferência de uso único derivada por:

```
transfer_key = HKDF-SHA256(
  salt = succession_id,
  ikm  = predecessor_private_key_contribution || successor_public_key_contribution,
  info = "DCP-AI.v2.Succession.TransferKey",
  len  = 32
)
```

Na sucessão de emergência, quando o predecessor não pode participar do acordo de chaves, o principal responsável fornece o material de chave.

<a id="55-consent-for-relational-memory"></a>

### 5.5 Consentimento para a memória relacional

Os itens de memória relacional (históricos de interação, avaliações de confiança de contrapartes específicas) exigem o consentimento da contraparte afetada antes da transferência. O fluxo de consentimento:

1. O predecessor (ou o principal, em emergência) envia uma solicitação de consentimento a cada contraparte afetada por meio do DCP-04
2. A contraparte responde com consentimento ou recusa
3. Só os itens consentidos são transferidos
4. Os registros de consentimento são incluídos no manifesto de transferência de memória
5. Se uma contraparte não puder ser contatada dentro da janela de sucessão, o item é ignorado

<a id="6-identity-boundary"></a>

## 6. Fronteira de identidade

<a id="61-principle"></a>

### 6.1 Princípio

Um agente sucessor é uma entidade nova e distinta. Ele NÃO herda do predecessor:

- O ID de agente
- As chaves criptográficas
- A vinculação de identidade DCP-01
- A cadeia de auditoria
- As sessões A2A

O sucessor recebe o contexto operacional selecionado, mas opera sob a própria identidade. Esse princípio é fundamental: a sucessão é uma transferência de responsabilidades e conhecimento, não uma transferência de identidade.

<a id="62-provenance-tracking"></a>

### 6.2 Rastreamento da proveniência

Quando um sucessor usa conhecimento recebido pela sucessão, ele deveria (SHOULD) incluir uma referência de proveniência nas entradas de auditoria pertinentes:

```json
{
  "provenance": {
    "source": "succession",
    "predecessor_agent_id": "agent:<predecessor>",
    "succession_id": "sr:<uuid>",
    "memory_item_id": "mti:<uuid>"
  }
}
```

Isso permite aos auditores rastrear como o conhecimento transferido influencia as decisões do sucessor.

<a id="7-security-considerations"></a>

## 7. Considerações de segurança

<a id="71-testament-tampering"></a>

### 7.1 Adulteração do testamento

Os testamentos digitais são encadeados por hash e assinados. Se a cadeia de hashes de um testamento estiver rompida, a sucessão deve (MUST) recorrer a uma transferência dirigida pelo principal, sem transferência automática de memória. O principal precisa autorizar explicitamente cada item transferido.

<a id="72-unauthorized-succession"></a>

### 7.2 Sucessão não autorizada

As cerimônias de sucessão exigem a autorização do principal. Um agente não pode declarar unilateralmente um sucessor nem iniciar a sucessão. O requisito de três assinaturas nos registros de sucessão (predecessor, sucessor e principal) garante que todas as partes consentem.

<a id="73-memory-exfiltration"></a>

### 7.3 Exfiltração de memória

A transferência de memória é um possível vetor de exfiltração de dados. Mitigações:

- Os itens transferidos são classificados e controlados por políticas
- Os itens restritos exigem a aprovação explícita do principal
- Os itens relacionais exigem o consentimento da contraparte
- Todas as transferências são cifradas e registradas
- O manifesto de transferência fornece um inventário completo e assinado

<a id="74-emergency-succession-risks"></a>

### 7.4 Riscos da sucessão de emergência

A sucessão de emergência opera com salvaguardas reduzidas por causa da pressão do tempo e da indisponibilidade do predecessor:

- Não há assinatura do predecessor no registro de sucessão
- Não há consentimento interativo para a memória relacional
- O estado da memória pode estar desatualizado (do último backup, não do estado atual)

Mitigações:

- O principal precisa autorizar explicitamente a sucessão de emergência
- O sucessor precisa verificar os dados transferidos em relação às últimas raízes de Merkle conhecidas do predecessor
- Uma auditoria pós-sucessão deveria (SHOULD) ser feita em até 24 horas

<a id="75-successor-impersonation"></a>

### 7.5 Personificação pelo sucessor

Um sucessor não deve (MUST NOT) se apresentar como o predecessor. As notificações das contrapartes (seção 4.2, passo 6) garantem que todos os agentes com que interage saibam da sucessão. As implementações deveriam (SHOULD) rejeitar interações em que um sucessor afirme ser o predecessor.

<a id="76-domain-separation"></a>

### 7.6 Separação de domínio

Todas as assinaturas segundo esta especificação usam a tag de separação de domínio `DCP-SUCCESSION-SIG-v2`, o que impede a repetição de assinaturas entre protocolos.

<a id="8-conformance"></a>

## 8. Conformidade

Uma implementação está em conformidade com o DCP-06 se:

1. Oferece suporte à criação de testamentos digitais e às suas versões encadeadas por hash conforme a seção 3
2. Implementa os três tipos de cerimônia de sucessão (planejada, forçada e de emergência) conforme a seção 4
3. Aplica a classificação da memória e as políticas de transferência conforme a seção 5
4. Calcula raízes de Merkle de hash duplo sobre os itens transferidos conforme a seção 5.3
5. Mantém a fronteira de identidade entre predecessor e sucessor conforme a seção 6
6. Exige a autorização do principal para todas as cerimônias de sucessão
7. Gera entradas de auditoria do DCP-03 para todos os eventos de sucessão
8. Usa a tag de separação de domínio `DCP-SUCCESSION-SIG-v2` em todas as assinaturas

<a id="references"></a>

## Referências

- DCP-01: Identidade e vinculação ao principal
- DCP-03: Cadeia de auditoria e transparência
- DCP-04: Comunicação entre agentes
- DCP-05: Ciclo de vida do agente
- RFC 5869: HKDF
- NIST SP 800-88: Guidelines for Media Sanitization

---

*Esta especificação reconhece que o conhecimento que um agente de IA acumula durante a vida tem valor além do próprio agente. A sucessão garante que esse valor seja preservado de uma geração para a seguinte, de forma seletiva, segura e com plena responsabilização.*

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- **Registros em `schemas/v2/`.** O testamento, o registro de sucessão e o manifesto de transferência de memória que os
  SDKs constroem e que `schemas/v2/` valida têm campos diferentes dos exemplos de §3 a §5: por exemplo,
  `testament_version` e `prev_testament_hash` (`GENESIS` na versão 1 e depois `sha256:` da versão anterior, somente
  SHA-256), uma `memory_classification` que associa a cada categoria `transfer`, `retain` ou `destroy`, e
  `transfer_hash` no manifesto. As quatro classificações e as quatro políticas de transferência de §3.4 e §5.1 não estão
  nos schemas.
- **Assinaturas.** Cada registro tem uma única `composite_sig` (Ed25519 + ML-DSA-65) de quem detém as chaves passadas,
  com o contexto `DCP-AI.v2.Succession`; os SDKs não usam a tag `DCP-SUCCESSION-SIG-v2` nem produzem as três
  assinaturas (predecessor, sucessor e principal) de §7.2.
- **O que as funções auxiliares fazem.** Elas constroem e assinam registros. `executeSuccession` só rejeita um
  `ceremony_participants` vazio; não executa nenhuma cerimônia, não verifica a autorização do principal, não verifica o
  sucessor nem move memória. `classifyMemory` separa as entradas pela disposição do testamento: `transfer` vai para o
  manifesto, `destroy` e as categorias que não estão no testamento são listadas como destruídas, e as entradas `retain`
  não aparecem em nenhuma das duas listas. `createMemoryTransferManifest` recebe `transfer_hash` de quem chama e não
  calcula a raiz de Merkle de §5.3. A cifragem, as solicitações de consentimento e a notificação das contrapartes
  (§5.4, §5.5, §4.2) ficam a cargo de quem chama.
- Esses registros são declarações assinadas de quem os assina. Os exemplos são ilustrações com marcadores, não
  fixtures. Para os tipos do SDK, consulte [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md).
