<sub>[English](DCP-05.md) · [中文](DCP-05.zh-CN.md) · **Español** · [日本語](DCP-05.ja.md) · [Português](DCP-05.pt-BR.md)</sub>

<a id="dcp-05-agent-lifecycle"></a>

# DCP-05: Ciclo de vida del agente

> Traducción informativa de [la especificación en inglés](DCP-05.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

<a id="status"></a>

## Estado
Publicada — v2.0 (extensión; las revisiones se gestionan según los comentarios de quienes la adoptan)

<a id="abstract"></a>

## Resumen
Esta especificación define el ciclo de vida completo de un agente de IA certificado por DCP, desde su puesta en servicio, pasando por el servicio activo y la pérdida de capacidad, hasta su retirada definitiva. Introduce máquinas de estados del ciclo de vida, métricas de vitalidad, certificados de puesta en servicio, informes de vitalidad y registros de retirada, todos firmados criptográficamente, encadenados por hash y verificables de forma independiente. El protocolo garantiza que el historial operativo de un agente permita detectar manipulaciones, que las transiciones entre estados del ciclo de vida estén autorizadas y sean auditables, y que cuatro modos de terminación distintos cubran toda la gama de escenarios de fin de vida.

<a id="1-introduction"></a>

## 1. Introducción

DCP-01 a DCP-04 establecen la identidad, la intención, la auditoría y la comunicación de los agentes de IA. Sin embargo, esas especificaciones suponen que los agentes existen en un estado operativo estable. En la práctica, los agentes tienen una vida finita: se crean, operan, se degradan y se retiran o se terminan. DCP-05 cubre ese hueco definiendo un modelo integral del ciclo de vida.

Sin un protocolo de ciclo de vida, las organizaciones afrontan varios riesgos:

- Ningún registro con autoridad de cuándo se puso en servicio o se retiró un agente
- Ninguna supervisión continua de su estado que alimente el modelo de confianza
- Ningún proceso estandarizado para la retirada ordenada o la terminación de emergencia
- Ningún historial que permita detectar manipulaciones y que enlace el nacimiento de un agente con su fin

<a id="11-design-principles"></a>

### 1.1 Principios de diseño
- Toda transición de estado del ciclo de vida debe (MUST) firmarse y registrarse
- Las métricas de vitalidad deben (MUST) encadenarse por hash para impedir la manipulación retroactiva
- La retirada debe (MUST) producir un registro sellado y verificable de forma independiente
- Los eventos del ciclo de vida se integran en la cadena de auditoría DCP existente (DCP-03)
- Los principales humanos conservan la autoridad última sobre las transiciones del ciclo de vida

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relación con otras especificaciones
- **DCP-01**: los estados del ciclo de vida extienden el modelo de identidad; la identidad de un agente retirado persiste a efectos de auditoría, pero no puede autorizar acciones nuevas
- **DCP-02**: las declaraciones de intención solo son válidas si proceden de agentes en estado `active`
- **DCP-03**: todos los eventos del ciclo de vida generan entradas de auditoría en la cadena de hashes del agente
- **DCP-04**: las sesiones A2A deben (MUST) terminarse cuando un agente sale del estado `active`
- **DCP-06**: la sucesión y la herencia (definidas aparte) dependen de los estados del ciclo de vida definidos aquí

<a id="2-terminology"></a>

## 2. Terminología

**Puesta en servicio (commissioning)**: el acto formal de crear la identidad de un agente, vincularla a un principal responsable y ponerlo en servicio. Equivale a un certificado de nacimiento unido a un nombramiento para un cargo.

**Vitalidad**: una métrica compuesta (entero, 0–1000) que representa la salud operativa de un agente, la integridad de sus capacidades y su posición de confianza. Una vitalidad de 1000 indica plena capacidad operativa; 0 indica incapacidad total.

**Informe de vitalidad**: un registro periódico, firmado y encadenado por hash de la métrica de vitalidad de un agente y de las puntuaciones de sus componentes.

**Retirada (decommissioning)**: el acto formal de retirar un agente del servicio de forma permanente y sellar su registro operativo.

**Estado del ciclo de vida**: uno de los cuatro estados canónicos en que puede estar un agente: `commissioned`, `active`, `declining` o `decommissioned`.

**Modo de terminación**: la forma en que un agente pasa al estado `decommissioned`: `planned_retirement`, `termination_for_cause`, `organizational_restructuring` o `sudden_failure`.

**Etiqueta de separación de dominio**: `DCP-LIFECYCLE-SIG-v2`, usada en todas las firmas producidas según esta especificación para impedir la reproducción entre protocolos.

<a id="3-lifecycle-state-machine"></a>

## 3. Máquina de estados del ciclo de vida

<a id="31-states"></a>

### 3.1 Estados

Un agente debe (MUST) estar en todo momento exactamente en uno de los estados siguientes:

| Estado | Código | Descripción |
|-------|------|-------------|
| **Puesto en servicio** | `commissioned` | La identidad del agente se ha creado y vinculado a un principal, pero el agente aún no se ha puesto en servicio activo. Equivale a una credencial recién emitida que todavía no se ha activado. |
| **Activo** | `active` | El agente está plenamente operativo. Puede declarar intenciones, ejecutar acciones, participar en sesiones A2A y generar entradas de auditoría. |
| **En declive** | `declining` | La vitalidad del agente ha caído por debajo de un umbral configurable, o un principal ha iniciado un cese gestionado. El agente puede (MAY) seguir operando, pero con capacidades restringidas. Debería (SHOULD) rechazar nuevos compromisos a largo plazo. |
| **Retirado** | `decommissioned` | El agente está fuera de servicio de forma permanente. Su registro de identidad persiste para la auditoría y la verificación histórica, pero no debe (MUST NOT) iniciar nuevas acciones, sesiones ni declaraciones de intención. |

<a id="32-valid-transitions"></a>

### 3.2 Transiciones válidas

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

Transiciones válidas:

1. `commissioned` -> `active` (activación)
2. `active` -> `declining` (caída de la vitalidad o declive iniciado por el principal)
3. `declining` -> `active` (reactivación; requiere la aprobación del principal y una vitalidad por encima del umbral)
4. `active` -> `decommissioned` (terminación directa)
5. `declining` -> `decommissioned` (terminación desde el estado de declive)

Transiciones no válidas:

- `decommissioned` -> cualquier estado (estado terminal, irreversible)
- `commissioned` -> `declining` (antes debe activarse)
- `commissioned` -> `decommissioned` (antes debe activarse, o usar `termination_for_cause` si la puesta en servicio fue errónea, lo que activa implícitamente y retira de inmediato)

<a id="33-transition-record"></a>

### 3.3 Registro de transición

Toda transición de estado debe (MUST) producir un registro firmado:

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

## 4. Certificado de puesta en servicio

<a id="41-purpose"></a>

### 4.1 Propósito

El certificado de puesta en servicio es el documento fundacional de la existencia de un agente. Registra los parámetros de creación del agente, el principal al que está vinculado, sus capacidades iniciales y la entidad que lo autoriza. Debe (MUST) ser la primera entrada de la cadena del ciclo de vida del agente.

<a id="42-schema"></a>

### 4.2 Esquema

Referencia del esquema: `schemas/v2/commissioning_certificate.schema.json`

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

### 4.3 Flujo de puesta en servicio

1. La autoridad de puesta en servicio genera la identidad criptográfica del agente
2. La autoridad crea y firma el certificado de puesta en servicio
3. El principal responsable refrenda el certificado y acepta la rendición de cuentas
4. El certificado se registra como entrada génesis (con `prev_hash` nulo) en la cadena del ciclo de vida del agente
5. Se crea una entrada de auditoría `agent_commissioned` en la cadena de auditoría de DCP-03
6. El agente pasa al estado `commissioned`
7. Tras verificar que está preparado, el agente pasa al estado `active`

<a id="44-countersignature-requirement"></a>

### 4.4 Requisito de refrendo

El certificado de puesta en servicio debe (MUST) llevar dos firmas:

- **Firma de la autoridad**: la entidad autorizada para poner agentes en servicio (clave raíz de la organización o clave delegada de puesta en servicio)
- **Refrendo del principal**: el principal responsable que acepta la rendición de cuentas por el agente

Ambas firmas deben (MUST) usar la etiqueta de separación de dominio `DCP-LIFECYCLE-SIG-v2`.

<a id="5-vitality-metric"></a>

## 5. Métrica de vitalidad

<a id="51-definition"></a>

### 5.1 Definición

La vitalidad es un entero en el rango [0, 1000] que representa la aptitud operativa global de un agente. Combina cuatro puntuaciones de componentes:

| Componente | Peso | Rango | Descripción |
|-----------|--------|-------|-------------|
| **Integridad de capacidades** | 0.30 | 0–1000 | Mide si el agente puede ejecutar correctamente las capacidades que declara. Se obtiene de autopruebas, sondeos de capacidades o validación externa. |
| **Posición de confianza** | 0.25 | 0–1000 | Mide la fiabilidad del agente según su historial de auditoría, el cumplimiento de políticas y las evaluaciones de sus pares. |
| **Salud de los recursos** | 0.25 | 0–1000 | Mide la disponibilidad de recursos de cómputo: memoria, latencia, rendimiento, tasas de error. |
| **Cumplimiento de políticas** | 0.20 | 0–1000 | Mide la adhesión a las intenciones declaradas y a las políticas de la organización. Se obtiene de los registros de resultado de políticas de DCP-02. |

Vitalidad compuesta:
```
vitality = floor(0.30 * capability_integrity + 0.25 * trust_standing +
                 0.25 * resource_health + 0.20 * policy_compliance)
```

<a id="52-thresholds"></a>

### 5.2 Umbrales

Las organizaciones configuran dos umbrales por agente en el certificado de puesta en servicio:

- **Umbral de declive** (400 de forma predeterminada): cuando la vitalidad cae por debajo de este valor, el agente pasa al estado `declining`
- **Umbral crítico** (200 de forma predeterminada): cuando la vitalidad cae por debajo de este valor, se requiere una intervención inmediata; el agente debería (SHOULD) retirarse salvo que el principal responsable autorice explícitamente que siga operando

<a id="53-vitality-decay-and-recovery"></a>

### 5.3 Deterioro y recuperación de la vitalidad

La vitalidad no es estática. Las puntuaciones de los componentes cambian según:

- **Autoevaluación**: resultados de pruebas de capacidad comunicados por el propio agente
- **Sondeos externos**: comprobaciones de estado del servicio de verificación
- **Análisis de auditoría**: revisión automatizada de la cadena de auditoría en busca de anomalías
- **Informes de pares**: otros agentes que informan de la calidad de la interacción mediante DCP-04

Recuperación: si la vitalidad de un agente en `declining` vuelve a superar el umbral de declive y el principal responsable lo aprueba, el agente puede (MAY) volver a `active`.

<a id="6-vitality-report"></a>

## 6. Informe de vitalidad

<a id="61-purpose"></a>

### 6.1 Propósito

Los informes de vitalidad forman una secuencia encadenada por hash que ofrece un historial de la salud del agente a lo largo del tiempo en el que se pueden detectar manipulaciones. Se generan con el intervalo indicado en el certificado de puesta en servicio.

<a id="62-schema"></a>

### 6.2 Esquema

Referencia del esquema: `schemas/v2/vitality_report.schema.json`

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

### 6.3 Encadenamiento por hash

Los informes de vitalidad forman una cadena de hashes. Los campos `prev_hash` y `prev_hash_secondary` de cada informe hacen referencia a los hashes SHA-256 y SHA3-256 del informe de vitalidad inmediatamente anterior. El primer informe de vitalidad tras la puesta en servicio hace referencia al hash del certificado de puesta en servicio.

El enfoque de doble hash (SHA-256 + SHA3-256) sigue el mismo patrón que las cadenas de auditoría de DCP-03 y aporta resistencia frente al compromiso de un único algoritmo.

<a id="64-merkle-root"></a>

### 6.4 Raíz de Merkle

Cada informe de vitalidad incluye una raíz de Merkle de doble hash sobre las puntuaciones de los componentes y sus detalles. Esto permite la divulgación selectiva: un agente puede demostrar su puntuación global de vitalidad revelando solo detalles concretos de los componentes.

<a id="65-anomaly-detection"></a>

### 6.5 Detección de anomalías

El array `anomalies` puede (MAY) contener informes de anomalías estructurados:

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

Gravedades de las anomalías: `info`, `warning`, `critical`.

<a id="7-termination-modes"></a>

## 7. Modos de terminación

<a id="71-overview"></a>

### 7.1 Visión general

Un agente llega al estado `decommissioned` mediante uno de cuatro modos de terminación, cada uno con requisitos de procedimiento distintos:

| Modo | Código | Desencadenante | Periodo de gracia |
|------|------|---------|--------------|
| **Retirada planificada** | `planned_retirement` | El agente ha cumplido su propósito o ha llegado al final de la vida prevista | Completo (configurable, 72 h de forma predeterminada) |
| **Terminación por causa** | `termination_for_cause` | El agente infringió una política, mostró un comportamiento inseguro o fue comprometido | Mínimo (configurable, 1 h de forma predeterminada) |
| **Reestructuración organizativa** | `organizational_restructuring` | Decisión de negocio de retirar al agente, ajena a su desempeño | Estándar (configurable, 24 h de forma predeterminada) |
| **Fallo repentino** | `sudden_failure` | El agente dejó de responder o sufrió un fallo catastrófico | Ninguno (retirada a posteriori por el principal) |

<a id="72-planned-retirement"></a>

### 7.2 Retirada planificada

El proceso ordenado de fin de vida:

1. El principal responsable emite un aviso de retirada con un periodo de gracia
2. El agente entra en el estado `declining` (si aún no lo está)
3. El agente completa o transfiere el trabajo en curso
4. El agente termina todas las sesiones A2A con el motivo `complete`
5. El agente genera un informe de vitalidad final
6. El agente ejecuta el protocolo de sucesión (DCP-06) si está configurado
7. Se crea y se firma el registro de retirada
8. El agente pasa a `decommissioned`

<a id="73-termination-for-cause"></a>

### 7.3 Terminación por causa

Terminación de emergencia por infracciones de políticas o compromiso:

1. El principal responsable o la autoridad de la organización emite la orden de terminación
2. Las credenciales del agente se marcan de inmediato para su revocación
3. Todas las sesiones A2A se terminan con el motivo `revocation`
4. Un periodo de gracia mínimo permite que las operaciones en curso terminen (o se reviertan)
5. Se crea el registro de retirada con los detalles de la `cause`
6. El agente pasa a `decommissioned`
7. El análisis posterior al incidente genera un resumen de auditoría

<a id="74-organizational-restructuring"></a>

### 7.4 Reestructuración organizativa

Retirada por motivos de negocio:

1. La organización emite un aviso de reestructuración que afecta al agente
2. Periodo de gracia estándar para transferir el trabajo
3. El agente completa o transfiere el trabajo según la política de la organización
4. Se ejecuta el protocolo de sucesión (DCP-06) si hay un sucesor designado
5. Se crea el registro de retirada
6. El agente pasa a `decommissioned`

<a id="75-sudden-failure"></a>

### 7.5 Fallo repentino

Cuando un agente falla de forma inesperada:

1. El sistema de supervisión o un agente par detecta que no responde
2. Se genera un evento `sudden_failure` tras un tiempo de espera configurable (de forma predeterminada, 5 minutos sin respuesta)
3. Se notifica al principal responsable
4. El principal crea a posteriori un registro de retirada en nombre del agente
5. El principal firma el registro de retirada con su propia clave (porque el agente no puede firmar)
6. Se notifica a las contrapartes A2A si el agente tenía sesiones activas
7. El protocolo de sucesión (DCP-06) se ejecuta en modo de emergencia si está configurado

<a id="8-decommissioning-record"></a>

## 8. Registro de retirada

<a id="81-purpose"></a>

### 8.1 Propósito

El registro de retirada es el documento terminal de la cadena del ciclo de vida de un agente. Sella su historial operativo y ofrece un registro permanente y verificable de cómo y por qué se retiró el agente.

<a id="82-schema"></a>

### 8.2 Esquema

Referencia del esquema: `schemas/v2/decommissioning_record.schema.json`

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

### 8.3 Sellado de las cadenas

El registro de retirada incluye sellos de raíz de Merkle tanto para la cadena de auditoría como para la cadena de vitalidad. Estos sellos permiten a cualquier verificador futuro confirmar la completitud y la integridad de los registros históricos del agente sin volver a recorrer toda la cadena.

<a id="84-key-disposition"></a>

### 8.4 Destino de las claves

Al retirar el agente:

- Las claves privadas deben (MUST) destruirse de forma segura
- Las claves públicas deben (MUST) archivarse para la verificación futura de los artefactos históricos
- Deben (MUST) registrarse el método de destrucción y el testigo
- En `sudden_failure`, la destrucción de las claves la realiza el principal responsable

<a id="85-sudden-failure-special-handling"></a>

### 8.5 Tratamiento especial del fallo repentino

Cuando un agente falla de repente y no puede firmar su propio registro de retirada:

1. El principal responsable firma el registro con su propia clave
2. `signature.kid` hace referencia a la clave del principal, no a la del agente
3. Se asigna `true` a un indicador `principal_signed_on_behalf`
4. El motivo debe (MUST) incluir la información de diagnóstico disponible
5. Si está disponible el último informe de vitalidad del agente, su hash se usa como `prev_hash`; si no, se usa el hash de la última entrada de auditoría conocida

<a id="9-integration-with-dcp-03-audit-chain"></a>

## 9. Integración con la cadena de auditoría de DCP-03

<a id="91-lifecycle-audit-events"></a>

### 9.1 Eventos de auditoría del ciclo de vida

Todos los eventos del ciclo de vida generan entradas en la cadena de auditoría de DCP-03:

| Evento | `event_type` |
|-------|-------------|
| Certificado de puesta en servicio creado | `agent_commissioned` |
| Agente activado | `agent_activated` |
| El agente entró en el estado de declive | `agent_declining` |
| Agente reactivado desde el declive | `agent_reactivated` |
| Informe de vitalidad generado | `vitality_report_generated` |
| Umbral de vitalidad superado a la baja | `vitality_threshold_breach` |
| Retirada iniciada | `decommissioning_initiated` |
| Retirada completada | `agent_decommissioned` |

<a id="92-audit-entry-format"></a>

### 9.2 Formato de la entrada de auditoría

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

## 10. Consideraciones de seguridad

<a id="101-lifecycle-chain-integrity"></a>

### 10.1 Integridad de la cadena del ciclo de vida

La secuencia encadenada por hash formada por el certificado de puesta en servicio, los informes de vitalidad, los registros de transición y el registro de retirada constituye una cadena del ciclo de vida que permite detectar manipulaciones. Cualquier modificación de un registro histórico invalida todos los hashes posteriores.

<a id="102-vitality-report-authenticity"></a>

### 10.2 Autenticidad de los informes de vitalidad

Los informes de vitalidad los comunica el propio agente. Las implementaciones deberían (SHOULD) complementar los datos autodeclarados con validación externa:

- Sondeos de estado del servicio de verificación
- Informes de agentes pares sobre la calidad de la interacción
- Sistemas de supervisión de la organización
- Pruebas automatizadas de capacidades

Un agente comprometido podría falsear su propia vitalidad. Las fuentes de validación externas aportan defensa en profundidad.

<a id="103-termination-authorization"></a>

### 10.3 Autorización de la terminación

Solo los principales autorizados pueden iniciar transiciones del ciclo de vida. El modelo de autorización:

- **Activación**: autoridad de puesta en servicio o principal responsable
- **Declive**: automático (umbral de vitalidad) o principal responsable
- **Reactivación**: solo el principal responsable (requiere aprobación explícita)
- **Retirada**: principal responsable, autoridad de la organización o automática (detección de fallo repentino)

<a id="104-post-decommissioning-verification"></a>

### 10.4 Verificación tras la retirada

Tras la retirada, las claves públicas del agente siguen archivadas. Cualquier parte puede verificar las firmas históricas del agente, su cadena de auditoría y sus informes de vitalidad. Los sellos de cadena del registro de retirada permiten una verificación eficiente sin volver a recorrer todo el historial.

<a id="105-domain-separation"></a>

### 10.5 Separación de dominio

Todas las firmas según esta especificación usan la etiqueta de separación de dominio `DCP-LIFECYCLE-SIG-v2`. Esto impide que las firmas creadas para el ciclo de vida se reproduzcan en otros contextos del protocolo DCP (por ejemplo, declaraciones de intención o sesiones A2A).

<a id="106-sudden-failure-risks"></a>

### 10.6 Riesgos del fallo repentino

El fallo repentino presenta riesgos de seguridad propios:

- El agente no puede firmar su propio registro de retirada
- El material de las claves privadas del agente puede estar en un estado desconocido
- Las operaciones en curso pueden quedar en un estado incoherente

Mitigaciones:

- Los registros de retirada firmados por el principal se marcan claramente
- El material de las claves debe (MUST) presumirse comprometido; debería (SHOULD) emitirse una revocación
- Los agentes contrapartes deberían (SHOULD) tratar los datos en curso del agente que falló como potencialmente no fiables

<a id="11-conformance"></a>

## 11. Conformidad

Una implementación es conforme con DCP-05 si:

1. Implementa los cuatro estados del ciclo de vida y las transiciones válidas definidas en la sección 3
2. Genera certificados de puesta en servicio con doble firma según la sección 4
3. Produce informes de vitalidad encadenados por hash con el intervalo configurado según la sección 6
4. Admite los cuatro modos de terminación definidos en la sección 7
5. Genera registros de retirada sellados según la sección 8
6. Crea entradas de auditoría de DCP-03 para todos los eventos del ciclo de vida según la sección 9
7. Usa la etiqueta de separación de dominio `DCP-LIFECYCLE-SIG-v2` en todas las firmas
8. Implementa doble hash (SHA-256 + SHA3-256) en todos los enlaces de las cadenas de hashes

<a id="references"></a>

## Referencias

- DCP-01: Identidad y vinculación con el principal
- DCP-02: Declaración de intenciones y control por políticas
- DCP-03: Cadena de auditoría y transparencia
- DCP-04: Comunicación entre agentes
- DCP-06: Sucesión y herencia
- NIST SP 800-88: Guidelines for Media Sanitization (destrucción de claves)
- RFC 3339: Date and Time on the Internet

---

*Esta especificación reconoce que los agentes de IA, como todos los sistemas operativos, tienen una vida finita. Un protocolo para la ciudadanía digital debe tener en cuenta no solo cómo viven los agentes, sino cómo terminan: con dignidad, rendición de cuentas y un registro completo.*

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- **Registros en `schemas/v2/`.** El certificado de puesta en servicio, el informe de vitalidad y el registro de
  retirada que construyen los SDK y que valida `schemas/v2/` tienen campos distintos de los ejemplos de §3 a §9: por
  ejemplo, `vitality_score`, `state`, `metrics` y `prev_report_hash` en el informe de vitalidad, y
  `final_vitality_score` y `data_disposition` en el registro de retirada. Ninguno tiene `prev_hash_secondary`,
  `merkle_root`, `countersignature` ni `domain_sep`. No hay esquema para el registro de transición de §3.3 ni para la
  entrada de auditoría de §9.2.
- **Firmas.** Cada registro lleva una única `composite_sig` (Ed25519 + ML-DSA-65) de quien tenga las claves que se
  pasan, con el contexto `DCP-AI.v2.Lifecycle`; los SDK no usan la etiqueta `DCP-LIFECYCLE-SIG-v2` ni producen la firma
  de la autoridad más el refrendo del principal de §4.4.
- **Transiciones.** `validateStateTransition` acepta seis aristas: las cinco de §3.2 y `commissioned` ->
  `decommissioned`. Solo comprueba el par de estados, no la aprobación del principal, la vitalidad ni quién firma.
- **Puntuación de vitalidad.** `computeVitalityScore` recibe cuatro métricas en [0, 1] (`task_completion_rate`,
  `error_rate` invertida, `human_satisfaction`, `policy_alignment`) con los pesos de §5.1 y redondea al entero más
  cercano (`Math.round`); §5.1 usa otros componentes puntuados de 0 a 1000 y `floor`. La cadena de vitalidad enlaza cada
  informe mediante `prev_report_hash` (solo SHA-256).
- **Métricas fraccionarias.** `dcp-jcs-v1` solo acepta enteros, así que un informe de vitalidad cuyas `metrics`
  contengan una fracción como `0.83` no puede canonicalizarse ni firmarse; con el rango [0, 1] del esquema, un informe
  firmado solo puede llevar 0 o 1 en cada métrica. Los ejemplos de §6 también contienen fracciones
  (`error_rate_percent`, `previous_pass_rate`): son ilustraciones con marcadores, no fixtures.
- Estos registros son declaraciones firmadas de quien los firma; no prueban que un estado, una puntuación o un destino
  sean verdaderos, y nada en los SDK ni en los servicios hace cumplir los periodos de gracia, la destrucción de claves
  ni la terminación de sesiones de §7 y §8. Para los tipos del SDK, consulta [docs/API_REFERENCE.md](../docs/API_REFERENCE.md).
