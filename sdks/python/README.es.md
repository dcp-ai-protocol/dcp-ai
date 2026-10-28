<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--python-sdk"></a>
<a id="dcp-ai-python-sdk"></a>

# dcp-ai — SDK de Python

> Traducción informativa de [la versión en inglés](README.md), actualizada el 26/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

SDK oficial de Python para el Digital Citizenship Protocol (DCP v2.0). Modelos de Pydantic v2, firmas híbridas poscuánticas (Ed25519 + ML-DSA-65, además de SLH-DSA-192f), la primitiva KEM ML-KEM-768, firmas compuestas con vinculación `pq_over_classical`, firma y verificación de bundles V1 y V2, observabilidad con OpenTelemetry, el comportamiento de DCP-04 a DCP-09 y una CLI completa.

<a id="installation"></a>

## Instalación

**SDK Python.** Desde la 2.10.0, este SDK incluye las correcciones del verificador V2, confianza en el principal y `strict-v1`, cadenas de delegación, ventana de recepción A2A, trabajadores de revocación acotados y las API experimentales opt-in de `dcp-jcs-v2`. También incluye los adaptadores FastAPI, LangChain, OpenAI y CrewAI corregidos. `dcp-jcs-v1` sigue siendo el predeterminado normativo. Instala con:

**SDK Python 2.10.1.** Esta versión también verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary`, cada `prev_hash_secondary` y cada `intent_hash_secondary`. Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa; un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza. No cambian las API, los campos de resultado, `dcp-jcs-v1` ni el tratamiento de `hash_alg`. La versión 2.10.0 no comprueba estos campos. Los comandos de instalación siguientes indican esta versión; para su disponibilidad en el registro, véase [Versiones publicadas](../../docs/README.md#published-versions).

```bash
pip install "dcp-ai>=2.10.1,<3"
```

**Actualización desde 2.9.0.** FastAPI ahora verifica las firmas V2 en lugar de aceptar solo la estructura. La aceptación V1 en FastAPI y los adaptadores LangChain/OpenAI sigue la política del verificador. V2 también rechaza codificaciones no canónicas de firmas y evidencia inconsistente o vinculada incorrectamente que versiones anteriores aceptaban. Conserva la evidencia histórica y la versión que la verificó; no la vuelvas a firmar silenciosamente. La confianza, los presupuestos de recursos y la gestión de desconexiones siguen siendo decisiones explícitas del operador. Verificar o admitir no autoriza una acción.

En Python 3.10, cancelar una descarga de lista de denegación con cupo también propaga la cancelación si el resultado acaba de llegar. El cupo se libera únicamente cuando el hilo de descarga termina realmente.

Para desarrollar desde el código fuente, puedes usar un checkout editable:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "dcp-ai/sdks/python"
```

<a id="optional-extras"></a>

### Extras opcionales

Desde el registro (2.10.1 o posterior); desde una copia del repositorio se aplican los mismos extras: `pip install -e "dcp-ai/sdks/python[fastapi]"`.

```bash
pip install "dcp-ai[fastapi]>=2.10.1,<3"    # FastAPI middleware
pip install "dcp-ai[langchain]>=2.10.1,<3"  # LangChain integration
pip install "dcp-ai[openai]>=2.10.1,<3"     # OpenAI wrapper
pip install "dcp-ai[crewai]>=2.10.1,<3"     # CrewAI multi-agent
pip install "dcp-ai[otlp]>=2.10.1,<3"       # OpenTelemetry OTLP exporter
```

<a id="features"></a>

## Funciones

| Área | Estado |
|---|---|
| Proveedores Ed25519 / ML-DSA-65 (FIPS 204) | Sí |
| Proveedor SLH-DSA-192f | Sí, FIPS 205 (puro, contexto vacío), interoperable con los demás SDK |
| ML-KEM-768 | Primitiva KEM: sí (`MlKem768Provider`, FIPS 203). Intercambio de claves híbrido X25519 + ML-KEM-768 de DCP-04: todavía no |
| Firmas compuestas (`pq_over_classical`) + verificación | Sí |
| JSON canónico v2 + separación de dominio | Sí |
| Doble hash (SHA-256 + SHA3-256) + raíces de Merkle | Sí |
| Firma + verificación de bundles | V1: sí. V2 (`SignedBundleV2`): sí, `BundleBuilderV2` / `sign_bundle_v2` / `verify_signed_bundle_v2` |
| Descubrimiento A2A de DCP-04 + handshake + sesión AES-256-GCM (mediante `cryptography`); cada mensaje se acepta una sola vez dentro de la ventana (§8.4) | Sí |
| Ciclo de vida del agente de DCP-05 (puesta en servicio / vitalidad / retirada) | Sí |
| Sucesión digital de DCP-06 (testamento, transferencia de memoria, ceremonia) | Sí |
| Resolución de disputas de DCP-07 + arbitraje + jurisprudencia | Sí |
| Derechos de DCP-08 + obligaciones + cumplimiento | Sí |
| Delegación de DCP-09 + cadenas de delegación verificables (`create_sub_mandate`, `verify_mandate_chain`, §3.5) + umbral de atención + espejo del principal | Sí |
| Utilidades de nonce de sesión, motor de niveles de seguridad (`compute_security_tier(intent, policy_decision, mandate_chain_tier)`, spec §14.2), revocación de emergencia | Sí |
| Checkpoints PQ diferidos + `PQCheckpointManager` | Sí |
| RPR cegado, autorización multiparte, utilidades de avisos sobre algoritmos | Sí |
| Códigos de error canónicos (38 compartidos por todos los SDK) + `detect_wire_format` | Sí |
| Exportador OpenTelemetry / OTLP (extra opcional `[otlp]`) | Sí |
| Admisión: principales de confianza y el perfil `strict-v1` | Sí (2.10.0) |
| Candidato de canonicalización `dcp-jcs-v2` (entrada, enrutador, verificador de bytes, productores) | Experimental y opt-in; no normativo |

<a id="quickstart"></a>

## Inicio rápido

Un bundle V1 firmado con Ed25519. El RPR se firma con la clave del principal y el pasaporte con la del agente,
cada uno sobre el JSON canónico del objeto sin su campo `signature`; `create_audit_entry` calcula
`intent_hash` y la cadena `prev_hash`. `verify_signed_bundle` comprueba la firma del bundle, sus hashes y la
cadena, no estas firmas internas: compruébalas tú, como se muestra abajo. Para bundles V2, véase [Bundles V2](#v2-bundles).

```python
from datetime import datetime, timezone

from dcp_ai import (
    AgentPassport,
    AuditEvidence,
    BundleBuilder,
    Intent,
    PolicyDecision,
    ResponsiblePrincipalRecord,
    generate_keypair,
    sign_bundle,
    sign_object,
    verify_object,
    verify_signed_bundle,
)

now = datetime.now(timezone.utc).isoformat()
principal_keys = generate_keypair()
agent_keys = generate_keypair()

# 1. The responsible principal, signed with the principal's key (the object without "signature")
rpr_body = {
    "dcp_version": "1.0", "human_id": "human:example-001", "legal_name": "Example Principal",
    "entity_type": "natural_person", "jurisdiction": "ES", "liability_mode": "owner_responsible",
    "override_rights": True, "issued_at": now, "expires_at": None, "contact": None,
}
rpr = {**rpr_body, "signature": sign_object(rpr_body, principal_keys["secret_key_b64"])}

# 2. The agent passport, signed with the agent's key (the object without "signature")
passport_body = {
    "dcp_version": "1.0", "agent_id": "agent:example-001", "public_key": agent_keys["public_key_b64"],
    "principal_binding_reference": "human:example-001", "capabilities": ["browse", "api_call"],
    "risk_tier": "low", "created_at": now, "status": "active",
}
passport = {**passport_body, "signature": sign_object(passport_body, agent_keys["secret_key_b64"])}

# 3. Intent, policy decision and one audit entry
intent = Intent(
    intent_id="intent:example-001", agent_id="agent:example-001", human_id="human:example-001",
    timestamp=now, action_type="api_call", target={"channel": "api", "domain": "api.example.com"},
    data_classes=["none"], estimated_impact="low", requires_consent=False,
)
policy = PolicyDecision(
    intent_id="intent:example-001", decision="approve", risk_score=0.05, reasons=["low-impact call"],
)
bundle = (
    BundleBuilder()
    .responsible_principal_record(ResponsiblePrincipalRecord(**rpr))
    .agent_passport(AgentPassport(**passport))
    .intent(intent)
    .policy_decision(policy)
    .create_audit_entry(
        audit_id="audit:example-001", timestamp=now, agent_id="agent:example-001",
        human_id="human:example-001", intent_id="intent:example-001", policy_decision="approved",
        outcome="call_completed", evidence=AuditEvidence(tool="http", result_ref=None),
    )
    .build()
)

# 4. Sign with the principal's key and verify against the principal's public key
signed = sign_bundle(bundle, principal_keys["secret_key_b64"])
print(verify_signed_bundle(signed, principal_keys["public_key_b64"]))  # {'verified': True}

# 5. The inner signatures, over the same objects without "signature"
print(verify_object(rpr_body, rpr["signature"], principal_keys["public_key_b64"]))  # True
print(verify_object(passport_body, passport["signature"], agent_keys["public_key_b64"]))  # True
```

## CLI

El SDK incluye una CLI construida con Typer. Está disponible como `dcp` tras la instalación.

```bash
# Version
dcp version

# Generate Ed25519 keypair
dcp keygen [out_dir]

# Validate an object against a DCP schema
dcp validate <schema_name> <json_path>

# Validate a complete Citizenship Bundle
dcp validate-bundle <bundle_path>

# Verify a Signed Bundle
dcp verify <signed_path> [public_key_path]

# Compute bundle hash (SHA-256)
dcp bundle-hash <bundle_path>

# Compute Merkle root of audit entries
dcp merkle-root <bundle_path>

# Compute intent_hash
dcp intent-hash-cmd <intent_path>
```

<a id="api-reference"></a>

## Referencia de la API

<a id="crypto"></a>

### Criptografía

| Función | Firma | Descripción |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> dict[str, str]` | Devuelve `{"public_key_b64": ..., "secret_key_b64": ...}` |
| `sign_object(obj, secret_key_b64)` | `(Any, str) -> str` | Firma y devuelve base64 |
| `verify_object(obj, signature_b64, public_key_b64)` | `(Any, str, str) -> bool` | Verifica la firma |
| `canonicalize(obj)` | `(Any) -> str` | JSON determinista |
| `public_key_from_secret(secret_key_b64)` | `(str) -> str` | Deriva la clave pública |

<a id="merkle--hashing"></a>
<a id="merkle-hashing"></a>

### Merkle y hashes

| Función | Firma | Descripción |
|----------|-----------|-------------|
| `hash_object(obj)` | `(Any) -> str` | SHA-256 del JSON canonicalizado |
| `merkle_root_from_hex_leaves(leaves)` | `(list[str]) -> str \| None` | Raíz de Merkle |
| `merkle_root_for_audit_entries(entries)` | `(list[Any]) -> str \| None` | Raíz de Merkle de las entradas de auditoría |
| `intent_hash(intent)` | `(Any) -> str` | Hash de la intención |
| `prev_hash_for_entry(prev_entry)` | `(Any) -> str` | Hash de la entrada anterior |

<a id="schema-validation"></a>

### Validación de esquemas

| Función | Firma | Descripción |
|----------|-----------|-------------|
| `validate_schema(schema_name, data)` | `(str, Any) -> dict` | Devuelve `{"valid": bool, "errors": [...]}` |
| `validate_bundle(bundle)` | `(dict) -> dict` | Valida un bundle completo |

<a id="bundle-builder"></a>

### Constructor de bundles

```python
# Fragment: rpr, passport, intent, policy and entry are the models built in the Quickstart.
bundle = (
    BundleBuilder()
    .responsible_principal_record(rpr)
    .agent_passport(passport)
    .intent(intent)
    .policy_decision(policy)
    .add_audit_entry(entry)       # Manual
    .create_audit_entry(...)      # Auto-computes hashes
    .build()                      # => CitizenshipBundle
)
```

<a id="bundle-signing"></a>

### Firma de bundles

```python
# Signature (not runnable)
sign_bundle(
    bundle: CitizenshipBundle,
    secret_key_b64: str,
    signer_type: str = "human",
    signer_id: str | None = None,
) -> dict[str, Any]
```

<a id="bundle-verification"></a>

### Verificación de bundles

```python
# Signature (not runnable)
verify_signed_bundle(
    signed_bundle: dict[str, Any],
    public_key_b64: str | None = None,
) -> dict[str, Any]  # {"verified": bool, "errors": [...]}
```

Verifica: esquema, firma Ed25519, `bundle_hash`, `merkle_root`, cadena `intent_hash` y cadena `prev_hash`.

<a id="v2-bundles"></a>

### Bundles V2

`BundleBuilderV2`, `sign_bundle_v2` y `verify_signed_bundle_v2` (en `dcp_ai.v2`) portan `builder-v2.ts`, `signer-v2.ts` y `verify-v2.ts` del SDK de TypeScript. Los artefactos son diccionarios `SignedPayload` (`{"payload", "payload_hash", "composite_sig"}`); la firma del bundle es una firma compuesta sobre el manifiesto.

```python
# Fragment, inside an async function: session_nonce, the signed artifacts (signed_rpr, signed_passport, signed_intent, signed_policy), audit_events, classical_key and pq_key come from your application.
from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, BundleBuilderV2, sign_bundle_v2, verify_signed_bundle_v2

registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())

bundle = (
    BundleBuilderV2(session_nonce)
    .responsible_principal_record(signed_rpr)
    .agent_passport(signed_passport)
    .intent(signed_intent)
    .policy_decision(signed_policy)
    .add_audit_entries(audit_events)
    .build()
)
signed = await sign_bundle_v2(bundle, registry, "human", "human-001", classical_key, pq_key)
result = await verify_signed_bundle_v2(signed, registry)  # DEFAULT_VERIFIER_POLICY
# {"verified": bool, "errors": [...], "warnings": [...], "details": {...}}
```

El verificador también comprueba la firma compuesta propia de cada artefacto (el RPR con las `binding_keys` del principal y el resto con las claves del pasaporte) y, en todos los modos de política, rechaza una firma PQ presente pero no válida. El modo es el más estricto entre el modo de la política y el del nivel de seguridad (spec §14.3), y `details["resolved_tier"]` informa del nivel.

<a id="admission-trusted-principals-and-strict-v1"></a>
<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admisión: Trusted Principals y strict-v1

Un bundle verificado está firmado por las claves que enumera; no prueba quién es el principal. La admisión acepta un bundle solo cuando sus firmas de principal se hicieron con claves de un principal que figura en tu conjunto de confianza y, opcionalmente, bajo el perfil `strict-v1` fijado por el operador (firmas híbridas, audiencia firmada, una sesión de 300 s como máximo, una instantánea de revocación reciente).

```python
# Fragment, inside an async function: trust_set comes from operator configuration, signed_bundle from the request, snapshot from your revocation source, registry as in V2 Bundles.
from dcp_ai.v2 import admit_signed_bundle_v2, create_principal_trust_store, resolve_strict_v1_profile

trust = create_principal_trust_store(trust_set)  # AdmissionConfigError on a bad trust set
profile = resolve_strict_v1_profile({"profile": "strict-v1", "verifier_id": "api.acme.example"})
result = await admit_signed_bundle_v2(signed_bundle, registry, profile=profile, trust=trust, revocation=snapshot)
# result["verified"], result["principal_trust"], result["profile_compliance"], result["admitted"],
# result["action_authorized"] (always False), result["errors"] [{"code", "message"}]
```

- `verify_signed_bundle_v2(bundle, registry, policy, now_ms=...)` acepta un reloj opcional e informa de `details["signer_keys"]`; sin ellos se comporta como antes.
- `evaluate_admission_v2` evalúa un resultado de verificación que ya tienes (sin criptografía ni E/S) y confía en él; `revocation_subjects` enumera aquello por lo que debe responder una fuente de revocación, y `deny_list_revocation_source(url)` lee la lista de denegación del servicio de revocación de referencia; con `workers=DenyListWorkers(max_workers=...)` sus hilos de descarga se cuentan y se limitan hasta que terminan de verdad (opt-in; véase el README de FastAPI).
- FastAPI: `DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=...)`; véase [`integrations/fastapi/README.md`](../../integrations/fastapi/README.md). Guía: [`docs/ADMISSION.md`](../../docs/ADMISSION.md). Especificación y códigos: [`spec/profiles/admission`](../../spec/profiles/admission/README.md).

<a id="delegation-chains-dcp-09-35"></a>
<a id="delegation-chains-dcp-09-35-unreleased"></a>

### Cadenas de delegación (DCP-09 §3.5)

La persona firma un mandato raíz (`create_delegation_mandate`); el agente que lo tiene puede emitir un
submandato a otro agente (`create_sub_mandate`), firmado con sus propias claves. `verify_mandate_chain` comprueba
la cadena empezando por la raíz y sin conexión: firmas hasta la persona, enlaces con el padre y profundidad, `sub_delegation`,
ventanas de validez anidadas, atenuación (acciones, `data_classes` y `limits` solo se restringen), el nivel de seguridad
mínimo y la revocación.

```python
# Fragment, inside an async function: registry as in V2 Bundles; orchestrator_classical, orchestrator_pq, root_mandate, nonce and the key entries come from your delegation setup; intent and policy_decision are V2 payloads.
from dcp_ai.v2 import create_sub_mandate, verify_mandate_chain, compute_security_tier

sub = await create_sub_mandate(
    registry, orchestrator_classical, orchestrator_pq, root_mandate,
    mandate_id="mandate:sub-1", session_nonce=nonce, agent_id="agent:subagent",
    authority_scope=[{"domain": "email", "actions_permitted": ["read"], "data_classes": ["contact_info"]}],
    valid_from="2026-03-01T00:00:00Z", valid_until="2026-06-01T00:00:00Z", revocable=True,
)
result = await verify_mandate_chain(
    registry, [root_mandate, sub], set(),
    {"human_keys": human_key_entries, "agent_keys": {"agent:orchestrator": orchestrator_key_entries}},
)
# {"valid", "errors", "depth", "effective_tier"}; the tier floor can only raise an action's tier.
tier = compute_security_tier(intent, policy_decision, result["effective_tier"] if result["valid"] else None)
```

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: candidato de canonicalización `dcp-jcs-v2` (opt-in)

No es normativo ni está activo: `dcp-jcs-v1` sigue siendo el único perfil de canonicalización, y no cambia ningún valor por defecto, constructor,
firmante ni verificador. `dcp_ai.v2` no reexporta los módulos; existen para quien los importe,
también en Python 2.10.0. Un bundle candidato verificado no otorga confianza ni admisión.
Diseño y contrato: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
(§15 entrada, §16 enrutador, §17 verificador, §18 productores).

| Módulo | API |
|---|---|
| `dcp_ai.v2.experimental_candidate_ingress` | `experimental_candidate_ingress(data)`: `CandidateIngressAccept(value, canonical, canonical_sha256)` o `CandidateIngressReject(reject_class, offset)` |
| `dcp_ai.v2.experimental_candidate_router` | `create_router(transport=..., accepted_profiles=..., historical=...)`; decodificadores `JSON_LOADS_BYTES` y `JSON_LOADS_STRICT_DECODE`, ninguno predeterminado |
| `dcp_ai.v2.experimental_candidate_verify` | `create_verifier(...)` y después `await verifier.verify(data, registry, policy=None, now_ms=None)`: la ruta, el verificador al que se entró y su resultado |
| `dcp_ai.v2.experimental_candidate_produce` | `sign_payload(registry, context, input, keys)` y `sign_bundle(registry, parts, signer, options)`, que comprueban y copian en el momento de la llamada y devuelven un awaitable; `ExperimentalCandidateProduceError` para un rechazo por el dominio o la forma de las entradas, lanzado antes de llamar a cualquier firmante |

```python
import asyncio

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import AlgorithmRegistry, DCP_CONTEXTS
from dcp_ai.v2.experimental_candidate_ingress import experimental_candidate_ingress
from dcp_ai.v2.experimental_candidate_produce import sign_payload

# The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
print(experimental_candidate_ingress(b'{"b":1.0,"a":[]}').canonical)  # b'{"a":[],"b":1}'
refused = experimental_candidate_ingress(b'{"a":1,"a":2}')
print(refused.reject_class, refused.offset)  # DUPLICATE_KEY 7


async def main():
    registry = AlgorithmRegistry()
    keys = {}
    for name, provider in (("classical", Ed25519Provider()), ("pq", MlDsa65Provider())):
        registry.register_signer(provider)
        kp = await provider.generate_keypair()
        keys[name] = {"kid": kp["kid"], "alg": provider.alg, "secret_key_b64": kp["secret_key_b64"], "public_key_b64": kp["public_key_b64"]}
    artifact = await sign_payload(registry, DCP_CONTEXTS["Intent"], {"bytes": b'{"intent_id":"intent:1","risk":1.0}'}, keys)
    print(artifact.signed_payload["payload_hash"])  # sha256:... of {"intent_id":"intent:1","risk":1}


asyncio.run(main())
```

<a id="pydantic-models"></a>

### Modelos de Pydantic

Todos los artefactos de DCP v1 están disponibles como modelos de Pydantic v2 con validación automática:

`ResponsiblePrincipalRecord`, `AgentPassport`, `Intent`, `IntentTarget`, `PolicyDecision`, `AuditEntry`, `AuditEvidence`, `CitizenshipBundle`, `SignedBundle`, `BundleSignature`, `SignerInfo`, `RevocationRecord`, `HumanConfirmation`

**Modelos V2** (`dcp_ai.v2.models`), con los campos de los esquemas V2. Los valores enumerados (estados del ciclo de vida,
modos de terminación, estado de las disputas y similares) son campos `Literal` de estos modelos, no clases separadas:

- Núcleo V2: `ResponsiblePrincipalRecordV2`, `BlindedResponsiblePrincipalRecordV2`, `AgentPassportV2`, `KeyEntryV2`, `IntentV2`, `PolicyDecisionV2`, `AuditEventV2`, `PQCheckpoint`, `BundleManifest`, `VerifierPolicy`, `DcpCapabilities`
- DCP-05 — Ciclo de vida: `CommissioningCertificate`, `VitalityMetrics`, `VitalityReport`, `DecommissioningRecord`
- DCP-06 — Sucesión: `DigitalTestament`, `SuccessorPreference`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `DualHashRef`
- DCP-07 — Disputas: `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`
- DCP-08 — Derechos: `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`
- DCP-09 — Delegación: `DelegationMandate`, `SubMandate`, `SubDelegationPolicy`, `AuthorityScopeEntry`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`

```python
# Example: DCP-05 commissioning, signed with a composite (Ed25519 + ML-DSA-65) signature
import asyncio

from dcp_ai.providers import Ed25519Provider, MlDsa65Provider
from dcp_ai.v2 import (
    AlgorithmRegistry, CompositeKeyInfo, create_commissioning_certificate, generate_session_nonce,
    validate_state_transition,
)
from dcp_ai.v2.models import CommissioningCertificate


async def main():
    registry = AlgorithmRegistry()
    keys = []
    for provider in (Ed25519Provider(), MlDsa65Provider()):
        registry.register_signer(provider)
        kp = await provider.generate_keypair()
        keys.append(CompositeKeyInfo(kp["kid"], provider.alg, kp["secret_key_b64"], kp["public_key_b64"]))

    cert = await create_commissioning_certificate(
        registry, *keys,
        agent_id="agent:example-001", session_nonce=generate_session_nonce(), human_id="human:example-001",
        commissioning_authority="human:example-001", purpose="Customer support triage",
        initial_capabilities=["browse", "api_call"], risk_tier="low",
        principal_binding_reference="human:example-001",
    )
    CommissioningCertificate(**cert)  # validates the fields
    print(validate_state_transition("commissioned", "active"))  # True


asyncio.run(main())
```

<a id="domain-separation-v2"></a>

### Separación de dominio (V2)

**Contextos de separación de dominio de V2:** `Bundle`, `Intent`, `Passport`, `Revocation`, `Governance`, `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`

<a id="development"></a>

## Desarrollo

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest -v

# Async tests
pytest -v --asyncio-mode=auto
```

<a id="dependencies"></a>

### Dependencias

- `pynacl` — Criptografía Ed25519
- `jsonschema` — Validación de JSON Schema
- `pydantic` v2 — Modelos de datos
- `typer` — Framework de CLI
- `pqcrypto` ≥ 1.0 — ML-DSA-65, SLH-DSA-192f, ML-KEM-768 (FIPS 204/205/203)
- `cryptography` — AES-256-GCM para las sesiones A2A de DCP-04

<a id="license"></a>

## Licencia

Apache-2.0
