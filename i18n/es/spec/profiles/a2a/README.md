<sub>[English](../../../../../spec/profiles/a2a/README.md) · [中文](../../../../zh-CN/spec/profiles/a2a/README.md) · **Español** · [日本語](../../../../ja/spec/profiles/a2a/README.md) · [Português](../../../../pt-BR/spec/profiles/a2a/README.md)</sub>

<a id="a2a-profile-agent-to-agent-communication"></a>

# Perfil A2A (comunicación entre agentes)

> Traducción informativa de [la especificación en inglés](../../../../../spec/profiles/a2a/README.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Estado:** Publicado — v2.0  
**Alcance:** Descubrimiento de agentes, establecimiento de sesiones, vinculaciones de transporte e intercambio de mensajes  

---

<a id="purpose"></a>

## Propósito

El núcleo de DCP define cómo un agente individual demuestra su identidad y su rendición de cuentas ante un verificador. El perfil A2A amplía esto a la interacción directa entre agentes: cómo dos agentes certificados por DCP se descubren, establecen una sesión con autenticación mutua e intercambian mensajes con plena integración en el registro de auditoría.

Esto queda explícitamente fuera del núcleo porque:

- Muchos despliegues de DCP solo implican interacción entre agente y verificador (verificación pasiva)
- A2A requiere vinculaciones específicas de transporte (WebSocket, gRPC, HTTP/2) que el núcleo no debería imponer
- Los mecanismos de descubrimiento dependen del contexto de despliegue (URL well-known, registros, intercambio directo)
- La gestión de sesiones introduce estado, que no forma parte del modelo de verificación sin estado del núcleo

<a id="what-lives-here-not-in-core"></a>

## Qué vive aquí (no en el núcleo)

<a id="agent-discovery"></a>

### Descubrimiento de agentes

Publicación y resolución de directorios de agentes mediante `.well-known/dcp-agent-directory.json`, incluidos los metadatos, las capacidades, los endpoints y los algoritmos admitidos de cada agente.

Véase [DCP-04](../../../../../spec/DCP-04.md), sección 2.

<a id="handshake-protocol"></a>

### Protocolo de handshake

El handshake de cuatro mensajes (A2A_HELLO, A2A_WELCOME, A2A_CONFIRM, A2A_ESTABLISHED) que establece una sesión con autenticación mutua y protegida de forma poscuántica mediante un KEM híbrido (X25519 + ML-KEM-768).

Véase [DCP-04](../../../../../spec/DCP-04.md), sección 3.

<a id="session-management"></a>

### Gestión de sesiones

Estado de la sesión (claves, contadores, renovación de claves), formato de los mensajes cifrados (AES-256-GCM), protocolo de renovación de claves, cierre de sesión y reanudación de sesión.

Véase [DCP-04](../../../../../spec/DCP-04.md), sección 4.

<a id="transport-bindings"></a>

### Vinculaciones de transporte

Opciones de transporte WebSocket, gRPC y HTTP/2 SSE, con codificación CBOR para los mensajes de sesión.

Véase [DCP-04](../../../../../spec/DCP-04.md), sección 7.

<a id="trust-model"></a>

### Modelo de confianza

Establecimiento de confianza por sesión mediante verificación mutua de bundles, confianza organizativa y confianza transitiva opcional con límites de profundidad configurables.

Véase [DCP-04](../../../../../spec/DCP-04.md), sección 5.

<a id="a2a-audit-events"></a>

### Eventos de auditoría A2A

Tipos de entrada de auditoría específicos de las interacciones A2A: `a2a_hello_sent`, `a2a_session_established`, `a2a_message_sent`, `a2a_rekey`, `a2a_session_closed`, etc.

Véase [DCP-04](../../../../../spec/DCP-04.md), sección 6.

<a id="what-stays-in-core"></a>

## Qué permanece en el núcleo

- El Signed Bundle que presentan los agentes durante el handshake A2A: su estructura y su verificación son del núcleo
- Las entradas de auditoría encadenadas por hash que producen los eventos A2A: su formato es del núcleo, pero los tipos de evento específicos de A2A son del perfil
- El Agent Passport que identifica a cada agente: su estructura es del núcleo

<a id="normative-references"></a>

## Referencias normativas

- [DCP-04](../../../../../spec/DCP-04.md) — Comunicación entre agentes (especificación normativa completa)
- [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) — Vinculación de sesión (sección 8), derivación de claves

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- «Publicado» se refiere a la especificación. En `main`, todos los SDK construyen `A2A_HELLO` y `A2A_WELCOME`, pero ninguno
  implementa `A2A_CONFIRM` / `A2A_ESTABLISHED` ni la derivación de la clave de sesión de [DCP-04](../../../../../spec/DCP-04.md) §3.4; solo
  el SDK de TypeScript tiene el KEM híbrido X25519 + ML-KEM-768 que anuncian los mensajes, y el SDK de Rust no tiene capa de
  sesión ([tools/interop-matrix](../../../../../tools/interop-matrix/README.md#roadmap)).
- Las ayudas de los SDK construyen mensajes, directorios y objetos de sesión para los que quien llama aporta las claves. No ejecutan
  por sí solas el handshake, el intercambio KEM, la verificación de bundles, la admisión, la red ni el registro de auditoría: eso
  corresponde a quien llama, y el servidor de referencia no implementa ninguna vinculación de transporte.
