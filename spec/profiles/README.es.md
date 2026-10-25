<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-profiles"></a>

# Perfiles de DCP

> Traducción informativa de [la especificación en inglés](README.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

Los perfiles son extensiones que se apoyan en el [núcleo de DCP](../core/) para atender necesidades concretas de despliegue. No son necesarios para la interoperabilidad básica: una implementación conforme del núcleo es válida sin ningún perfil.

<a id="available-profiles"></a>

## Perfiles disponibles

| Perfil | Alcance | Directorio |
|---------|-------|-----------|
| **Crypto** | Selección de algoritmos, firmas híbridas/PQ, vinculación compuesta, agilidad criptográfica, política de verificador | [crypto/](crypto/) |
| **A2A** | Descubrimiento de agentes, establecimiento de sesiones, vinculaciones de transporte, intercambio de mensajes | [a2a/](a2a/) |
| **Governance** | Niveles de riesgo, atestación de jurisdicción, revocación, recuperación de claves, ceremonias de gobernanza | [governance/](governance/) |
| **Admission** | Conjuntos de confianza de principales y el perfil `strict-v1` fijado por el operador, por encima de la verificación | [admission/](admission/) |

<a id="design-principles"></a>

## Principios de diseño

- Los perfiles no deben (MUST NOT) contradecir los requisitos del núcleo de DCP
- Los perfiles pueden (MAY) definir artefactos, campos o pasos de verificación adicionales
- Los perfiles pueden (MAY) especificar elecciones de algoritmos, vinculaciones de transporte o políticas de gobernanza
- Una implementación conforme del núcleo es válida sin ningún perfil
- Los perfiles se versionan de forma independiente del núcleo

<a id="relationship-to-existing-specs"></a>

## Relación con las especificaciones existentes

La estructura de perfiles ofrece un marco organizativo para material que ya existe en el repositorio:

- El **perfil Crypto** se basa en las secciones 2–5 de [DCP-AI v2.0](../DCP-AI-v2.0.md) (algoritmos, firmas compuestas, modos de verificación)
- El **perfil A2A** se basa en [DCP-04](../DCP-04.md) (comunicación entre agentes)
- El **perfil Governance** se basa en las secciones 13–14 de [DCP-AI v2.0](../DCP-AI-v2.0.md) (gobernanza, niveles de seguridad adaptativos) y en [DCP-01](../DCP-01.md) (atestación de jurisdicción, revocación)

Las especificaciones normativas existentes siguen siendo la referencia. Estos README de perfiles aportan contexto editorial y explican la separación entre lo que corresponde al núcleo y a los perfiles.

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- «Válida sin ningún perfil» se refiere a la interoperabilidad de los artefactos del núcleo. No exime a una implementación
  de los requisitos del núcleo, y un despliegue sigue aplicando su propia política de verificador (por ejemplo, el modo de
  verificación que exige un nivel de riesgo) y, cuando lo usa, el perfil de admisión.
- Un bundle que se verifica es coherente internamente y está firmado por las claves que él mismo enumera; eso por sí solo no hace
  que su principal sea de confianza, ni lo admite, ni autoriza una acción. La confianza en un principal viene del conjunto de
  confianza propio del verificador: véase [docs/ADMISSION.md](../../docs/ADMISSION.md) y el [perfil de admisión](admission/).
