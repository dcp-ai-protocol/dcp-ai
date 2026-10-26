<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="specs--dcp-ai-normative"></a>
<a id="specs-dcp-ai-normative"></a>

# Especificaciones — DCP-AI normativo

**Publicación Python (26/10/2026).** `dcp-ai` 2.10.0 ya está disponible en PyPI, incluidas las correcciones del verificador, la admisión y las API experimentales opt-in. Las publicaciones de Go y Rust siguen siendo independientes. Véase [Python 2.10.0](../docs/PYTHON_RELEASE.md).

> Traducción informativa de [la versión en inglés](README.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Especificaciones normativas del Digital Citizenship Protocol for AI Agents. La fuente de verdad de los formatos es el JSON Schema de `schemas/v1/` y `schemas/v2/`; estos documentos definen el alcance, los artefactos y cómo validarlos. [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) enumera las erratas que alinean los nombres, los contextos de firma y los ejemplos de DCP-05, DCP-08 y DCP-09 con ese formato, y las cuatro capas (representable, válido según el esquema, verificado, conforme) que se juzgan por separado.

<a id="foundation-specifications-dcp-01--dcp-03"></a>
<a id="foundation-specifications-dcp-01-dcp-03"></a>

## Especificaciones fundamentales (DCP-01 – DCP-03)

| Especificación | Alcance | Artefactos |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | Identidad y vinculación al principal | Responsible Principal Record, Agent Passport, Revocation Record |
| [DCP-02](DCP-02.md) | Declaración de intención y control por política | Intent, PolicyDecision, HumanConfirmation (opcional) |
| [DCP-03](DCP-03.md) | Cadena de auditoría y transparencia | AuditEntry, encadenamiento por prev_hash, Merkle opcional |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle y Signed Bundle | Citizenship Bundle (L3), Signed Bundle (firma Ed25519, bundle_hash, merkle_root) |
| [VERIFICATION](VERIFICATION.md) | Lista de verificación | Pasos normativos para verificar un Signed Bundle (esquema, firma, caducidad, revocación, intent_hash, cadena de auditoría, Merkle; todo local) |

**Validación** (`dcp` es la CLI de referencia de un checkout, `node bin/dcp.js`): `dcp validate <schema> <json>`, `dcp validate-bundle <bundle.json>`, `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`, `dcp intent-hash <intent.json>`.
**Conformidad:** `npm run conformance` valida L3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash y la cadena de prev_hash.

Estos comandos y DCP-01 a DCP-03 describen los artefactos V1; los artefactos y las comprobaciones V2 están en
[DCP-AI v2.0](DCP-AI-v2.0.md) y en la lista de verificación V2 de [VERIFICATION](VERIFICATION.md). Un bundle que se verifica es coherente
y está firmado por las claves que enumera; la confianza en su principal es un paso aparte ([docs/ADMISSION.md](../docs/ADMISSION.md)).

---

<a id="communication--cryptography-dcp-04-v20"></a>
<a id="communication-cryptography-dcp-04-v20"></a>

## Comunicación y criptografía (DCP-04, v2.0)

| Documento | Alcance |
|----------|-------|
| [DCP-04](DCP-04.md) | Comunicación entre agentes |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | Especificación normativa poscuántica |
| [Perfil de canonicalización](CANONICALIZATION_PROFILE.md) | `dcp-jcs-v1` — canonicalización JSON exacta byte a byte para cada firma, hash y hoja de Merkle |
| [Auditoría de seguridad](AUDIT-v2.0-FINAL.md) | Auditoría de seguridad final de v2.0 del 26/02/2026 (13 carencias cerradas); un registro histórico, con un aviso sobre lo que matizaron revisiones posteriores |

---

<a id="constitutional-framework-dcp-05--dcp-09"></a>
<a id="constitutional-framework-dcp-05-dcp-09"></a>

## Marco constitucional (DCP-05 – DCP-09)

Especificaciones que rigen el ciclo de vida del agente, la sucesión, la resolución de disputas, los derechos y la delegación: la capa constitucional del protocolo.

| Especificación | Alcance | Artefactos clave |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | Gestión del ciclo de vida del agente | CommissioningCertificate, VitalityReport, DecommissioningRecord |
| [DCP-06](DCP-06.md) | Sucesión y herencia digital | DigitalTestament, SuccessionRecord, MemoryTransferManifest |
| [DCP-07](DCP-07.md) | Resolución de conflictos y arbitraje de disputas | DisputeRecord, ArbitrationResolution, JurisprudenceBundle, ObjectionRecord |
| [DCP-08](DCP-08.md) | Marco de derechos y obligaciones | RightsDeclaration, ObligationRecord, RightsViolationReport |
| [DCP-09](DCP-09.md) | Representación personal y delegación | DelegationMandate, AdvisoryDeclaration, PrincipalMirror, AwarenessThreshold |

**Esquemas:** 18 JSON Schemas en `schemas/v2/` que cubren todos los artefactos de DCP-05–09.
**Endpoints del servidor:** 31 endpoints REST en el servidor de verificación de referencia, sin autenticación ni verificación de firmas (véase [OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).
**Separación de dominios:** 7 contextos nuevos — `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`, `SubMandate`.

---

<a id="core-and-profiles"></a>

## Núcleo y perfiles

La especificación se está organizando en un **núcleo** (protocolo mínimo interoperable) y **perfiles** (extensiones para necesidades concretas de despliegue):

| Directorio | Alcance |
|-----------|-------|
| [core/](core/) | Núcleo de DCP — artefactos, modelo de verificación, estructura del bundle |
| [profiles/](profiles/) | Perfiles — extensiones crypto, A2A y de gobernanza |
| [profiles/crypto/](profiles/crypto/) | Selección de algoritmos, firmas compuestas, agilidad criptográfica |
| [profiles/a2a/](profiles/a2a/) | Descubrimiento de agentes, handshake, gestión de sesiones |
| [profiles/governance/](profiles/governance/) | Niveles de riesgo, jurisdicción, revocación, recuperación de claves |
| [profiles/admission/](profiles/admission/) | Admisión: principales de confianza y el perfil strict-v1 (en los SDK de `main`; publicado en npm SDK 2.2.0, con publicaciones independientes en los demás ecosistemas) |

Las especificaciones existentes (de DCP-01 a DCP-09, BUNDLE, VERIFICATION, DCP-AI v2.0) siguen siendo la referencia. Los documentos del núcleo y de los perfiles aportan contexto editorial y aclaran la separación de responsabilidades. Véase el [ROADMAP](../ROADMAP.md) para la evolución prevista.
