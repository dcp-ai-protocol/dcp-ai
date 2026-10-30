<sub>[English](../../../spec/DCP-04.md) · [中文](../../zh-CN/spec/DCP-04.md) · **Español** · [日本語](../../ja/spec/DCP-04.md) · [Português](../../pt-BR/spec/DCP-04.md)</sub>

<a id="dcp-04-agent-to-agent-communication"></a>

# DCP-04: Comunicación entre agentes

> Traducción informativa de [la especificación en inglés](../../../spec/DCP-04.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

<a id="status"></a>

## Estado
Publicada — v2.0 (extensión; las revisiones se gestionan según los comentarios de quienes la adoptan)

<a id="abstract"></a>

## Resumen
Esta especificación define cómo los agentes certificados por DCP se descubren entre sí, establecen canales de comunicación con autenticación mutua y protección poscuántica, e intercambian mensajes integrados por completo en la pista de auditoría.

<a id="1-introduction"></a>

## 1. Introducción

DCP-01 a DCP-03 definen la identidad, la intención y la auditoría de agentes individuales. DCP-04 extiende el protocolo a la interacción directa entre agentes, la base de los flujos de trabajo empresariales con varios agentes.

Sin A2A, DCP solo admite la verificación pasiva (el agente presenta su bundle a un verificador). DCP-04 permite la interacción activa: un agente de la Organización A puede negociar con un agente de la Organización B, ambos con autenticación mutua poscuántica.

<a id="11-design-principles"></a>

### 1.1 Principios de diseño
- Autenticación mutua antes de cualquier intercambio de datos
- Seguridad poscuántica desde el handshake hasta el final de la sesión
- Cada mensaje A2A genera una entrada de auditoría
- No se requiere un intermediario central (P2P)
- Compatible con las capas de transporte existentes (WebSocket, gRPC, HTTP/2)

<a id="12-threat-model"></a>

### 1.2 Modelo de amenazas
- Adversario cuántico que almacena ahora para descifrar después (harvest-now-decrypt-later)
- Intermediario (man-in-the-middle) entre agentes
- Suplantación de agentes legítimos
- Secuestro de la sesión después del handshake
- Reproducción de mensajes A2A entre sesiones

<a id="2-agent-discovery-protocol"></a>

## 2. Protocolo de descubrimiento de agentes

<a id="21-well-known-endpoint"></a>

### 2.1 Endpoint conocido

Los agentes publican su disponibilidad mediante `.well-known/dcp-agent-directory.json`:

```json
{
  "dcp_version": "2.0",
  "organization": "Acme Corp",
  "agents": [
    {
      "agent_id": "agent:acme-purchasing-001",
      "agent_name": "Acme Purchasing Agent",
      "capabilities": ["negotiate", "purchase_order", "invoice"],
      "bundle_endpoint": "https://acme.com/.well-known/dcp/agents/001/bundle.json",
      "a2a_endpoint": "wss://acme.com/dcp/a2a",
      "a2a_transports": ["websocket", "grpc"],
      "security_tier_minimum": "elevated",
      "supported_algorithms": {
        "signing": ["ed25519", "ml-dsa-65"],
        "kem": ["x25519-ml-kem-768"]
      },
      "status": "active",
      "updated_at": "2026-02-28T00:00:00Z"
    }
  ],
  "directory_signature": {
    "alg": "ed25519",
    "kid": "org-signing-key-kid",
    "sig_b64": "..."
  }
}
```

<a id="22-discovery-flow"></a>

### 2.2 Flujo de descubrimiento

1. El agente A resuelve el dominio del agente B
2. El agente A obtiene `https://<domain>/.well-known/dcp-agent-directory.json`
3. El agente A verifica la firma del directorio
4. El agente A selecciona un agente según las capacidades requeridas
5. El agente A obtiene el bundle firmado del agente B desde el `bundle_endpoint`
6. El agente A verifica localmente el bundle del agente B

<a id="23-capability-matching"></a>

### 2.3 Correspondencia de capacidades

Las capacidades son cadenas de un registro. Entre las capacidades estándar están:

- `negotiate` — Puede participar en flujos de negociación
- `purchase_order` — Puede emitir o recibir órdenes de compra
- `invoice` — Puede emitir o procesar facturas
- `data_query` — Puede responder a consultas de datos
- `task_delegate` — Puede aceptar tareas delegadas
- `approval` — Puede aprobar o rechazar solicitudes
- `notification` — Puede enviar y recibir notificaciones

Las capacidades personalizadas deben (MUST) usar notación de dominio inverso: `com.acme.custom_capability`.

<a id="3-handshake-protocol"></a>

## 3. Protocolo de handshake

<a id="31-overview"></a>

### 3.1 Visión general

El handshake A2A establece una sesión con autenticación mutua y protección poscuántica. Usa el KEM híbrido (X25519 + ML-KEM-768) ya definido en la especificación principal v2.0.

```
Agent A (Initiator)                    Agent B (Responder)
    |                                       |
    |── A2A_HELLO ─────────────────────────>|
    |   { signed_bundle_A, kem_pk_A,        |
    |     nonce_A, supported_algs }         |
    |                                       |
    |<────────────────────── A2A_WELCOME ───|
    |   { signed_bundle_B, kem_pk_B,        |
    |     nonce_B, kem_ciphertext_BA }      |
    |                                       |
    |── A2A_CONFIRM ───────────────────────>|
    |   { kem_ciphertext_AB,                |
    |     encrypted_confirm(nonce_A+B) }    |
    |                                       |
    |<──────────────────── A2A_ESTABLISHED ─|
    |   { encrypted_ack, session_id }       |
    |                                       |
    |══ Encrypted A2A Messages ════════════>|
    |<═════════════════════════════════════ ═|
```

### 3.2 A2A_HELLO

Lo envía el iniciador para comenzar el handshake.

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "supported_algorithms": {
    "signing": ["ed25519", "ml-dsa-65"],
    "kem": ["x25519-ml-kem-768"],
    "cipher": ["aes-256-gcm"]
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

### 3.3 A2A_WELCOME

Lo envía el respondedor después de verificar el bundle del iniciador.

```json
{
  "type": "A2A_WELCOME",
  "protocol_version": "2.0",
  "responder_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "kem_ciphertext": {
    "alg": "x25519-ml-kem-768",
    "ciphertext_b64": "..."
  },
  "selected_algorithms": {
    "signing": "ed25519",
    "kem": "x25519-ml-kem-768",
    "cipher": "aes-256-gcm"
  },
  "resolved_security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

<a id="34-key-derivation"></a>

### 3.4 Derivación de la clave

Ambas partes derivan la clave de sesión:

```
shared_secret_BA = decapsulate(kem_ciphertext_BA, sk_A)
shared_secret_AB = decapsulate(kem_ciphertext_AB, sk_B)

session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

<a id="35-session-binding"></a>

### 3.5 Vinculación de la sesión

La sesión queda vinculada a las identidades de ambos agentes:

```
session_id = SHA-256(
  "DCP-AI.v2.A2A.Session" || 0x00 ||
  agent_id_A || 0x00 ||
  agent_id_B || 0x00 ||
  nonce_A || nonce_B ||
  session_key
)[0:32] (hex)
```

<a id="4-session-management"></a>

## 4. Gestión de sesiones

<a id="41-session-state"></a>

### 4.1 Estado de la sesión

Cada sesión mantiene:

- `session_id`: identificador único de la sesión
- `session_key`: clave simétrica derivada
- `message_counter_send`: contador monótonamente creciente de mensajes enviados
- `message_counter_recv`: contador monótonamente creciente de mensajes recibidos
- `created_at`: marca de tiempo de creación de la sesión
- `last_activity`: marca de tiempo del último mensaje
- `security_tier`: nivel de seguridad resuelto para la sesión
- `rekeying_interval`: mensajes antes de renovar la clave (predeterminado: 1000)

<a id="42-message-format"></a>

### 4.2 Formato de los mensajes

```json
{
  "session_id": "<hex>",
  "sequence": 42,
  "type": "A2A_MESSAGE",
  "encrypted_payload": "<base64>",
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "sender_agent_id": "agent:acme-001",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

Cifrado: AES-256-GCM con:

- Clave: `session_key`
- IV: 12 bytes aleatorios por mensaje
- AAD: `session_id || sequence || sender_agent_id || timestamp`

<a id="43-rekeying"></a>

### 4.3 Renovación de la clave

Cuando `message_counter_send` alcanza el `rekeying_interval`:

1. El iniciador envía `A2A_REKEY` con una nueva clave pública KEM efímera
2. El respondedor contesta con el texto cifrado KEM
3. Se deriva una nueva clave de sesión:
```
new_session_key = HKDF-SHA256(
  salt = old_session_key,
  ikm  = new_shared_secret,
  info = "DCP-AI.v2.A2A.Rekey" || session_id,
  len  = 32
)
```
4. Ambos contadores vuelven a 0

<a id="44-session-termination"></a>

### 4.4 Terminación de la sesión

Cualquiera de las partes puede terminarla:

```json
{
  "type": "A2A_CLOSE",
  "session_id": "<hex>",
  "reason": "complete",
  "final_sequence": 157,
  "audit_summary_hash": "sha256:<hex>",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

Motivos: `complete`, `timeout`, `error`, `revocation`, `policy_violation`.

<a id="45-session-resume"></a>

### 4.5 Reanudación de la sesión

Una sesión establecida anteriormente puede reanudarse si ambas partes conservan el estado de la sesión:

```json
{
  "type": "A2A_RESUME",
  "session_id": "<hex>",
  "last_seen_sequence": 157,
  "resume_proof": "<HMAC-SHA256(session_key, session_id || last_seen_sequence)>"
}
```

El respondedor valida la prueba y confirma con `A2A_RESUMED` o la rechaza con `A2A_RESUME_REJECTED` (lo que exige un handshake completo de nuevo).

<a id="5-trust-model"></a>

## 5. Modelo de confianza

<a id="51-direct-trust"></a>

### 5.1 Confianza directa

Dos agentes confían el uno en el otro después de verificar mutuamente sus bundles durante el handshake. La confianza se establece por sesión y, de forma predeterminada, no es transitiva.

<a id="52-organizational-trust"></a>

### 5.2 Confianza organizativa

Si el agente A confía en la clave de firma de la Organización X y el directorio de la Organización X incluye al agente B, el agente A puede extender su confianza al agente B bajo la autoridad de la Organización X.

<a id="53-transitive-trust-optional"></a>

### 5.3 Confianza transitiva (opcional)

La confianza transitiva debe (MUST) habilitarse explícitamente y está limitada en profundidad:

```json
{
  "trust_policy": {
    "allow_transitive": true,
    "max_depth": 2,
    "require_tier": "elevated",
    "trusted_organizations": ["org:acme", "org:globex"]
  }
}
```

Si `max_depth` es 2: A confía en B, B confía en C, A puede (MAY) confiar en C. Una profundidad de 0 significa solo confianza directa (predeterminado).

<a id="54-trust-revocation"></a>

### 5.4 Revocación de la confianza

Si el bundle de un agente se revoca durante una sesión activa:

1. La sesión debe (MUST) terminarse de inmediato
2. Debe (MUST) crearse una entrada de auditoría `revocation`
3. Los mensajes en tránsito deben (MUST) descartarse
4. Debe (MUST) notificarse a la contraparte mediante `A2A_CLOSE` con el motivo `revocation`

<a id="6-audit-integration"></a>

## 6. Integración con la auditoría

<a id="61-a2a-audit-events"></a>

### 6.1 Eventos de auditoría A2A

Cada interacción A2A genera entradas de auditoría en las cadenas de auditoría de ambos agentes:

**Eventos de handshake:**

- `a2a_hello_sent` / `a2a_hello_received`
- `a2a_session_established`

**Eventos de mensaje:**

- `a2a_message_sent` / `a2a_message_received`

**Eventos de sesión:**

- `a2a_rekey`
- `a2a_session_closed`
- `a2a_session_resumed`

<a id="62-audit-entry-for-a2a"></a>

### 6.2 Entrada de auditoría para A2A

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "a2a_message_sent",
  "agent_id": "agent:acme-001",
  "session_id": "<hex>",
  "counterparty_agent_id": "agent:globex-002",
  "sequence": 42,
  "payload_hash": "sha256:<hash of decrypted payload>",
  "timestamp": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hash of previous audit entry>",
  "prev_hash_secondary": "sha3-256:<hash>"
}
```

<a id="63-cross-chain-verification"></a>

### 6.3 Verificación entre cadenas

Las cadenas de auditoría de ambos agentes hacen referencia a la misma sesión. Un auditor externo puede verificar la coherencia:

1. Obteniendo las entradas de auditoría de ambos agentes para la sesión
2. Verificando que los hashes de los mensajes coinciden entre emisor y receptor
3. Verificando que los números de secuencia son coherentes
4. Verificando que las marcas de tiempo están dentro de un desfase aceptable (configurable, 30 segundos de forma predeterminada)

<a id="7-wire-format"></a>

## 7. Formato de intercambio

<a id="71-transport-requirements"></a>

### 7.1 Requisitos de transporte

Los mensajes A2A pueden (MAY) transportarse sobre:

- **WebSocket** (recomendado para conexiones bidireccionales y persistentes)
- **gRPC** (recomendado para entornos empresariales de alto rendimiento)
- **HTTP/2 Server-Sent Events** (para flujos unidireccionales)

El handshake debe (MUST) completarse en 10 segundos. La entrega de mensajes debe (MUST) tener semántica de como máximo una vez.

<a id="72-cbor-encoding"></a>

### 7.2 Codificación CBOR

Los mensajes A2A deberían (SHOULD) usar codificación CBOR (RFC 8949) por eficiencia de transporte:

- Mensajes de handshake: JSON (para facilitar la depuración)
- Mensajes de sesión: CBOR (por rendimiento)

Content-Type: `application/cbor` para CBOR, `application/json` para JSON.

<a id="8-security-considerations"></a>

## 8. Consideraciones de seguridad

<a id="81-forward-secrecy"></a>

### 8.1 Secreto hacia adelante

Las claves KEM efímeras proporcionan secreto hacia adelante (forward secrecy). Comprometer las claves de largo plazo no revela las claves de sesiones pasadas.

<a id="82-post-quantum-security"></a>

### 8.2 Seguridad poscuántica

El KEM híbrido (X25519 + ML-KEM-768) ofrece seguridad frente a adversarios clásicos y cuánticos. La clave de sesión es segura si cualquiera de los dos KEM que lo componen es seguro.

<a id="83-denial-of-service"></a>

### 8.3 Denegación de servicio

Las implementaciones deberían (SHOULD):

- Limitar la tasa de mensajes A2A_HELLO por origen
- Exigir un bundle válido antes de las operaciones KEM
- Aplicar límites de conexión por agente
- Usar prueba de trabajo para iniciadores anónimos (opcional)

<a id="84-message-ordering"></a>

### 8.4 Orden de los mensajes

Los números de secuencia impiden la reproducción y el reordenamiento. Las implementaciones deben (MUST) rechazar los mensajes con:

- Números de secuencia duplicados
- Números de secuencia más de 1000 por delante del último recibido (ventana)
- Números de secuencia inferiores al último recibido (salvo dentro de la ventana)

<a id="9-conformance"></a>

## 9. Conformidad

Una implementación es conforme con DCP-04 si:

1. Implementa el protocolo de handshake definido en la sección 3
2. Usa KEM híbrido para el establecimiento de claves
3. Cifra todos los mensajes de sesión con AES-256-GCM
4. Genera entradas de auditoría para todos los eventos A2A
5. Admite la renovación de la clave de sesión
6. Implementa la verificación de la confianza mediante la validación de bundles
7. Respeta los requisitos del nivel de seguridad

<a id="references"></a>

## Referencias

- DCP-01: Identidad y vinculación con el principal
- DCP-02: Declaración de intenciones y control por políticas
- DCP-03: Cadena de auditoría y transparencia
- FIPS 203: ML-KEM (mecanismo de encapsulación de claves basado en retículos modulares)
- RFC 5869: HKDF
- RFC 8949: CBOR
- RFC 8446: TLS 1.3 (inspiración para el diseño del handshake)

---

*Esta especificación fue cocreada por una persona y un agente de IA: el primer protocolo A2A para la ciudadanía digital, diseñado para gobernar las mismas interacciones que hace posibles.*

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- **Lo que implementan los SDK.** En `main` todos los SDK construyen `A2A_HELLO` y `A2A_WELCOME`; ninguno implementa
  `A2A_CONFIRM` / `A2A_ESTABLISHED` ni la derivación de clave de §3.4, solo el SDK de TypeScript tiene el KEM híbrido
  X25519 + ML-KEM-768 y el SDK de Rust no tiene capa de sesión
  ([tools/interop-matrix](../../../tools/interop-matrix/README.md#roadmap)). Ningún SDK ni servicio declara conformidad con
  DCP-04 tal como la define §9.
- **Lo que no hacen las funciones auxiliares.** Las funciones auxiliares de TypeScript construyen mensajes, directorios
  y objetos de sesión, y cifran y descifran mensajes de sesión con una clave que aporta quien llama: `createSession`
  recibe la `session_key` como argumento y no la deriva. No ejecutan el handshake, el intercambio KEM, la verificación
  ni la admisión del bundle de la contraparte, el transporte de red ni las entradas de auditoría de §6; todo eso queda a
  cargo de quien llama.
- **Entradas de auditoría.** No hay JSON Schema para la entrada de auditoría A2A de §6.2; su forma (`event_id`,
  `event_type`) difiere de `schemas/v2/audit_entry.schema.json` (`audit_id`, `outcome`). Tampoco los mensajes A2A de
  §2 a §4 tienen esquema en `schemas/v2/`. Para los tipos del SDK, consulta [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md).
- Los ejemplos son ilustraciones con marcadores (`...`, `<hex>`, `<uuid>`), no fixtures.
