<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

# Specs — DCP-AI normativo

Especificaciones normativas para el Digital Citizenship Protocol for AI Agents. La fuente de verdad para los formatos es JSON Schema en `schemas/v1/` y `schemas/v2/`; estos documentos definen el alcance, los artefactos y cómo validarlos.

## Especificaciones Fundamentales (DCP-01 – DCP-03)

| Spec | Alcance | Artefactos |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | Identidad y Vinculación al Principal | Responsible Principal Record, Agent Passport, Revocation Record |
| [DCP-02](DCP-02.md) | Declaración de Intención y Control de Política | Intent, PolicyDecision, HumanConfirmation (opcional) |
| [DCP-03](DCP-03.md) | Cadena de Auditoría y Transparencia | AuditEntry, encadenamiento por `prev_hash`, Merkle opcional |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle y Signed Bundle | Citizenship Bundle (L3), Signed Bundle (firma Ed25519, `bundle_hash`, `merkle_root`) |
| [VERIFICATION](VERIFICATION.md) | Checklist de verificación | Pasos normativos para verificar un Signed Bundle (schema, firma, expiración, revocación, `intent_hash`, cadena de auditoría, merkle; todo local) |

**Validación:** `dcp validate <schema> <json>`, `dcp validate-bundle <bundle.json>`, `dcp verify-bundle <signed.json> <public_key.txt>`, `dcp intent-hash <intent.json>`.
**Conformidad:** `npm run conformance` valida L3-OBJECTS + L3-BUNDLE + L3-SIGNED + cadena de `intent_hash` y `prev_hash`.

---

## Comunicación y Criptografía (DCP-04, v2.0)

| Documento | Alcance |
|----------|-------|
| [DCP-04](DCP-04.md) | Comunicación Entre Agentes |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | Especificación Normativa Post-Cuántica |
| [Security Audit](AUDIT-v2.0-FINAL.md) | Auditoría de Seguridad Final de v2.0 (13 gaps cerrados) |

---

## Marco Constitucional (DCP-05 – DCP-09)

Especificaciones que rigen el ciclo de vida del agente, la sucesión, la resolución de disputas, los derechos y la delegación — la capa constitucional del protocolo.

| Spec | Alcance | Artefactos Clave |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | Gestión del Ciclo de Vida del Agente | CommissioningCertificate, VitalityReport, DecommissioningRecord |
| [DCP-06](DCP-06.md) | Sucesión Digital y Herencia | DigitalTestament, SuccessionRecord, MemoryTransferManifest |
| [DCP-07](DCP-07.md) | Resolución de Conflictos y Arbitraje de Disputas | DisputeRecord, ArbitrationResolution, JurisprudenceBundle, ObjectionRecord |
| [DCP-08](DCP-08.md) | Marco de Derechos y Obligaciones | RightsDeclaration, ObligationRecord, RightsViolationReport |
| [DCP-09](DCP-09.md) | Representación Personal y Delegación | DelegationMandate, AdvisoryDeclaration, PrincipalMirror, AwarenessThreshold |

**Schemas:** 18 JSON Schemas en `schemas/v2/` cubriendo todos los artefactos DCP-05–09.
**Endpoints del servidor:** 31 endpoints REST en el servidor de verificación (consulta [OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md)).
**Separación de dominio:** 6 nuevos contextos — `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`.

---

## Core y Perfiles

La especificación está organizándose en un **Core** (protocolo mínimo interoperable) y **Perfiles** (extensiones para necesidades específicas de despliegue):

| Directorio | Alcance |
|-----------|-------|
| [core/](core/) | DCP Core — artefactos, modelo de verificación, estructura del bundle |
| [profiles/](profiles/) | Perfiles — extensiones crypto, A2A, governance |
| [profiles/crypto/](profiles/crypto/) | Selección de algoritmos, firmas compuestas, cripto-agilidad |
| [profiles/a2a/](profiles/a2a/) | Descubrimiento de agentes, handshake, gestión de sesiones |
| [profiles/governance/](profiles/governance/) | Niveles de riesgo, jurisdicción, revocación, recuperación de claves |

Las specs existentes (DCP-01 a DCP-09, BUNDLE, VERIFICATION, DCP-AI v2.0) siguen siendo autoritativas. Los documentos de core y perfiles proporcionan contexto editorial y clarifican la separación de responsabilidades. Consulta el [ROADMAP](../ROADMAP.md) para la evolución planeada.
