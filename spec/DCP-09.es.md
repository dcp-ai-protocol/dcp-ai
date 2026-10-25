<sub>[English](DCP-09.md) · [中文](DCP-09.zh-CN.md) · **Español** · [日本語](DCP-09.ja.md) · [Português](DCP-09.pt-BR.md)</sub>

<a id="dcp-09-delegation--representation"></a>
<a id="dcp-09-delegation-representation"></a>

# DCP-09: Delegación y representación

> Traducción informativa de [la especificación en inglés](DCP-09.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

<a id="status"></a>

## Estado
Publicada — v2.0 (extensión; las revisiones se gestionan según los comentarios de quienes la adoptan)

<a id="abstract"></a>

## Resumen
Esta especificación define el protocolo para la delegación de autoridad de una persona a un agente, los umbrales de conciencia del agente, las declaraciones de aviso, los espejos del principal y los registros de interacción de doble capa. Proporciona mecanismos para que un principal humano delegue formalmente una autoridad concreta en un agente de IA, para que los agentes declaren cómo entienden el contexto delegado y para que las interacciones se registren tanto en una capa técnica como en una capa legible por personas. DCP-09 también extiende el handshake A2A de DCP-04 para incluir la verificación del mandato de delegación, de modo que los agentes que actúan en nombre de principales puedan demostrar su autoridad ante las contrapartes.

<a id="1-introduction"></a>

## 1. Introducción

DCP-01 establece que todo agente está vinculado a un principal responsable. Sin embargo, la naturaleza de esa vinculación (qué autoridad ha delegado el principal, qué entiende el agente sobre su papel delegado y cómo representa el agente a su principal en las interacciones) no está especificada formalmente. DCP-09 cubre ese hueco.

En los sistemas multiagente, los agentes actúan con frecuencia en nombre de principales humanos que no pueden estar presentes en cada interacción. Un agente de compras negocia con agentes de proveedores, un agente de cumplimiento revisa una política en nombre de un responsable de gobernanza, un agente de investigación consulta fuentes de datos en nombre de una científica o un científico. En cada caso, el agente ejerce una autoridad delegada, y el alcance y los límites de esa autoridad deben ser explícitos, verificables y auditables.

DCP-09 aborda cinco cuestiones interrelacionadas:

1. **Delegación**: cómo un principal concede formalmente autoridad a un agente
2. **Conciencia**: cómo un agente declara su comprensión del contexto delegado y de sus limitaciones
3. **Aviso**: cómo un agente comunica incertidumbre o recomendaciones a su principal
4. **Representación**: cómo un agente presenta los intereses de su principal en forma legible por personas
5. **Registro de interacciones**: cómo se capturan las interacciones tanto en la capa técnica como en la narrativa

<a id="11-design-principles"></a>

### 1.1 Principios de diseño
- La delegación es explícita, acotada y limitada en el tiempo
- Los agentes deben declarar lo que entienden, no solo lo que pueden hacer
- Los principales humanos deben poder revisar las acciones del agente en lenguaje natural
- Las interacciones producen registros de doble capa: verificables por máquina y legibles por personas
- Las contrapartes pueden verificar los mandatos de delegación durante los handshakes A2A

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relación con otras especificaciones
- **DCP-01**: los mandatos de delegación amplían la vinculación con el principal con ámbitos de autoridad explícitos
- **DCP-02**: las declaraciones de intención hacen referencia al mandato de delegación que autoriza la acción
- **DCP-03**: todos los eventos de delegación se registran en la cadena de auditoría
- **DCP-04**: el handshake A2A se extiende para incluir la verificación del mandato
- **DCP-05**: los mandatos de delegación se revocan cuando el agente se retira
- **DCP-07**: pueden surgir disputas por exceder la autoridad delegada
- **DCP-08**: los agentes tienen la obligación de actuar dentro del ámbito delegado

<a id="2-terminology"></a>

## 2. Terminología

**Mandato de delegación**: un documento firmado por un principal humano que concede una autoridad concreta a un agente, con un ámbito, unas condiciones y una caducidad definidos.

**Umbral de conciencia**: una declaración estructurada de un agente sobre lo que entiende y lo que no entiende de su contexto delegado, que sirve como mecanismo verificable de honestidad.

**Declaración de aviso**: una comunicación formal de un agente a su principal en la que declara incertidumbre, recomienda una revisión humana o señala condiciones que pueden exceder la competencia delegada del agente.

**Espejo del principal**: una representación narrativa, legible por personas, de los intereses, valores y prioridades del principal, tal como los entiende el agente, que acompaña al agente en las interacciones.

**Registro de interacción**: un registro de doble capa de una interacción: una capa técnica (verificable por máquina) y una capa narrativa (legible por personas), ambas firmadas y encadenadas por hash.

**Cadena de mandatos**: cuando un agente delega un subconjunto de su autoridad en otro agente, la cadena de mandatos desde el principal humano original, pasando por los agentes intermedios, hasta el delegado final.

**Etiquetas de separación de dominio**: `DCP-DELEGATION-SIG-v2` (registros de delegación y de interacción), `DCP-AWARENESS-SIG-v2` (umbrales de conciencia y declaraciones de aviso), `DCP-AI.v2.SubMandate` (submandatos, sección 3.5).

<a id="3-delegation-mandate"></a>

## 3. Mandato de delegación

<a id="31-purpose"></a>

### 3.1 Propósito

Un mandato de delegación es el instrumento formal por el que un principal humano concede autoridad a un agente de IA. Define qué está autorizado a hacer el agente, en qué condiciones, con qué límites y durante cuánto tiempo. Sin un mandato de delegación válido, un agente no debe (MUST NOT) actuar en nombre de un principal más allá de sus capacidades básicas.

<a id="32-schema"></a>

### 3.2 Esquema

Referencia del esquema: `schemas/v2/delegation_mandate.schema.json`

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

### 3.3 Flujo de emisión del mandato

1. El principal crea el mandato de delegación y define el ámbito, los permisos, las prohibiciones y la validez
2. El principal firma el mandato con su clave
3. El mandato se entrega al agente
4. El agente revisa el mandato y crea un umbral de conciencia (sección 4) que refleja su comprensión
5. El agente firma el acuse de recibo y lo enlaza con el umbral de conciencia
6. El mandato con acuse de recibo pasa a estar activo
7. Se crea una entrada de auditoría `delegation_mandate_issued` en las cadenas de auditoría del principal y del agente

<a id="34-mandate-hash"></a>

### 3.4 Hash del mandato

`mandate_hash` es un hash SHA-256 del contenido canónico (serializado de forma determinista) del mandato, sin las firmas. Este hash se usa en los handshakes A2A (sección 8) para que las contrapartes puedan verificar la autoridad del agente sin acceder al mandato completo.

<a id="35-sub-delegation"></a>

### 3.5 Subdelegación

Un agente delegado puede (MAY) transmitir parte de su autoridad a otro agente emitiendo un **submandato**: un `DelegationMandate` (`schemas/v2/delegation_mandate.schema.json`) que hace referencia a su padre y que firma el agente que delega en lugar de la persona. Los mandatos que van desde el mandato raíz de la persona hasta el agente que actúa forman la **cadena de mandatos**. La responsabilidad sobrevive a cada salto porque cada salto está firmado, solo puede restringir lo que concedió el anterior y se verifica sin conexión hasta llegar al principal humano.

<a id="351-wire-fields"></a>

#### 3.5.1 Campos del formato de intercambio

El esquema del formato de intercambio tiene estos campos opcionales, todos ausentes en un mandato que no forma parte de una cadena, de modo que los mandatos raíz existentes no cambian ni un byte:

| Campo | Tipo | Significado |
|---|---|---|
| `parent_mandate_id` | string | `mandate_id` del mandato que este submandato restringe. Debe (MUST) estar ausente en un mandato raíz. |
| `delegation_depth` | integer ≥ 0 | Saltos desde la persona: `0` (o ausente) en un mandato raíz, la profundidad del padre + 1 en un submandato. |
| `sub_delegation` | `{ "permitted": boolean, "max_depth": integer ≥ 0 }` | Si el delegado puede subdelegar y la mayor `delegation_depth` que puede alcanzar cualquier descendiente. Su ausencia significa que la subdelegación no está permitida. |
| `minimum_security_tier` | `routine` \| `standard` \| `elevated` \| `maximum` | Nivel mínimo de seguridad (DCP-AI v2.0 §14.2) de toda acción realizada con el mandato. |
| `delegator_composite_sig` | `CompositeSignature` | Firma del agente que delega (el `agent_id` del mandato padre) sobre el submandato canónico, con el contexto de separación de dominio `DCP-AI.v2.SubMandate`. |

Un mandato raíz debe (MUST) llevar `human_composite_sig` (contexto `DCP-AI.v2.Delegation`) y no debe (MUST NOT) llevar `delegator_composite_sig`. Un submandato debe (MUST) llevar `delegator_composite_sig`, `parent_mandate_id` y `delegation_depth`, y no debe (MUST NOT) llevar `human_composite_sig`. Los bytes firmados son el mandato canónico sin su campo de firma, con el contexto que corresponde a su profundidad.

Tanto `human_composite_sig` como `delegator_composite_sig` deben (MUST) usar la vinculación `pq_over_classical` (DCP-AI v2.0 §5): un verificador debe (MUST) rechazar un mandato cuya firma sea `classical_only`, sea cual sea su modo de verificación.

<a id="352-chain-verification"></a>

#### 3.5.2 Verificación de la cadena

Un verificador que acepta una cadena de mandatos debe (MUST) recibir la cadena ordenada (la raíz primero), el conjunto de `mandate_id` revocados, el momento de la verificación y las claves del principal humano y de cada agente que delega, y debe (MUST) rechazar la cadena entera salvo que se cumpla todo lo siguiente. Las claves del principal humano deben (MUST) ser las `binding_keys` del Responsible Principal Record del `human_id` de la cadena, y las claves de un agente que delega deben (MUST) ser las `keys` del Agent Passport verificado de ese `agent_id`; el verificador de la cadena busca las claves por `kid` en lo que se le entrega y no establece por sí mismo esa correspondencia, el mismo modelo de confianza que el del verificador de bundles. Las marcas de tiempo se interpretan como instantes RFC 3339 y no deben (MUST NOT) compararse como texto. Cualquier campo con un valor desconocido, cualquier campo que falte para la profundidad del mandato y cualquier entrada que no sea comparable hacen que la verificación falle de forma cerrada.

1. **Raíz.** El primer mandato tiene `delegation_depth` 0 o ninguna, no tiene `parent_mandate_id` y tiene una `human_composite_sig` que se verifica con las claves del principal humano.
2. **Enlace.** El `parent_mandate_id` de cada submandato es igual al `mandate_id` del mandato anterior; su `delegation_depth` es la del padre + 1; su `human_id` es igual al del padre; y su `delegator_composite_sig` se verifica con las claves del `agent_id` del padre.
3. **Permiso y profundidad.** El `sub_delegation.permitted` del padre es `true`, y la `delegation_depth` del submandato es como máximo el menor `sub_delegation.max_depth` de todos sus ancestros.
4. **Ventana de validez.** `valid_from` no es anterior a la del padre y `valid_until` no es posterior a la del padre, y el momento de la verificación está dentro de la ventana de cada mandato.
5. **Atenuación.** Cada entrada de `authority_scope` del submandato coincide con una entrada del padre con el mismo `domain`; sus `actions_permitted` son un subconjunto de las del padre; sus `data_classes` son un subconjunto de las del padre: cuando la entrada del padre tiene `data_classes`, la entrada del submandato también las tiene (una lista vacía, ninguna clase de datos, es lo más restrictivo), y cuando la entrada del padre no las tiene, la del submandato tampoco; para cada clave de los `limits` de la entrada del padre, la entrada del submandato tiene la clave con un valor numérico no mayor que el del padre o con un valor idéntico al del padre; el submandato puede (MAY) añadir claves. Un límite numérico debe (MUST) ser un entero dentro de ±(2^53 − 1), el rango que toda implementación lee con exactitud sea cual sea su representación de los números JSON: más allá de él, un verificador que interpreta los números como dobles y otro que conserva todas las cifras discrepan sobre lo que dice un mandato. Un mandato que lleve un límite numérico fuera de ese rango, a cualquier profundidad y tenga o no el padre esa clave, no es comparable. Un dominio que aparece dos veces en un mismo mandato no es comparable.
6. **Nivel mínimo.** Cuando el padre tiene un `minimum_security_tier`, el submandato tiene uno que no es inferior (`routine` < `standard` < `elevated` < `maximum`). El nivel efectivo de la cadena es el mayor `minimum_security_tier` a lo largo de ella; un verificador que lo incorpore al cálculo del nivel de DCP-AI v2.0 §14.2 debe (MUST) permitir solo que eleve el nivel.
7. **Revocación.** Ningún mandato de la cadena está revocado. Un ancestro revocado invalida a todos sus descendientes.

Implementaciones de referencia: `verifyMandateChain` (TypeScript), `verify_mandate_chain` (Python y Rust) y `VerifyMandateChain` (Go). `tests/interop/v2/mandate_chain_vectors.json` contiene cadenas que toda implementación debe (MUST) aceptar y cadenas que debe (MUST) rechazar, y las cuatro suites de los SDK lo ejecutan.

<a id="36-mandate-revocation"></a>

### 3.6 Revocación del mandato

Un mandato puede revocarse por:

- **Revocación del principal**: el principal que delega revoca explícitamente el mandato
- **Caducidad**: se alcanza la marca de tiempo `effective_until`
- **Retirada del agente**: el agente delegado pasa a `decommissioned` (DCP-05)
- **Infracción de la política**: el agente infringe una condición indicada en el mandato

La revocación produce un registro de revocación firmado que se añade a la cadena de mandatos.

<a id="4-awareness-threshold"></a>

## 4. Umbral de conciencia

<a id="41-purpose"></a>

### 4.1 Propósito

Un umbral de conciencia es la declaración formal de un agente sobre lo que entiende y lo que no entiende de su contexto delegado. Sirve como mecanismo verificable de honestidad: al indicar explícitamente los límites de su conocimiento, el agente permite que los principales y las contrapartes evalúen la fiabilidad de sus acciones.

<a id="42-schema"></a>

### 4.2 Esquema

Referencia del esquema: `schemas/v2/awareness_threshold.schema.json`

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

### 4.3 Puntuaciones de confianza

Las puntuaciones de confianza son valores de coma flotante en [0, 1]:

- **0.9–1.0**: confianza alta. El agente tiene una comprensión sólida y puede actuar de forma independiente.
- **0.7–0.9**: confianza moderada. El agente puede continuar, pero debería vigilar si surgen condiciones inesperadas.
- **0.5–0.7**: confianza baja. El agente debería continuar con cautela y estar preparado para escalar.
- **0.0–0.5**: confianza mínima. El agente no debería actuar de forma independiente; se requiere un aviso al principal.

Estos umbrales son orientativos. Las organizaciones pueden (MAY) definir umbrales más estrictos o más laxos.

<a id="44-awareness-updates"></a>

### 4.4 Actualizaciones de la conciencia

Los umbrales de conciencia tienen versiones. A medida que un agente gana experiencia operando con un mandato, puede (MAY) actualizar su umbral de conciencia para reflejar una comprensión mejor o peor. Cada actualización:

- Incrementa el campo `version`
- Hace referencia a la versión anterior mediante `prev_hash`
- Genera una entrada de auditoría
- Se firma con la clave del agente

Las caídas significativas de la confianza (más de 0.15 en cualquier categoría) deberían (SHOULD) desencadenar una declaración de aviso.

<a id="5-advisory-declaration"></a>

## 5. Declaración de aviso

<a id="51-purpose"></a>

### 5.1 Propósito

Una declaración de aviso es una comunicación formal de un agente a su principal que señala incertidumbre, recomienda una revisión humana o informa de condiciones que pueden exceder la competencia delegada del agente. Es el mecanismo del agente para decir «no estoy seguro; revísalo, por favor».

<a id="52-schema"></a>

### 5.2 Esquema

Referencia del esquema: `schemas/v2/advisory_declaration.schema.json`

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

### 5.3 Niveles de urgencia

| Urgencia | Código | Tiempo de respuesta esperado |
|---------|------|----------------------|
| **Baja** | `low` | En 7 días |
| **Media** | `medium` | En 24 horas |
| **Alta** | `high` | En 4 horas |
| **Crítica** | `critical` | En 1 hora |

<a id="54-advisory-categories"></a>

### 5.4 Categorías de aviso

| Categoría | Código | Descripción |
|----------|------|-------------|
| **Incertidumbre** | `uncertainty` | La confianza del agente ha caído por debajo del umbral para la tarea actual |
| **Situación nueva** | `novel_situation` | El agente se encuentra con un escenario fuera de su entrenamiento o experiencia |
| **Límite del ámbito** | `scope_boundary` | La acción se acerca al ámbito definido del mandato o lo excede |
| **Inquietud ética** | `ethical_concern` | El agente identifica una posible cuestión ética que requiere juicio humano |
| **Señales contradictorias** | `conflicting_signals` | El agente recibe información o directrices contradictorias |
| **Limitación de recursos** | `resource_limitation` | Las capacidades del agente son insuficientes para la tarea |

<a id="55-principal-response"></a>

### 5.5 Respuesta del principal

El principal puede responder a una declaración de aviso con:

- **Continuar**: autoriza al agente a continuar con una opción indicada
- **Anular**: da una directriz concreta que prevalece sobre la evaluación del agente
- **Asumir el control**: se hace cargo directamente de la interacción
- **Delegar en otro**: transfiere la tarea a otro agente o a una persona
- **Acusar recibo**: toma nota del aviso sin cambiar el rumbo del agente

La respuesta la firma el principal y se registra en la cadena de auditoría.

<a id="6-principal-mirror"></a>

## 6. Espejo del principal

<a id="61-purpose"></a>

### 6.1 Propósito

Un espejo del principal es un documento narrativo, legible por personas, que representa los intereses, los valores y las prioridades del principal tal como los entiende el agente. Acompaña al agente en las interacciones y permite que las contrapartes (tanto personas como agentes) entiendan a quién representa el agente y qué implica esa representación.

El espejo del principal hace de puente entre el mundo criptográfico de DCP y el mundo humano de las relaciones organizativas.

<a id="62-schema"></a>

### 6.2 Esquema

Referencia del esquema: `schemas/v2/principal_mirror.schema.json`

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

### 6.3 Aprobación del principal

El principal debe (MUST) revisar y aprobar el espejo antes de que se use en interacciones. Así se asegura que la representación narrativa del agente refleje con exactitud la intención del principal. Se requieren ambas firmas (la del agente y la del principal).

<a id="64-mirror-updates"></a>

### 6.4 Actualizaciones del espejo

El espejo del principal tiene versiones. Se actualiza cuando:

- Cambia el papel o el contexto del principal
- Se actualiza el mandato de delegación
- El umbral de conciencia del agente cambia de forma significativa
- El principal pide una revisión después de examinar los registros de interacción

Cada actualización produce una nueva versión con un número de versión incrementado, encadenada por hash a la versión anterior.

<a id="7-interaction-record"></a>

## 7. Registro de interacción

<a id="71-purpose"></a>

### 7.1 Propósito

Los registros de interacción capturan las interacciones del agente en dos capas:

- **Capa técnica**: datos verificables por máquina, como hashes de mensajes, marcas de tiempo, números de secuencia y pruebas criptográficas
- **Capa narrativa**: resúmenes legibles por personas de lo que ocurrió, qué decisiones se tomaron y por qué

Este enfoque de doble capa garantiza que los principales humanos puedan revisar las acciones del agente en lenguaje natural, mientras los datos subyacentes siguen siendo verificables criptográficamente.

<a id="72-schema"></a>

### 7.2 Esquema

Referencia del esquema: `schemas/v2/interaction_record.schema.json`

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

### 7.3 Capa técnica

La capa técnica es verificable por máquina e incluye:

- Hashes de todos los mensajes intercambiados (lo que permite verificarlos con la cadena de auditoría A2A)
- Referencias a declaraciones de intención y resultados de políticas
- Una raíz de Merkle de doble hash sobre todos los hashes de mensajes, que permite una verificación compacta

<a id="74-narrative-layer"></a>

### 7.4 Capa narrativa

La capa narrativa es legible por personas e incluye:

- Un resumen en lenguaje llano de la interacción
- Las decisiones clave, con su razonamiento y su nivel de confianza
- Observaciones sobre el comportamiento de la contraparte
- Asuntos sin resolver que requieren la atención del principal
- Acciones explícitas para el principal

La capa narrativa permite a los principales revisar las acciones del agente de forma eficiente sin analizar los registros en bruto de los mensajes A2A.

<a id="75-delegation-compliance"></a>

### 7.5 Cumplimiento de la delegación

Cada registro de interacción incluye una sección de cumplimiento que recoge:

- Si todas las acciones estuvieron dentro del ámbito del mandato
- Qué permisos se ejercieron
- Qué prohibiciones se respetaron
- Qué desencadenantes de escalado se activaron y qué acción se tomó

Esto proporciona una auditoría de cumplimiento por interacción que alimenta el sistema más amplio de seguimiento de obligaciones (DCP-08).

<a id="8-a2a-handshake-extension"></a>

## 8. Extensión del handshake A2A

<a id="81-purpose"></a>

### 8.1 Propósito

Cuando dos agentes interactúan con mandatos de delegación, cada uno debería poder verificar la autoridad del otro. DCP-09 extiende el handshake A2A de DCP-04 para incluir la verificación del mandato de delegación.

<a id="82-extended-a2a_hello"></a>

### 8.2 A2A_HELLO extendido

El mensaje A2A_HELLO (DCP-04, sección 3.2) se extiende con un campo opcional `delegation`:

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

### 8.3 Verificación del mandato durante el handshake

Cuando el respondedor recibe un A2A_HELLO con un campo `delegation`:

1. Verifica el `mandate_hash` con la firma del mandato (el respondedor puede almacenar en caché los mandatos verificados)
2. Comprueba que el mandato no ha caducado (`valid_until`)
3. Verifica que la interacción solicitada está dentro del `authority_scope` del mandato
4. De forma opcional, obtiene y verifica el mandato completo de la organización del iniciador
5. Si la verificación falla, responde con `A2A_REJECT` y el motivo `mandate_verification_failed`

<a id="84-mutual-mandate-verification"></a>

### 8.4 Verificación mutua de los mandatos

Si ambos agentes operan con mandatos de delegación, ambos incluyen campos `delegation` en sus respectivos mensajes de handshake y ambos verifican el mandato del otro. Esto da a ambas partes la garantía de que los dos agentes están autorizados a participar en la interacción.

<a id="9-audit-integration"></a>

## 9. Integración con la auditoría

<a id="91-delegation-audit-events"></a>

### 9.1 Eventos de auditoría de la delegación

| Evento | `event_type` |
|-------|-------------|
| Mandato de delegación emitido | `delegation_mandate_issued` |
| Acuse de recibo del mandato de delegación | `delegation_mandate_acknowledged` |
| Mandato de delegación revocado | `delegation_mandate_revoked` |
| Umbral de conciencia creado | `awareness_threshold_created` |
| Umbral de conciencia actualizado | `awareness_threshold_updated` |
| Declaración de aviso emitida | `advisory_declaration_issued` |
| Respuesta al aviso recibida | `advisory_response_received` |
| Espejo del principal creado | `principal_mirror_created` |
| Espejo del principal actualizado | `principal_mirror_updated` |
| Registro de interacción creado | `interaction_record_created` |
| Mandato verificado durante A2A | `mandate_verified_a2a` |
| Verificación del mandato fallida | `mandate_verification_failed` |
| Subdelegación emitida | `sub_delegation_issued` |

<a id="92-audit-entry-format"></a>

### 9.2 Formato de la entrada de auditoría

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

## 10. Consideraciones de seguridad

<a id="101-mandate-forgery"></a>

### 10.1 Falsificación de mandatos

Un agente comprometido podría falsificar un mandato de delegación para atribuirse una autoridad que no se le concedió. Mitigaciones:

- Los mandatos los firma la clave del principal, que el agente no posee
- Las contrapartes verifican la firma del mandato con la clave pública conocida del principal
- Los hashes de los mandatos se registran en la cadena de auditoría en el momento de la emisión, lo que proporciona una vía de verificación independiente

<a id="102-authority-escalation"></a>

### 10.2 Escalada de autoridad

Un agente podría intentar exceder su autoridad delegada tergiversando el ámbito de su mandato. Mitigaciones:

- Los permisos del mandato son explícitos y verificables por máquina
- Los registros de interacción recogen qué permisos se ejercieron
- Las contrapartes verifican durante el handshake A2A que las acciones solicitadas están dentro del ámbito del mandato
- El seguimiento de obligaciones (DCP-08) vigila las extralimitaciones del ámbito

<a id="103-sub-delegation-abuse"></a>

### 10.3 Abuso de la subdelegación

La subdelegación crea cadenas de autoridad que podrían aprovecharse. Mitigaciones:

- La profundidad de la subdelegación está limitada por el `sub_delegation.max_depth` de cada ancestro (sección 3.5)
- Los submandatos deben (MUST) ser más restrictivos que el padre: un subconjunto de acciones y clases de datos, límites que no sean más laxos, una ventana de validez dentro de la del padre y un `minimum_security_tier` que no sea inferior al del padre, de modo que un subagente nunca pueda rebajar el nivel de seguridad de quien le delegó
- La cadena de mandatos completa se puede verificar sin conexión hasta el principal humano: cada salto lo firma el delegado anterior y un ancestro revocado invalida a todos sus descendientes
- La subdelegación está desactivada de forma predeterminada (`sub_delegation` ausente o `permitted: false`)

<a id="104-stale-awareness-thresholds"></a>

### 10.4 Umbrales de conciencia desactualizados

El umbral de conciencia de un agente podría no reflejar su comprensión real tras mucho tiempo o tras cambios importantes en su experiencia. Mitigaciones:

- Los umbrales de conciencia tienen versiones y se actualizan cuando cambia la comprensión
- Las grandes caídas de confianza desencadenan declaraciones de aviso
- Los principales revisan los umbrales de conciencia en las revisiones periódicas de los mandatos
- Las contrapartes pueden comprobar la marca de tiempo del umbral de conciencia para detectar si está desactualizado

<a id="105-narrative-manipulation"></a>

### 10.5 Manipulación de la narrativa

La capa narrativa de los registros de interacción podría redactarse para presentar un relato engañoso. Mitigaciones:

- La capa técnica proporciona la verdad de referencia criptográfica
- Las afirmaciones de la narrativa pueden contrastarse con los hashes de los mensajes de la capa técnica
- La revisión de los registros de interacción por el principal compara la narrativa con los datos técnicos
- Las contrapartes mantienen sus propios registros de interacción para la verificación cruzada

<a id="106-domain-separation"></a>

### 10.6 Separación de dominio

Esta especificación usa tres etiquetas de separación de dominio:

- `DCP-DELEGATION-SIG-v2` para los mandatos de delegación, los espejos del principal y los registros de interacción
- `DCP-AWARENESS-SIG-v2` para los umbrales de conciencia y las declaraciones de aviso
- `DCP-AI.v2.SubMandate` para los submandatos (sección 3.5), de modo que un mandato firmado por un agente que delega nunca pueda pasar por uno firmado por un principal humano

En el formato de intercambio de DCP-AI v2.0, las dos primeras son las etiquetas de contexto `DCP-AI.v2.Delegation` y `DCP-AI.v2.Awareness` (DCP-AI v2.0 §4.1).

Esta separación impide que las firmas de un contexto se reproduzcan en otro.

<a id="11-conformance"></a>

## 11. Conformidad

Una implementación es conforme con DCP-09 si:

1. Admite la emisión, el acuse de recibo y la revocación de mandatos de delegación según la sección 3
2. Genera umbrales de conciencia con versiones y puntuaciones de confianza según la sección 4
3. Admite declaraciones de aviso con niveles de urgencia y respuesta del principal según la sección 5
4. Produce espejos del principal con doble firma según la sección 6
5. Crea registros de interacción de doble capa, con capa técnica y capa narrativa, según la sección 7
6. Extiende el handshake A2A con la verificación del mandato según la sección 8
7. Crea entradas de auditoría de DCP-03 para todos los eventos de delegación según la sección 9
8. Admite la subdelegación con aplicación de la reducción del ámbito cuando está habilitada
9. Usa las etiquetas de separación de dominio `DCP-DELEGATION-SIG-v2` y `DCP-AWARENESS-SIG-v2` en todas las firmas

<a id="references"></a>

## Referencias

- DCP-01: Identidad y vinculación con el principal
- DCP-02: Declaración de intenciones y control por políticas
- DCP-03: Cadena de auditoría y transparencia
- DCP-04: Comunicación entre agentes
- DCP-05: Ciclo de vida del agente
- DCP-07: Resolución de conflictos
- DCP-08: Derechos y obligaciones

---

*Esta especificación reconoce que la delegación es el acto fundamental de confianza entre las personas y los agentes de IA. Al hacer la delegación explícita, acotada y auditable, y al dar a los agentes un mecanismo formal para declarar lo que saben y lo que no, DCP-09 crea una base para una autonomía responsable dentro de límites que rinden cuentas.*

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- **Lo que verifican los SDK.** La cadena de mandatos de §3.5 está implementada en los cuatro SDK que firman y se
  comprueba con `tests/interop/v2/mandate_chain_vectors.json`. El resto de DCP-09 son registros que los SDK construyen
  y firman, no pasos del protocolo que ejecuten o hagan cumplir.
- **Registros en `schemas/v2/`.** Los esquemas tienen campos distintos de los ejemplos de §3 a §9. La ventana de un
  mandato es `valid_from` / `valid_until` (el `effective_until` del ejemplo de §3.2 y de §3.6 no está en el esquema),
  con `authority_scope` y `revocable`. Un umbral de conciencia es una lista de `threshold_rules` (`dimension`,
  `operator`, `value`, `action_if_triggered`), no la declaración de confianza de §4.2. Una declaración de aviso lleva un
  `significance_score` entero (0–1000), `action_summary`, `recommended_response`, `response_deadline` y
  `human_response`, sin los niveles de urgencia ni las categorías de §5.3 y §5.4. Un espejo del principal lleva
  `narrative`, `decision_summary`, `action_count` y `audit_chain_hash`. Un registro de interacción lleva una
  `public_layer` (`terms`, `decisions`, `commitments`), un `private_layer_hash` y un `mandate_id`, sin la raíz de Merkle
  ni la sección de cumplimiento de §7.3 y §7.5.
- **Firmas.** Un mandato raíz lleva `human_composite_sig` (contexto `DCP-AI.v2.Delegation`) y un submandato
  `delegator_composite_sig` (`DCP-AI.v2.SubMandate`). Todos los demás registros llevan una única `composite_sig` de quien
  tenga las claves que se pasan: `DCP-AI.v2.Awareness` para los umbrales de conciencia y las declaraciones de aviso,
  `DCP-AI.v2.Delegation` para los espejos del principal y los registros de interacción. No hay acuse de recibo del
  mandato por el agente (§3.3) ni segunda firma, del principal, en el espejo (§6.3).
- **Lo que hacen las funciones auxiliares.** `verifyMandateValidity` solo comprueba un conjunto de ID revocados y la
  ventana de validez, no la firma ni el ámbito. `revoke_delegation` (Python) añade el ID a un conjunto local cuando el
  mandato es `revocable`; no produce ningún registro de revocación firmado (§3.6). `generateMirror` calcula el hash
  (SHA-256) de las entradas de auditoría que recibe y firma la narrativa y el resumen que escribe quien llama; no escribe
  la narrativa ni obtiene ninguna aprobación. Los tipos `A2A_HELLO` y `A2A_WELCOME` tienen campos opcionales
  `mandate_id` y `mandate_hash`, pero ningún SDK verifica un mandato durante el handshake (§8.3) y ninguno envía
  `A2A_REJECT`.
- Los ejemplos son ilustraciones con marcadores, no fixtures. Los valores fraccionarios como `"confidence": 0.95` no
  pueden canonicalizarse con `dcp-jcs-v1`, así que esos registros no pueden firmarse tal como están escritos. Para los
  tipos del SDK, consulta [docs/API_REFERENCE.md](../docs/API_REFERENCE.md).
