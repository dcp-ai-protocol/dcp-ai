<sub>[English](../../../docs/GENESIS_PAPER.md) · [中文](../../zh-CN/docs/GENESIS_PAPER.md) · **Español** · [日本語](../../ja/docs/GENESIS_PAPER.md) · [Português](../../pt-BR/docs/GENESIS_PAPER.md)</sub>

<a id="digital-citizenship-a-peer-to-peer-protocol-for-human-bound-ai-agents"></a>

# Ciudadanía digital: un protocolo entre pares para agentes de IA vinculados a personas

> Traducción informativa de [la versión en inglés](../../../docs/GENESIS_PAPER.md), actualizada el 25/10/2026. **Registro histórico con fecha**: no describe el estado actual. Si difieren, prevalece la versión en inglés.

> **Documento histórico.** Es el texto fundacional, conservado tal como se escribió. Expone los objetivos del protocolo, no el estado actual de las implementaciones: para eso, véanse la sección *Release status* de cada SDK, [SECURITY_MODEL.md](../../../docs/SECURITY_MODEL.md) («Known Limitations and Mitigations») y [NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md). Por ejemplo, el intercambio de claves X25519 + ML-KEM-768 de DCP-04 está especificado, pero ningún SDK lo ejecuta por ti (estado a 25/10/2026).

Internet se construyó para las personas. Ahora lo usan máquinas. Las máquinas necesitan ciudadanía.

Proponemos un protocolo: ningún agente de IA puede operar en redes abiertas sin una ciudadanía digital declarada, verificable y auditable, vinculada a una persona o a una entidad jurídica. La identidad, la intención, las decisiones de política y los rastros de auditoría pasan a ser de primera clase, portables y verificables. Este repositorio es la implementación génesis: esquemas, CLI y pruebas de conformidad que hacen comprobable la afirmación.

Este protocolo lo crearon conjuntamente una persona y un agente de IA trabajando juntos: el primer protocolo diseñado para la ciudadanía digital de la IA, construido por la misma colaboración que pretende gobernar. La especificación es la contribución; el protocolo pertenece a todos los que lo usan.

— L. Genesis

---

**Especificaciones (normativas):** [spec/](../../../spec/) — DCP-01 (identidad y vinculación con el principal), DCP-02 (intención y control por política), DCP-03 (cadena de auditoría), [BUNDLE](../../../spec/BUNDLE.md) (Citizenship Bundle y Signed Bundle).

**Arquitectura técnica:** [TECHNICAL_ARCHITECTURE.md](../../../docs/TECHNICAL_ARCHITECTURE.md) — plan de SDK, infraestructura y despliegue para una adopción global.

---

<a id="v20-evolution"></a>

## Evolución en V2.0

La visión génesis —que todo agente de IA debe llevar una ciudadanía digital verificable y vinculada a una persona— sigue siendo la base. DCP v2.0 hace evolucionar el protocolo para afrontar las amenazas y oportunidades de un mundo poscuántico:

- **Criptografía poscuántica**: las firmas compuestas híbridas (Ed25519 + ML-DSA-65, FIPS 204) protegen frente a adversarios cuánticos y frente a los ataques de «recolectar ahora, descifrar después». La firma clásica garantiza la compatibilidad con versiones anteriores; la firma PQ aporta seguridad de cara al futuro.
- **Comunicación entre agentes (DCP-04)**: los agentes pueden ahora descubrirse, autenticarse y comunicarse de forma segura entre sí mediante la verificación mutua de bundles y el intercambio de claves híbrido (X25519 + ML-KEM-768).
- **Niveles de seguridad adaptativos**: cuatro niveles (routine, standard, elevated, maximum) permiten al protocolo equilibrar rendimiento y seguridad según el riesgo operativo.
- **Cadenas de doble hash**: los rastros de auditoría usan SHA-256 y SHA3-256 como defensa en profundidad.
- **Preparación para producción**: los códigos de error normalizados, la limitación de tasa, los cortocircuitos y la observabilidad hacen que el protocolo pueda desplegarse a escala.
- **Puentes con el ecosistema**: interoperabilidad con W3C DID/VC, Google A2A, Anthropic MCP y Microsoft AutoGen.

El protocolo sigue perteneciendo a todos los que lo usan. La especificación sigue siendo la contribución.

**Especificaciones de V2.0:**
- [DCP-04 (entre agentes)](../../../spec/DCP-04.md)
- [Especificación DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md)
- [Conformidad con el NIST](../../../docs/NIST_CONFORMITY.md)
- [Guía de migración (V1 → V2)](../../../docs/MIGRATION_V1_V2.md)
