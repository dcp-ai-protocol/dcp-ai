<sub>[English](../../../../sdks/rust/README.md) · [中文](../../../zh-CN/sdks/rust/README.md) · **Español** · [日本語](../../../ja/sdks/rust/README.md) · [Português](../../../pt-BR/sdks/rust/README.md)</sub>

<a id="dcp-ai-rust-sdk"></a>

# dcp-ai — SDK de Rust

**Publicación Rust (26/10/2026).** Rust `dcp-ai` 2.11.0 está publicado en crates.io, incluidas las correcciones del verificador, admisión y API experimentales opt-in. `dcp-jcs-v1` sigue siendo el perfil normativo predeterminado. Véase [Rust 2.11.0](../../../../docs/RUST_RELEASE.md).

> Traducción informativa del [README en inglés](../../../../sdks/rust/README.md), actualizada el 30/10/2026. Los identificadores y los bloques de código, incluidos sus comentarios, se conservan en el idioma original para mantener los ejemplos verificados.

SDK oficial de Rust para el Digital Citizenship Protocol (DCP v2.0). Ofrece tipos basados en Serde, criptografía poscuántica híbrida (Ed25519 + ML-DSA-65 + SLH-DSA-192f + ML-KEM-768), firmas compuestas con vinculación `pq_over_classical`, cadenas de hash duales, observabilidad con OpenTelemetry, comportamiento DCP-04..09 y soporte opcional para WebAssembly.

La verificación comprueba integridad y firmas; no establece confianza en el principal, admisión ni autorización para actuar. El verificador V2 comprueba la cadena de auditoría primaria y, desde la 2.11.1, los enlaces, hashes de intención y raíz Merkle secundarios SHA3-256 opcionales que estén presentes (los ausentes no se exigen); la versión 2.11.0 no comprueba los campos secundarios. Consulta [la limitación documentada del verificador](../../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains) y usa las API de admisión descritas más abajo cuando se requiera confianza.

<a id="installation"></a>

## Instalación

**SDK Rust.** Desde la 2.11.0, este SDK incluye construcción y firma de bundles V2, admisión con confianza explícita en el principal y `strict-v1`, cadenas de delegación, correcciones del verificador y API experimentales opt-in de `dcp-jcs-v2`. `dcp-jcs-v1` conserva el carácter normativo y predeterminado. La evidencia inválida aceptada por versiones anteriores puede ser rechazada ahora. El cifrado de sesiones A2A y su ventana de replay no están implementados en Rust; siguen disponibles las funciones de descubrimiento y handshake.

**SDK Rust 2.11.1.** Esta versión también verifica los campos secundarios SHA3-256 de [VERIFICATION.md V2-11](../../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) cuando están presentes: `audit_merkle_root_secondary`, cada `prev_hash_secondary` y cada `intent_hash_secondary`. Los campos ausentes no se exigen, así que un bundle verificado puede no tener una cadena secundaria completa; un campo presente que sea `null`, no sea una cadena o sea incoherente se rechaza. No cambian las API, los campos de resultado, `dcp-jcs-v1` ni el tratamiento de `hash_alg`. La versión 2.11.0 no comprueba estos campos. Los comandos de instalación siguientes indican esta versión; para su disponibilidad en el registro, véase [Versiones publicadas](../../../../docs/README.md#published-versions).

```toml
[dependencies]
dcp-ai = "2.11.1"
```

Con exportación OpenTelemetry/OTLP:

```toml
[dependencies]
dcp-ai = { version = "2.11.1", features = ["otlp"] }
```

Para soporte de WebAssembly:

```toml
[dependencies]
dcp-ai = { version = "2.11.1", features = ["wasm"] }
```

<a id="features"></a>

## Funciones

| Área | Estado |
|---|---|
| Proveedores Ed25519 / ML-DSA-65 / SLH-DSA-192f / ML-KEM-768 | Sí |
| Firmas compuestas (`pq_over_classical`) y verificación | Sí |
| JSON canónico v2 y separación de dominios | Sí |
| Hash dual (SHA-256 + SHA3-256) y raíces Merkle | Sí |
| Verificación de bundles (V1 + V2; V2 bajo una política del verificador y el nivel de seguridad, `verify_signed_bundle_v2_with_policy`) | Sí |
| Construcción y firma de bundles V2 (`dcp_ai::v2::bundle`: `build_bundle_v2`, `sign_bundle_v2`; `wasm_build_bundle` / `wasm_sign_bundle` de la función `wasm` las llaman; todavía sin checkpoints PQ) | Sí |
| Ciclo de vida de agentes DCP-05 (puesta en servicio / vitalidad / retirada de servicio) | Sí |
| Sucesión digital DCP-06 (testamento, transferencia de memoria, ceremonia) | Sí |
| Resolución de disputas, arbitraje y jurisprudencia DCP-07 | Sí |
| Derechos, obligaciones y cumplimiento DCP-08 | Sí |
| Delegación DCP-09 y cadenas de delegación verificables (`create_sub_mandate`, `verify_mandate_chain`, §3.5), umbral de consciencia y espejo del principal | Sí |
| Descubrimiento A2A DCP-04, handshake y derivación del identificador de sesión | Sí |
| Cifrado de sesión A2A DCP-04 con AES-256-GCM | _Pospuesto a una versión posterior_ |
| Funciones auxiliares del nonce de sesión, motor de niveles de seguridad (`compute_security_tier(&intent, Some(&policy_decision))`, especificación §14.2; `compute_security_tier_with_floor` añade el nivel de una cadena de delegación), revocación de emergencia | Sí |
| Checkpoints PQ diferidos y `PQCheckpointManager` | Sí |
| RPR cegado, autorización multipartita y funciones auxiliares de avisos sobre algoritmos | Sí |
| Códigos de error canónicos (38 compartidos entre todos los SDK) y `detect_wire_format` | Sí |
| Exportador OpenTelemetry / OTLP (función opcional `otlp`) | Sí |
| Admisión: principales de confianza y perfil `strict-v1` | Sí |
| Candidato de canonicalización `dcp-jcs-v2` (ingreso, router, verificador de bytes, productores) | Experimental y de activación explícita; no normativo |

<a id="quickstart"></a>

## Inicio rápido

```rust
use dcp_ai::crypto::{generate_keypair, sign_object, verify_object, hash_object};
use serde_json::json;

fn main() {
    // 1. Generate Ed25519 keypair
    let (public_key_b64, secret_key_b64) = generate_keypair();
    println!("Public Key: {}", public_key_b64);

    // 2. Sign an object
    let obj = json!({
        "agent_id": "agent-001",
        "action": "api_call"
    });
    let signature = sign_object(&obj, &secret_key_b64).unwrap();

    // 3. Verify signature
    let valid = verify_object(&obj, &signature, &public_key_b64).unwrap();
    println!("Verified: {}", valid); // true

    // 4. SHA-256 hash
    let hash = hash_object(&obj);
    println!("SHA-256: {}", hash);
}
```

<a id="verify-a-signed-bundle"></a>

### Verificar un bundle firmado

```rust
// Needs citizenship_bundle.signed.json in the working directory and the signer's public key in place of BASE64_PUBLIC_KEY.
use dcp_ai::verify::verify_signed_bundle;
use serde_json;
use std::fs;

fn main() {
    let data = fs::read_to_string("citizenship_bundle.signed.json").unwrap();
    let signed_bundle: serde_json::Value = serde_json::from_str(&data).unwrap();

    let result = verify_signed_bundle(&signed_bundle, Some("BASE64_PUBLIC_KEY"));
    println!("Verified: {}", result.verified);
    if let Some(errors) = &result.errors {
        println!("Errors: {:?}", errors);
    }
}
```

<a id="api-reference"></a>

## Referencia de API

<a id="crypto-dcp_aicrypto"></a>

### Criptografía (`dcp_ai::crypto`)

| Función | Firma | Descripción |
|----------|-----------|-------------|
| `generate_keypair()` | `() -> (String, String)` | Devuelve `(public_key_b64, secret_key_b64)` |
| `sign_object(obj, secret_key_b64)` | `(&Value, &str) -> Result<String, String>` | Firma y devuelve base64 |
| `verify_object(obj, sig_b64, pub_b64)` | `(&Value, &str, &str) -> Result<bool, String>` | Verifica la firma |
| `canonicalize(obj)` | `(&Value) -> String` | JSON determinista |
| `hash_object(obj)` | `(&Value) -> String` | SHA-256 hexadecimal |
| `merkle_root_from_hex_leaves(leaves)` | `(&[String]) -> Option<String>` | Raíz Merkle |

<a id="verification-dcp_aiverify"></a>

### Verificación (`dcp_ai::verify`)

```rust
// Signature (not runnable)
fn verify_signed_bundle(
    signed_bundle: &Value,
    public_key_b64: Option<&str>,
) -> VerificationResult
```

Verifica: firma Ed25519, `bundle_hash`, `merkle_root`, cadena de `intent_hash` y cadena de `prev_hash`.

<a id="types-dcp_aitypes"></a>

### Tipos (`dcp_ai::types`)

```rust
// Declarations, fields elided (not runnable)
pub struct ResponsiblePrincipalRecord { ... }
pub struct AgentPassport { ... }
pub struct Intent { ... }
pub struct IntentTarget { ... }
pub struct PolicyDecision { ... }
pub struct AuditEntry { ... }
pub struct AuditEvidence { ... }
pub struct CitizenshipBundle { ... }
pub struct SignedBundle { ... }
pub struct BundleSignature { ... }
pub struct Signer { ... }
pub struct VerificationResult {
    pub verified: bool,
    pub errors: Vec<String>,
}
```

Todas las estructuras implementan `Serialize` + `Deserialize` (serde).

<a id="v2-types-dcp_aiv2types"></a>

### Tipos V2 (`dcp_ai::v2::types`)

V2 incluye estructuras derivadas de Serde para todos los artefactos de DCP-05 a DCP-09:

| Especificación | Tipos |
|------|-------|
| DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `VitalityMetrics`, `DecommissioningRecord`, `TerminationMode`, `DataDisposition` |
| DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `SuccessorPreference`, `MemoryClassification`, `TransitionType`, `MemoryDisposition` |
| DCP-07 | `DisputeRecord`, `ArbitrationResolution`, `JurisprudenceBundle`, `ObjectionRecord`, `DisputeType`, `EscalationLevel`, `DisputeStatus`, `ObjectionType`, `AuthorityLevel` |
| DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AwarenessThreshold`, `ThresholdRule`, `AuthorityScopeEntry` |

Constantes de separación de dominios: `CTX_LIFECYCLE`, `CTX_SUCCESSION`, `CTX_DISPUTE`, `CTX_RIGHTS`, `CTX_DELEGATION`, `CTX_AWARENESS`

Todas las estructuras derivan `Debug`, `Clone`, `Serialize` y `Deserialize`. Las enumeraciones usan `#[serde(rename_all = "snake_case")]`. Los campos opcionales usan `Option<T>` con `#[serde(skip_serializing_if = "Option::is_none")]`.

**Entradas de auditoría recibidas (2.12.0 preparada, sin publicar).** `AuditEventV2` y `AuditEvidenceV2` sirven para producir entradas. Decodificar en ellos una entrada recibida y volver a codificarla pierde un `null` explícito (en `evidence`, `prev_hash_secondary` e `intent_hash_secondary`) y cualquier miembro desconocido, y convierte un `pq_checkpoint_ref` ausente en `null`. Eso cambia los bytes canónicos de la entrada y puede romper la cadena `prev_hash` o la raíz Merkle de auditoría. Para conservar una entrada recibida, usa `RawAuditEventV2`: guarda el `serde_json::Value` decodificado, así que cada miembro, a cualquier profundidad, conserva su presencia y su `null`, también los desconocidos, y serializa ese valor tal cual. Solo rechaza lo que no es un objeto JSON (`RawAuditEventError`). Conserva lo que decodificó `serde_json`, no el texto original, nunca repara ni vuelve a firmar, y conserva la evidencia inválida tal cual, para que un verificador la rechace por el mismo motivo. `typed()` es una vista con pérdidas para leer campos. Para conservar un bundle recibido, consérvalo tal como llegó y verifica eso.

<a id="bundles-dcp_aiv2bundle-unreleased"></a>

### Bundles (`dcp_ai::v2::bundle`)

| Función | Descripción |
|----------|-------------|
| `build_bundle_v2(&rpr, &passport, &intent, &policy, &audit_entries, session_nonce)` | Construye el bundle V2 a partir de los cuatro `SignedPayload` y la traza de auditoría. Comprueba cada `payload_hash` y el `session_nonce` de cada artefacto y entrada de auditoría, y escribe el manifiesto con ambas raíces Merkle de auditoría; una traza vacía recibe raíces de 64 ceros |
| `sign_bundle_v2(bundle, &classical, &pq)` | Firma el manifiesto con una firma compuesta bajo `CTX_BUNDLE` y devuelve `{bundle, signature}`, con `signer.id` igual al `human_id` de la RPR. Incluye `session_expires_at` o `intended_verifier` en el manifiesto antes de firmar; si existe `session_expires_at` y falta `session_issued_at`, establece `session_issued_at` en el momento de la firma |

<a id="delegation-chains-dcp_aiv2delegation-dcp-09-35-unreleased"></a>
<a id="delegation-chains-dcp_aiv2delegation-dcp-09-35"></a>

### Cadenas de delegación (`dcp_ai::v2::delegation`, DCP-09 §3.5)

| Función | Descripción |
|----------|-------------|
| `create_delegation_mandate_with_options(ed, pq, human_classical, human_pq, params, &MandateChainOptions)` | Mandato raíz firmado por la persona, con `sub_delegation` y `minimum_security_tier` opcionales |
| `create_sub_mandate(ed, pq, classical, pq_key, &parent, SubMandateParams { .. })` | Submandato firmado por el agente del mandato padre bajo el contexto `DCP-AI.v2.SubMandate` |
| `verify_mandate_chain(&chain, &revoked_ids, &MandateChainKeys { human_keys, agent_keys }, now_millis)` | Verifica la cadena sin conexión, empezando por la raíz (firmas hasta la persona, enlaces y profundidad, `sub_delegation`, vigencia anidada, restricción de acciones, `data_classes` y `limits`, nivel mínimo y revocación); devuelve `MandateChainResult { valid, errors, depth, effective_tier }` |

<a id="admission-dcp_aiv2-specprofilesadmission-unreleased"></a>
<a id="admission-dcp_aiv2-specprofilesadmission"></a>

### Admisión (`dcp_ai::v2`, spec/profiles/admission)

Determina si un bundle V2 verificado se admite como evidencia de un principal en el que el operador ya confía, opcionalmente bajo el perfil `strict-v1`. El conjunto de confianza, el perfil y la fuente de revocación proceden del operador, nunca del bundle ni de la petición.

| Función | Descripción |
|----------|-------------|
| `verify_signed_bundle_v2_at(&b, &policy, now_ms)` | `verify_signed_bundle_v2_with_policy` en `now_ms` (milisegundos desde la época Unix), que se usa en todas las comprobaciones temporales; las otras dos funciones de verificación usan el reloj del sistema. Devuelve `V2VerificationDetails`: el mismo `V2VerificationResult` en `result` y `signer_keys`, que enumera, para cada firma compuesta comprobada, la clave resuelta de cada componente y si se verificó. `V2VerificationResult` conserva su forma de diez campos y las otras dos funciones conservan sus firmas |
| `PrincipalTrustStore::from_json(&json)` | Carga un conjunto de confianza (`schemas/v2/principal_trust_set.schema.json`) |
| `resolve_strict_v1_profile(&json)` | Carga un perfil `strict-v1` (`schemas/v2/admission_profile.schema.json`); `policy()`, `verifier_id()`, `max_session_duration_seconds()` y `max_revocation_age_seconds()` son de solo lectura |
| `revocation_subjects(&b, &verification)` | El `agent_id` del pasaporte y los kid ordenados de las claves de firmantes verificadas, para la fuente de revocación del operador |
| `evaluate_admission_v2(&b, &verification, &AdmissionOptions { .. })` | Admisión a partir de un resultado de verificación, sin criptografía ni E/S |
| `admit_signed_bundle_v2(&b, &AdmitOptions { .. })` | Verifica en `now_ms` (reloj del sistema cuando es `None`) bajo la política del perfil, o bajo `policy` cuando no hay perfil, y después evalúa |

Un conjunto de confianza o perfil que no pueda cargarse, un perfil sin conjunto de confianza y un perfil con una política del llamador devuelven `AdmissionConfigError { code, message }`. `AdmissionResult` se serializa con las claves de §5.2 (`verified`, `verification`, `principal_trust`, `profile`, `profile_compliance`, `admitted`, `action_authorized`, `recorded_decision`, `trust_set_version`, `errors`); `action_authorized` siempre es `false`. La `verifier_policy` de un perfil puede restringir `accepted_classical_algs` y `accepted_pq_algs`, que el verificador aplica; fija `min_classical`, `min_pq`, `accepted_hash_algs` y `max_key_age_days` en sus valores predeterminados.

```rust
// Fragment, inside a function returning a Result: profile_json, trust_set_json, signed_bundle, now_ms and revocation_source come from your application.
use dcp_ai::v2::{
    evaluate_admission_v2, resolve_strict_v1_profile, revocation_subjects, verify_signed_bundle_v2_at,
    AdmissionOptions, PrincipalTrustStore,
};

let profile = resolve_strict_v1_profile(&profile_json)?;
let trust = PrincipalTrustStore::from_json(&trust_set_json)?;
let verification = verify_signed_bundle_v2_at(&signed_bundle, profile.policy(), now_ms);
// Ask the operator's revocation source about these; None when it cannot answer.
let snapshot: Option<serde_json::Value> = revocation_source(&revocation_subjects(&signed_bundle, &verification));
let result = evaluate_admission_v2(
    &signed_bundle,
    &verification,
    &AdmissionOptions { profile: Some(&profile), trust: Some(&trust), revocation: snapshot.as_ref(), now_ms },
)?;
if result.admitted {
    // Authentic evidence from a trusted principal; not an authorization to act.
}
```

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>
<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in"></a>

### Experimental: candidato de canonicalización `dcp-jcs-v2` (activación explícita)

No es normativo ni está activo: `dcp-jcs-v1` sigue siendo el único perfil de canonicalización y no cambia ningún valor predeterminado, constructor, firmante ni verificador. Estos módulos están disponibles en 2.11.0 únicamente mediante activación explícita. Un bundle candidato verificado no otorga confianza ni admisión. Diseño y contrato: [`docs/proposals/canonicalization-candidate`](../../../../docs/proposals/canonicalization-candidate/README.md) (§15 ingreso, §16 router, §17 verificador, §18 productores).

| Módulo | API |
|---|---|
| `dcp_ai::v2::experimental_candidate_ingress` | `experimental_candidate_ingress(&[u8])`: `CandidateIngressOutcome::Accept { value, canonical, canonical_sha256 }` o `Reject { class, offset }` |
| `dcp_ai::v2::experimental_candidate_router` | `CandidateRouter::new(CandidateRouterConfig { transport, accepted_profiles, historical })`; decodificador `HistoricalAdapter::serde_json_from_slice()`, ninguno predeterminado |
| `dcp_ai::v2::experimental_candidate_verify` | `CandidateVerifier::new(config)` y `verify_at(input, policy, now_ms)` |
| `dcp_ai::v2::experimental_candidate_produce` | `sign_payload(context, &CandidateInput, &CandidateKeys)` y `sign_bundle(&BundleParts, &BundleSigner, &BundleOptions)`; `ProduceError::Reject` para el dominio o la forma de las entradas (antes de ejecutar cualquier firmante), `Usage`, `Provider` |

```rust
use dcp_ai::providers::{ed25519::Ed25519Provider, ml_dsa_65::MlDsa65Provider};
use dcp_ai::v2::composite_ops::CompositeKeyInfo;
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::experimental_candidate_ingress::{experimental_candidate_ingress, CandidateIngressOutcome};
use dcp_ai::v2::experimental_candidate_produce::{sign_payload, CandidateInput, CandidateKeys};

fn main() {
    // The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
    if let Ok(CandidateIngressOutcome::Accept { canonical, .. }) = experimental_candidate_ingress(br#"{"b":1.0,"a":[]}"#) {
        println!("{}", String::from_utf8(canonical).unwrap()); // {"a":[],"b":1}
    }
    if let Ok(CandidateIngressOutcome::Reject { class, offset }) = experimental_candidate_ingress(br#"{"a":1,"a":2}"#) {
        println!("{} {}", class.as_str(), offset); // DUPLICATE_KEY 7
    }

    // A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
    let key = |p: &dyn CryptoProvider| {
        let k = p.generate_keypair().unwrap();
        CompositeKeyInfo { kid: k.kid, alg: p.alg().to_string(), secret_key_b64: k.secret_key_b64, public_key_b64: k.public_key_b64 }
    };
    let keys = CandidateKeys { classical: key(&Ed25519Provider), pq: Some(key(&MlDsa65Provider)) };
    let input = CandidateInput::Bytes(br#"{"intent_id":"intent:1","risk":1.0}"#.to_vec());
    let artifact = sign_payload("DCP-AI.v2.Intent", &input, &keys).unwrap();
    println!("{}", artifact.signed_payload["payload_hash"]); // "sha256:..." of {"intent_id":"intent:1","risk":1}
}
```

<a id="feature-wasm"></a>

### Función `wasm`

Cuando se habilita la función `wasm`, el crate expone bindings de WebAssembly:

```rust
// Declarations of the wasm-bindgen exports, bodies elided (not runnable)
// Available via wasm-bindgen
fn wasm_verify_signed_bundle(json: &str, pub_key: Option<String>) -> String;
fn wasm_verify_signed_bundle_v2(json: &str, policy_json: Option<String>) -> String; // default policy when None; V1 bundles are rejected under a policy
fn wasm_hash_object(json: &str) -> String;
fn wasm_generate_keypair() -> String;
fn wasm_build_bundle(rpr_json: &str, passport_json: &str, intent_json: &str, policy_json: &str, audit_entries_json: &str, session_nonce: &str) -> String;
fn wasm_sign_bundle(bundle_json: &str, classical_sk_b64: &str, classical_kid: &str, pq_sk_b64: &str, pq_kid: &str) -> String;
```

Compilar para WASM:

```bash
cargo build --target wasm32-unknown-unknown --features wasm
```

<a id="development"></a>

## Desarrollo

```bash
# Build
cargo build

# Tests
cargo test

# Build with WASM
cargo build --features wasm

# Build for WASM target
cargo build --target wasm32-unknown-unknown --features wasm
```

<a id="dependencies"></a>

### Dependencias

- `serde` + `serde_json` — Serialización
- `sha2` — SHA-256
- `sha3` — SHA3-256 (cadenas de hash duales)
- `ed25519-dalek` — Criptografía Ed25519
- `fips203` / `fips204` / `fips205` — ML-KEM-768, ML-DSA-65 y SLH-DSA-192f (FIPS 203 / 204 / 205)
- `rand` — Generación de números aleatorios
- `base64` — Codificación Base64
- `hex` — Codificación hexadecimal
- `wasm-bindgen` (opcional) — Bindings de WASM

<a id="license"></a>

## Licencia

Apache-2.0
