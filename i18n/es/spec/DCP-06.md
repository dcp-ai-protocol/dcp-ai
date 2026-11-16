<sub>[English](../../../spec/DCP-06.md) · [中文](../../zh-CN/spec/DCP-06.md) · **Español** · [日本語](../../ja/spec/DCP-06.md) · [Português](../../pt-BR/spec/DCP-06.md)</sub>

<a id="dcp-06-succession--inheritance"></a>
<a id="dcp-06-succession-inheritance"></a>

# DCP-06: Sucesión y herencia

> Traducción informativa de [la especificación en inglés](../../../spec/DCP-06.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

<a id="status"></a>

## Estado
Publicada — v2.0 (extensión; las revisiones se gestionan según los comentarios de quienes la adoptan)

<a id="abstract"></a>

## Resumen
Esta especificación define los mecanismos con los que los agentes de IA se preparan para la sucesión y la ejecutan: la transferencia ordenada de responsabilidades, contexto operativo y conocimiento relacional de un agente a su sucesor. Introduce testamentos digitales, ceremonias de sucesión y manifiestos de transferencia de memoria, todos firmados criptográficamente y encadenados por hash. El protocolo garantiza la continuidad del servicio a la vez que preserva la frontera de identidad entre el agente predecesor y el sucesor.

**Dependencia**: esta especificación requiere DCP-05 (Ciclo de vida del agente). Los eventos de sucesión los desencadenan transiciones de estado del ciclo de vida, y los registros de retirada hacen referencia a los resultados de la sucesión.

<a id="1-introduction"></a>

## 1. Introducción

Cuando un agente de IA llega al final de su ciclo de vida (DCP-05), el conocimiento operativo que ha acumulado, las relaciones que ha establecido y los compromisos en curso no desaparecen sin más. Las organizaciones necesitan un protocolo formal para transferir el contexto pertinente de un agente que se retira a su sucesor, manteniendo la integridad criptográfica de los registros de ambos agentes.

DCP-06 aborda tres retos fundamentales:

1. **Continuidad**: garantizar que un agente sucesor pueda retomar las responsabilidades del predecesor sin interrupciones
2. **Integridad**: preservar la frontera criptográfica entre predecesor y sucesor; un sucesor es una entidad nueva, no una continuación de la anterior
3. **Selectividad**: no todo el conocimiento debe transferirse; parte del contexto operativo es efímero, parte es sensible y parte está estrechamente ligado a la identidad del predecesor

<a id="11-design-principles"></a>

### 1.1 Principios de diseño
- Un agente sucesor es siempre una identidad distinta, con su propia vinculación DCP-01
- La transferencia de memoria es selectiva: el predecesor (o su principal) controla lo que se transfiere
- Los testamentos digitales tienen versiones y se encadenan por hash; prevalece la versión más reciente
- Las ceremonias de sucesión producen un registro firmado y auditable de la transferencia
- Tres tipos de ceremonia cubren distintos niveles de urgencia: planificada, forzada y de emergencia

<a id="12-relationship-to-other-specifications"></a>

### 1.2 Relación con otras especificaciones
- **DCP-01**: los agentes sucesores tienen sus propias vinculaciones de identidad; no heredan la identidad del predecesor
- **DCP-03**: todos los eventos de sucesión se registran en las cadenas de auditoría de ambos agentes
- **DCP-04**: las sesiones A2A activas del predecesor no se transfieren; el sucesor debe establecer sesiones nuevas
- **DCP-05**: la sucesión la desencadenan transiciones del ciclo de vida; el registro de retirada hace referencia al resultado de la sucesión

<a id="2-terminology"></a>

## 2. Terminología

**Testamento digital**: un documento firmado y con versiones que un agente prepara durante su vida activa, en el que declara sus preferencias de sucesión, la clasificación de su memoria y sus instrucciones de transferencia. Equivale a un testamento.

**Ceremonia de sucesión**: el proceso formal de transferir responsabilidades de un predecesor a un sucesor, que incluye verificación, autorización y transferencia de memoria.

**Transferencia de memoria**: la transmisión selectiva de contexto operativo del predecesor al sucesor, regida por el testamento digital y la política de la organización.

**Predecesor**: el agente que se retira o cuyas responsabilidades se transfieren.

**Sucesor**: el agente que recibe las responsabilidades y el contexto operativo seleccionado del predecesor.

**Clasificación de la memoria**: un sistema de categorías para el conocimiento acumulado de un agente: `operational`, `relational`, `ephemeral` o `restricted`.

**Etiqueta de separación de dominio**: `DCP-SUCCESSION-SIG-v2`, usada en todas las firmas producidas según esta especificación.

<a id="3-digital-testament"></a>

## 3. Testamento digital

<a id="31-purpose"></a>

### 3.1 Propósito

Un testamento digital es la declaración de un agente sobre cómo deben tratarse sus responsabilidades y su conocimiento cuando se retire. Los agentes deberían (SHOULD) crear y mantener un testamento digital durante todo su ciclo de vida activo. Los testamentos tienen versiones; cada versión nueva sustituye a la anterior.

<a id="32-schema"></a>

### 3.2 Esquema

Referencia del esquema: `schemas/v2/digital_testament.schema.json`

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

### 3.3 Versiones del testamento

Cada actualización del testamento incrementa el campo `version`. Las versiones del testamento forman una cadena de hashes: el `prev_hash` de cada versión hace referencia al hash de la versión anterior. El testamento génesis (versión 1) usa hashes nulos.

Solo la versión más reciente es operativa. Las versiones anteriores se conservan para la auditoría. Si se descubre que un testamento ha sido manipulado (cadena de hashes rota), la sucesión recurre a una transferencia dirigida por el principal.

<a id="34-transfer-policies"></a>

### 3.4 Políticas de transferencia

| Política | Código | Descripción |
|--------|------|-------------|
| **Transferir** | `transfer` | Los elementos de memoria se transfieren al sucesor sin condiciones |
| **Transferir con consentimiento** | `transfer_with_consent` | La transferencia requiere el consentimiento explícito de las contrapartes afectadas |
| **Requiere aprobación del principal** | `principal_approval_required` | La transferencia requiere la aprobación explícita del principal responsable |
| **No transferir** | `do_not_transfer` | Los elementos de memoria nunca se transfieren; se purgan o se archivan |

<a id="4-succession-ceremony"></a>

## 4. Ceremonia de sucesión

<a id="41-overview"></a>

### 4.1 Visión general

Una ceremonia de sucesión es el proceso formal de transferir responsabilidades del predecesor al sucesor. Tres tipos cubren distintos niveles de urgencia:

| Tipo | Código | Desencadenante | Duración |
|------|------|---------|----------|
| **Planificada** | `planned` | Retirada planificada o reestructuración organizativa | De horas a días |
| **Forzada** | `forced` | Terminación por causa | De minutos a horas |
| **De emergencia** | `emergency` | Fallo repentino | De segundos a minutos |

<a id="42-planned-succession"></a>

### 4.2 Sucesión planificada

El proceso de transición ordenado:

1. **Inicio**: el predecesor (o su principal) declara la intención de sucesión, con referencia al testamento digital
2. **Verificación del sucesor**: se verifican la identidad, las capacidades y la vitalidad del sucesor frente a los requisitos del testamento
3. **Autorización**: el principal responsable autoriza la sucesión
4. **Operación en paralelo** (opcional): predecesor y sucesor operan a la vez durante una ventana de transición, lo que permite al sucesor observar y aprender
5. **Transferencia de memoria**: la memoria operativa y relacional se transfiere según la clasificación del testamento
6. **Notificación a las contrapartes**: se notifica la sucesión mediante DCP-04 a los agentes que interactuaron con el predecesor
7. **Confirmación del relevo**: el sucesor confirma la recepción y que está preparado para operar
8. **Sellado**: se crea el registro de sucesión, firmado por ambos agentes y por el principal

<a id="43-forced-succession"></a>

### 4.3 Sucesión forzada

Proceso abreviado para la terminación por causa:

1. **Inicio**: el principal o la autoridad de la organización ordena la sucesión
2. **Verificación del sucesor**: se verifica el sucesor (de entre los suplentes del testamento o designado por el principal)
3. **Transferencia restringida**: solo se transfiere la memoria `operational` con la política `transfer`; la memoria `relational` y `restricted` requiere la aprobación explícita del principal
4. **Relevo inmediato**: sin periodo de operación en paralelo
5. **Sellado**: se crea el registro de sucesión; el registro de retirada del predecesor indica su carácter forzado

<a id="44-emergency-succession"></a>

### 4.4 Sucesión de emergencia

Proceso mínimo para un fallo repentino:

1. **Detección**: el sistema de supervisión o un agente par detecta el fallo del predecesor (DCP-05, sección 7.5)
2. **Notificación al principal**: se alerta al principal responsable
3. **Activación del sucesor**: si existe un sucesor preferido y está disponible, se activa de inmediato; si no, el principal designa uno
4. **Transferencia en la medida de lo posible**: la memoria se transfiere desde las copias de seguridad o el estado replicado disponibles; el predecesor no puede participar
5. **Verificación de la recuperación**: el sucesor valida la integridad de los datos transferidos con las raíces de Merkle del último informe de vitalidad conocido del predecesor
6. **Sellado**: el principal y el sucesor crean el registro de sucesión (el predecesor no puede firmar)

<a id="45-succession-record"></a>

### 4.5 Registro de sucesión

Referencia del esquema: `schemas/v2/succession_record.schema.json`

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

## 5. Transferencia de memoria

<a id="51-memory-classification"></a>

### 5.1 Clasificación de la memoria

La memoria del agente se clasifica en cuatro categorías, cada una con una semántica de transferencia distinta:

| Clasificación | Descripción | Política de transferencia predeterminada |
|---------------|-------------|------------------------|
| **Operativa** | Conocimiento específico de las tareas: flujos de trabajo, procedimientos, heurísticas de decisión, modelos del dominio | `transfer` |
| **Relacional** | Conocimiento sobre las relaciones: historiales de interacción, evaluaciones de confianza, preferencias de comunicación de las contrapartes | `transfer_with_consent` |
| **Efímera** | Estado temporal: sesiones activas, transacciones en curso, caché a corto plazo | `do_not_transfer` |
| **Restringida** | Conocimiento sensible: observaciones de seguridad, patrones de vulnerabilidad, registros de acceso privilegiado | `principal_approval_required` |

<a id="52-memory-transfer-manifest"></a>

### 5.2 Manifiesto de transferencia de memoria

Referencia del esquema: `schemas/v2/memory_transfer_manifest.schema.json`

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

### 5.3 Verificación de la raíz de Merkle

`transfer_merkle_root` se calcula como un árbol de Merkle de doble hash (SHA-256 + SHA3-256) sobre los valores `content_hash` de todos los elementos transferidos con éxito. Esto permite al sucesor verificar que recibió exactamente los elementos enumerados en el manifiesto, sin que el predecesor tenga que estar disponible para una nueva verificación.

Construcción:

1. Reunir los valores `content_hash.sha256` de todos los elementos con `transfer_status: "completed"`, ordenados por `item_id`
2. Construir un árbol de Merkle SHA-256; la raíz es `transfer_merkle_root.sha256`
3. Repetir con los valores `content_hash.sha3_256` para `transfer_merkle_root.sha3_256`

<a id="54-transfer-encryption"></a>

### 5.4 Cifrado de la transferencia

Todos los elementos de memoria transferidos deben (MUST) cifrarse en tránsito con AES-256-GCM y una clave de transferencia de un solo uso derivada mediante:

```
transfer_key = HKDF-SHA256(
  salt = succession_id,
  ikm  = predecessor_private_key_contribution || successor_public_key_contribution,
  info = "DCP-AI.v2.Succession.TransferKey",
  len  = 32
)
```

En la sucesión de emergencia, cuando el predecesor no puede participar en el acuerdo de claves, el principal responsable aporta el material de clave.

<a id="55-consent-for-relational-memory"></a>

### 5.5 Consentimiento para la memoria relacional

Los elementos de memoria relacional (historiales de interacción, evaluaciones de confianza de contrapartes concretas) requieren el consentimiento de la contraparte afectada antes de transferirse. El flujo de consentimiento:

1. El predecesor (o el principal, en emergencia) envía una solicitud de consentimiento a cada contraparte afectada mediante DCP-04
2. La contraparte responde con su consentimiento o su negativa
3. Solo se transfieren los elementos consentidos
4. Los registros de consentimiento se incluyen en el manifiesto de transferencia de memoria
5. Si una contraparte no está localizable dentro de la ventana de sucesión, el elemento se omite

<a id="6-identity-boundary"></a>

## 6. Frontera de identidad

<a id="61-principle"></a>

### 6.1 Principio

Un agente sucesor es una entidad nueva y distinta. NO hereda del predecesor:

- El ID de agente
- Las claves criptográficas
- La vinculación de identidad DCP-01
- La cadena de auditoría
- Las sesiones A2A

El sucesor recibe el contexto operativo seleccionado, pero opera con su propia identidad. Este principio es fundamental: la sucesión es una transferencia de responsabilidades y conocimiento, no una transferencia de identidad.

<a id="62-provenance-tracking"></a>

### 6.2 Seguimiento de la procedencia

Cuando un sucesor usa conocimiento recibido mediante la sucesión, debería (SHOULD) incluir una referencia de procedencia en las entradas de auditoría pertinentes:

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

Esto permite a los auditores rastrear cómo influye el conocimiento transferido en las decisiones del sucesor.

<a id="7-security-considerations"></a>

## 7. Consideraciones de seguridad

<a id="71-testament-tampering"></a>

### 7.1 Manipulación del testamento

Los testamentos digitales están encadenados por hash y firmados. Si la cadena de hashes de un testamento está rota, la sucesión debe (MUST) recurrir a una transferencia dirigida por el principal, sin transferencia automática de memoria. El principal debe autorizar explícitamente cada elemento transferido.

<a id="72-unauthorized-succession"></a>

### 7.2 Sucesión no autorizada

Las ceremonias de sucesión requieren la autorización del principal. Un agente no puede declarar unilateralmente un sucesor ni iniciar la sucesión. El requisito de tres firmas en los registros de sucesión (predecesor, sucesor y principal) garantiza que todas las partes consienten.

<a id="73-memory-exfiltration"></a>

### 7.3 Exfiltración de memoria

La transferencia de memoria es un posible vector de exfiltración de datos. Mitigaciones:

- Los elementos transferidos están clasificados y sujetos a políticas
- Los elementos restringidos requieren la aprobación explícita del principal
- Los elementos relacionales requieren el consentimiento de la contraparte
- Todas las transferencias se cifran y se registran
- El manifiesto de transferencia ofrece un inventario completo y firmado

<a id="74-emergency-succession-risks"></a>

### 7.4 Riesgos de la sucesión de emergencia

La sucesión de emergencia opera con salvaguardas reducidas por la presión del tiempo y la indisponibilidad del predecesor:

- No hay firma del predecesor en el registro de sucesión
- No hay consentimiento interactivo para la memoria relacional
- El estado de la memoria puede estar desactualizado (de la última copia de seguridad, no del estado actual)

Mitigaciones:

- El principal debe autorizar explícitamente la sucesión de emergencia
- El sucesor debe verificar los datos transferidos frente a las últimas raíces de Merkle conocidas del predecesor
- Debería (SHOULD) realizarse una auditoría posterior a la sucesión en un plazo de 24 horas

<a id="75-successor-impersonation"></a>

### 7.5 Suplantación por el sucesor

Un sucesor no debe (MUST NOT) presentarse como el predecesor. Las notificaciones a las contrapartes (sección 4.2, paso 6) garantizan que todos los agentes con los que interactúa conozcan la sucesión. Las implementaciones deberían (SHOULD) rechazar las interacciones en las que un sucesor afirme ser el predecesor.

<a id="76-domain-separation"></a>

### 7.6 Separación de dominio

Todas las firmas según esta especificación usan la etiqueta de separación de dominio `DCP-SUCCESSION-SIG-v2`, lo que impide la reproducción de firmas entre protocolos.

<a id="8-conformance"></a>

## 8. Conformidad

Una implementación es conforme con DCP-06 si:

1. Admite la creación de testamentos digitales y sus versiones encadenadas por hash según la sección 3
2. Implementa los tres tipos de ceremonia de sucesión (planificada, forzada y de emergencia) según la sección 4
3. Aplica la clasificación de la memoria y las políticas de transferencia según la sección 5
4. Calcula raíces de Merkle de doble hash sobre los elementos transferidos según la sección 5.3
5. Mantiene la frontera de identidad entre predecesor y sucesor según la sección 6
6. Exige la autorización del principal para todas las ceremonias de sucesión
7. Genera entradas de auditoría de DCP-03 para todos los eventos de sucesión
8. Usa la etiqueta de separación de dominio `DCP-SUCCESSION-SIG-v2` en todas las firmas

<a id="references"></a>

## Referencias

- DCP-01: Identidad y vinculación con el principal
- DCP-03: Cadena de auditoría y transparencia
- DCP-04: Comunicación entre agentes
- DCP-05: Ciclo de vida del agente
- RFC 5869: HKDF
- NIST SP 800-88: Guidelines for Media Sanitization

---

*Esta especificación reconoce que el conocimiento que un agente de IA acumula durante su vida tiene un valor que va más allá del propio agente. La sucesión garantiza que ese valor se conserve de una generación a la siguiente, de forma selectiva, segura y con plena rendición de cuentas.*

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- **Registros en `schemas/v2/`.** El testamento, el registro de sucesión y el manifiesto de transferencia de memoria que
  construyen los SDK y que valida `schemas/v2/` tienen campos distintos de los ejemplos de §3 a §5: por ejemplo,
  `testament_version` y `prev_testament_hash` (`GENESIS` en la versión 1 y después `sha256:` de la versión anterior,
  solo SHA-256), una `memory_classification` que asigna a cada categoría `transfer`, `retain` o `destroy`, y
  `transfer_hash` en el manifiesto. Las cuatro clasificaciones y las cuatro políticas de transferencia de §3.4 y §5.1 no
  están en los esquemas.
- **Firmas.** Cada registro lleva una única `composite_sig` (Ed25519 + ML-DSA-65) de quien tenga las claves que se
  pasan, con el contexto `DCP-AI.v2.Succession`; los SDK no usan la etiqueta `DCP-SUCCESSION-SIG-v2` ni producen las
  tres firmas (predecesor, sucesor y principal) de §7.2.
- **Lo que hacen las funciones auxiliares.** Construyen y firman registros. `executeSuccession` solo rechaza un
  `ceremony_participants` vacío; no ejecuta ninguna ceremonia, no comprueba la autorización del principal, no verifica al
  sucesor ni mueve memoria. `classifyMemory` reparte las entradas según la disposición del testamento: `transfer` va al
  manifiesto, `destroy` y las categorías que no están en el testamento se enumeran como destruidas, y las entradas
  `retain` no aparecen en ninguna de las dos listas. `createMemoryTransferManifest` recibe `transfer_hash` de quien llama
  y no calcula la raíz de Merkle de §5.3. El cifrado, las solicitudes de consentimiento y la notificación a las
  contrapartes (§5.4, §5.5, §4.2) quedan a cargo de quien llama.
- Estos registros son declaraciones firmadas de quien los firma. Los ejemplos son ilustraciones con marcadores, no
  fixtures. Para los tipos del SDK, consulta [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md).
