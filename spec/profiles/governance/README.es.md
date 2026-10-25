<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="governance-profile"></a>

# Perfil Governance

> Traducción informativa de [la especificación en inglés](README.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Estado:** Publicado — v2.0  
**Alcance:** Niveles de riesgo, atestación de jurisdicción, revocación, recuperación de claves y operaciones de gobernanza  

---

<a id="purpose"></a>

## Propósito

El núcleo de DCP define los artefactos y el modelo de verificación. El perfil Governance define las políticas, las reglas y los mecanismos operativos que determinan cómo se gestionan esos artefactos a lo largo de su ciclo de vida: quién puede revocar un agente, cómo se asignan los niveles de riesgo, qué requisitos jurisdiccionales se aplican y cómo se recuperan las claves.

Esto queda explícitamente fuera del núcleo porque:

- Las políticas de gobernanza dependen del despliegue (un despliegue gubernamental tiene reglas distintas de las de una startup)
- La asignación de niveles de riesgo depende del contexto del verificador, no de la estructura del protocolo
- Los requisitos jurisdiccionales varían según el país y el marco regulatorio
- Los mecanismos de recuperación de claves y de revocación implican infraestructura operativa
- Las ceremonias de gobernanza requieren una coordinación entre varias partes que va más allá de la verificación

<a id="what-lives-here-not-in-core"></a>

## Qué vive aquí (no en el núcleo)

<a id="adaptive-security-tiers"></a>

### Niveles de seguridad adaptativos

El sistema de cuatro niveles (routine, standard, elevated, maximum) que selecciona automáticamente el nivel de protección criptográfica según la puntuación de riesgo de la intención, la clasificación de los datos y el tipo de acción.

Véase la sección 14 de [DCP-AI v2.0](../../DCP-AI-v2.0.md).

<a id="jurisdiction-attestation"></a>

### Atestación de jurisdicción

Atestaciones opcionales de autoridades gubernamentales o acreditadas que certifican la identidad de un registro de vinculación al principal para una jurisdicción concreta.

Véase la sección «Jurisdiction Attestation» de [DCP-01](../../DCP-01.md).

<a id="revocation"></a>

### Revocación

Mecanismos para revocar agentes:

- **Revocación estándar** mediante Revocation Records firmados ([DCP-01](../../DCP-01.md))
- **Revocación de emergencia** mediante un token de revocación registrado previamente (no hace falta firma)
- **Listas de revocación jurisdiccionales** publicadas por autoridades

Véase la sección 11.3 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) y la carencia n.º 13 del [informe de AUDIT](../../AUDIT-v2.0-FINAL.md).

<a id="key-recovery"></a>

### Recuperación de claves

Recuperación social M de N mediante el esquema de compartición de secretos de Shamir, con las partes cifradas mediante un KEM híbrido.

Véase la sección 11.2 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) y la carencia n.º 1 del [informe de AUDIT](../../AUDIT-v2.0-FINAL.md).

<a id="key-rotation"></a>

### Rotación de claves

Ceremonia de rotación: la clave nueva firma una prueba de posesión, la clave antigua contrafirma la autorización, con un periodo de gracia configurable.

Véase la sección 11.1 de [DCP-AI v2.0](../../DCP-AI-v2.0.md).

<a id="governance-key-ceremonies"></a>

### Ceremonias de claves de gobernanza

Operaciones de gobernanza M de N entre varias partes para firmar avisos de algoritmos y decisiones del protocolo.

Véase la sección 13.1 de [DCP-AI v2.0](../../DCP-AI-v2.0.md) y la sección «Governance Key Ceremony» del [informe de AUDIT](../../AUDIT-v2.0-FINAL.md).

<a id="verifier-authoritative-policy"></a>

### Política que decide el verificador

El principio de que la política de firmas la fija la configuración del verificador, no el agente. Incluye la regla de no rebajar nunca los niveles de seguridad.

Véase la sección 7.2 de [DCP-AI v2.0](../../DCP-AI-v2.0.md).

<a id="what-stays-in-core"></a>

## Qué permanece en el núcleo

- La existencia de un compromiso de revocación en la vinculación al principal (el campo `revocation_token`)
- El campo `status` del pasaporte del agente (active/suspended/revoked)
- El artefacto de resultado de política (pero no cómo se toman las decisiones de política)
- El registro de auditoría (pero no qué eventos de gobernanza se registran)

<a id="normative-references"></a>

## Referencias normativas

- [DCP-01](../../DCP-01.md) — atestación de jurisdicción, Revocation Records
- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — secciones 7.2 (política de verificador), 11 (gestión de claves), 13 (gobernanza), 14 (niveles de seguridad)
- [Almacenamiento y anclaje](../../../docs/STORAGE_AND_ANCHORING.md) — listas de revocación, registros de transparencia
- [Guía del operador](../../../docs/OPERATOR_GUIDE.md) — operar un servicio de verificación

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- Ningún esquema de RPR tiene un campo `revocation_token`. El esquema del pasaporte V2 tiene un
  `emergency_revocation_token` opcional, el compromiso que comprueba la revocación de emergencia; el pasaporte V1 no tiene ninguno.
- El enum `status` del pasaporte es `active`, `suspended` y `revoked` en V1, y añade `commissioned`, `declining` y
  `decommissioned` en V2 (seis estados).
- Las ayudas de recuperación de claves de los SDK dividen y reconstruyen un secreto con el esquema de Shamir y devuelven las partes tal cual:
  no cifran las partes con el KEM híbrido ni las distribuyen. Cifrar y entregar cada parte es tarea de
  quien llama.
