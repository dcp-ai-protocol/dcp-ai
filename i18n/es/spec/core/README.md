<sub>[English](../../../../spec/core/README.md) · [中文](../../../zh-CN/spec/core/README.md) · **Español** · [日本語](../../../ja/spec/core/README.md) · [Português](../../../pt-BR/spec/core/README.md)</sub>

<a id="dcp-core"></a>

# Núcleo de DCP

> Traducción informativa de [la especificación en inglés](../../../../spec/core/README.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

Este directorio contiene la **especificación del núcleo** del Digital Citizenship Protocol: la superficie mínima interoperable del protocolo que toda implementación de DCP debe admitir.

<a id="what-is-dcp-core"></a>

## Qué es el núcleo de DCP

El núcleo de DCP define los artefactos, sus relaciones y el modelo de verificación que permiten a cualquier verificador evaluar:

- **Quién es responsable** de un agente (vinculación al principal responsable)
- **Qué declaró el agente** que pretendía hacer (declaración de intención)
- **Qué resultado de política** se aplicó (decisión de política)
- **Qué evidencia verificable** se produjo (evidencia de la acción / registro de auditoría)
- **Cómo se empaquetan todos los artefactos** para una verificación portable (manifiesto del bundle)

El núcleo es deliberadamente mínimo. Define *qué* debe estar presente y *cómo* verificarlo, pero delega en los **perfiles** *cómo* firmar, *qué* algoritmos usar, *cómo* se descubren los agentes entre sí y *cómo* se aplican las políticas de gobernanza.

<a id="core-artifacts"></a>

## Artefactos del núcleo

| Artefacto | Propósito | Especificación existente |
|----------|---------|---------------|
| Responsible Principal Record | Vincula un agente a una persona o entidad jurídica | [DCP-01](../../../../spec/DCP-01.md) (como «Responsible Principal Record») |
| Agent Passport | Identidad, capacidades y material de claves del agente | [DCP-01](../../../../spec/DCP-01.md) |
| Intent Declaration | Declaración estructurada previa a la acción | [DCP-02](../../../../spec/DCP-02.md) |
| Policy Outcome | Decisión de autorización sobre una intención | [DCP-02](../../../../spec/DCP-02.md) |
| Action Evidence | Entradas de auditoría encadenadas por hash | [DCP-03](../../../../spec/DCP-03.md) |
| Bundle Manifest | Paquete portable que vincula todos los artefactos | [BUNDLE](../../../../spec/BUNDLE.md) |

<a id="documents"></a>

## Documentos

- [dcp-core.md](../../../../spec/core/dcp-core.md) — especificación editorial del núcleo, con la justificación completa y las definiciones de los artefactos

<a id="relationship-to-existing-specs"></a>

## Relación con las especificaciones existentes

La especificación del núcleo es una capa editorial que organiza las especificaciones normativas existentes (de DCP-01 a DCP-03, BUNDLE, VERIFICATION) en un núcleo coherente. No las sustituye: ofrece una vista unificada de la superficie mínima del protocolo.

<a id="what-is-not-core"></a>

## Qué NO es núcleo

Lo siguiente queda explícitamente fuera del núcleo y corresponde a perfiles o servicios:

- Algoritmos criptográficos concretos (Ed25519, ML-DSA-65, etc.) → [perfil Crypto](../../../../spec/profiles/crypto/)
- Descubrimiento y comunicación entre agentes → [perfil A2A](../../../../spec/profiles/a2a/)
- Niveles de riesgo, jurisdicción, revocación, gobernanza → [perfil Governance](../../../../spec/profiles/governance/)
- Servidores de verificación, anclaje, registros de transparencia → servicios de infraestructura

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- Los artefactos del núcleo existen en dos versiones del formato de intercambio. V1 (`schemas/v1/`): sin manifiesto, sin sobres `SignedPayload`, sin
  `session_nonce`, una firma Ed25519 sobre el bundle y al menos una entrada de auditoría. V2 (`schemas/v2/`, especificada en
  [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md)): un manifiesto firmado que se compromete con cada artefacto, sobres `SignedPayload` para el
  RPR, el pasaporte, la intención y la decisión de política, un nonce de sesión, firmas compuestas y un registro de auditoría que puede estar
  vacío.
- En V2 el RPR lleva las `binding_keys` del principal y el pasaporte lo firman las propias claves del agente. Un bundle
  que se verifica prueba que sus firmas coinciden con las claves que enumera, no quién es el principal: la confianza viene del
  conjunto de confianza del verificador ([docs/ADMISSION.md](../../../../docs/ADMISSION.md)).
