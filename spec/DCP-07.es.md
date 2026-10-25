<sub>[English](DCP-07.md) · [中文](DCP-07.zh-CN.md) · **Español** · [日本語](DCP-07.ja.md) · [Português](DCP-07.pt-BR.md)</sub>

<a id="dcp-07-conflict-resolution"></a>

# DCP-07: Resolución de conflictos

> Traducción informativa de [la especificación en inglés](DCP-07.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

<a id="status"></a>

## Estado
Publicada — v2.0 (extensión; las revisiones se gestionan según los comentarios de quienes la adoptan)

<a id="abstract"></a>

## Resumen
Esta especificación define un protocolo estructurado y auditable para resolver conflictos entre agentes de IA certificados por DCP. Introduce un modelo de escalado en tres niveles (negociación directa, arbitraje contextual, apelación humana), registros de disputa tipados, paneles de arbitraje M de N, paquetes de jurisprudencia para el seguimiento de precedentes y registros de objeción para el disenso formal. Todos los artefactos de resolución de conflictos se firman criptográficamente y se encadenan por hash, lo que produce un registro de cada disputa y de su resolución que permite detectar manipulaciones.

<a id="1-introduction"></a>

## 1. Introducción

A medida que los agentes de IA que operan con DCP interactúan cada vez más entre sí (DCP-04), los conflictos son inevitables. Los agentes pueden competir por recursos compartidos, recibir directrices contradictorias de distintos principales, discrepar sobre los límites de sus capacidades o interpretar las políticas de forma diferente. Sin un mecanismo formal de resolución, esos conflictos o bien escalan a operadores humanos sin un contexto estructurado, o bien acaban en bloqueos y fallos en cascada.

DCP-07 proporciona un marco de resolución de conflictos en el nivel del protocolo que:

- Clasifica las disputas por tipo para permitir estrategias de resolución adecuadas
- Define un modelo de escalado en tres niveles, empezando por la negociación entre agentes
- Crea registros firmados y auditables de cada disputa, de cada intento de resolución y de cada resultado
- Construye un sistema de jurisprudencia en el que las disputas resueltas sirven de precedente
- Preserva el derecho de cualquier parte a objetar formalmente una resolución

<a id="11-design-principles"></a>

### 1.1 Principios de diseño
- Los conflictos deberían resolverse en el nivel más bajo posible
- Cada disputa y cada intento de resolución se firma y se registra
- La apelación humana está siempre disponible como último recurso
- Las disputas resueltas crean precedentes que mejoran las resoluciones futuras
- Ningún agente está obligado a aceptar una resolución sin poder recurrir a una objeción

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relación con otras especificaciones
- **DCP-01**: la identidad del agente determina su legitimación para plantear disputas o responder a ellas
- **DCP-02**: los conflictos de políticas son un tipo principal de disputa; los resultados de las políticas alimentan el contexto de la disputa
- **DCP-03**: todos los eventos de disputa se registran en la cadena de auditoría
- **DCP-04**: los mensajes de negociación de las disputas se intercambian por canales A2A
- **DCP-05**: un agente en estado `declining` tiene una capacidad limitada para participar en disputas
- **DCP-08**: las vulneraciones de derechos (DCP-08) desencadenan disputas según esta especificación

<a id="2-terminology"></a>

## 2. Terminología

**Disputa**: una declaración formal de uno o varios agentes de que existe un conflicto que requiere resolución.

**Parte en disputa**: un agente que es parte de una disputa, ya sea como iniciador (reclamante) o como demandado.

**Nivel de escalado**: una de las tres fases de resolución: `direct_negotiation`, `contextual_arbitration` o `human_appeal`.

**Panel de arbitraje**: un grupo de agentes (o un panel mixto de agentes y personas) convocado para resolver una disputa en el nivel de arbitraje contextual. Las decisiones requieren un acuerdo M de N.

**Paquete de jurisprudencia**: un registro sellado de una disputa resuelta, con su contexto, sus argumentos y su resultado, que sirve de precedente para disputas futuras.

**Registro de objeción**: una declaración formal y firmada de desacuerdo con el resultado de una resolución.

**Etiqueta de separación de dominio**: `DCP-DISPUTE-SIG-v2`, usada en todas las firmas producidas según esta especificación.

<a id="3-dispute-types"></a>

## 3. Tipos de disputa

<a id="31-classification"></a>

### 3.1 Clasificación

Las disputas se clasifican en cuatro tipos, cada uno con características de resolución propias:

| Tipo | Código | Descripción | Nivel inicial predeterminado |
|------|------|-------------|----------------------|
| **Conflicto de recursos** | `resource_conflict` | Dos o más agentes compiten por el mismo recurso limitado (cómputo, acceso a datos, cuota de API, ancho de banda de red) | `direct_negotiation` |
| **Conflicto de directrices** | `directive_conflict` | Un agente recibe instrucciones contradictorias de varios principales, o de un principal y una política de la organización | `contextual_arbitration` |
| **Conflicto de capacidades** | `capability_conflict` | Desacuerdo sobre si un agente tiene la capacidad o la autoridad para realizar una acción concreta | `direct_negotiation` |
| **Conflicto de políticas** | `policy_conflict` | Dos o más agentes interpretan de forma distinta una política compartida, o la acción de un agente choca con las restricciones de política de otro | `direct_negotiation` |

<a id="32-severity-levels"></a>

### 3.2 Niveles de gravedad

Cada disputa tiene un nivel de gravedad que influye en los plazos de escalado:

| Gravedad | Código | Plazo de escalado |
|----------|------|-------------------|
| **Baja** | `low` | 24 horas por nivel |
| **Media** | `medium` | 4 horas por nivel |
| **Alta** | `high` | 1 hora por nivel |
| **Crítica** | `critical` | 15 minutos por nivel |

Si una disputa no se resuelve dentro de su plazo de escalado en el nivel actual, debe (MUST) escalarse automáticamente al nivel siguiente.

<a id="4-dispute-record"></a>

## 4. Registro de disputa

<a id="41-schema"></a>

### 4.1 Esquema

Referencia del esquema: `schemas/v2/dispute_record.schema.json`

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

### 4.2 Ciclo de vida de la disputa

```
 opened ──> negotiating ──> escalated ──> arbitrating ──> escalated ──> appealing ──> resolved
                │                              │                              │
                └──────── resolved ◄───────────┘──────── resolved ◄───────────┘
                                                                              │
                                                                    withdrawn/abandoned
```

Estados válidos: `open`, `negotiating`, `escalated`, `arbitrating`, `appealing`, `resolved`, `withdrawn`, `abandoned`.

Una disputa queda `abandoned` si vencen todos los plazos de escalado sin resolución y ninguna parte solicita un escalado posterior.

<a id="5-three-level-escalation-model"></a>

## 5. Modelo de escalado en tres niveles

<a id="51-level-1-direct-negotiation"></a>

### 5.1 Nivel 1: negociación directa

Los agentes en disputa intentan resolver el conflicto directamente mediante mensajería A2A de DCP-04.

**Proceso:**

1. El reclamante abre la disputa creando un registro de disputa y enviándolo a los demandados mediante A2A
2. Los demandados acusan recibo y aportan contrapruebas o propuestas de resolución
3. Los agentes intercambian propuestas de resolución
4. Si todas las partes aceptan una propuesta, la disputa queda resuelta
5. La resolución se registra en un registro de resolución de arbitraje (sección 6)

**Estrategias de negociación** (las implementaciones pueden (MAY) admitirlas):

- **Turnos**: los agentes acceden por turnos al recurso disputado
- **Por prioridad**: procede primero el agente con mayor prioridad (según la política o una directriz del principal)
- **Por capacidad**: procede el agente cuya capacidad es más pertinente
- **Aleatoria**: lanzamiento de moneda criptográficamente justo (esquema de compromiso y revelación)

**Desencadenante del escalado**: si la negociación fracasa dentro del plazo de escalado, la disputa debe (MUST) escalar al nivel 2.

<a id="52-level-2-contextual-arbitration"></a>

### 5.2 Nivel 2: arbitraje contextual

Se convoca un panel de arbitraje para resolver la disputa.

**Formación del panel:**

1. Cada parte en disputa propone uno o más candidatos al panel de entre un grupo de árbitros aprobado previamente
2. Se forma un panel M de N (mínimo 3 miembros; de forma predeterminada M=2, N=3)
3. Los miembros del panel no deben (MUST NOT) tener disputas activas con ninguna de las partes
4. Los miembros del panel deben (MUST) tener una vitalidad superior a 600 (DCP-05)
5. Los miembros del panel deben (MUST) estar en el estado de ciclo de vida `active`

**Proceso de arbitraje:**

1. El panel revisa el registro de disputa, las pruebas y los precedentes citados
2. El panel puede (MAY) solicitar pruebas adicionales a las partes
3. Los miembros del panel evalúan de forma independiente y proponen resoluciones
4. El panel vota; se requiere un acuerdo M de N para una resolución vinculante
5. La resolución se registra con el voto de cada miembro del panel

**Tipos de decisión del panel:**

- `binding_resolution`: todas las partes deben cumplirla
- `recommended_resolution`: sugerencia no vinculante; las partes pueden aceptarla o escalar
- `split_decision`: el panel no alcanzó el acuerdo M de N; escala automáticamente al nivel 3

<a id="53-level-3-human-appeal"></a>

### 5.3 Nivel 3: apelación humana

La disputa se escala a los principales humanos para su resolución.

**Proceso:**

1. Se presentan a los principales responsables de todas las partes el registro de disputa completo, las pruebas, el historial de arbitraje y las objeciones que haya
2. Los principales pueden deliberar, negociar o aplicar la política de la organización
3. La decisión humana se registra como resolución definitiva y vinculante
4. Si los principales no llegan a un acuerdo, se aplican los procedimientos de escalado de la organización (fuera del alcance de DCP)

**Garantías de la apelación humana:**

- Cualquier parte puede (MAY) escalar a la apelación humana en cualquier momento, saltándose los niveles anteriores
- Las disputas de gravedad crítica pueden (MAY) empezar en el nivel de apelación humana
- Las decisiones humanas son definitivas dentro del protocolo DCP

<a id="6-arbitration-resolution"></a>

## 6. Resolución de arbitraje

<a id="61-schema"></a>

### 6.1 Esquema

Referencia del esquema: `schemas/v2/arbitration_resolution.schema.json`

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

### 6.2 Cumplimiento de la resolución

Tras una resolución vinculante:

1. Todas las partes deben (MUST) cumplirla en el plazo indicado
2. El cumplimiento se verifica con el método indicado en la resolución (normalmente, la revisión de la cadena de auditoría)
3. El incumplimiento es en sí mismo una disputa (tipo: `policy_conflict`) y escala directamente a la apelación humana
4. El incumplimiento reiterado puede (MAY) desencadenar una terminación por causa (DCP-05)

<a id="7-jurisprudence-bundle"></a>

## 7. Paquete de jurisprudencia

<a id="71-purpose"></a>

### 7.1 Propósito

Las disputas resueltas se empaquetan como paquetes de jurisprudencia: registros sellados y referenciables que sirven de precedente para la resolución de disputas futuras. Así se crea un cuerpo de «jurisprudencia» en evolución que mejora la coherencia de las resoluciones con el tiempo.

<a id="72-schema"></a>

### 7.2 Esquema

Referencia del esquema: `schemas/v2/jurisprudence_bundle.schema.json`

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

### 7.3 Búsqueda de precedentes

Cuando se abre una disputa nueva, los agentes y los paneles de arbitraje deberían (SHOULD) buscar precedentes aplicables en el registro de jurisprudencia:

1. Filtrar por `dispute_type`
2. Buscar coincidencias en `applicable_conditions`
3. Excluir según `inapplicable_conditions`
4. Ordenar por `authority_level` (human_appeal > contextual_arbitration > direct_negotiation)
5. Preferir los precedentes más recientes cuando los fallos entren en conflicto

El precedente es orientativo, no estrictamente vinculante. Los paneles de arbitraje y los principales humanos pueden (MAY) apartarse del precedente con un razonamiento documentado.

<a id="74-supersession"></a>

### 7.4 Sustitución

Un paquete de jurisprudencia puede quedar sustituido por un fallo posterior sobre la misma cuestión. Cuando se sustituye:

- El campo `superseded_by` se actualiza para hacer referencia al nuevo paquete de jurisprudencia
- El campo `supersedes` del paquete que lo sustituye enumera los paquetes anteriores
- Los paquetes sustituidos permanecen en el registro como referencia histórica, pero pierden prioridad en la búsqueda de precedentes

<a id="8-objection-record"></a>

## 8. Registro de objeción

<a id="81-purpose"></a>

### 8.1 Propósito

Cualquier parte en disputa puede objetar formalmente el resultado de una resolución. Las objeciones se registran como artefactos firmados y con marca de tiempo que pasan a formar parte del registro permanente de la disputa. Presentar una objeción no revierte automáticamente una resolución, pero conserva el disenso del agente y puede servir de base para apelaciones futuras o para impugnar precedentes.

<a id="82-schema"></a>

### 8.2 Esquema

Referencia del esquema: `schemas/v2/objection_record.schema.json`

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

### 8.3 Tipos de objeción

| Tipo | Código | Descripción |
|------|------|-------------|
| **Sustantiva** | `substantive` | La resolución es errónea en el fondo; las pruebas o el razonamiento no respaldan el resultado |
| **Procedimental** | `procedural` | El proceso de resolución tuvo defectos (sesgo del panel, pruebas pasadas por alto, extralimitación) |
| **De precedente** | `precedent` | La resolución contradice la jurisprudencia establecida sin una justificación adecuada |
| **De derechos** | `rights` | La resolución vulnera los derechos de un agente definidos en DCP-08 |

<a id="84-objection-handling"></a>

### 8.4 Tramitación de las objeciones

1. Las objeciones presentadas se añaden al registro de disputa y se incluyen en el paquete de jurisprudencia
2. La resolución sigue en vigor salvo que un principal humano ordene su suspensión
3. Las objeciones de tipo `rights` deben (MUST) remitirse al nivel de apelación humana para su revisión
4. Las objeciones dan fundamento para futuras impugnaciones de precedentes (sección 7.4)

<a id="9-audit-integration"></a>

## 9. Integración con la auditoría

<a id="91-dispute-audit-events"></a>

### 9.1 Eventos de auditoría de las disputas

Todos los eventos del ciclo de vida de una disputa generan entradas de auditoría de DCP-03:

| Evento | `event_type` |
|-------|-------------|
| Disputa abierta | `dispute_opened` |
| Prueba presentada | `dispute_evidence_submitted` |
| Propuesta de negociación enviada | `dispute_negotiation_proposal` |
| Disputa escalada | `dispute_escalated` |
| Panel de arbitraje formado | `arbitration_panel_formed` |
| Voto del panel emitido | `arbitration_vote_cast` |
| Resolución emitida | `dispute_resolved` |
| Objeción presentada | `dispute_objection_filed` |
| Cumplimiento de la resolución verificado | `dispute_compliance_verified` |
| Cumplimiento de la resolución fallido | `dispute_compliance_failed` |

<a id="92-cross-agent-audit-consistency"></a>

### 9.2 Coherencia de la auditoría entre agentes

Como las disputas implican a varios agentes, los auditores deberían (SHOULD) verificar la coherencia entre cadenas:

1. Las cadenas de auditoría de ambas partes deberían hacer referencia al mismo `dispute_id`
2. Las marcas de tiempo de presentación de pruebas deberían ser coherentes entre cadenas
3. Los registros de resolución deberían estar presentes en las cadenas de todas las partes

<a id="10-security-considerations"></a>

## 10. Consideraciones de seguridad

<a id="101-panel-independence"></a>

### 10.1 Independencia del panel

Los miembros del panel de arbitraje deben (MUST) ser independientes de las partes. La independencia se verifica comprobando:

- Que no hay sesiones A2A activas con ninguna de las partes en los 30 días anteriores (configurable)
- Que no comparten principal con ninguna de las partes
- Que no hay disputas activas en las que intervenga alguna de las partes
- Que la vitalidad supera 600, para asegurar una participación fiable

<a id="102-evidence-integrity"></a>

### 10.2 Integridad de las pruebas

Todas las referencias a pruebas se direccionan por contenido (con hash). Las pruebas no pueden alterarse tras su presentación sin que se detecte. Las implementaciones deberían (SHOULD):

- Almacenar las pruebas de forma inmutable una vez presentadas
- Rechazar las pruebas cuyos hashes de contenido no coincidan
- Registrar con marca de tiempo la presentación de pruebas en la cadena de auditoría

<a id="103-dispute-flooding"></a>

### 10.3 Inundación de disputas

Un agente malicioso podría presentar disputas infundadas para saturar a las contrapartes o los recursos de arbitraje. Mitigaciones:

- Limitación de la tasa: número máximo de disputas por agente y periodo (configurable; de forma predeterminada, 10 cada 24 h)
- Coste de presentación: los agentes que presentan disputas que se resuelven en su contra acumulan una puntuación de disputas que eleva su umbral de presentación
- Validación de la gravedad: las disputas de gravedad crítica requieren pruebas que las respalden en el momento de presentarlas

<a id="104-panel-collusion"></a>

### 10.4 Colusión del panel

El arbitraje M de N mitiga el sesgo individual, pero no la colusión coordinada. Mitigaciones:

- Los miembros del panel se extraen de un grupo distribuido entre organizaciones
- La selección de los miembros del panel usa funciones aleatorias verificables cuando es posible
- Las opiniones discrepantes quedan registradas de forma permanente
- La apelación humana está siempre disponible

<a id="105-domain-separation"></a>

### 10.5 Separación de dominio

Todas las firmas según esta especificación usan la etiqueta de separación de dominio `DCP-DISPUTE-SIG-v2`, lo que impide la reproducción de firmas entre protocolos.

<a id="11-conformance"></a>

## 11. Conformidad

Una implementación es conforme con DCP-07 si:

1. Admite los cuatro tipos de disputa definidos en la sección 3
2. Implementa el modelo de escalado en tres niveles definido en la sección 5
3. Admite paneles de arbitraje M de N con umbrales configurables según la sección 5.2
4. Genera registros de disputa, resoluciones de arbitraje y registros de objeción conformes con los esquemas de las secciones 4, 6 y 8
5. Empaqueta las disputas resueltas como paquetes de jurisprudencia según la sección 7
6. Hace cumplir los plazos de escalado según la gravedad, como define la sección 3.2
7. Crea entradas de auditoría de DCP-03 para todos los eventos de disputa según la sección 9
8. Usa la etiqueta de separación de dominio `DCP-DISPUTE-SIG-v2` en todas las firmas

<a id="references"></a>

## Referencias

- DCP-01: Identidad y vinculación con el principal
- DCP-02: Declaración de intenciones y control por políticas
- DCP-03: Cadena de auditoría y transparencia
- DCP-04: Comunicación entre agentes
- DCP-05: Ciclo de vida del agente
- DCP-08: Derechos y obligaciones

---

*Esta especificación reconoce que el conflicto no es un fallo de los sistemas multiagente, sino un rasgo inherente. La medida de un protocolo no es si surgen conflictos, sino si se resuelven de forma justa, transparente y con plena rendición de cuentas.*

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- **Registros en `schemas/v2/`.** El registro de disputa, la resolución de arbitraje, el paquete de jurisprudencia y el
  registro de objeción que construyen los SDK y que valida `schemas/v2/` tienen campos distintos de los ejemplos de §4 a
  §8. Una disputa tiene un único `respondent_agent_id`, `evidence_hashes` y ninguna gravedad ni plazo; su `status` es
  uno de `open`, `in_negotiation`, `arbitrated`, `appealed` o `resolved`, no los ocho estados de §4.2. Una objeción
  hace referencia a un `directive_hash` y su `objection_type` es `ethical`, `safety`, `policy_violation` o
  `capability_mismatch`, no los cuatro tipos de §8.3. El `authority_level` de un paquete de jurisprudencia es `local`,
  `organizational` o `cross_org`.
- **Firmas.** Cada registro lleva una única `composite_sig` (Ed25519 + ML-DSA-65) de quien tenga las claves que se
  pasan, con el contexto `DCP-AI.v2.Dispute`; los SDK no usan la etiqueta `DCP-DISPUTE-SIG-v2`.
- **Lo que hacen las funciones auxiliares.** Construyen y firman registros; el escalado y la resolución solo ocurren
  cuando quien llama lo pide. `createDispute` empieza siempre en `direct_negotiation` con el estado `open`, sea cual sea
  el tipo de disputa. `escalateDispute` sube un nivel y asigna `in_negotiation`; nada escala al vencer un plazo, porque
  no hay temporizadores. `resolveDispute` asigna `resolved` en cualquier nivel. `createArbitrationPanel` solo comprueba
  que el umbral sea al menos 1 y que haya al menos ese número de ID de árbitros; no comprueba la independencia, la
  vitalidad ni el estado del ciclo de vida, y `submitResolution` firma con una sola clave los ID de árbitros y el texto
  que recibe, sin recoger votos. `lookupPrecedent` filtra por `category` y, de forma opcional, por un contexto; no
  ordena.
- Estos registros son declaraciones firmadas de quien los firma; los SDK y los servicios no hacen cumplir ninguna
  resolución. Los ejemplos son ilustraciones con marcadores, no fixtures. Para los tipos del SDK, consulta
  [docs/API_REFERENCE.md](../docs/API_REFERENCE.md).
