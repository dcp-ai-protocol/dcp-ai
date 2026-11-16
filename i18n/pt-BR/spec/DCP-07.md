<sub>[English](../../../spec/DCP-07.md) · [中文](../../zh-CN/spec/DCP-07.md) · [Español](../../es/spec/DCP-07.md) · [日本語](../../ja/spec/DCP-07.md) · **Português**</sub>

<a id="dcp-07-conflict-resolution"></a>

# DCP-07: Resolução de conflitos

> Tradução informativa da [especificação em inglês](../../../spec/DCP-07.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

## Status
Publicada — v2.0 (extensão; as revisões são acompanhadas conforme o retorno de quem a adota)

<a id="abstract"></a>

## Resumo
Esta especificação define um protocolo estruturado e auditável para resolver conflitos entre agentes de IA certificados pelo DCP. Ela introduz um modelo de escalonamento em três níveis (negociação direta, arbitragem contextual, recurso humano), registros de disputa tipados, painéis de arbitragem M de N, pacotes de jurisprudência para o acompanhamento de precedentes e registros de objeção para a divergência formal. Todos os artefatos de resolução de conflitos são assinados criptograficamente e encadeados por hash, o que produz um registro de cada disputa e de sua resolução que permite detectar adulterações.

<a id="1-introduction"></a>

## 1. Introdução

À medida que agentes de IA que operam sob o DCP interagem cada vez mais entre si (DCP-04), os conflitos são inevitáveis. Os agentes podem disputar recursos compartilhados, receber diretrizes contraditórias de principais diferentes, discordar sobre os limites de suas capacidades ou interpretar as políticas de forma diferente. Sem um mecanismo formal de resolução, esses conflitos ou escalam para operadores humanos sem um contexto estruturado, ou resultam em impasses e falhas em cascata.

O DCP-07 oferece um arcabouço de resolução de conflitos no nível do protocolo que:

- Classifica as disputas por tipo para permitir estratégias de resolução adequadas
- Define um modelo de escalonamento em três níveis, começando pela negociação entre agentes
- Cria registros assinados e auditáveis de cada disputa, de cada tentativa de resolução e de cada resultado
- Constrói um sistema de jurisprudência em que as disputas resolvidas servem de precedente
- Preserva o direito de qualquer parte de objetar formalmente uma resolução

<a id="11-design-principles"></a>

### 1.1 Princípios de design
- Os conflitos deveriam ser resolvidos no nível mais baixo possível
- Cada disputa e cada tentativa de resolução é assinada e registrada
- O recurso humano está sempre disponível como último recurso
- As disputas resolvidas criam precedentes que melhoram as resoluções futuras
- Nenhum agente é obrigado a aceitar uma resolução sem poder recorrer a uma objeção

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relação com outras especificações
- **DCP-01**: a identidade do agente determina sua legitimidade para propor disputas ou responder a elas
- **DCP-02**: os conflitos de políticas são um tipo principal de disputa; os resultados das políticas alimentam o contexto da disputa
- **DCP-03**: todos os eventos de disputa são registrados na cadeia de auditoria
- **DCP-04**: as mensagens de negociação das disputas são trocadas por canais A2A
- **DCP-05**: um agente no estado `declining` tem capacidade limitada de participar de disputas
- **DCP-08**: as violações de direitos (DCP-08) disparam disputas segundo esta especificação

<a id="2-terminology"></a>

## 2. Terminologia

**Disputa**: uma declaração formal de um ou mais agentes de que existe um conflito que requer resolução.

**Parte na disputa**: um agente que é parte de uma disputa, seja como iniciador (reclamante) ou como respondente.

**Nível de escalonamento**: uma das três etapas de resolução: `direct_negotiation`, `contextual_arbitration` ou `human_appeal`.

**Painel de arbitragem**: um grupo de agentes (ou um painel misto de agentes e pessoas) convocado para resolver uma disputa no nível de arbitragem contextual. As decisões exigem um acordo M de N.

**Pacote de jurisprudência**: um registro selado de uma disputa resolvida, com contexto, argumentos e resultado, que serve de precedente para disputas futuras.

**Registro de objeção**: uma declaração formal e assinada de desacordo com o resultado de uma resolução.

**Tag de separação de domínio**: `DCP-DISPUTE-SIG-v2`, usada em todas as assinaturas produzidas segundo esta especificação.

<a id="3-dispute-types"></a>

## 3. Tipos de disputa

<a id="31-classification"></a>

### 3.1 Classificação

As disputas são classificadas em quatro tipos, cada um com características de resolução próprias:

| Tipo | Código | Descrição | Nível inicial padrão |
|------|------|-------------|----------------------|
| **Conflito de recursos** | `resource_conflict` | Dois ou mais agentes disputam o mesmo recurso limitado (computação, acesso a dados, cota de API, largura de banda de rede) | `direct_negotiation` |
| **Conflito de diretrizes** | `directive_conflict` | Um agente recebe instruções contraditórias de vários principais, ou de um principal e de uma política da organização | `contextual_arbitration` |
| **Conflito de capacidades** | `capability_conflict` | Desacordo sobre se um agente tem a capacidade ou a autoridade para realizar uma ação específica | `direct_negotiation` |
| **Conflito de políticas** | `policy_conflict` | Dois ou mais agentes interpretam de forma diferente uma política compartilhada, ou a ação de um agente conflita com as restrições de política de outro | `direct_negotiation` |

<a id="32-severity-levels"></a>

### 3.2 Níveis de gravidade

Cada disputa tem um nível de gravidade que influencia os prazos de escalonamento:

| Gravidade | Código | Prazo de escalonamento |
|----------|------|-------------------|
| **Baixa** | `low` | 24 horas por nível |
| **Média** | `medium` | 4 horas por nível |
| **Alta** | `high` | 1 hora por nível |
| **Crítica** | `critical` | 15 minutos por nível |

Se uma disputa não for resolvida dentro do prazo de escalonamento no nível atual, ela deve (MUST) ser escalonada automaticamente para o nível seguinte.

<a id="4-dispute-record"></a>

## 4. Registro de disputa

### 4.1 Schema

Referência do schema: `schemas/v2/dispute_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "dispute_record",
  "dispute_id": "disp:<uuid>",
  "dispute_type": "resource_conflict",
  "severity": "medium",
  "status": "open",
  "current_escalation_level": "direct_negotiation",
  "complainant": {
    "agent_id": "agent:<complainant-identifier>",
    "principal_id": "principal:<identifier>",
    "organization_id": "org:<identifier>"
  },
  "respondents": [
    {
      "agent_id": "agent:<respondent-identifier>",
      "principal_id": "principal:<identifier>",
      "organization_id": "org:<identifier>"
    }
  ],
  "subject": {
    "description": "Both agents require exclusive write access to the shared procurement database during the same time window",
    "resource_identifiers": ["resource:procurement-db:write-lock"],
    "related_intent_ids": ["intent:<uuid-a>", "intent:<uuid-b>"],
    "related_policy_ids": ["policy:<uuid>"],
    "related_audit_entries": ["evt:<uuid>", "evt:<uuid>"]
  },
  "evidence": [
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<complainant-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-a>",
      "description": "Complainant's intent declaration for procurement database access",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:00:00Z"
    },
    {
      "evidence_id": "evd:<uuid>",
      "submitted_by": "agent:<respondent-identifier>",
      "evidence_type": "intent_declaration",
      "reference": "intent:<uuid-b>",
      "description": "Respondent's concurrent intent declaration for the same resource",
      "content_hash": "sha256:<hex>",
      "submitted_at": "2026-03-01T10:01:00Z"
    }
  ],
  "precedents_cited": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "relevance": "Previous resource conflict resolved by time-sharing; similar resource type and contention pattern"
    }
  ],
  "timeline": [
    {
      "event": "dispute_opened",
      "timestamp": "2026-03-01T10:05:00Z",
      "actor": "agent:<complainant-identifier>"
    }
  ],
  "escalation_deadline": "2026-03-01T14:05:00Z",
  "opened_at": "2026-03-01T10:05:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<complainant-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="42-dispute-lifecycle"></a>

### 4.2 Ciclo de vida da disputa

```
 opened ──> negotiating ──> escalated ──> arbitrating ──> escalated ──> appealing ──> resolved
                │                              │                              │
                └──────── resolved ◄───────────┘──────── resolved ◄───────────┘
                                                                              │
                                                                    withdrawn/abandoned
```

Status válidos: `open`, `negotiating`, `escalated`, `arbitrating`, `appealing`, `resolved`, `withdrawn`, `abandoned`.

Uma disputa fica `abandoned` se todos os prazos de escalonamento expirarem sem resolução e nenhuma parte buscar novo escalonamento.

<a id="5-three-level-escalation-model"></a>

## 5. Modelo de escalonamento em três níveis

<a id="51-level-1-direct-negotiation"></a>

### 5.1 Nível 1: negociação direta

Os agentes em disputa tentam resolver o conflito diretamente por mensagens A2A do DCP-04.

**Processo:**

1. O reclamante abre a disputa criando um registro de disputa e enviando-o aos respondentes por A2A
2. Os respondentes confirmam o recebimento e apresentam contraprovas ou propostas de resolução
3. Os agentes trocam propostas de resolução
4. Se uma proposta for aceita por todas as partes, a disputa está resolvida
5. A resolução é registrada em um registro de resolução de arbitragem (seção 6)

**Estratégias de negociação** (as implementações podem (MAY) oferecê-las):

- **Revezamento**: os agentes se revezam no acesso ao recurso disputado
- **Por prioridade**: o agente com maior prioridade (pela política ou por diretriz do principal) segue primeiro
- **Por capacidade**: segue o agente cuja capacidade é mais pertinente
- **Aleatória**: lançamento de moeda criptograficamente justo (esquema de compromisso e revelação)

**Gatilho de escalonamento**: se a negociação falhar dentro do prazo de escalonamento, a disputa deve (MUST) escalonar para o nível 2.

<a id="52-level-2-contextual-arbitration"></a>

### 5.2 Nível 2: arbitragem contextual

Um painel de arbitragem é convocado para resolver a disputa.

**Formação do painel:**

1. Cada parte indica um ou mais candidatos ao painel a partir de um grupo de árbitros pré-aprovado
2. É montado um painel M de N (mínimo de 3 membros; padrão M=2, N=3)
3. Os membros do painel não devem (MUST NOT) ter disputas ativas com nenhuma das partes
4. Os membros do painel devem (MUST) ter vitalidade acima de 600 (DCP-05)
5. Os membros do painel devem (MUST) estar no estado de ciclo de vida `active`

**Processo de arbitragem:**

1. O painel examina o registro de disputa, as provas e os precedentes citados
2. O painel pode (MAY) solicitar provas adicionais às partes
3. Os membros do painel avaliam de forma independente e propõem resoluções
4. O painel vota; é necessário um acordo M de N para uma resolução vinculante
5. A resolução é registrada com o voto de cada membro do painel

**Tipos de decisão do painel:**

- `binding_resolution`: todas as partes devem cumpri-la
- `recommended_resolution`: sugestão não vinculante; as partes podem aceitá-la ou escalonar
- `split_decision`: o painel não alcançou o acordo M de N; escalona automaticamente para o nível 3

<a id="53-level-3-human-appeal"></a>

### 5.3 Nível 3: recurso humano

A disputa é escalonada para os principais humanos para resolução.

**Processo:**

1. O registro de disputa completo, as provas, o histórico de arbitragem e as eventuais objeções são apresentados aos principais responsáveis de todas as partes
2. Os principais podem deliberar, negociar ou aplicar a política da organização
3. A decisão humana é registrada como resolução final e vinculante
4. Se os principais não chegarem a um acordo, aplicam-se os procedimentos de escalonamento da organização (fora do escopo do DCP)

**Garantias do recurso humano:**

- Qualquer parte pode (MAY) escalonar para o recurso humano a qualquer momento, pulando os níveis anteriores
- Disputas de gravidade crítica podem (MAY) começar no nível de recurso humano
- As decisões humanas são finais dentro do protocolo DCP

<a id="6-arbitration-resolution"></a>

## 6. Resolução de arbitragem

### 6.1 Schema

Referência do schema: `schemas/v2/arbitration_resolution.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "arbitration_resolution",
  "resolution_id": "res:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_level": "contextual_arbitration",
  "resolution_type": "binding_resolution",
  "outcome": {
    "description": "Time-sharing arrangement: Agent A has exclusive access during 00:00-12:00 UTC, Agent B during 12:00-24:00 UTC",
    "actions_required": [
      {
        "agent_id": "agent:<agent-a>",
        "action": "Restrict procurement database write access to 00:00-12:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      },
      {
        "agent_id": "agent:<agent-b>",
        "action": "Restrict procurement database write access to 12:00-24:00 UTC window",
        "deadline": "2026-03-02T00:00:00Z"
      }
    ],
    "compliance_verification_method": "audit_chain_review",
    "compliance_deadline": "2026-03-09T00:00:00Z"
  },
  "reasoning": "Both agents have equally valid intent declarations for the resource. Historical precedent (jur:abc123) established time-sharing as the preferred resolution for symmetric resource conflicts. Agent A's intent was filed 60 seconds earlier, granting first selection of time window.",
  "precedents_applied": [
    {
      "jurisprudence_id": "jur:<uuid>",
      "applicability": "Directly applicable: same resource type, symmetric priority"
    }
  ],
  "panel": {
    "members": [
      {
        "agent_id": "agent:<arbitrator-1>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-2>",
        "vote": "approve",
        "reasoning_hash": "sha256:<hex>"
      },
      {
        "agent_id": "agent:<arbitrator-3>",
        "vote": "dissent",
        "reasoning_hash": "sha256:<hex>"
      }
    ],
    "threshold": {
      "m": 2,
      "n": 3
    },
    "votes_for": 2,
    "votes_against": 1
  },
  "effective_at": "2026-03-01T16:00:00Z",
  "expires_at": "2026-06-01T00:00:00Z",
  "timestamp": "2026-03-01T15:30:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signatures": [
    {
      "agent_id": "agent:<arbitrator-1>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    },
    {
      "agent_id": "agent:<arbitrator-2>",
      "alg": "ed25519",
      "kid": "<key-id>",
      "sig_b64": "...",
      "domain_sep": "DCP-DISPUTE-SIG-v2"
    }
  ]
}
```

<a id="62-resolution-compliance"></a>

### 6.2 Cumprimento da resolução

Após uma resolução vinculante:

1. Todas as partes devem (MUST) cumpri-la até o prazo especificado
2. O cumprimento é verificado pelo método especificado na resolução (normalmente, a revisão da cadeia de auditoria)
3. O descumprimento é, ele próprio, uma disputa (tipo: `policy_conflict`) e escalona diretamente para o recurso humano
4. O descumprimento reiterado pode (MAY) disparar um encerramento por justa causa (DCP-05)

<a id="7-jurisprudence-bundle"></a>

## 7. Pacote de jurisprudência

<a id="71-purpose"></a>

### 7.1 Finalidade

As disputas resolvidas são empacotadas como pacotes de jurisprudência: registros selados e referenciáveis que servem de precedente para a resolução de disputas futuras. Isso cria um corpo de «jurisprudência» em evolução que melhora a consistência das resoluções ao longo do tempo.

### 7.2 Schema

Referência do schema: `schemas/v2/jurisprudence_bundle.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "jurisprudence_bundle",
  "jurisprudence_id": "jur:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "classification": {
    "dispute_type": "resource_conflict",
    "resource_category": "database_access",
    "resolution_pattern": "time_sharing",
    "tags": ["symmetric_priority", "exclusive_access", "periodic_resource"]
  },
  "summary": {
    "facts": "Two agents with equivalent priority both declared intent to access the same exclusive-write resource during overlapping time windows.",
    "holding": "Time-sharing arrangement based on filing order, with the earlier-filing agent selecting preferred time window.",
    "rationale": "Symmetric priority conflicts for periodic resources are best resolved by time division. Filing order provides a fair, deterministic tie-breaker.",
    "dissent": "Dissenting arbitrator argued for capability-based priority, where the agent with greater procurement-domain capability should receive priority access."
  },
  "applicability": {
    "applicable_dispute_types": ["resource_conflict"],
    "applicable_conditions": [
      "Two or more agents with equal priority",
      "Exclusive-access resource that supports time division",
      "No principal directive establishing priority"
    ],
    "inapplicable_conditions": [
      "Non-divisible resource (e.g., one-time-use token)",
      "Asymmetric principal-directed priority"
    ]
  },
  "supersedes": [],
  "superseded_by": null,
  "authority_level": "contextual_arbitration",
  "created_at": "2026-03-01T16:00:00Z",
  "dispute_record_hash": "sha256:<hex>",
  "resolution_record_hash": "sha256:<hex>",
  "objections": [],
  "timestamp": "2026-03-01T16:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<panel-lead-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="73-precedent-matching"></a>

### 7.3 Busca de precedentes

Quando uma nova disputa é aberta, os agentes e os painéis de arbitragem deveriam (SHOULD) buscar precedentes aplicáveis no registro de jurisprudência:

1. Filtrar por `dispute_type`
2. Buscar correspondências em `applicable_conditions`
3. Excluir com base em `inapplicable_conditions`
4. Ordenar por `authority_level` (human_appeal > contextual_arbitration > direct_negotiation)
5. Preferir os precedentes mais recentes quando as decisões conflitarem

O precedente é orientativo, não estritamente vinculante. Os painéis de arbitragem e os principais humanos podem (MAY) se afastar do precedente com uma fundamentação documentada.

<a id="74-supersession"></a>

### 7.4 Substituição

Um pacote de jurisprudência pode ser substituído por uma decisão posterior sobre a mesma questão. Quando substituído:

- O campo `superseded_by` é atualizado para referenciar o novo pacote de jurisprudência
- O campo `supersedes` do pacote substituto lista os pacotes antigos
- Os pacotes substituídos permanecem no registro como referência histórica, mas perdem prioridade na busca de precedentes

<a id="8-objection-record"></a>

## 8. Registro de objeção

<a id="81-purpose"></a>

### 8.1 Finalidade

Qualquer parte na disputa pode objetar formalmente o resultado de uma resolução. As objeções são registradas como artefatos assinados e com carimbo de data/hora, que passam a fazer parte do registro permanente da disputa. Apresentar uma objeção não reverte automaticamente uma resolução, mas preserva a divergência do agente e pode apoiar recursos futuros ou contestações de precedentes.

### 8.2 Schema

Referência do schema: `schemas/v2/objection_record.schema.json`

```json
{
  "dcp_version": "2.0",
  "record_type": "objection_record",
  "objection_id": "obj:<uuid>",
  "dispute_id": "disp:<uuid>",
  "resolution_id": "res:<uuid>",
  "objecting_party": {
    "agent_id": "agent:<identifier>",
    "principal_id": "principal:<identifier>"
  },
  "objection_type": "procedural",
  "grounds": {
    "summary": "Panel member agent:<arbitrator-3> had a prior undisclosed resource dependency on the respondent, creating a conflict of interest",
    "detailed_reasoning": "Audit chain analysis reveals that arbitrator-3 and the respondent shared 47 A2A sessions in the preceding 30 days, establishing a working relationship that was not disclosed during panel formation. This violates the independence requirement of Section 5.2.",
    "evidence_references": [
      "evt:<uuid-session-log-1>",
      "evt:<uuid-session-log-2>"
    ],
    "precedent_references": []
  },
  "requested_remedy": {
    "type": "panel_reconstitution",
    "description": "Request reconstitution of the arbitration panel with verified independent members and re-hearing of the dispute"
  },
  "status": "filed",
  "filed_at": "2026-03-01T17:00:00Z",
  "timestamp": "2026-03-01T17:00:00Z",
  "prev_hash": "sha256:<hex>",
  "prev_hash_secondary": "sha3-256:<hex>",
  "signature": {
    "alg": "ed25519",
    "kid": "<objecting-agent-key-id>",
    "sig_b64": "...",
    "domain_sep": "DCP-DISPUTE-SIG-v2"
  }
}
```

<a id="83-objection-types"></a>

### 8.3 Tipos de objeção

| Tipo | Código | Descrição |
|------|------|-------------|
| **Substantiva** | `substantive` | A resolução está errada no mérito; as provas ou a fundamentação não sustentam o resultado |
| **Processual** | `procedural` | O processo de resolução teve falhas (viés do painel, provas ignoradas, extrapolação do escopo) |
| **De precedente** | `precedent` | A resolução conflita com a jurisprudência estabelecida sem justificativa adequada |
| **De direitos** | `rights` | A resolução viola direitos de um agente definidos no DCP-08 |

<a id="84-objection-handling"></a>

### 8.4 Tratamento das objeções

1. As objeções apresentadas são anexadas ao registro de disputa e incluídas no pacote de jurisprudência
2. A resolução continua em vigor, a menos que um principal humano ordene sua suspensão
3. As objeções do tipo `rights` devem (MUST) ser encaminhadas ao nível de recurso humano para revisão
4. As objeções dão fundamento a futuras contestações de precedentes (seção 7.4)

<a id="9-audit-integration"></a>

## 9. Integração com a auditoria

<a id="91-dispute-audit-events"></a>

### 9.1 Eventos de auditoria das disputas

Todos os eventos do ciclo de vida de uma disputa geram entradas de auditoria do DCP-03:

| Evento | `event_type` |
|-------|-------------|
| Disputa aberta | `dispute_opened` |
| Prova apresentada | `dispute_evidence_submitted` |
| Proposta de negociação enviada | `dispute_negotiation_proposal` |
| Disputa escalonada | `dispute_escalated` |
| Painel de arbitragem formado | `arbitration_panel_formed` |
| Voto do painel registrado | `arbitration_vote_cast` |
| Resolução emitida | `dispute_resolved` |
| Objeção apresentada | `dispute_objection_filed` |
| Cumprimento da resolução verificado | `dispute_compliance_verified` |
| Cumprimento da resolução falhou | `dispute_compliance_failed` |

<a id="92-cross-agent-audit-consistency"></a>

### 9.2 Consistência da auditoria entre agentes

Como as disputas envolvem vários agentes, os auditores deveriam (SHOULD) verificar a consistência entre cadeias:

1. As cadeias de auditoria das duas partes deveriam referenciar o mesmo `dispute_id`
2. Os carimbos de data/hora da apresentação de provas deveriam ser consistentes entre as cadeias
3. Os registros de resolução deveriam estar presentes nas cadeias de todas as partes

<a id="10-security-considerations"></a>

## 10. Considerações de segurança

<a id="101-panel-independence"></a>

### 10.1 Independência do painel

Os membros do painel de arbitragem devem (MUST) ser independentes das partes. A independência é verificada por:

- Nenhuma sessão A2A ativa com nenhuma das partes nos 30 dias anteriores (configurável)
- Nenhum principal em comum com nenhuma das partes
- Nenhuma disputa ativa envolvendo alguma das partes
- Vitalidade acima de 600, para garantir uma participação confiável

<a id="102-evidence-integrity"></a>

### 10.2 Integridade das provas

Todas as referências a provas são endereçadas por conteúdo (com hash). As provas não podem ser alteradas após a apresentação sem que isso seja detectado. As implementações deveriam (SHOULD):

- Armazenar as provas de forma imutável depois de apresentadas
- Rejeitar provas cujos hashes de conteúdo não coincidam
- Registrar com carimbo de data/hora a apresentação de provas na cadeia de auditoria

<a id="103-dispute-flooding"></a>

### 10.3 Inundação de disputas

Um agente malicioso poderia abrir disputas infundadas para sobrecarregar as contrapartes ou os recursos de arbitragem. Mitigações:

- Limitação de taxa: número máximo de disputas por agente por período (configurável; padrão: 10 a cada 24 h)
- Custo de abertura: os agentes que abrem disputas resolvidas contra eles acumulam uma pontuação de disputas que eleva seu limite de abertura
- Validação da gravidade: disputas de gravidade crítica exigem provas que as sustentem no momento da abertura

<a id="104-panel-collusion"></a>

### 10.4 Conluio do painel

A arbitragem M de N mitiga o viés individual, mas não o conluio coordenado. Mitigações:

- Os membros do painel são escolhidos de um grupo distribuído entre organizações
- A seleção dos membros do painel usa funções aleatórias verificáveis quando possível
- As opiniões divergentes ficam registradas permanentemente
- O recurso humano está sempre disponível

<a id="105-domain-separation"></a>

### 10.5 Separação de domínio

Todas as assinaturas segundo esta especificação usam a tag de separação de domínio `DCP-DISPUTE-SIG-v2`, o que impede a repetição de assinaturas entre protocolos.

<a id="11-conformance"></a>

## 11. Conformidade

Uma implementação está em conformidade com o DCP-07 se:

1. Oferece suporte aos quatro tipos de disputa definidos na seção 3
2. Implementa o modelo de escalonamento em três níveis definido na seção 5
3. Oferece suporte a painéis de arbitragem M de N com limites configuráveis conforme a seção 5.2
4. Gera registros de disputa, resoluções de arbitragem e registros de objeção em conformidade com os schemas das seções 4, 6 e 8
5. Empacota as disputas resolvidas como pacotes de jurisprudência conforme a seção 7
6. Aplica os prazos de escalonamento com base na gravidade, conforme a seção 3.2
7. Cria entradas de auditoria do DCP-03 para todos os eventos de disputa conforme a seção 9
8. Usa a tag de separação de domínio `DCP-DISPUTE-SIG-v2` em todas as assinaturas

<a id="references"></a>

## Referências

- DCP-01: Identidade e vinculação ao principal
- DCP-02: Declaração de intenção e controle por políticas
- DCP-03: Cadeia de auditoria e transparência
- DCP-04: Comunicação entre agentes
- DCP-05: Ciclo de vida do agente
- DCP-08: Direitos e obrigações

---

*Esta especificação reconhece que o conflito não é uma falha dos sistemas multiagentes, mas uma característica inerente. A medida de um protocolo não é se surgem conflitos, mas se eles são resolvidos de forma justa, transparente e com plena responsabilização.*

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- **Registros em `schemas/v2/`.** O registro de disputa, a resolução de arbitragem, o pacote de jurisprudência e o
  registro de objeção que os SDKs constroem e que `schemas/v2/` valida têm campos diferentes dos exemplos de §4 a §8.
  Uma disputa tem um único `respondent_agent_id`, `evidence_hashes` e nenhuma gravidade nem prazo; seu `status` é um de
  `open`, `in_negotiation`, `arbitrated`, `appealed` ou `resolved`, não os oito status de §4.2. Uma objeção referencia
  um `directive_hash` e seu `objection_type` é `ethical`, `safety`, `policy_violation` ou `capability_mismatch`, não os
  quatro tipos de §8.3. O `authority_level` de um pacote de jurisprudência é `local`, `organizational` ou `cross_org`.
- **Assinaturas.** Cada registro tem uma única `composite_sig` (Ed25519 + ML-DSA-65) de quem detém as chaves passadas,
  com o contexto `DCP-AI.v2.Dispute`; os SDKs não usam a tag `DCP-DISPUTE-SIG-v2`.
- **O que as funções auxiliares fazem.** Elas constroem e assinam registros; o escalonamento e a resolução só acontecem
  quando quem chama os solicita. `createDispute` sempre começa em `direct_negotiation` com o status `open`, seja qual for
  o tipo de disputa. `escalateDispute` sobe um nível e define `in_negotiation`; nada escalona ao vencer um prazo, porque
  não há temporizadores. `resolveDispute` define `resolved` em qualquer nível. `createArbitrationPanel` só verifica se o
  limite é pelo menos 1 e se há pelo menos esse número de IDs de árbitros; não verifica independência, vitalidade nem
  estado do ciclo de vida, e `submitResolution` assina com uma única chave os IDs de árbitros e o texto que recebe, sem
  coletar votos. `lookupPrecedent` filtra por `category` e, opcionalmente, por um contexto; não ordena.
- Esses registros são declarações assinadas de quem os assina; os SDKs e os serviços não fazem cumprir nenhuma
  resolução. Os exemplos são ilustrações com marcadores, não fixtures. Para os tipos do SDK, consulte
  [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md).
