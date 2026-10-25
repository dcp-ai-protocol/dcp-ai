<sub>[English](EARLY_ADOPTERS.md) · [中文](EARLY_ADOPTERS.zh-CN.md) · **Español** · [日本語](EARLY_ADOPTERS.ja.md) · [Português](EARLY_ADOPTERS.pt-BR.md)</sub>

<a id="dcp-ai-early-adopter-program"></a>

# Programa de primeros usuarios de DCP-AI

> Traducción informativa de [la versión en inglés](EARLY_ADOPTERS.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

**Estado:** Abierto — admisión continua
**Licencia:** Apache-2.0 (participar no tiene coste)

---

<a id="what-it-is"></a>

## Qué es

DCP-AI es una capa portable de rendición de cuentas para agentes de IA: identidad criptográfica, intención legible por máquinas, rastros de auditoría que permiten detectar manipulaciones, comunicación entre agentes, gobierno del ciclo de vida y representación delegada. Toda la pila es de código abierto y puede instalarse desde todos los registros principales.

El programa de primeros usuarios es una invitación a los equipos que despliegan agentes de IA en sistemas reales para que integren DCP-AI, saquen a la luz los casos límite que una revisión basada solo en la especificación no puede encontrar y den forma directamente a la siguiente iteración del protocolo.

No es una prueba beta. Los SDK están publicados y en uso. Es una colaboración de codiseño: la historia de tu integración pasa a formar parte de cómo se diseñan las próximas versiones.

---

<a id="who-should-apply"></a>

## Quién debería presentarse

- **Equipos de plataformas de IA** que construyen frameworks u orquestación de agentes
- **Equipos empresariales** que despliegan agentes autónomos donde importan la responsabilidad, la auditoría o el cumplimiento normativo
- **Equipos financieros, sanitarios o del sector público** que necesitan una identidad de agente verificable
- **Investigadores** que trabajan en seguridad de agentes, criptografía poscuántica o credenciales verificables
- **Desarrolladores independientes** que lanzan productos de agentes novedosos y están dispuestos a compartir lo que aprenden

---

<a id="what-you-get"></a>

## Qué obtienes

<a id="everything-in-the-public-stack"></a>

### Todo lo de la pila pública

No esperas «acceso» a nada. Esto ya está disponible:

| Artefacto | Dónde |
|---|---|
| 9 especificaciones del protocolo (DCP-01..09) | [docs.dcp-ai.org](https://docs.dcp-ai.org/) |
| 5 SDK que implementan el mismo protocolo principal (TypeScript, Python, Go, Rust, WASM); las versiones y la cobertura difieren, véase la sección *Release status* de cada SDK | npm / PyPI / crates.io / módulos de Go |
| 11 integraciones con frameworks (LangChain, CrewAI, Agno, OpenAI, Express, FastAPI, Anthropic MCP, Google A2A, AutoGen, W3C DID, OpenClaw) | npm + dcp-ai[extras] + agno-dcp (PyPI) |
| 4 generadores `npm create @dcp-ai/*` | npm |
| Imágenes Docker de los cuatro servicios | `ghcr.io/dcp-ai-protocol/dcp-ai/*` |
| Playground interactivo | [docs.dcp-ai.org/playground](https://docs.dcp-ai.org/playground/) |
| `@context` JSON-LD para credenciales verificables | [dcp-ai.org/credentials/v2](https://dcp-ai.org/credentials/v2) |

<a id="what-early-adopters-get-on-top"></a>

### Lo que obtienen además los primeros usuarios

- **Canal directo con los mantenedores** mediante Issues/Discussions de GitHub: respuestas en 2 días hábiles y máxima prioridad de clasificación para los bloqueos.
- **Participación en el codiseño** de la hoja de ruta de las próximas versiones: qué niveles de seguridad, qué algoritmos, qué decisiones sobre el formato de transmisión.
- **Validación de conformidad**: ayuda para construir suites de pruebas que ejerciten tus rutas de integración concretas; los resultados vuelven a la suite de conformidad pública.
- **Colaboración en un caso de estudio** (opcional): un artículo publicado sobre tu integración —decisiones de arquitectura, retos, resultados— con tu aprobación en cada párrafo.
- **Vía de gobernanza**: se invita a los colaboradores activos a convertirse en Reviewers o Maintainers según [GOVERNANCE.md](../GOVERNANCE.md).

---

<a id="what-we-ask"></a>

## Qué pedimos

<a id="integration"></a>

### Integración

1. Integrar el SDK de DCP-AI en al menos una ruta de preproducción o de producción en los 90 días siguientes al inicio.
2. Implementar el flujo principal de extremo a extremo: vinculación de identidad → declaración de intención → decisión de política → entrada de auditoría → verificación del bundle.
3. En v2.0, usar firmas híbridas compuestas (Ed25519 + ML-DSA-65). Los SDK lo hacen por ti; no hay que implementarlo a mano.
4. Ejecutar la suite de pruebas de conformidad contra tu integración y compartir el resultado.

<a id="feedback"></a>

### Comentarios

1. Una nota de comentarios estructurada al mes: una Discussion de GitHub, un correo o una llamada breve, lo que te resulte más fácil.
2. Registrar los errores y los casos límite como issues de GitHub. Para los hallazgos sensibles para la seguridad, usar la notificación privada de vulnerabilidades de GitHub.
3. Participar en al menos un hilo de discusión abierto en el que se estén sopesando decisiones de diseño.

<a id="testing"></a>

### Pruebas

1. Ejecutar la validación NIST KAT de las primitivas criptográficas de las que dependas (Ed25519, ML-DSA-65; ML-KEM-768 y SLH-DSA-192f si procede).
2. Si usas varios SDK en el mismo sistema, ejecutar los vectores de interoperabilidad entre SDK (`tests/interop/v2/`).
3. Validar la compatibilidad con los bundles v1.0 si existe alguno en tu canal.
4. Intentar romper cosas: manipulación de bundles, eliminación de firmas, empalme de sesiones, repetición. Si lo rompes, queremos saberlo.

---

<a id="timeline"></a>

## Calendario

El programa funciona con admisión continua. Tu reloj empieza cuando aceptas.

| Fase | Duración típica | Qué ocurre |
|---|---|---|
| Incorporación | semana 1 | Llamada o hilo de inicio. Recorrido por el protocolo orientado a tu pila. Borrador del plan de integración. |
| Integración | semanas 2-8 | Se construye el flujo principal. Primera ejecución de conformidad. Aparece el primer bloqueo. Ciclo de desbloqueo con la ayuda de los mantenedores. |
| Refuerzo | semanas 9-12 | Ajuste de los niveles de seguridad. Cobertura de NIST KAT. Interoperabilidad entre SDK si procede. Revisión de la preparación para producción. |
| Graduación | semana 13 en adelante | Eres un participante de pleno derecho del ecosistema. Borrador del caso de estudio si lo elegiste. Se abre la vía de gobernanza. |

No hay una «fecha de fin» formal. Sigues en el programa mientras sigas lanzando y el ciclo de comentarios esté activo.

---

<a id="how-to-apply"></a>

## Cómo presentarse

<a id="process"></a>

### Proceso

1. Abre una Discussion de GitHub en [`dcp-ai-protocol/dcp-ai`](https://github.com/dcp-ai-protocol/dcp-ai/discussions) con la plantilla **Early Adopter Application** (o abre un issue con la etiqueta `early-adopter` si las discusiones no están habilitadas para ti).
2. También puedes escribir a los mantenedores (véase [GOVERNANCE.md](../GOVERNANCE.md) para los contactos actuales de los mantenedores).

<a id="what-to-include"></a>

### Qué incluir

- Nombre de la organización o del equipo, y una breve descripción
- Caso de uso: ¿qué agentes despliegas o piensas desplegar?
- Pila técnica: lenguajes, frameworks, infraestructura
- Qué componentes de DCP te resultan más relevantes (¿identidad de DCP-01? ¿auditoría de DCP-03? ¿arbitraje de DCP-07? ¿todos?)
- Calendario: ¿cuándo puedes empezar?
- Tamaño del equipo: ¿cuántos ingenieros trabajarán en la integración?

<a id="review"></a>

### Revisión

Las solicitudes se revisan de forma continua, normalmente en 7 días hábiles. Buscamos una mezcla de casos de uso —cumplimiento normativo empresarial, investigación, desarrolladores independientes— en lugar de seleccionar por tamaño.

---

<a id="selection-criteria"></a>

## Criterios de selección

- **Diversidad de casos de uso**: buscamos activamente aplicaciones poco habituales, no solo las rutas empresariales esperadas.
- **Intención real de despliegue**: prioridad para los equipos que lanzan a sistemas reales, no solo para quienes evalúan.
- **Implicación**: disposición a compartir lo que encuentres, tanto lo positivo como lo negativo.
- **Capacidad técnica**: el equipo tiene experiencia previa con protocolos criptográficos, sistemas de agentes o infraestructura relevante para la seguridad.

---

<a id="support-channels"></a>

## Canales de soporte

| Canal | Propósito | Acceso |
|---|---|---|
| Issues de GitHub | Errores, peticiones de funciones, problemas de conformidad | Público |
| Discussions de GitHub | Preguntas de diseño, hilos de primeros usuarios, patrones de integración | Público |
| Informes privados de vulnerabilidades | Hallazgos sensibles para la seguridad | Notificación privada de GitHub |
| Correo electrónico | Trabajo bajo NDA, conversaciones contractuales | Según [GOVERNANCE.md](../GOVERNANCE.md) |

Por ahora no hay un Slack, un Discord ni sesiones de consulta dedicados. El programa se gestiona con pocos recursos para que el tiempo de los mantenedores se dedique a resolver de verdad tus problemas. Si la demanda crece lo suficiente para justificar un canal de comunidad, lo añadiremos y lo anunciaremos aquí.

---

<a id="security-disclosure"></a>

## Divulgación de seguridad

Los problemas de seguridad de DCP-AI se divulgan de forma responsable mediante la notificación privada de vulnerabilidades de GitHub. Puede ofrecerse una recompensa económica por errores, caso por caso, para los hallazgos de alto impacto; se decide en cada informe según la gravedad y la reproducibilidad, no con un nivel comprometido de antemano. Los investigadores que prefieran el reconocimiento público aparecen en las notas de la versión.

> **Nota (25/10/2026): los documentos no coinciden.** [SECURITY.md](../SECURITY.md) enumera rangos de recompensa fijos por gravedad, mientras que esta página y [GOVERNANCE.md](../GOVERNANCE.md) dicen que las recompensas se deciden en cada informe. Se conservan ambos textos hasta que un mantenedor confirme cuál se aplica.

Véase [SECURITY_MODEL.md](SECURITY_MODEL.md) para el modelo de amenazas y las indicaciones para notificar.

---

<a id="success-stories"></a>

## Casos de éxito

*Esta sección se irá completando a medida que los primeros usuarios publiquen sus integraciones.*

<a id="your-organization-here"></a>

### [Tu organización aquí]

Si integras DCP-AI y estás dispuesto a compartir la historia —decisiones de arquitectura, sorpresas, resultados—, queremos destacarla. Contacta con los mantenedores para iniciar un hilo de caso de estudio.

---

<a id="faq"></a>

## Preguntas frecuentes

**P: ¿DCP-AI está listo para producción?**
R: La especificación v2.0 está completa y los 5 SDK están publicados y en uso. DCP-04 a DCP-09 llevan en sus cabeceras la etiqueta «Published — v2.0 (extension; revisions tracked via adopter feedback)»; el formato de transmisión es estable y está probado, y las revisiones de versiones menores las guiarán los comentarios de los usuarios, no cambios incompatibles. Que esté listo para tu despliegue depende de las partes que uses:

- los verificadores de los SDK son la ruta de producción; los servicios de referencia guardan su estado en memoria, y los endpoints de DCP-05–09 de la pasarela de referencia no tienen autenticación ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md));
- el repositorio no tiene integración con HSM, y el asistente `@dcp-ai/cli init` es una demo ([SECURITY_MODEL.md](SECURITY_MODEL.md), «Known Limitations and Mitigations»).

La auditoría de seguridad final de v2.0 del 26/02/2026 ([spec/AUDIT-v2.0-FINAL.md](../spec/AUDIT-v2.0-FINAL.md)) es un registro con fecha: revisiones posteriores encontraron límites que no recogía, como que su carencia de HSM solo se cerró con un proveedor simulado.

**P: ¿Participar en el programa de primeros usuarios tiene coste?**
R: No. El programa es gratuito. Todo el proyecto tiene licencia Apache-2.0.

**P: ¿Tengo que usar las funciones poscuánticas?**
R: Depende del verificador. Un bundle V2 puede llevar una firma solo clásica; los verificadores exigen la firma híbrida compuesta (Ed25519 + ML-DSA-65) en el modo `hybrid_required`, que se aplica a las acciones de nivel elevated y maximum y es el valor por defecto del servidor de referencia. Usa claves híbridas y el SDK firma ambas por ti; no escribes criptografía a mano.

**P: ¿Puedo participar como desarrollador individual?**
R: Sí. Los desarrolladores individuales y los equipos pequeños son bienvenidos y a menudo descubren los casos límite más interesantes.

**P: ¿Qué pasa cuando termino el programa?**
R: Sigues usando DCP-AI. Se invita a los colaboradores activos a convertirse en Reviewers o Maintainers según [GOVERNANCE.md](../GOVERNANCE.md).

**P: ¿Puedo ejecutar mi propia instancia alojada de los servicios?**
R: Sí, ese es el modelo previsto. El servidor de verificación, el anclaje, el registro de transparencia y el registro de revocaciones se publican como imágenes Docker en GHCR, con configuraciones de Fly.io listas en [`deploy/`](../deploy/). No hay ningún SaaS propio; cada operador ejecuta los suyos. Son servicios de referencia: añade almacenamiento persistente, restringe los endpoints de DCP-05–09 sin autenticación de la pasarela y lee [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) antes de exponerlos.

**P: ¿Cómo cito DCP-AI en un artículo?**
R: Véase [CITATION.cff](../CITATION.cff) para los DOI del artículo y del software.

---

*El programa de primeros usuarios de DCP-AI es una invitación abierta a construir juntos la infraestructura de rendición de cuentas que necesitan los sistemas de IA autónomos.*
