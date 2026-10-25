<sub>[English](GOVERNANCE.md) · [中文](GOVERNANCE.zh-CN.md) · **Español** · [日本語](GOVERNANCE.ja.md) · [Português](GOVERNANCE.pt-BR.md)</sub>

<a id="dcp-ai-governance"></a>

# Gobernanza de DCP-AI

> Traducción informativa de [la versión en inglés](GOVERNANCE.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Este documento describe el modelo de gobernanza del proyecto DCP-AI (Digital Citizenship Protocol for AI Agents).

<a id="governance-model"></a>

## Modelo de gobernanza

DCP-AI usa un modelo de **gobernanza abierta**. El proyecto se desarrolla en abierto y se aceptan contribuciones de cualquier persona. Las decisiones importantes se toman por consenso entre los mantenedores, con la información aportada por la comunidad.

**Estado actual (abril de 2026):** el proyecto está en su fase inicial, con un único mantenedor fundador. Los roles, el proceso de decisión y las reglas de votación descritos abajo definen cómo funcionará el proyecto a medida que se incorporen más mantenedores. Mientras el proyecto tenga un único mantenedor, «consenso entre los mantenedores» significa la decisión de ese mantenedor; este documento se aplica a ese caso por construcción.

## Roles

<a id="contributors"></a>

### Contribuidores

Cualquier persona que envía un pull request, abre un issue, participa en debates o contribuye de otro modo al proyecto. Se espera que los contribuidores sigan la [Guía de contribución](CONTRIBUTING.md).

<a id="reviewers"></a>

### Revisores

Contribuidores de confianza que han demostrado contribuciones sostenidas y de alta calidad y un buen conocimiento del protocolo. Los revisores pueden:

- Aprobar pull requests
- Clasificar y etiquetar issues
- Participar en los debates de diseño con un peso mayor

Los revisores los proponen los mantenedores y se confirman por consenso.

<a id="maintainers"></a>

### Mantenedores

Los mantenedores tienen acceso completo de escritura al repositorio y son responsables de la dirección general del proyecto. Los mantenedores pueden:

- Fusionar pull requests
- Crear versiones
- Gestionar la CI/CD y la infraestructura
- Proponer y aprobar nuevos revisores y mantenedores
- Tomar las decisiones finales cuando no se alcanza el consenso

Los nuevos mantenedores se incorporan por consentimiento unánime de los mantenedores existentes.

<a id="decision-making-process"></a>

## Proceso de decisión

1. **Propuestas**: los cambios significativos (nuevas versiones del protocolo, cambios incompatibles, nuevos SDK, cambios de gobernanza) deben proponerse como issues o debates de GitHub antes de implementarse.

2. **Debate**: se anima a todas las partes interesadas a dar su opinión. Hay que dejar un mínimo de 7 días de debate para las propuestas significativas.

3. **Consenso**: las decisiones se toman por consenso entre los mantenedores. Consenso significa que ningún mantenedor mantiene una objeción tras el debate.

4. **Votación**: si no se alcanza el consenso, decide una votación por mayoría simple entre los mantenedores. Cada mantenedor tiene un voto. La votación debe permanecer abierta al menos 72 horas.

5. **Documentación**: todas las decisiones significativas se documentan en el issue, el PR o el hilo de debate correspondiente.

<a id="protocol-changes"></a>

## Cambios en el protocolo

Los cambios en las especificaciones normativas del protocolo (`spec/`) exigen un listón más alto:

- Una propuesta escrita que describa el cambio, la motivación y las implicaciones de compatibilidad con versiones anteriores
- La revisión de al menos dos mantenedores
- Un periodo mínimo de debate de 14 días para los cambios incompatibles
- Pruebas de conformidad actualizadas que validen el nuevo comportamiento
- Esquemas actualizados en `schemas/v1/` o `schemas/v2/` (o un nuevo directorio de versión)

<a id="release-process"></a>

## Proceso de publicación

1. **Versionado**: el proyecto sigue [Semantic Versioning](https://semver.org/). Las versiones del protocolo (p. ej., DCP v1.0) son independientes de las versiones de las implementaciones.

2. **Cadencia de publicación**: las versiones se publican cuando hace falta. No hay un calendario fijo.

3. **Pasos de la publicación**:
   - Todas las comprobaciones de CI deben pasar en `main`
   - Un mantenedor crea una rama de versión (si procede) o etiqueta desde `main`
   - `CHANGELOG.md` se actualiza con todos los cambios notables
   - Las notas de la versión se publican en GitHub
   - Los paquetes de los SDK se publican en sus registros respectivos (npm, PyPI, crates.io). El SDK de Go no se publica en un registro central: los módulos de Go se descubren por etiqueta en `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2`; pkg.go.dev los indexa automáticamente desde allí.
   - La publicación está automatizada con los workflows `publish.yml`, `publish-pypi.yml`, `publish-integrations.yml`, `publish-templates.yml` y `publish-docker.yml`, que se disparan con una GitHub Release o se ejecutan a mano. Los workflows de paquetes comprueban si la versión ya existe en el registro; el workflow de Docker construye y sube imágenes sin esa comprobación de existencia de versión. `publish-docker.yml` también se ejecuta en cada push a `main` que toque `server/`, `services/`, `lib/`, `tools/`, `schemas/`, `docker/Dockerfile` o el propio workflow, y sube las etiquetas de imagen `:latest`, `:main` y `:sha-…`.
   - Cuando procede, se crea o se enlaza un DOI de software de Zenodo para que la versión pueda citarse en trabajos académicos (véase [CITATION.cff](CITATION.cff)).

4. **Correcciones urgentes**: las correcciones críticas de seguridad o de corrección pueden saltarse el periodo normal de debate a criterio de los mantenedores.

<a id="security-disclosure-policy"></a>

## Política de divulgación de seguridad

Si descubres una vulnerabilidad de seguridad en DCP-AI:

1. **No** abras un issue público.
2. Notifícala en privado por una de estas vías:
   - Correo: **security@dcp-ai.org**
   - Notificación privada de vulnerabilidades de GitHub: [security/advisories/new](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new)
3. Incluye una descripción de la vulnerabilidad, los pasos para reproducirla, el componente afectado (el protocolo, un SDK concreto, un servicio o el contrato inteligente) y una evaluación del impacto posible.
4. Los mantenedores acusan recibo en 48 horas y comparten un plazo estimado para la corrección.
5. Se publica un aviso de seguridad cuando la corrección está disponible.

Para todos los detalles, véase [SECURITY.md](SECURITY.md), incluidos el alcance, el SLA y el tratamiento de la gravedad. Las recompensas económicas se deciden caso por caso, no como un nivel de recompensa fijo.

> **Nota (25/10/2026): los documentos no coinciden.** [SECURITY.md](SECURITY.md) enumera rangos de recompensa fijos por gravedad, mientras que este documento y [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) dicen que las recompensas se deciden caso por caso. Se conservan ambos textos hasta que un mantenedor confirme cuál se aplica.

<a id="amendments"></a>

## Modificaciones

Este documento de gobernanza puede modificarse por consenso entre los mantenedores, siguiendo el proceso de decisión habitual con un periodo mínimo de debate de 14 días.
