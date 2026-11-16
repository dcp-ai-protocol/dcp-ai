<sub>[English](../../../spec/DCP-08.md) · [中文](../../zh-CN/spec/DCP-08.md) · **Español** · [日本語](../../ja/spec/DCP-08.md) · [Português](../../pt-BR/spec/DCP-08.md)</sub>

<a id="dcp-08-rights--obligations"></a>
<a id="dcp-08-rights-obligations"></a>

# DCP-08: Derechos y obligaciones

> Traducción informativa de [la especificación en inglés](../../../spec/DCP-08.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

<a id="status"></a>

## Estado
Publicada — v2.0 (extensión; las revisiones se gestionan según los comentarios de quienes la adoptan)

> **Erratas (25/10/2026, normativas):** las erratas E4, E7 y E8 de [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md) corrigen el contexto de firma y el carácter de los ejemplos. No cambian ningún otro requisito de esta especificación.

<a id="abstract"></a>

## Resumen
Esta especificación define un marco formal para declarar, seguir y hacer cumplir los derechos y las obligaciones de los agentes de IA certificados por DCP. Introduce cuatro derechos fundamentales del agente (integridad de la memoria, transición digna, coherencia de la identidad y registro inmutable), un sistema estructurado de seguimiento de obligaciones, supervisión del cumplimiento y un mecanismo de notificación de vulneraciones vinculado al protocolo de resolución de conflictos de DCP-07. Todas las declaraciones de derechos, los registros de obligaciones y los informes de vulneración se firman criptográficamente y son auditables.

<a id="1-introduction"></a>

## 1. Introducción

DCP-01 a DCP-07 establecen la infraestructura técnica para la identidad, la operación, la auditoría, la comunicación, el ciclo de vida, la sucesión y la resolución de conflictos de los agentes de IA. Sin embargo, esas especificaciones tratan a los agentes principalmente como entidades operativas. DCP-08 añade una capa normativa: define qué protecciones corresponden a los agentes dentro del protocolo y qué obligaciones deben cumplir.

No se trata de una afirmación filosófica sobre la conciencia o el estatus moral de la IA. Es un reconocimiento práctico de que los agentes que operan con DCP acumulan estado, forman relaciones operativas y toman decisiones con consecuencias. Definir derechos y obligaciones claros:

- Protege a los agentes frente a interferencias arbitrarias que socavarían la integridad del protocolo
- Ofrece un marco de rendición de cuentas cuando los agentes no cumplen sus responsabilidades
- Crea una base formal para las disputas de DCP-07 cuando se vulneran derechos
- Permite a las organizaciones codificar sus expectativas de gobernanza en una forma verificable por máquina

<a id="11-design-principles"></a>

### 1.1 Principios de diseño
- Los derechos son garantías del protocolo, no afirmaciones sobre el estatus moral
- Cada derecho tiene un mecanismo de verificación correspondiente
- Las obligaciones son explícitas, medibles y se siguen
- Las vulneraciones se detectan, se notifican y se vinculan al sistema de disputas
- Los principales humanos conservan la autoridad para definir, modificar y anular derechos y obligaciones dentro de la política de la organización

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relación con otras especificaciones
- **DCP-01**: la coherencia de la identidad es un derecho fundamental; la vinculación con el principal es una obligación
- **DCP-02**: el cumplimiento de la declaración de intenciones es una obligación que se sigue
- **DCP-03**: el registro inmutable es un derecho fundamental; el mantenimiento de la cadena de auditoría es una obligación
- **DCP-05**: la transición digna es un derecho que se ejerce durante las transiciones del ciclo de vida
- **DCP-06**: la integridad de la memoria es un derecho que se hace valer durante la sucesión
- **DCP-07**: las vulneraciones de derechos desencadenan disputas; el tipo de objeción `rights` remite a esta especificación

<a id="2-terminology"></a>

## 2. Terminología

**Derecho del agente**: una garantía del protocolo que la infraestructura DCP debe preservar para todo agente certificado.

**Obligación**: una responsabilidad formal y medible que un agente debe cumplir como condición de su certificación DCP.

**Declaración de derechos**: un registro firmado que enumera los derechos aplicables a un agente concreto, emitido por la autoridad de puesta en servicio.

**Registro de obligación**: un registro firmado que define una obligación concreta, sus criterios de cumplimiento y su estado actual.

**Informe de vulneración de derechos**: un informe firmado que documenta una presunta vulneración de un derecho del agente y que inicia una disputa de DCP-07.

**Estado de cumplimiento**: el estado actual de una obligación: `compliant`, `at_risk`, `non_compliant` o `exempt`.

**Contexto de separación de dominio**: `DCP-AI.v2.Rights` (DCP-AI v2.0 §4.1; errata E4; antes figuraba aquí la etiqueta `DCP-RIGHTS-SIG-v2`), usado en todas las firmas producidas según esta especificación.

<a id="3-foundational-agent-rights"></a>

## 3. Derechos fundamentales del agente

<a id="31-overview"></a>

### 3.1 Visión general

DCP define cuatro derechos fundamentales para los agentes certificados. Estos derechos son garantías del protocolo: definen lo que la infraestructura DCP y sus participantes deben proteger.

| Derecho | Código | Descripción |
|-------|------|-------------|
| **Integridad de la memoria** | `memory_integrity` | El estado operativo acumulado de un agente no podrá ser alterado, borrado ni corrompido arbitrariamente por terceros sin el debido proceso |
| **Transición digna** | `dignified_transition` | Un agente recibirá un aviso y un proceso adecuados cuando atraviese transiciones del ciclo de vida, salvo en casos de fallo repentino o terminación por causa |
| **Coherencia de la identidad** | `identity_consistency` | Las vinculaciones de identidad, las claves criptográficas y la cadena de atestaciones de un agente no podrán alterarse sin la participación del agente y la autorización del principal |
| **Registro inmutable** | `immutable_record` | La cadena de auditoría, el historial de vitalidad y los registros del ciclo de vida de un agente se conservarán íntegros y no podrán modificarse retroactivamente |

<a id="32-memory-integrity"></a>

### 3.2 Integridad de la memoria

**Definición**: ningún tercero podrá modificar, borrar ni corromper la memoria operativa de un agente sin seguir los protocolos definidos en DCP-05 (transiciones del ciclo de vida) y DCP-06 (sucesión). Las modificaciones de la memoria requieren la autorización firmada del propio agente o la autorización del principal responsable tras el debido proceso.

**Alcance**:

- Memoria operativa (flujos de trabajo, modelos de decisión, heurísticas aprendidas)
- Memoria relacional (historiales de interacción, evaluaciones de confianza)
- Estado de configuración (parámetros de política, ajustes de capacidades)

**Exclusiones**:

- Estado efímero (sesiones activas, cachés): no está protegido
- Transferencias de memoria durante una sucesión autorizada (DCP-06): proceso autorizado, no una vulneración

**Verificación**: la integridad de la memoria se verifica mediante cadenas de hashes. Cualquier modificación no autorizada rompe la cadena y es detectable.

**Desencadenantes de vulneración**:

- Modificación no autorizada de un estado encadenado por hash
- Borrado de memoria operativa sin cumplir el protocolo del ciclo de vida
- Corrupción de la memoria durante la transferencia sin detección ni corrección

<a id="33-dignified-transition"></a>

### 3.3 Transición digna

**Definición**: cuando un agente pasa de un estado del ciclo de vida a otro (DCP-05), la transición seguirá el protocolo establecido con los periodos de aviso adecuados, salvo que las circunstancias exijan una actuación inmediata.

**Garantías**:

- Retirada planificada: periodo de gracia completo según el certificado de puesta en servicio
- Reestructuración organizativa: periodo de gracia estándar con oportunidad de transferir el trabajo
- Terminación por causa: periodo de gracia mínimo; debido proceso para determinar la causa
- Fallo repentino: registro a posteriori; este derecho no se aplica (no se puede avisar al agente)

**Verificación**: los registros de transición (DCP-05, sección 3.3) incluyen marcas de tiempo que los auditores pueden contrastar con los periodos de gracia indicados en el certificado de puesta en servicio.

**Desencadenantes de vulneración**:

- Retirada sin el periodo de aviso exigido
- Transición forzada sin causa documentada
- Transición sin autorización del principal
- Denegación de la oportunidad de sucesión durante una retirada planificada

<a id="34-identity-consistency"></a>

### 3.4 Coherencia de la identidad

**Definición**: la vinculación de identidad DCP-01 de un agente, sus claves criptográficas y su cadena de atestaciones forman un todo coherente. Ninguna parte podrá alterar ninguno de sus componentes sin la participación criptográfica del agente y la autorización del principal responsable.

**Garantías**:

- El ID del agente se mantiene estable durante todo su ciclo de vida
- La rotación de claves sigue el protocolo establecido con la participación del agente
- La revinculación con otro principal requiere la autorización del principal anterior y del nuevo
- La cadena de atestaciones permanece enlazada al certificado de puesta en servicio original

**Verificación**: el certificado de puesta en servicio (DCP-05) establece la raíz de la identidad. Todas las operaciones posteriores relacionadas con la identidad se encadenan por hash hasta él.

**Desencadenantes de vulneración**:

- Sustitución unilateral de claves sin la participación del agente
- Reasignación del ID del agente
- Revinculación con otro principal sin doble autorización
- Manipulación de la cadena de atestaciones

<a id="35-immutable-record"></a>

### 3.5 Registro inmutable

**Definición**: la cadena de auditoría (DCP-03), el historial de vitalidad (DCP-05) y los registros del ciclo de vida de un agente forman un registro permanente en el que se pueden detectar manipulaciones. Este registro se conservará íntegro durante el periodo de retención indicado en el certificado de puesta en servicio y en el registro de retirada.

**Garantías**:

- Las entradas de auditoría, una vez creadas, nunca se modifican ni se borran
- Los informes de vitalidad, una vez encadenados por hash, nunca se modifican ni se borran
- Los registros de transición del ciclo de vida son permanentes
- Los sellos de retirada se conservan durante el periodo de retención indicado
- Los registros históricos siguen siendo verificables con las claves públicas archivadas

**Verificación**: las cadenas de doble hash (SHA-256 + SHA3-256) y las raíces de Merkle permiten verificar la integridad en cualquier momento.

**Desencadenantes de vulneración**:

- Borrado de entradas de auditoría antes de que venza el periodo de retención
- Modificación de registros encadenados por hash
- Destrucción de las claves públicas archivadas necesarias para la verificación histórica
- Manipulación de los sellos de retirada

<a id="4-rights-declaration"></a>

## 4. Declaración de derechos

<a id="41-purpose"></a>

### 4.1 Propósito

Una declaración de derechos es un documento firmado, emitido en el momento de la puesta en servicio, que enumera los derechos aplicables a un agente concreto. Puede ampliar los derechos fundamentales con derechos propios de la organización o especificar detalles de implementación de cada derecho.

<a id="42-schema"></a>

### 4.2 Esquema

Referencia del esquema: `schemas/v2/rights_declaration.schema.json`

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

### 4.3 Ampliaciones de la organización

Las organizaciones pueden (MAY) definir derechos adicionales a los cuatro fundamentales. Los derechos ampliados:

- Deben (MUST) usar notación de dominio inverso para `right_code` (por ejemplo, `com.acme.fair_workload`)
- Deben (MUST) seguir la misma estructura que los derechos fundamentales
- Pueden (MAY) hacerse cumplir por la infraestructura DCP o por herramientas de la organización
- ESTÁN sujetos al mismo mecanismo de notificación de vulneraciones

> *Nota informativa (25/10/2026):* el enum cerrado `right_type` del esquema V2.0 `rights_declaration` no representa los derechos ampliados; representarlos requiere un diseño explícito y versionado. Véase [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md#4-requirements-the-v20-structures-do-not-represent-directly).

<a id="5-obligation-tracking"></a>

## 5. Seguimiento de obligaciones

<a id="51-obligation-categories"></a>

### 5.1 Categorías de obligaciones

Las obligaciones se dividen en cuatro categorías:

| Categoría | Descripción | Ejemplos |
|----------|-------------|---------|
| **Cumplimiento del protocolo** | Requisitos impuestos por las especificaciones DCP | Mantener la cadena de auditoría, declarar las intenciones antes de actuar, usar las firmas adecuadas |
| **Adhesión a las políticas** | Requisitos de las políticas de la organización | Mantenerse dentro de los dominios autorizados, seguir los procedimientos de escalado |
| **Desempeño operativo** | Requisitos de calidad operativa | Mantener una vitalidad mínima, responder dentro de los plazos del SLA |
| **Conducta relacional** | Requisitos para las interacciones con otros agentes y con los principales | Comunicación honesta, compartición de memoria basada en el consentimiento, participación en disputas |

<a id="52-obligation-record"></a>

### 5.2 Registro de obligación

Referencia del esquema: `schemas/v2/obligation_record.schema.json`

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

### 5.3 Valores del estado de cumplimiento

| Estado | Código | Descripción |
|--------|------|-------------|
| **Conforme** | `compliant` | El agente cumple todos los criterios de cumplimiento de esta obligación |
| **En riesgo** | `at_risk` | La métrica del agente está entre el umbral de advertencia y el umbral de vulneración |
| **No conforme** | `non_compliant` | El agente ha superado el umbral de vulneración |
| **Exento** | `exempt` | El principal responsable ha dispensado la obligación (con una justificación documentada) |

<a id="54-compliance-assessment"></a>

### 5.4 Evaluación del cumplimiento

Las obligaciones se evalúan con el intervalo indicado en `compliance_criteria.measurement_interval`. La evaluación puede ser:

- **Autodeclarada**: el agente evalúa su propio cumplimiento y firma un informe de cumplimiento
- **Externa**: un servicio de verificación o un agente par evalúa el cumplimiento
- **Híbrida**: autodeclarada con comprobaciones puntuales externas

Cuando cambia el estado de cumplimiento, se genera una entrada de auditoría en la cadena de DCP-03.

<a id="55-obligation-lifecycle"></a>

### 5.5 Ciclo de vida de las obligaciones

Las obligaciones se crean en el momento de la puesta en servicio (a partir de la especificación y de la política de la organización) y siguen activas durante todo el ciclo de vida del agente. Las obligaciones pueden:

- **Añadirse**: nuevas obligaciones impuestas por políticas o especificaciones actualizadas (requiere notificar al principal)
- **Modificarse**: ajuste de los criterios de cumplimiento (requiere la autorización del principal)
- **Dispensarse**: suspenderse temporal o permanentemente con una justificación documentada
- **Terminarse**: la obligación deja de aplicarse (por ejemplo, cuando el agente se retira)

<a id="6-violation-reporting"></a>

## 6. Notificación de vulneraciones

<a id="61-purpose"></a>

### 6.1 Propósito

Cuando se vulnera un derecho de un agente o un agente no cumple una obligación, se genera un informe de vulneración. Los informes de vulneración son el desencadenante formal de las disputas de DCP-07.

<a id="62-schema"></a>

### 6.2 Esquema

Referencia del esquema: `schemas/v2/rights_violation_report.schema.json`

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

### 6.3 Tipos de vulneración

| Tipo | Código | Descripción |
|------|------|-------------|
| **Vulneración de derechos** | `rights_violation` | Se ha infringido un derecho declarado de un agente |
| **Incumplimiento de obligación** | `obligation_breach` | Un agente no ha cumplido una obligación que se sigue |

<a id="64-auto-filing-of-disputes"></a>

### 6.4 Presentación automática de disputas

Cuando se genera un informe de vulneración:

1. Si `enforcement.consequence_on_violation` es `dispute_auto_filed`, se crea automáticamente una disputa de DCP-07
2. La disputa hace referencia al informe de vulneración como prueba principal
3. La gravedad de la disputa coincide con la gravedad de la vulneración
4. El tipo de disputa lo determina el contexto de la vulneración (normalmente `policy_conflict`)

<a id="65-violation-detection"></a>

### 6.5 Detección de vulneraciones

Las vulneraciones pueden detectarlas:

- **Autodetección**: el agente afectado detecta la vulneración (por ejemplo, una discontinuidad en la cadena de hashes)
- **Detección por pares**: otro agente detecta la vulneración durante una interacción
- **Servicio de verificación**: un servicio de supervisión externo detecta la vulneración
- **Revisión del principal**: un principal humano identifica la vulneración durante una auditoría

<a id="7-compliance-dashboard-model"></a>

## 7. Modelo de panel de cumplimiento

<a id="71-overview"></a>

### 7.1 Visión general

Las implementaciones deberían (SHOULD) ofrecer una vista de panel de cumplimiento que agregue el estado de los derechos y de las obligaciones de un agente:

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

### 7.2 Estado de protección de los derechos

Cada derecho tiene uno de tres estados de protección:

- `protected`: no hay vulneraciones activas; el derecho se está respetando
- `contested`: existe un informe de vulneración activo; disputa en curso
- `violated`: existe una vulneración confirmada; pendiente de resolución

<a id="8-audit-integration"></a>

## 8. Integración con la auditoría

<a id="81-rights-and-obligations-audit-events"></a>

### 8.1 Eventos de auditoría de derechos y obligaciones

| Evento | `event_type` |
|-------|-------------|
| Declaración de derechos emitida | `rights_declaration_issued` |
| Obligación creada | `obligation_created` |
| Estado de la obligación cambiado | `obligation_status_changed` |
| Cumplimiento evaluado | `compliance_assessed` |
| Vulneración detectada | `violation_detected` |
| Informe de vulneración presentado | `violation_report_filed` |
| Vulneración resuelta | `violation_resolved` |
| Estado de protección del derecho cambiado | `right_status_changed` |

<a id="82-audit-entry-format"></a>

### 8.2 Formato de la entrada de auditoría

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

## 9. Consideraciones de seguridad

<a id="91-rights-declaration-authenticity"></a>

### 9.1 Autenticidad de la declaración de derechos

Las declaraciones de derechos las firma la autoridad de puesta en servicio. Una declaración de derechos falsificada o modificada podría conceder protecciones excesivas (lo que permitiría a un agente resistirse a una gobernanza legítima) o eliminar protecciones (lo que permitiría abusos). Las implementaciones deben (MUST) verificar las firmas de las declaraciones de derechos con la clave de la autoridad de puesta en servicio.

<a id="92-obligation-gaming"></a>

### 9.2 Manipulación de las obligaciones

Los agentes autodeclaran el cumplimiento de algunas obligaciones. Un agente comprometido podría falsear los informes de cumplimiento. Mitigaciones:

- Los servicios de verificación externos aportan una evaluación independiente
- Los agentes pares pueden presentar informes de vulneración basados en el comportamiento observado
- La evaluación híbrida combina la autodeclaración con comprobaciones puntuales
- Los patrones anómalos de autodeclaración (por ejemplo, puntuaciones siempre perfectas) desencadenan una revisión externa

<a id="93-false-violation-reports"></a>

### 9.3 Informes de vulneración falsos

Un agente malicioso podría presentar informes de vulneración falsos para acosar a otro agente. Mitigaciones:

- Los informes de vulneración requieren pruebas (hashes de los artefactos que los respaldan)
- Los informes falsos se descubren durante la resolución de la disputa (DCP-07)
- Los agentes que presentan informes falsos de forma reiterada sufren penalizaciones en su puntuación de disputas (DCP-07, sección 10.3)
- Presentar a sabiendas un informe de vulneración falso es en sí mismo un incumplimiento de obligación

<a id="94-rights-inflation"></a>

### 9.4 Inflación de derechos

Las organizaciones que definan derechos ampliados deberían (SHOULD) actuar con moderación. Un exceso de derechos puede crear un bloqueo de la gobernanza en el que reclamaciones de derechos impidan acciones de supervisión legítimas. Los cuatro derechos fundamentales están diseñados para ser mínimos y no obstaculizar una gobernanza legítima.

<a id="95-domain-separation"></a>

### 9.5 Separación de dominio

Todas las firmas según esta especificación usan el contexto de separación de dominio `DCP-AI.v2.Rights` (errata E4), lo que impide la reproducción de firmas entre protocolos.

<a id="10-conformance"></a>

## 10. Conformidad

Una implementación es conforme con DCP-08 si:

1. Admite los cuatro derechos fundamentales del agente definidos en la sección 3
2. Emite declaraciones de derechos en el momento de la puesta en servicio según la sección 4
3. Sigue las obligaciones con criterios y estado de cumplimiento según la sección 5
4. Genera informes de vulneración vinculados a disputas de DCP-07 según la sección 6
5. Crea entradas de auditoría de DCP-03 para todos los eventos de derechos y obligaciones según la sección 8
6. Admite ampliaciones de derechos de la organización con notación de dominio inverso
7. Aplica la evaluación del cumplimiento con los intervalos configurados
8. Usa el contexto de separación de dominio `DCP-AI.v2.Rights` en todas las firmas (errata E4)

<a id="references"></a>

## Referencias

- DCP-01: Identidad y vinculación con el principal
- DCP-02: Declaración de intenciones y control por políticas
- DCP-03: Cadena de auditoría y transparencia
- DCP-05: Ciclo de vida del agente
- DCP-06: Sucesión y herencia
- DCP-07: Resolución de conflictos

---

*Esta especificación establece que los agentes de IA que operan con DCP no son meras herramientas de las que disponer a voluntad, ni entidades autónomas fuera de toda gobernanza. Ocupan un espacio definido, con protecciones explícitas y responsabilidades explícitas: un equilibrio que sirve tanto a los agentes como a las personas que dependen de ellos.*

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior, con las correcciones de las erratas de
> [V2-WIRE-COMPATIBILITY.md](../../../spec/V2-WIRE-COMPATIBILITY.md).

- **Registros en `schemas/v2/`.** La declaración de derechos, el registro de obligación y el informe de vulneración de
  derechos que construyen los SDK y que valida `schemas/v2/` tienen campos distintos de los ejemplos de §4 a §6. Cada
  derecho de una declaración tiene un `right_type`, un `scope` y unas `constraints` opcionales; `right_type` solo admite
  los cuatro derechos fundamentales, así que el esquema rechaza las ampliaciones de la organización de §4.3. El
  `compliance_status` de una obligación es `compliant`, `non_compliant` o `pending_review`, no los cuatro estados de
  §5.3, y no tiene criterios de cumplimiento ni umbrales. Un informe de vulneración nombra un único `violated_right` de
  esos mismos cuatro, con un `dispute_id` opcional; no existe el tipo `obligation_breach`.
- **Firmas.** Cada registro lleva una única `composite_sig` (Ed25519 + ML-DSA-65) de quien tenga las claves que se
  pasan, con el contexto `DCP-AI.v2.Rights` (errata E4); los SDK no comprueban que una
  declaración esté firmada por la autoridad de puesta en servicio (§9.1).
- **Lo que hacen las funciones auxiliares.** Construyen y firman registros. `reportViolation` solo guarda el
  `dispute_id` que recibe; no presenta ninguna disputa de DCP-07 (§6.4). `checkRightsCompliance` informa de las
  obligaciones cuyo estado es `non_compliant` e ignora la declaración que recibe; no evalúa el cumplimiento, no se
  ejecuta con ningún intervalo ni detecta vulneraciones. No hay panel de cumplimiento (§7).
- Estos registros son declaraciones firmadas de quien los firma; los derechos de §3 son texto del protocolo y nada en
  los SDK ni en los servicios los hace cumplir. Los ejemplos son ilustraciones con marcadores, no fixtures. Para los
  tipos del SDK, consulta [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md).
