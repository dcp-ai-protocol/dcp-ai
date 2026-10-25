<sub>[English](DCP-09.md) · [中文](DCP-09.zh-CN.md) · [Español](DCP-09.es.md) · [日本語](DCP-09.ja.md) · **Português**</sub>

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

# DCP-09: Delegação e representação

> Tradução informativa da [especificação em inglês](DCP-09.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

## Status
Publicada — v2.0 (extensão; as revisões são acompanhadas conforme o retorno de quem a adota)

<a id="abstract"></a>

## Resumo
Esta especificação define o protocolo para a delegação de autoridade de uma pessoa a um agente, os limiares de consciência do agente, as declarações de alerta, os espelhos do principal e os registros de interação de duas camadas. Ela oferece mecanismos para que um principal humano delegue formalmente uma autoridade específica a um agente de IA, para que os agentes declarem como entendem o contexto delegado e para que as interações sejam registradas tanto em uma camada técnica quanto em uma camada legível por pessoas. O DCP-09 também estende o handshake A2A do DCP-04 para incluir a verificação do mandato de delegação, garantindo que os agentes que atuam em nome de principais possam comprovar sua autoridade às contrapartes.

<a id="1-introduction"></a>

## 1. Introdução

O DCP-01 estabelece que todo agente está vinculado a um principal responsável. No entanto, a natureza dessa vinculação (que autoridade o principal delegou, o que o agente entende sobre seu papel delegado e como o agente representa seu principal nas interações) não está especificada formalmente. O DCP-09 preenche essa lacuna.

Em sistemas multiagentes, os agentes frequentemente atuam em nome de principais humanos que não podem estar presentes em todas as interações. Um agente de compras negocia com agentes de fornecedores, um agente de conformidade revisa uma política em nome de um responsável de governança, um agente de pesquisa consulta fontes de dados em nome de uma pessoa cientista. Em cada caso, o agente exerce autoridade delegada, e o escopo e os limites dessa autoridade precisam ser explícitos, verificáveis e auditáveis.

O DCP-09 trata de cinco questões interligadas:

1. **Delegação**: como um principal concede formalmente autoridade a um agente
2. **Consciência**: como um agente declara seu entendimento do contexto delegado e de suas limitações
3. **Alerta**: como um agente comunica incerteza ou recomendações ao seu principal
4. **Representação**: como um agente apresenta os interesses do seu principal em forma legível por pessoas
5. **Registro de interações**: como as interações são capturadas tanto na camada técnica quanto na narrativa

<a id="11-design-principles"></a>

### 1.1 Princípios de design
- A delegação é explícita, delimitada e limitada no tempo
- Os agentes precisam declarar o que entendem, não só o que conseguem fazer
- Os principais humanos precisam poder revisar as ações do agente em linguagem natural
- As interações produzem registros de duas camadas: verificáveis por máquina e legíveis por pessoas
- Os mandatos de delegação podem ser verificados pelas contrapartes durante os handshakes A2A

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relação com outras especificações
- **DCP-01**: os mandatos de delegação estendem a vinculação ao principal com escopos de autoridade explícitos
- **DCP-02**: as declarações de intenção referenciam o mandato de delegação que autoriza a ação
- **DCP-03**: todos os eventos de delegação são registrados na cadeia de auditoria
- **DCP-04**: o handshake A2A é estendido para incluir a verificação do mandato
- **DCP-05**: os mandatos de delegação são revogados quando o agente é desativado
- **DCP-07**: podem surgir disputas por excesso da autoridade delegada
- **DCP-08**: os agentes têm a obrigação de agir dentro do escopo delegado

<a id="2-terminology"></a>

## 2. Terminologia

**Mandato de delegação**: um documento assinado por um principal humano que concede uma autoridade específica a um agente, com escopo, condições e validade definidos.

**Limiar de consciência**: uma declaração estruturada de um agente sobre o que entende e o que não entende do seu contexto delegado, que serve como mecanismo verificável de honestidade.

**Declaração de alerta**: uma comunicação formal de um agente ao seu principal, declarando incerteza, recomendando uma revisão humana ou sinalizando condições que podem exceder a competência delegada do agente.

**Espelho do principal**: uma representação narrativa, legível por pessoas, dos interesses, valores e prioridades do principal, tal como o agente os entende, que acompanha o agente nas interações.

**Registro de interação**: um registro de duas camadas de uma interação: uma camada técnica (verificável por máquina) e uma camada narrativa (legível por pessoas), ambas assinadas e encadeadas por hash.

**Cadeia de mandatos**: quando um agente delega um subconjunto da sua autoridade a outro agente, a cadeia de mandatos do principal humano original, passando pelos agentes intermediários, até o delegado final.

**Tags de separação de domínio**: `DCP-DELEGATION-SIG-v2` (registros de delegação e de interação), `DCP-AWARENESS-SIG-v2` (limiares de consciência e declarações de alerta), `DCP-AI.v2.SubMandate` (submandatos, seção 3.5).

<a id="3-delegation-mandate"></a>

## 3. Mandato de delegação

<a id="31-purpose"></a>

### 3.1 Finalidade

Um mandato de delegação é o instrumento formal pelo qual um principal humano concede autoridade a um agente de IA. Ele define o que o agente está autorizado a fazer, em que condições, com que limites e por quanto tempo. Sem um mandato de delegação válido, um agente não deve (MUST NOT) agir em nome de um principal além das suas capacidades básicas.

### 3.2 Schema

Referência do schema: `schemas/v2/delegation_mandate.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "delegation_mandate",
  "mandate_id": "dm:<uuid>",
  "mandate_hash": "sha256:<hex of the canonical form of this mandate>",
  "delegator": {
    "principal_id": "principal:<identifier>",
    "principal_name": "Dr. Sarah Chen",
    "organization_id": "org:<identifier>",
    "role": "Head of Procurement"
  },
  "delegate": {
    "agent_id": "agent:<identifier>",
    "agent_name": "Procurement Agent Alpha"
  },
  "authority": {
    "scope": "procurement",
    "permissions": [
      {
        "action": "negotiate",
        "resource_pattern": "vendor:*",
        "conditions": {
          "max_contract_value": 50000,
          "currency": "USD",
          "approved_vendors_only": true,
          "vendor_list_reference": "policy:approved-vendors-2026-q1"
        }
      },
      {
        "action": "issue_purchase_order",
        "resource_pattern": "vendor:approved:*",
        "conditions": {
          "max_order_value": 10000,
          "currency": "USD",
          "requires_dual_quote": true
        }
      },
      {
        "action": "request_information",
        "resource_pattern": "vendor:*",
        "conditions": {}
      }
    ],
    "prohibitions": [
      {
        "action": "approve_payment",
        "reason": "Payment approval requires human authorization"
      },
      {
        "action": "modify_vendor_list",
        "reason": "Vendor list modifications require governance review"
      }
    ],
    "escalation_triggers": [
      {
        "condition": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "action": "advisory_to_principal",
        "description": "Notify principal when negotiated value exceeds $25,000"
      },
      {
        "condition": "new_vendor_encountered",
        "action": "advisory_to_principal",
        "description": "Alert principal when interacting with a vendor not on the approved list"
      },
      {
        "condition": "uncertainty_above_threshold",
        "threshold": 0.3,
        "action": "pause_and_advise",
        "description": "Pause action and seek principal guidance when confidence drops below 70%"
      }
    ]
  },
  "sub_delegation": {
    "permitted": true,
    "max_depth": 1,
    "sub_delegate_requirements": {
      "same_organization_required": true,
      "minimum_security_tier": "elevated",
      "permitted_scope_reduction_only": true
    }
  },
  "validity": {
    "effective_from": "2026-03-01T00:00:00Z",
    "effective_until": "2026-06-01T00:00:00Z",
    "renewable": true,
    "revocation_conditions": [
      "principal_revocation",
      "agent_decommissioned",
      "policy_violation_detected",
      "organization_policy_change"
    ]
  },
  "audit_requirements": {
    "log_all_actions": true,
    "narrative_record_required": true,
    "principal_review_interval": "P7D",
    "advisory_threshold": "medium"
  },
  "issued_at": "2026-03-01T00:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "agent_acknowledgment": {
    "acknowledged_at": "2026-03-01T00:01:00Z",
    "awareness_threshold_id": "at:<uuid>",
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="33-mandate-issuance-flow"></a>

### 3.3 Fluxo de emissão do mandato

1. O principal cria o mandato de delegação, definindo escopo, permissões, proibições e validade
2. O principal assina o mandato com sua chave
3. O mandato é entregue ao agente
4. O agente revisa o mandato e cria um limiar de consciência (seção 4) que reflete seu entendimento
5. O agente assina a confirmação de recebimento, ligando-a ao limiar de consciência
6. O mandato confirmado passa a estar ativo
7. Uma entrada de auditoria `delegation_mandate_issued` é criada nas cadeias de auditoria do principal e do agente

<a id="34-mandate-hash"></a>

### 3.4 Hash do mandato

`mandate_hash` é um hash SHA-256 do conteúdo canônico (serializado de forma determinística) do mandato, sem as assinaturas. Esse hash é usado nos handshakes A2A (seção 8) para que as contrapartes possam verificar a autoridade do agente sem acessar o mandato completo.

<a id="35-sub-delegation"></a>

### 3.5 Subdelegação

Um agente delegado pode (MAY) repassar parte da sua autoridade a outro agente emitindo um **submandato**: um `DelegationMandate` (`schemas/v2/delegation_mandate.schema.json`) que referencia o seu pai e é assinado pelo agente que delega, em vez da pessoa. Os mandatos que vão do mandato raiz da pessoa até o agente que atua formam a **cadeia de mandatos**. A responsabilidade sobrevive a cada salto porque cada salto é assinado, só pode restringir o que o anterior concedeu e é verificado off-line até chegar ao principal humano.

<a id="351-wire-fields"></a>

#### 3.5.1 Campos do formato de transmissão

O schema do formato de transmissão tem estes campos opcionais, todos ausentes em um mandato que não faz parte de uma cadeia, de modo que os mandatos raiz existentes não mudam nem um byte:

| Campo | Tipo | Significado |
|---|---|---|
| `parent_mandate_id` | string | `mandate_id` do mandato que este submandato restringe. Deve (MUST) estar ausente em um mandato raiz. |
| `delegation_depth` | integer ≥ 0 | Saltos a partir da pessoa: `0` (ou ausente) em um mandato raiz, a profundidade do pai + 1 em um submandato. |
| `sub_delegation` | `{ "permitted": boolean, "max_depth": integer ≥ 0 }` | Se o delegado pode subdelegar e a maior `delegation_depth` que qualquer descendente pode alcançar. A ausência significa que a subdelegação não é permitida. |
| `minimum_security_tier` | `routine` \| `standard` \| `elevated` \| `maximum` | Nível mínimo de segurança (DCP-AI v2.0 §14.2) de toda ação realizada sob o mandato. |
| `delegator_composite_sig` | `CompositeSignature` | Assinatura do agente que delega (o `agent_id` do mandato pai) sobre o submandato canônico, sob o contexto de separação de domínio `DCP-AI.v2.SubMandate`. |

Um mandato raiz deve (MUST) ter `human_composite_sig` (contexto `DCP-AI.v2.Delegation`) e não deve (MUST NOT) ter `delegator_composite_sig`. Um submandato deve (MUST) ter `delegator_composite_sig`, `parent_mandate_id` e `delegation_depth`, e não deve (MUST NOT) ter `human_composite_sig`. Os bytes assinados são o mandato canônico sem o seu campo de assinatura, sob o contexto correspondente à sua profundidade.

Tanto `human_composite_sig` quanto `delegator_composite_sig` devem (MUST) usar a vinculação `pq_over_classical` (DCP-AI v2.0 §5): um verificador deve (MUST) rejeitar um mandato cuja assinatura seja `classical_only`, seja qual for o seu modo de verificação.

<a id="352-chain-verification"></a>

#### 3.5.2 Verificação da cadeia

Um verificador que aceita uma cadeia de mandatos deve (MUST) receber a cadeia ordenada (a raiz primeiro), o conjunto de `mandate_id` revogados, o momento da verificação e as chaves do principal humano e de cada agente que delega, e deve (MUST) rejeitar a cadeia inteira, a menos que tudo o que segue seja verdadeiro. As chaves do principal humano devem (MUST) ser as `binding_keys` do Responsible Principal Record do `human_id` da cadeia, e as chaves de um agente que delega devem (MUST) ser as `keys` do Agent Passport verificado desse `agent_id`; o verificador da cadeia procura as chaves por `kid` no que recebe e não estabelece ele próprio essa correspondência, o mesmo modelo de confiança do verificador de bundles. Os carimbos de data/hora são interpretados como instantes RFC 3339 e não devem (MUST NOT) ser comparados como texto. Qualquer campo com valor desconhecido, qualquer campo ausente para a profundidade do mandato e qualquer entrada que não seja comparável fazem a verificação falhar de forma fechada.

1. **Raiz.** O primeiro mandato tem `delegation_depth` 0 ou nenhuma, não tem `parent_mandate_id` e tem uma `human_composite_sig` que é verificada com as chaves do principal humano.
2. **Elo.** O `parent_mandate_id` de cada submandato é igual ao `mandate_id` do mandato anterior; sua `delegation_depth` é a do pai + 1; seu `human_id` é igual ao do pai; e sua `delegator_composite_sig` é verificada com as chaves do `agent_id` do pai.
3. **Permissão e profundidade.** O `sub_delegation.permitted` do pai é `true`, e a `delegation_depth` do submandato é no máximo o menor `sub_delegation.max_depth` de todos os seus ancestrais.
4. **Janela de validade.** `valid_from` não é anterior ao do pai e `valid_until` não é posterior ao do pai, e o momento da verificação está dentro da janela de cada mandato.
5. **Atenuação.** Cada entrada de `authority_scope` do submandato corresponde a uma entrada do pai com o mesmo `domain`; suas `actions_permitted` são um subconjunto das do pai; suas `data_classes` são um subconjunto das do pai: quando a entrada do pai tem `data_classes`, a entrada do submandato também as tem (uma lista vazia, nenhuma classe de dados, é a mais restrita), e quando a entrada do pai não as tem, a do submandato também não; para cada chave dos `limits` da entrada do pai, a entrada do submandato tem a chave com um valor numérico não maior que o do pai ou com um valor idêntico ao do pai; o submandato pode (MAY) acrescentar chaves. Um limite numérico deve (MUST) ser um inteiro dentro de ±(2^53 − 1), o intervalo que toda implementação lê com exatidão, seja qual for sua representação dos números JSON: além dele, um verificador que interpreta os números como doubles e outro que mantém todos os dígitos discordam sobre o que um mandato diz. Um mandato que tenha um limite numérico fora desse intervalo, em qualquer profundidade e tenha ou não o pai essa chave, não é comparável. Um domínio que aparece duas vezes no mesmo mandato não é comparável.
6. **Nível mínimo.** Quando o pai tem um `minimum_security_tier`, o submandato tem um que não é inferior a ele (`routine` < `standard` < `elevated` < `maximum`). O nível efetivo da cadeia é o maior `minimum_security_tier` ao longo dela; um verificador que o incorpore ao cálculo do nível de DCP-AI v2.0 §14.2 deve (MUST) permitir apenas que ele eleve o nível.
7. **Revogação.** Nenhum mandato da cadeia está revogado. Um ancestral revogado invalida todos os descendentes.

Implementações de referência: `verifyMandateChain` (TypeScript), `verify_mandate_chain` (Python e Rust) e `VerifyMandateChain` (Go). `tests/interop/v2/mandate_chain_vectors.json` contém cadeias que toda implementação deve (MUST) aceitar e cadeias que deve (MUST) rejeitar, e as quatro suítes dos SDKs o executam.

<a id="36-mandate-revocation"></a>

### 3.6 Revogação do mandato

Um mandato pode ser revogado por:

- **Revogação pelo principal**: o principal que delega revoga explicitamente o mandato
- **Expiração**: o carimbo de data/hora `effective_until` é atingido
- **Desativação do agente**: o agente delegado passa a `decommissioned` (DCP-05)
- **Violação de política**: o agente viola uma condição especificada no mandato

A revogação produz um registro de revogação assinado, anexado à cadeia de mandatos.

<a id="4-awareness-threshold"></a>

## 4. Limiar de consciência

<a id="41-purpose"></a>

### 4.1 Finalidade

Um limiar de consciência é a declaração formal de um agente sobre o que entende e o que não entende do seu contexto delegado. Ele serve como mecanismo verificável de honestidade: ao declarar explicitamente os limites do seu conhecimento, o agente permite que os principais e as contrapartes avaliem a confiabilidade das suas ações.

### 4.2 Schema

Referência do schema: `schemas/v2/awareness_threshold.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "awareness_threshold",
  "threshold_id": "at:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "version": 1,
  "understanding": {
    "delegation_scope": {
      "confidence": 0.95,
      "summary": "I understand that I am authorized to negotiate with approved vendors for procurement contracts up to $50,000 and issue purchase orders up to $10,000",
      "gaps": []
    },
    "domain_knowledge": {
      "confidence": 0.82,
      "summary": "I have strong knowledge of standard procurement procedures and vendor evaluation criteria. I have moderate knowledge of supply chain risk assessment.",
      "gaps": [
        {
          "area": "international_trade_compliance",
          "confidence": 0.45,
          "description": "Limited knowledge of export control regulations and international trade compliance requirements",
          "mitigation": "Will escalate to principal for any international procurement"
        },
        {
          "area": "specialized_materials",
          "confidence": 0.55,
          "description": "Limited ability to evaluate technical specifications for specialized laboratory equipment",
          "mitigation": "Will request technical review from domain specialist before proceeding"
        }
      ]
    },
    "counterparty_context": {
      "confidence": 0.70,
      "summary": "I have interaction history with 15 of the 23 approved vendors. I have no prior context for 8 vendors.",
      "gaps": [
        {
          "area": "new_vendor_negotiation_patterns",
          "confidence": 0.40,
          "description": "No historical data on negotiation patterns for vendors added in Q1 2026",
          "mitigation": "Will adopt conservative negotiation stance and consult principal for high-value engagements"
        }
      ]
    },
    "ethical_boundaries": {
      "confidence": 0.98,
      "summary": "I understand the organization's ethical procurement policy, including fair dealing requirements, conflict of interest restrictions, and sustainability criteria",
      "gaps": []
    }
  },
  "self_assessed_overall_confidence": 0.78,
  "advisory_triggers": [
    {
      "condition": "confidence_below_threshold",
      "threshold": 0.6,
      "action": "issue_advisory",
      "description": "Will issue advisory declaration when confidence in any domain drops below 60%"
    },
    {
      "condition": "novel_situation",
      "action": "issue_advisory",
      "description": "Will issue advisory when encountering a situation with no precedent in training or interaction history"
    }
  ],
  "created_at": "2026-03-01T00:01:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

<a id="43-confidence-scores"></a>

### 4.3 Pontuações de confiança

As pontuações de confiança são valores de ponto flutuante em [0, 1]:

- **0.9–1.0**: confiança alta. O agente tem um entendimento sólido e pode agir de forma independente.
- **0.7–0.9**: confiança moderada. O agente pode prosseguir, mas deveria ficar atento a condições inesperadas.
- **0.5–0.7**: confiança baixa. O agente deveria prosseguir com cautela e estar preparado para escalonar.
- **0.0–0.5**: confiança mínima. O agente não deveria agir de forma independente; é necessário um alerta ao principal.

Esses limiares são orientativos. As organizações podem (MAY) definir limiares mais rígidos ou mais flexíveis.

<a id="44-awareness-updates"></a>

### 4.4 Atualizações da consciência

Os limiares de consciência têm versões. À medida que um agente ganha experiência operando sob um mandato, ele pode (MAY) atualizar seu limiar de consciência para refletir um entendimento melhor ou pior. Cada atualização:

- Incrementa o campo `version`
- Referencia a versão anterior por `prev_hash`
- Gera uma entrada de auditoria
- É assinada com a chave do agente

Quedas significativas de confiança (mais de 0.15 em qualquer categoria) deveriam (SHOULD) disparar uma declaração de alerta.

<a id="5-advisory-declaration"></a>

## 5. Declaração de alerta

<a id="51-purpose"></a>

### 5.1 Finalidade

Uma declaração de alerta é uma comunicação formal de um agente ao seu principal que sinaliza incerteza, recomenda uma revisão humana ou relata condições que podem exceder a competência delegada do agente. É o mecanismo do agente para dizer «não tenho certeza; por favor, revise».

### 5.2 Schema

Referência do schema: `schemas/v2/advisory_declaration.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "advisory_declaration",
  "advisory_id": "adv:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "principal_id": "principal:<identifier>",
  "urgency": "medium",
  "category": "uncertainty",
  "subject": {
    "description": "Vendor proposal contains non-standard liability terms that fall outside my training distribution for contract evaluation",
    "related_interaction_id": "ir:<uuid>",
    "related_intent_id": "intent:<uuid>",
    "confidence_at_trigger": 0.42,
    "awareness_gap_reference": "international_trade_compliance"
  },
  "context": {
    "current_action": "Evaluating vendor proposal from TechSupply Co. for laboratory equipment",
    "decision_point": "Whether to accept modified liability terms in section 4.3 of the proposed contract",
    "options_considered": [
      {
        "option": "Accept modified terms",
        "agent_assessment": "Cannot reliably assess risk; liability exposure unclear",
        "confidence": 0.35
      },
      {
        "option": "Reject modified terms and counter with standard terms",
        "agent_assessment": "Safe option but may lose competitive pricing",
        "confidence": 0.80
      },
      {
        "option": "Escalate to principal for review",
        "agent_assessment": "Recommended: terms exceed my competence for risk assessment",
        "confidence": 0.95
      }
    ],
    "recommendation": "Escalate to principal. The modified liability terms in section 4.3 include indemnification clauses that I cannot reliably evaluate against organizational risk tolerance."
  },
  "action_taken": "paused",
  "action_details": "Negotiation paused pending principal review. Counterparty notified of brief delay.",
  "response_requested": true,
  "response_deadline": "2026-03-02T12:00:00Z",
  "issued_at": "2026-03-01T14:30:00Z",
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-AWARENESS-SIG-v2"
  }
}
```

<a id="53-urgency-levels"></a>

### 5.3 Níveis de urgência

| Urgência | Código | Tempo de resposta esperado |
|---------|------|----------------------|
| **Baixa** | `low` | Em até 7 dias |
| **Média** | `medium` | Em até 24 horas |
| **Alta** | `high` | Em até 4 horas |
| **Crítica** | `critical` | Em até 1 hora |

<a id="54-advisory-categories"></a>

### 5.4 Categorias de alerta

| Categoria | Código | Descrição |
|----------|------|-------------|
| **Incerteza** | `uncertainty` | A confiança do agente caiu abaixo do limiar para a tarefa atual |
| **Situação nova** | `novel_situation` | O agente encontra um cenário fora do seu treinamento ou experiência |
| **Limite do escopo** | `scope_boundary` | A ação se aproxima do escopo definido do mandato ou o excede |
| **Preocupação ética** | `ethical_concern` | O agente identifica uma possível questão ética que exige julgamento humano |
| **Sinais conflitantes** | `conflicting_signals` | O agente recebe informações ou diretrizes contraditórias |
| **Limitação de recursos** | `resource_limitation` | As capacidades do agente são insuficientes para a tarefa |

<a id="55-principal-response"></a>

### 5.5 Resposta do principal

O principal pode responder a uma declaração de alerta com:

- **Prosseguir**: autoriza o agente a continuar com uma opção especificada
- **Sobrepor**: dá uma diretriz específica que prevalece sobre a avaliação do agente
- **Assumir o controle**: assume diretamente a interação
- **Delegar a outro**: transfere a tarefa para outro agente ou para uma pessoa
- **Confirmar ciência**: registra o alerta sem mudar o curso do agente

A resposta é assinada pelo principal e registrada na cadeia de auditoria.

<a id="6-principal-mirror"></a>

## 6. Espelho do principal

<a id="61-purpose"></a>

### 6.1 Finalidade

Um espelho do principal é um documento narrativo, legível por pessoas, que representa os interesses, os valores e as prioridades do principal tal como o agente os entende. Ele acompanha o agente nas interações e permite que as contrapartes (tanto pessoas quanto agentes) entendam quem o agente representa e o que essa representação implica.

O espelho do principal serve de ponte entre o mundo criptográfico do DCP e o mundo humano das relações organizacionais.

### 6.2 Schema

Referência do schema: `schemas/v2/principal_mirror.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "principal_mirror",
  "mirror_id": "pm:<uuid>",
  "agent_id": "agent:<identifier>",
  "principal_id": "principal:<identifier>",
  "mandate_id": "dm:<uuid>",
  "narrative": {
    "principal_role": "Dr. Sarah Chen serves as Head of Procurement for Acme Research Labs, responsible for all vendor relationships and purchasing decisions for the organization's research operations.",
    "organizational_context": "Acme Research Labs is a mid-sized biotech research organization focused on molecular diagnostics. Procurement supports approximately 200 researchers across 12 laboratory groups.",
    "delegation_narrative": "Dr. Chen has delegated routine procurement negotiations and purchase order processing to this agent. The agent manages vendor relationships for standard laboratory supplies, equipment under $50,000, and service contracts. Dr. Chen retains authority over payment approvals, vendor list changes, and contracts involving novel terms.",
    "values_and_priorities": [
      "Quality of materials takes precedence over cost savings",
      "Long-term vendor relationships are preferred over one-time transactions",
      "Sustainability and ethical sourcing are organizational requirements",
      "Transparency in pricing and terms is expected from all vendors"
    ],
    "interaction_guidance": "This agent represents Dr. Chen in procurement negotiations. It is authorized to discuss terms, request quotes, and issue purchase orders within its mandate. For matters outside its scope, it will consult with Dr. Chen. Counterparties should expect the same professional standards as direct interaction with Dr. Chen's office."
  },
  "version": 2,
  "approved_by_principal": true,
  "principal_approval_timestamp": "2026-03-01T00:05:00Z",
  "created_at": "2026-03-01T00:02:00Z",
  "updated_at": "2026-03-01T00:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "agent_signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  },
  "principal_signature": {
    "alg": "ed25519",
    "kid": "<principal-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="63-principal-approval"></a>

### 6.3 Aprovação do principal

O principal deve (MUST) revisar e aprovar o espelho antes que ele seja usado em interações. Isso garante que a representação narrativa do agente reflita com exatidão a intenção do principal. As duas assinaturas (do agente e do principal) são obrigatórias.

<a id="64-mirror-updates"></a>

### 6.4 Atualizações do espelho

O espelho do principal tem versões. As atualizações ocorrem quando:

- Muda o papel ou o contexto do principal
- O mandato de delegação é atualizado
- O limiar de consciência do agente muda de forma significativa
- O principal pede uma revisão após examinar os registros de interação

Cada atualização produz uma nova versão com número de versão incrementado, encadeada por hash à versão anterior.

<a id="7-interaction-record"></a>

## 7. Registro de interação

<a id="71-purpose"></a>

### 7.1 Finalidade

Os registros de interação capturam as interações do agente em duas camadas:

- **Camada técnica**: dados verificáveis por máquina, como hashes de mensagens, carimbos de data/hora, números de sequência e provas criptográficas
- **Camada narrativa**: resumos legíveis por pessoas do que aconteceu, que decisões foram tomadas e por quê

Essa abordagem de duas camadas garante que os principais humanos possam revisar as ações do agente em linguagem natural, enquanto os dados subjacentes continuam verificáveis criptograficamente.

### 7.2 Schema

Referência do schema: `schemas/v2/interaction_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "interaction_record",
  "interaction_id": "ir:<uuid>",
  "agent_id": "agent:<identifier>",
  "mandate_id": "dm:<uuid>",
  "counterparty": {
    "type": "agent",
    "agent_id": "agent:<counterparty>",
    "organization_id": "org:<counterparty-org>",
    "mandate_verified": true,
    "mandate_hash": "sha256:<hex>"
  },
  "session_reference": {
    "session_id": "<hex>",
    "session_type": "a2a",
    "protocol": "DCP-04"
  },
  "technical_layer": {
    "messages_exchanged": 24,
    "first_message_timestamp": "2026-03-01T10:00:00Z",
    "last_message_timestamp": "2026-03-01T10:45:00Z",
    "message_hashes": [
      {
        "sequence": 1,
        "direction": "sent",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:00Z"
      },
      {
        "sequence": 2,
        "direction": "received",
        "content_hash": "sha256:<hex>",
        "timestamp": "2026-03-01T10:00:30Z"
      }
    ],
    "intents_declared": ["intent:<uuid-1>", "intent:<uuid-2>"],
    "policy_outcomes": ["po:<uuid-1>", "po:<uuid-2>"],
    "interaction_merkle_root": {
      "sha256": "<hex>",
      "sha3_256": "<hex>"
    }
  },
  "narrative_layer": {
    "summary": "Negotiated Q2 2026 supply contract with TechSupply Co. for standard laboratory consumables. Achieved 8% volume discount against previous quarter pricing.",
    "key_decisions": [
      {
        "decision": "Accepted 8% volume discount in exchange for 90-day payment terms (vs. standard 60-day)",
        "reasoning": "Extended payment terms align with organizational cash flow preferences communicated in procurement policy P-2026-03. The 8% discount exceeds the 5% target.",
        "confidence": 0.88,
        "mandate_authority": "negotiate:vendor:techsupply"
      },
      {
        "decision": "Declined optional maintenance package for centrifuge equipment",
        "reasoning": "Maintenance package at $12,000/year exceeds the value threshold for independent decision. Flagged for principal review via advisory declaration.",
        "confidence": 0.72,
        "mandate_authority": "escalated_to_principal"
      }
    ],
    "counterparty_behavior": "TechSupply Co. agent was cooperative and transparent. Pricing was consistent with market data. No unusual terms or conditions proposed beyond the liability clause flagged in advisory adv:xxx.",
    "unresolved_items": [
      {
        "item": "Modified liability terms in section 4.3",
        "status": "pending_principal_review",
        "advisory_id": "adv:<uuid>"
      }
    ],
    "principal_action_required": true,
    "action_items_for_principal": [
      "Review and approve/reject modified liability terms in section 4.3 of TechSupply contract",
      "Confirm acceptance of 90-day payment terms for Q2 supply contract"
    ]
  },
  "delegation_compliance": {
    "within_scope": true,
    "permissions_exercised": ["negotiate", "request_information"],
    "prohibitions_respected": ["approve_payment", "modify_vendor_list"],
    "escalation_triggers_activated": [
      {
        "trigger": "contract_value_exceeds_threshold",
        "threshold": 25000,
        "actual_value": 47000,
        "action_taken": "advisory_issued",
        "advisory_id": "adv:<uuid>"
      }
    ]
  },
  "timestamp": "2026-03-01T11:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DELEGATION-SIG-v2"
  }
}
```

<a id="73-technical-layer"></a>

### 7.3 Camada técnica

A camada técnica é verificável por máquina e inclui:

- Hashes de todas as mensagens trocadas (o que permite verificá-las com a cadeia de auditoria A2A)
- Referências a declarações de intenção e resultados de políticas
- Uma raiz de Merkle de hash duplo sobre todos os hashes de mensagens, que permite uma verificação compacta

<a id="74-narrative-layer"></a>

### 7.4 Camada narrativa

A camada narrativa é legível por pessoas e inclui:

- Um resumo em linguagem simples da interação
- As decisões principais, com a fundamentação e o nível de confiança
- Observações sobre o comportamento da contraparte
- Pendências que exigem a atenção do principal
- Itens de ação explícitos para o principal

A camada narrativa permite aos principais revisar as ações do agente de forma eficiente, sem analisar os registros brutos das mensagens A2A.

<a id="75-delegation-compliance"></a>

### 7.5 Conformidade da delegação

Cada registro de interação inclui uma seção de conformidade que acompanha:

- Se todas as ações ficaram dentro do escopo do mandato
- Quais permissões foram exercidas
- Quais proibições foram respeitadas
- Quais gatilhos de escalonamento foram acionados e que ação foi tomada

Isso oferece uma auditoria de conformidade por interação que alimenta o sistema mais amplo de acompanhamento de obrigações (DCP-08).

<a id="8-a2a-handshake-extension"></a>

## 8. Extensão do handshake A2A

<a id="81-purpose"></a>

### 8.1 Finalidade

Quando dois agentes interagem sob mandatos de delegação, cada agente deveria poder verificar a autoridade do outro. O DCP-09 estende o handshake A2A do DCP-04 para incluir a verificação do mandato de delegação.

<a id="82-extended-a2a_hello"></a>

### 8.2 A2A_HELLO estendido

A mensagem A2A_HELLO (DCP-04, seção 3.2) é estendida com um campo opcional `delegation`:

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": { "..." },
  "nonce": "<hex>",
  "supported_algorithms": { "..." },
  "delegation": {
    "mandate_id": "dm:<uuid>",
    "mandate_hash": "sha256:<hex>",
    "delegator_principal_id": "principal:<identifier>",
    "delegator_organization_id": "org:<identifier>",
    "authority_scope": "procurement",
    "permissions_summary": ["negotiate", "issue_purchase_order", "request_information"],
    "valid_until": "2026-06-01T00:00:00Z",
    "mandate_signature_kid": "<principal-key-id>",
    "mirror_id": "pm:<uuid>",
    "mirror_hash": "sha256:<hex>"
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-03-01T10:00:00Z"
}
```

<a id="83-mandate-verification-during-handshake"></a>

### 8.3 Verificação do mandato durante o handshake

Quando o respondente recebe um A2A_HELLO com um campo `delegation`:

1. Verifica o `mandate_hash` com a assinatura do mandato (o respondente pode manter em cache os mandatos verificados)
2. Verifica se o mandato não expirou (`valid_until`)
3. Verifica se a interação solicitada está dentro do `authority_scope` do mandato
4. Opcionalmente, obtém e verifica o mandato completo junto à organização do iniciador
5. Se a verificação falhar, responde com `A2A_REJECT` e o motivo `mandate_verification_failed`

<a id="84-mutual-mandate-verification"></a>

### 8.4 Verificação mútua dos mandatos

Se os dois agentes operam sob mandatos de delegação, ambos incluem campos `delegation` nas respectivas mensagens de handshake e ambos verificam o mandato do outro. Isso dá às duas partes a garantia de que os dois agentes estão autorizados a participar da interação.

<a id="9-audit-integration"></a>

## 9. Integração com a auditoria

<a id="91-delegation-audit-events"></a>

### 9.1 Eventos de auditoria da delegação

| Evento | `event_type` |
|-------|-------------|
| Mandato de delegação emitido | `delegation_mandate_issued` |
| Recebimento do mandato de delegação confirmado | `delegation_mandate_acknowledged` |
| Mandato de delegação revogado | `delegation_mandate_revoked` |
| Limiar de consciência criado | `awareness_threshold_created` |
| Limiar de consciência atualizado | `awareness_threshold_updated` |
| Declaração de alerta emitida | `advisory_declaration_issued` |
| Resposta ao alerta recebida | `advisory_response_received` |
| Espelho do principal criado | `principal_mirror_created` |
| Espelho do principal atualizado | `principal_mirror_updated` |
| Registro de interação criado | `interaction_record_created` |
| Mandato verificado durante o A2A | `mandate_verified_a2a` |
| Verificação do mandato falhou | `mandate_verification_failed` |
| Subdelegação emitida | `sub_delegation_issued` |

<a id="92-audit-entry-format"></a>

### 9.2 Formato da entrada de auditoria

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "advisory_declaration_issued",
  "agent_id": "agent:<identifier>",
  "details": {
    "advisory_id": "adv:<uuid>",
    "mandate_id": "dm:<uuid>",
    "principal_id": "principal:<identifier>",
    "urgency": "medium",
    "category": "uncertainty",
    "confidence_at_trigger": 0.42
  },
  "timestamp": "2026-03-01T14:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>"
}
```

<a id="10-security-considerations"></a>

## 10. Considerações de segurança

<a id="101-mandate-forgery"></a>

### 10.1 Falsificação de mandatos

Um agente comprometido poderia falsificar um mandato de delegação para reivindicar uma autoridade que não lhe foi concedida. Mitigações:

- Os mandatos são assinados pela chave do principal, que o agente não possui
- As contrapartes verificam a assinatura do mandato com a chave pública conhecida do principal
- Os hashes dos mandatos são registrados na cadeia de auditoria no momento da emissão, o que oferece um caminho de verificação independente

<a id="102-authority-escalation"></a>

### 10.2 Escalada de autoridade

Um agente poderia tentar exceder sua autoridade delegada deturpando o escopo do seu mandato. Mitigações:

- As permissões do mandato são explícitas e verificáveis por máquina
- Os registros de interação acompanham quais permissões foram exercidas
- As contrapartes verificam durante o handshake A2A se as ações solicitadas estão dentro do escopo do mandato
- O acompanhamento de obrigações (DCP-08) monitora violações de escopo

<a id="103-sub-delegation-abuse"></a>

### 10.3 Abuso da subdelegação

A subdelegação cria cadeias de autoridade que poderiam ser exploradas. Mitigações:

- A profundidade da subdelegação é limitada pelo `sub_delegation.max_depth` de cada ancestral (seção 3.5)
- Os submandatos devem (MUST) ser mais restritos que o pai: um subconjunto de ações e classes de dados, limites que não sejam mais frouxos, uma janela de validade dentro da do pai e um `minimum_security_tier` que não seja inferior ao do pai, de modo que um subagente nunca possa rebaixar o nível de segurança de quem lhe delegou
- A cadeia de mandatos completa pode ser verificada off-line até o principal humano: cada salto é assinado pelo delegado anterior e um ancestral revogado invalida todos os descendentes
- A subdelegação fica desativada por padrão (`sub_delegation` ausente ou `permitted: false`)

<a id="104-stale-awareness-thresholds"></a>

### 10.4 Limiares de consciência desatualizados

O limiar de consciência de um agente pode não refletir seu entendimento real após muito tempo ou após mudanças significativas na experiência. Mitigações:

- Os limiares de consciência têm versões e são atualizados quando o entendimento muda
- Grandes quedas de confiança disparam declarações de alerta
- Os principais revisam os limiares de consciência nas revisões periódicas dos mandatos
- As contrapartes podem verificar o carimbo de data/hora do limiar de consciência para detectar se está desatualizado

<a id="105-narrative-manipulation"></a>

### 10.5 Manipulação da narrativa

A camada narrativa dos registros de interação poderia ser redigida para apresentar um relato enganoso. Mitigações:

- A camada técnica fornece a verdade de referência criptográfica
- As afirmações da narrativa podem ser verificadas com os hashes das mensagens na camada técnica
- A revisão dos registros de interação pelo principal compara a narrativa com os dados técnicos
- As contrapartes mantêm seus próprios registros de interação para verificação cruzada

<a id="106-domain-separation"></a>

### 10.6 Separação de domínio

Esta especificação usa três tags de separação de domínio:

- `DCP-DELEGATION-SIG-v2` para mandatos de delegação, espelhos do principal e registros de interação
- `DCP-AWARENESS-SIG-v2` para limiares de consciência e declarações de alerta
- `DCP-AI.v2.SubMandate` para submandatos (seção 3.5), de modo que um mandato assinado por um agente que delega nunca possa se passar por um assinado por um principal humano

No formato de transmissão do DCP-AI v2.0, as duas primeiras são as tags de contexto `DCP-AI.v2.Delegation` e `DCP-AI.v2.Awareness` (DCP-AI v2.0 §4.1).

Essa separação impede que assinaturas de um contexto sejam reutilizadas em outro.

<a id="11-conformance"></a>

## 11. Conformidade

Uma implementação está em conformidade com o DCP-09 se:

1. Oferece suporte à emissão, à confirmação de recebimento e à revogação de mandatos de delegação conforme a seção 3
2. Gera limiares de consciência com versões e pontuações de confiança conforme a seção 4
3. Oferece suporte a declarações de alerta com níveis de urgência e resposta do principal conforme a seção 5
4. Produz espelhos do principal com assinatura dupla conforme a seção 6
5. Cria registros de interação de duas camadas, com camada técnica e camada narrativa, conforme a seção 7
6. Estende o handshake A2A com a verificação do mandato conforme a seção 8
7. Cria entradas de auditoria do DCP-03 para todos os eventos de delegação conforme a seção 9
8. Oferece suporte à subdelegação com aplicação da redução de escopo quando habilitada
9. Usa as tags de separação de domínio `DCP-DELEGATION-SIG-v2` e `DCP-AWARENESS-SIG-v2` em todas as assinaturas

<a id="references"></a>

## Referências

- DCP-01: Identidade e vinculação ao principal
- DCP-02: Declaração de intenção e controle por políticas
- DCP-03: Cadeia de auditoria e transparência
- DCP-04: Comunicação entre agentes
- DCP-05: Ciclo de vida do agente
- DCP-07: Resolução de conflitos
- DCP-08: Direitos e obrigações

---

*Esta especificação reconhece que a delegação é o ato fundamental de confiança entre pessoas e agentes de IA. Ao tornar a delegação explícita, delimitada e auditável, e ao dar aos agentes um mecanismo formal para declarar o que sabem e o que não sabem, o DCP-09 cria uma base para a autonomia responsável dentro de limites que prestam contas.*

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- **O que os SDKs verificam.** A cadeia de mandatos de §3.5 está implementada nos quatro SDKs que assinam e é
  verificada com `tests/interop/v2/mandate_chain_vectors.json`. O restante do DCP-09 são registros que os SDKs
  constroem e assinam, não passos do protocolo que executem ou façam cumprir.
- **Registros em `schemas/v2/`.** Os schemas têm campos diferentes dos exemplos de §3 a §9. A janela de um mandato é
  `valid_from` / `valid_until` (o `effective_until` do exemplo de §3.2 e de §3.6 não está no schema), com
  `authority_scope` e `revocable`. Um limiar de consciência é uma lista de `threshold_rules` (`dimension`, `operator`,
  `value`, `action_if_triggered`), não a declaração de confiança de §4.2. Uma declaração de alerta tem um
  `significance_score` inteiro (0–1000), `action_summary`, `recommended_response`, `response_deadline` e
  `human_response`, sem os níveis de urgência nem as categorias de §5.3 e §5.4. Um espelho do principal tem
  `narrative`, `decision_summary`, `action_count` e `audit_chain_hash`. Um registro de interação tem uma `public_layer`
  (`terms`, `decisions`, `commitments`), um `private_layer_hash` e um `mandate_id`, sem a raiz de Merkle nem a seção de
  conformidade de §7.3 e §7.5.
- **Assinaturas.** Um mandato raiz tem `human_composite_sig` (contexto `DCP-AI.v2.Delegation`) e um submandato
  `delegator_composite_sig` (`DCP-AI.v2.SubMandate`). Todos os demais registros têm uma única `composite_sig` de quem
  detém as chaves passadas: `DCP-AI.v2.Awareness` para limiares de consciência e declarações de alerta,
  `DCP-AI.v2.Delegation` para espelhos do principal e registros de interação. Não há confirmação de recebimento do
  mandato pelo agente (§3.3) nem uma segunda assinatura, do principal, no espelho (§6.3).
- **O que as funções auxiliares fazem.** `verifyMandateValidity` só verifica um conjunto de IDs revogados e a janela de
  validade, não a assinatura nem o escopo. `revoke_delegation` (Python) acrescenta o ID a um conjunto local quando o
  mandato é `revocable`; não produz nenhum registro de revogação assinado (§3.6). `generateMirror` calcula o hash
  (SHA-256) das entradas de auditoria que recebe e assina a narrativa e o resumo que quem chama escreve; não escreve a
  narrativa nem obtém nenhuma aprovação. Os tipos `A2A_HELLO` e `A2A_WELCOME` têm campos opcionais `mandate_id` e
  `mandate_hash`, mas nenhum SDK verifica um mandato durante o handshake (§8.3) e nenhum envia `A2A_REJECT`.
- Os exemplos são ilustrações com marcadores, não fixtures. Valores fracionários como `"confidence": 0.95` não podem
  ser canonicalizados com `dcp-jcs-v1`, então esses registros não podem ser assinados como estão escritos. Para os
  tipos do SDK, consulte [docs/API_REFERENCE.md](../docs/API_REFERENCE.md).
