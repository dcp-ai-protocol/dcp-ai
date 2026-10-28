<sub>[English](DCP-AI-v2.0.md) · [中文](DCP-AI-v2.0.zh-CN.md) · **Español** · [日本語](DCP-AI-v2.0.ja.md) · [Português](DCP-AI-v2.0.pt-BR.md)</sub>

<a id="dcp-ai-v20-normative-specification"></a>

# Especificación normativa de DCP-AI v2.0

> Traducción informativa de [la especificación en inglés](DCP-AI-v2.0.md), actualizada el 28/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

**Estado:** Final  
**Versión:** 2.0.0  
**Fecha:** 2026-02-26  
**Autoría:** DCP-AI Protocol Governance  

---

<a id="1-introduction"></a>

## 1. Introducción

El Digital Citizenship Protocol for AI (DCP-AI) v2.0 define un marco resistente a la computación cuántica para la identidad de los agentes, la declaración de intenciones, el control por políticas y las pistas de auditoría. Sustituye a la v1.0 e introduce firmas híbridas con vinculación compuesta, separación de dominio, vinculación de sesión y aplicación de políticas en la que manda el verificador.

<a id="11-design-goals"></a>

### 1.1 Objetivos de diseño

1. **Seguridad poscuántica**: todos los artefactos de identidad y de auditoría están protegidos frente a adversarios cuánticos mediante firmas compuestas híbridas.
2. **No repudio**: los agentes y las personas no pueden negar las acciones registradas en cadenas de auditoría firmadas.
3. **Detección de manipulaciones**: las cadenas de hashes, las raíces de Merkle y el anclaje en blockchain ofrecen varias capas de detección de manipulaciones.
4. **Agilidad criptográfica**: el registro de algoritmos y la abstracción de proveedores permiten migrar de algoritmo sin cambiar el protocolo.
5. **Privacidad**: el modo de RPR cegado protege los datos personales sin perder la verificabilidad.
6. **Interoperabilidad**: verificación entre SDK, formato de intercambio CBOR y soporte de gRPC.

<a id="12-notation"></a>

### 1.2 Notación

- `||` denota la concatenación de bytes
- `UTF8(s)` denota la codificación UTF-8 de la cadena `s`
- `canonical(obj)` denota la canonicalización según el perfil `dcp-jcs-v1` (§15), basado en RFC 8785 JCS
- `SHA-256(m)` denota el hash SHA-256 del mensaje `m`
- `hex(b)[0:n]` denota los primeros `n` caracteres hexadecimales de la secuencia de bytes `b`

---

<a id="2-algorithm-registry"></a>

## 2. Registro de algoritmos

<a id="21-signature-algorithms"></a>

### 2.1 Algoritmos de firma

| Identificador | Estándar | Tamaño de la clave pública | Tamaño de la firma | Nivel de seguridad | Estado |
|---|---|---|---|---|---|
| `ed25519` | RFC 8032 | 32 B | 64 B | 128 bits clásico | ACTIVE |
| `ml-dsa-65` | FIPS 204 | 1952 B | 3309 B | NIST nivel 3 PQ | ACTIVE (PQ principal) |
| `ml-dsa-87` | FIPS 204 | 2592 B | 4627 B | NIST nivel 5 PQ | ACTIVE (alta garantía) |
| `slh-dsa-192f` | FIPS 205 | 48 B | 35664 B | NIST nivel 3 PQ | ACTIVE (PQ de respaldo) |
| `slh-dsa-256f` | FIPS 205 | 64 B | 49856 B | NIST nivel 5 PQ | RESERVED |

> *Nota informativa (25/10/2026), no forma parte del texto normativo:* ningún SDK de DCP-AI implementa todavía `ml-dsa-87`; los SDK firman y verifican con `ed25519`, `ml-dsa-65` y `slh-dsa-192f` ([docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md)).

<a id="22-kem-algorithms"></a>

### 2.2 Algoritmos KEM

| Identificador | Estándar | Tamaño de la clave pública | Tamaño del texto cifrado | Nivel de seguridad |
|---|---|---|---|---|
| `x25519` | RFC 7748 | 32 B | 32 B | 128 bits clásico |
| `ml-kem-768` | FIPS 203 | 1184 B | 1088 B | NIST nivel 3 PQ |
| `x25519-ml-kem-768` | Híbrido | 1216 B | 1120 B | Híbrido nivel 3 |

<a id="23-hash-algorithms"></a>

### 2.3 Algoritmos de hash

| Identificador | Salida | Uso |
|---|---|---|
| `sha256` | 32 B | PREDETERMINADO en despliegues de nivel 3 |
| `sha3-256` | 32 B | Hash secundario del modo de doble hash |
| `sha384` | 48 B | RECOMENDADO en despliegues de nivel 5 |

<a id="24-numeric-types"></a>

### 2.4 Tipos numéricos

Todos los campos numéricos de DCP-AI v2.0 deben (MUST) ser enteros. Los valores de coma flotante están prohibidos para eliminar la ambigüedad en la canonicalización.

---

<a id="3-key-objects"></a>

## 3. Objetos de clave

<a id="31-key-entry"></a>

### 3.1 Entrada de clave

```json
{
  "kid": "<32 hex chars>",
  "alg": "<algorithm identifier>",
  "public_key_b64": "<base64-encoded public key>",
  "created_at": "<ISO 8601>",
  "expires_at": "<ISO 8601 | null>",
  "status": "active | revoked | expired"
}
```

<a id="32-deterministic-kid-derivation"></a>

### 3.2 Derivación determinista del kid

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key_bytes))[0:32]
```

Propiedades: único, determinista y resistente a colisiones (128 bits del truncamiento de SHA-256).

---

<a id="4-domain-separation"></a>

## 4. Separación de dominio

Toda firma debe (MUST) incluir una etiqueta de separación de dominio:

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

<a id="41-context-tags"></a>

### 4.1 Etiquetas de contexto

| Etiqueta de contexto | Uso |
|---|---|
| `DCP-AI.v2.AgentPassport` | Autofirma del pasaporte del agente |
| `DCP-AI.v2.ResponsiblePrincipal` | Firma del registro de vinculación con la persona |
| `DCP-AI.v2.Intent` | Firma de la declaración de intención |
| `DCP-AI.v2.PolicyDecision` | Firma del motor de políticas |
| `DCP-AI.v2.AuditEvent` | Firma de auditoría por evento |
| `DCP-AI.v2.Bundle` | Firma del bundle |
| `DCP-AI.v2.Revocation` | Firma del registro de revocación |
| `DCP-AI.v2.KeyRotation` | Prueba de rotación de claves |
| `DCP-AI.v2.ProofOfPossession` | Desafío y respuesta de prueba de posesión |
| `DCP-AI.v2.JurisdictionAttestation` | Atestación de jurisdicción |
| `DCP-AI.v2.HumanConfirmation` | Confirmación humana |
| `DCP-AI.v2.AlgorithmAdvisory` | Aviso de retirada de algoritmos |
| `DCP-AI.v2.Governance` | Operaciones de gobernanza |
| `DCP-AI.v2.MultiPartyAuth` | Autorización de una parte en una autorización multiparte (`multi_party_authorization.schema.json`) |
| `DCP-AI.v2.Lifecycle` | Certificado de puesta en servicio, informe de vitalidad y registro de retirada (DCP-05) |
| `DCP-AI.v2.Succession` | Testamento digital, manifiesto de transferencia de memoria y registro de sucesión (DCP-06) |
| `DCP-AI.v2.Dispute` | Registro de disputa, objeción, resolución de arbitraje y paquete de jurisprudencia (DCP-07) |
| `DCP-AI.v2.Rights` | Declaración de derechos, registro de obligación e informe de vulneración de derechos (DCP-08) |
| `DCP-AI.v2.Delegation` | Mandato de delegación raíz (firma de la persona), espejos del principal y registros de interacción (DCP-09) |
| `DCP-AI.v2.Awareness` | Umbrales de conciencia y declaraciones de aviso (DCP-09) |
| `DCP-AI.v2.SubMandate` | Submandato firmado por el agente que delega (DCP-09 §3.5) |

> **Errata E1 (25/10/2026, normativa):** las filas `MultiPartyAuth`, `Lifecycle`, `Succession`, `Dispute`, `Rights` y `Awareness`, y los espejos del principal en la fila `Delegation`, documentan contextos que ya usan los SDK y `tests/interop/v2/interop_vectors.json#domain_separation_all_contexts`; no añaden ninguna etiqueta. Véase [V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md).

---

<a id="5-composite-signatures"></a>

## 5. Firmas compuestas

<a id="51-binding-protocol"></a>

### 5.1 Protocolo de vinculación

```
Step 1: classical_sig = Classical.sign(context || 0x00 || payload)
Step 2: pq_sig = PQ.sign(context || 0x00 || payload || classical_sig)
```

La firma PQ cubre la firma clásica. Eliminar cualquiera de los dos componentes hace que ambos fallen en la verificación.

<a id="52-wire-format"></a>

### 5.2 Formato de intercambio

```json
{
  "composite_sig": {
    "classical": { "alg": "ed25519", "kid": "...", "sig_b64": "..." },
    "pq": { "alg": "ml-dsa-65", "kid": "...", "sig_b64": "..." },
    "binding": "pq_over_classical"
  }
}
```

<a id="53-binding-modes"></a>

### 5.3 Modos de vinculación

- `pq_over_classical`: OBLIGATORIO en v2.0. La firma PQ cubre la firma clásica.
- `classical_only`: permitido durante la transición. El campo PQ es `null`.

---

<a id="6-signedpayload-envelope"></a>

## 6. Sobre SignedPayload

Los artefactos nunca contienen datos de firma. Las firmas están en un campo hermano:

```json
{
  "payload": { /* pure artifact */ },
  "payload_hash": "sha256:...",
  "composite_sig": { /* ... */ }
}
```

Bytes firmados: `context_tag || 0x00 || canonical(payload)`

---

<a id="7-verification-modes"></a>

## 7. Modos de verificación

<a id="71-modes"></a>

### 7.1 Modos

| Modo | Clásica requerida | PQ requerida | Bundles V1 |
|---|---|---|---|
| `classical_only` | Sí | No | Sí |
| `pq_only` | No | Sí | No |
| `hybrid_required` | Sí | Sí | Configurable |
| `hybrid_preferred` | Sí | No (advertencia) | Configurable |

En todos los modos, una firma PQ presente (`pq_over_classical`) debe (MUST) verificarse. `hybrid_preferred` y `classical_only` solo toleran que falte.

<a id="72-verifier-authoritative-policy"></a>

### 7.2 Política en la que manda el verificador

La política de firmas la fija la configuración del verificador, NO el agente. El verificador carga la política desde su propia configuración:

```json
{
  "verifier_policy": {
    "default_mode": "hybrid_required",
    "risk_overrides": { "high": "hybrid_required", "medium": "hybrid_required", "low": "hybrid_preferred" },
    "min_classical": 1,
    "min_pq": 1,
    "accepted_classical_algs": ["ed25519"],
    "accepted_pq_algs": ["ml-dsa-65", "slh-dsa-192f"],
    "require_session_binding": true,
    "require_composite_binding": true,
    "allow_classical_fallback_disable": false,
    "warn_classical_only_deprecated": false,
    "advisory_rejected_algs": []
  }
}
```

El nivel de seguridad (§14.3) solo puede hacer más estricto el modo que selecciona esta política.

<a id="73-pq-only-mode-phase-3"></a>

### 7.3 Modo solo PQ (fase 3)

Cuando `default_mode` es `pq_only`:

- Las firmas clásicas se aceptan, pero no se exigen
- `min_classical` es 0 y `min_pq` es 1
- No se exige la vinculación compuesta
- Los bundles V1 se rechazan
- Los bundles solo clásicos emiten advertencias de obsolescencia

---

<a id="8-session-binding"></a>

## 8. Vinculación de sesión

Un `session_nonce` aleatorio de 256 bits (64 caracteres hexadecimales) enlaza todos los artefactos de una sesión:

```
session_nonce = hex(random(32))
```

Todo artefacto V2 incluye `session_nonce`. El verificador debe (MUST) comprobar que todos los artefactos de un bundle comparten el mismo nonce.

---

<a id="9-bundle-manifest"></a>

## 9. Manifiesto del bundle

El manifiesto del bundle vincula criptográficamente los hashes de todos los artefactos:

```json
{
  "manifest": {
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    "passport_hash": "sha256:...",
    "intent_hash": "sha256:...",
    "policy_hash": "sha256:...",
    "audit_merkle_root": "sha256:...",
    "audit_merkle_root_secondary": "sha3-256:...",
    "audit_count": 5,
    "pq_checkpoints": ["ckpt-uuid-1"],
    "canonicalization_profile": "dcp-jcs-v1"
  }
}
```

`canonicalization_profile` es OPCIONAL (hoy solo está definido `"dcp-jcs-v1"`; véanse § 15 y [`CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md)). Un verificador que encuentre un bundle sin el campo debe (MUST) suponer `dcp-jcs-v1`. Los perfiles futuros harán el campo OBLIGATORIO.

La firma compuesta del bundle firma `canonical(manifest)`.

---

<a id="10-audit-trail"></a>

## 10. Pista de auditoría

<a id="101-per-event-signing"></a>

### 10.1 Firma por evento

Cada evento de auditoría se firma con Ed25519 (latencia de microsegundos). Los eventos forman una cadena de hashes mediante `prev_hash`.

<a id="102-pq-checkpoints-lazy-model"></a>

### 10.2 Checkpoints PQ (modelo diferido)

Cada N eventos (configurable, 10 de forma predeterminada) se produce un checkpoint PQ: una firma compuesta sobre la raíz de Merkle de los últimos N eventos.

<a id="103-dual-hash-chains"></a>

### 10.3 Cadenas de doble hash

Las cadenas SHA-256 y SHA3-256 funcionan en paralelo desde el lanzamiento de v2.0. Si una familia de hash se rompe, la otra da continuidad.

<a id="104-audit-compaction"></a>

### 10.4 Compactación de la auditoría

Tras N eventos (1000 de forma predeterminada) se produce un checkpoint de compactación. Los eventos compactados pueden (MAY) archivarse mientras el checkpoint permanece en la cadena activa.

---

<a id="11-key-management"></a>

## 11. Gestión de claves

<a id="111-key-rotation"></a>

### 11.1 Rotación de claves

1. Generar un nuevo par de claves
2. La nueva clave firma un desafío de prueba de posesión (old_kid + new_kid + marca de tiempo) con el contexto `DCP-AI.v2.KeyRotation`
3. La clave antigua refrenda la rotación para autorizarla
4. Ventana de gracia: 30 días en los que se aceptan ambas claves

<a id="112-key-recovery-m-of-n-social-recovery"></a>

### 11.2 Recuperación de claves (recuperación social M de N)

El secreto maestro se divide con el esquema de compartición de secretos de Shamir. Las participaciones se cifran con KEM híbrido para los contactos de recuperación.

> *Nota informativa (25/10/2026), no forma parte del texto normativo:* la recuperación de claves del SDK de TypeScript y `dcp recovery-setup` producen las participaciones, pero no las cifran; cifrarlas para los contactos de recuperación queda a cargo de quien implemente.

<a id="113-emergency-revocation"></a>

### 11.3 Revocación de emergencia

`revocation_token = SHA-256(revocation_secret)` registrado de antemano. Revelar la preimagen revoca todas las claves del agente sin firma criptográfica.

<a id="114-hsmtpm-support"></a>

### 11.4 Soporte de HSM/TPM

Las claves privadas deberían (SHOULD) almacenarse en módulos de seguridad de hardware. La interfaz `CryptoProvider` admite `HsmCryptoProvider`, que delega todas las operaciones en el HSM mediante PKCS#11.

> *Nota informativa (25/10/2026), no forma parte del texto normativo:* el `HsmCryptoProvider` del código fuente del SDK de TypeScript es un patrón simulado, no una integración con un HSM: no se exporta, no tiene enlace PKCS#11 y no debe usarse para firmar ni verificar evidencias reales. Este repositorio no implementa ningún backend de hardware ni declara ninguna validación FIPS 140 ([docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md) §2.2).

---

<a id="12-privacy"></a>

## 12. Privacidad

<a id="121-blinded-rpr"></a>

### 12.1 RPR cegado

Un RPR cegado (`schemas/v2/blinded_rpr.schema.json`) sustituye los campos de datos personales del RPR completo (`legal_name`, `contact`) por un compromiso con sal, de modo que los bundles puedan publicarse en registros de transparencia y anclajes sin los datos personales. Los campos que no son datos personales (`human_id`, `session_nonce`, `entity_type`, `jurisdiction`, `liability_mode`, `override_rights`, `issued_at`, `expires_at`, `binding_keys`) se copian sin cambios y se contrastan con el RPR completo cuando se divulga.

```
pii_salt = hex(random(32))
pii_hash = "sha256:" || hex(SHA-256(UTF8(canonical({ contact, legal_name, pii_salt }))))
```

Un `contact` ausente se incluye en el hash como `null`.

- **Sal.** `pii_salt` es un campo del RPR completo: 32 bytes de un CSPRNG en hexadecimal en minúsculas, nuevos para cada RPR. Lo cubre la firma del RPR completo y no debe (MUST NOT) publicarse; nunca aparece en el RPR cegado. Reutilizar una sal da el mismo `pii_hash` a los registros con los mismos datos personales, lo que permite enlazarlos. Con 32 bytes, una búsqueda por adivinación y confirmación sigue costando 2^128 operaciones incluso con el algoritmo de Grover.
- **El cegado falla de forma cerrada.** Las implementaciones deben (MUST) negarse a cegar un RPR que no tenga una `pii_salt` válida, y los verificadores deben (MUST) rechazar un RPR completo cuya `pii_salt` esté presente pero no tenga 64 caracteres hexadecimales en minúsculas. La sal se firma con el RPR completo, así que debe fijarse al crear el RPR: un RPR que pueda cegarse más adelante debería (SHOULD) llevar una `pii_salt` desde el principio.
- **Divulgación.** La sal solo se divulga junto con el RPR completo, por ejemplo a un regulador, que recalcula `pii_hash` a partir del RPR completo y compara los campos que no son datos personales.
- **Supresión.** Borrar el RPR completo, y con él la sal, hace que el compromiso publicado no pueda abrirse: nadie puede confirmar con él un nombre y un contacto adivinados. Esto proporciona supresión (artículo 17 del RGPD) para los registros en logs y anclajes inmutables, que no pueden reescribirse. Hay que borrar todas las copias del RPR completo, incluidas las divulgadas.
- **`human_id`.** El RPR cegado publica `human_id`, así que `human_id` debe (MUST) ser opaco y no debe (MUST NOT) contener datos personales ni derivarse de ellos, como una dirección de correo electrónico, un nombre o el hash de cualquiera de ellos.
- **Compromisos heredados.** Un `pii_hash` calculado a partir de un RPR completo sin `pii_salt` (la fórmula anterior sin el miembro `pii_salt`) está obsoleto. Las implementaciones no deben (MUST NOT) cegar así registros nuevos. Los verificadores pueden (MAY) seguir comprobando un compromiso heredado frente a un RPR completo divulgado y deberían (SHOULD) marcarlo como obsoleto: cualquiera que adivine los datos personales puede confirmarlos, y en un log inmutable eso sigue siendo cierto para siempre.

---

<a id="13-governance"></a>

## 13. Gobernanza

<a id="131-governance-key-set"></a>

### 13.1 Conjunto de claves de gobernanza

Claves multiparte M de N que se usan para firmar avisos sobre algoritmos y decisiones del protocolo. Se publican en `/.well-known/governance-keys.json`.

<a id="132-algorithm-advisory-system"></a>

### 13.2 Sistema de avisos sobre algoritmos

Avisos firmados con las acciones `warn`, `deprecate` y `revoke`. La respuesta automatizada del verificador elimina los algoritmos afectados y añade sus sustitutos.

<a id="133-advisory-auto-response"></a>

### 13.3 Respuesta automática a los avisos

Los verificadores, de forma automática:

- Eliminan de las listas aceptadas los algoritmos obsoletos o revocados
- Añaden los algoritmos sustitutos
- Pasan a pq_only si se eliminan todos los algoritmos clásicos
- Mantienen una pista de auditoría de los cambios de política

---

<a id="14-adaptive-security-tiers"></a>

## 14. Niveles de seguridad adaptativos

El sistema de niveles de seguridad adaptativos selecciona los niveles de protección criptográfica a partir de la puntuación de riesgo de la decisión de política y de las clases de datos, el tipo de acción y el impacto estimado de la intención. Los niveles determinan el modo de verificación, el intervalo de los checkpoints PQ y los modos de presentación del bundle.

<a id="141-tier-definitions"></a>

### 14.1 Definición de los niveles

| Nivel | Nombre | Modo de verificación | Intervalo de checkpoint PQ | Tamaño del bundle | Latencia criptográfica |
|---|---|---|---|---|---|
| 0 | `routine` | `classical_only` | Cada 50 eventos | ~1-2 KB | ~2 ms |
| 1 | `standard` | `hybrid_preferred` | Cada 10 eventos | ~2-5 KB | ~2 ms + 5 ms de checkpoint |
| 2 | `elevated` | `hybrid_required` | Cada evento | ~10-15 KB | ~11 ms |
| 3 | `maximum` | `hybrid_required` | Cada evento + verificación inmediata | ~15-25 KB | ~15 ms |

<a id="142-tier-selection-algorithm"></a>

### 14.2 Algoritmo de selección del nivel

El nivel se calcula solo a partir de campos firmados que definen los esquemas: `action_type`, `data_classes`, `estimated_impact` y el opcional `security_tier` de la intención, y la `risk_score` (entero 0..1000) del `PolicyDecisionV2` del bundle. El esquema de la intención no tiene `risk_score`; una implementación no debe (MUST NOT) leerla de la intención.

```
function computeSecurityTier(intent, policy_decision):
  if policy_decision is absent or null:
    score = 0
  else if policy_decision.risk_score is an integer from 0 to 1000:
    score = policy_decision.risk_score
  else:
    score = unknown
  dc = intent.data_classes
  unknown = score is unknown
         OR intent.action_type ∉ ACTION_TYPES
         OR intent.estimated_impact ∉ {low, medium, high}
         OR dc is not an array
         OR some element of dc ∉ DATA_CLASSES

  if score >= 800 OR dc ∩ {credentials, children_data} ≠ ∅:
    tier = "maximum"
  else if score >= 500 OR dc ∩ {pii, financial_data, health_data} ≠ ∅
       OR intent.action_type == "initiate_payment"
       OR intent.estimated_impact == "high" OR unknown:
    tier = "elevated"
  else if score >= 200 OR intent.estimated_impact == "medium":
    tier = "standard"
  else:
    tier = "routine"

  explicit = intent.security_tier
  if explicit is present and not null:
    tier = max(tier, explicit if it is a tier name else "elevated")
  if a verified mandate chain (DCP-09 §3.5) applies and has an effective tier:
    tier = max(tier, that tier if it is a tier name else "elevated")
  return tier
```

El nivel efectivo de una cadena de delegación verificada, el mayor `minimum_security_tier` a lo largo de ella, es una entrada opcional de este cálculo que solo puede elevar el resultado, nunca rebajarlo. Ningún campo del bundle lleva todavía la cadena, así que el mínimo se aplica cuando al verificador se le entrega una cadena verificada junto con el bundle; los verificadores de bundles de §18 no la leen.

`ACTION_TYPES` y `DATA_CLASSES` son los enumerados `action_type` y `data_classes` de `schemas/v2/intent.schema.json`. Un valor ausente, de tipo incorrecto o desconocido falla de forma cerrada a, como mínimo, `elevated`, de modo que un valor que el verificador no conoce nunca reduce el escrutinio que recibe un bundle, haya o no validación de esquema. Sin decisión de política la puntuación es 0. En una decisión de política, una `risk_score` que falte o que no sea un entero de 0 a 1000 (una cadena, una fracción, un número negativo, un número mayor que 1000) es desconocida del mismo modo, y las comparaciones de puntuación anteriores la tratan como 0. Un número sin parte fraccionaria, como `200.0`, cuenta como ese entero.

La categoría `security_tier` de `tests/interop/v2/interop_vectors.json` enumera el nivel, el modo de verificación y el intervalo de checkpoint esperados para cada caso. Los cuatro SDK la ejecutan.

<a id="143-tier-enforcement-never-downgrade"></a>

### 14.3 Aplicación del nivel (nunca a la baja)

Un verificador V2 debe (MUST) calcular el nivel de cada bundle y verificar el bundle con el más estricto de dos modos:

1. el modo de la política: el `default_mode` del verificador, o su entrada de `risk_overrides` para el `risk_tier` del pasaporte (§7.2);
2. el modo del nivel (§14.1).

El orden de rigor es `classical_only` < `hybrid_preferred` < `hybrid_required`. El nivel solo puede añadir un requisito PQ, así que una política `pq_only` sigue siendo `pq_only`. El agente que se verifica firma el pasaporte y la intención, así que su `risk_tier` y su `security_tier` pueden elevar el modo, pero no llevarlo por debajo del modo del nivel. Los verificadores informan del nivel resuelto junto con su resultado.

El verificador puede (MAY) elevar el nivel calculado, pero no debe (MUST NOT) rebajarlo. El campo `resolved_tier` de `PolicyDecisionV2` registra el nivel que resolvió el motor de políticas. Es informativo: el cálculo de §14.2 no lo lee.

<a id="144-intent-and-policy-decision-fields"></a>

### 14.4 Campos de la intención y de la decisión de política

`IntentV2` incluye un campo opcional `security_tier` (calculado automáticamente o fijado de forma explícita). `PolicyDecisionV2` incluye un campo opcional `resolved_tier`, el nivel que resolvió el motor de políticas, a título informativo; §14.2 no lo lee.

<a id="145-verification-cache"></a>

### 14.5 Caché de verificación

Los resultados de bundles verificados pueden (MAY) almacenarse en caché con un TTL que depende del nivel resuelto:

| Nivel | TTL de la caché |
|---|---|
| `routine` | 5 minutos |
| `standard` | 2 minutos |
| `elevated` | 30 segundos |
| `maximum` | 10 segundos |

Las entradas de la caché deben (MUST) invalidarse cuando se revoca el kid de cualquier firmante.

<a id="146-bundle-presentation-modes"></a>

### 14.6 Modos de presentación del bundle

Los niveles influyen en el modo de presentación sugerido para optimizar el ancho de banda:

- **Niveles 0-1 (sesión establecida)**: `compact` o `reference`: se omite la firma PQ y se incluye la referencia al checkpoint
- **Niveles 2-3**: `full`: el bundle completo con todas las firmas
- **Primer contacto (cualquier nivel)**: `full`

---

<a id="15-canonicalization"></a>

## 15. Canonicalización

DCP-AI v2.0 usa el perfil de canonicalización **`dcp-jcs-v1`**, basado en RFC 8785 (JCS). El perfil fija los casos que JCS deja a criterio de la implementación (tratamiento de undefined, números de coma flotante con valor entero, notación científica, conservación de null, contenedores vacíos) para que los cuatro SDK produzcan una salida idéntica byte a byte. No es un subconjunto estricto de JCS: las claves se ordenan por punto de código Unicode (punto 1), mientras que RFC 8785 las ordena por unidades de código UTF-16. Los dos órdenes solo difieren en las claves que mezclan caracteres de los planos suplementarios con caracteres del rango U+E000..U+FFFF.

Resumen:

1. Claves ordenadas lexicográficamente por punto de código Unicode
2. Forma compacta (sin espacios en blanco)
3. Solo números enteros, decidido tras el análisis (`1.0`, `1e2`, `1.00` se aceptan; `0.1`, `NaN`, `Infinity` se rechazan)
4. `null` se conserva con su clave; los arrays conservan `null` en su posición
5. `undefined` (solo TypeScript): se omite en los objetos y se serializa como `null` en los arrays
6. Ninguna exclusión de campos (sobre SignedPayload)
7. Bytes firmados: `UTF8(context_tag) || 0x00 || canonical(payload)`

El perfil normativo completo, con la tabla de aceptación de los casos límite y los fixtures de prueba que deben superar los cuatro SDK, está en [`spec/CANONICALIZATION_PROFILE.md`](CANONICALIZATION_PROFILE.md). Los bundles producidos con este perfil lo declaran mediante el campo opcional `canonicalization_profile: "dcp-jcs-v1"` del manifiesto del bundle.

---

<a id="16-wire-formats"></a>

## 16. Formatos de intercambio

<a id="161-json-default"></a>

### 16.1 JSON (predeterminado)

`Content-Type: application/json`

<a id="162-cbor-optional"></a>

### 16.2 CBOR (opcional)

`Content-Type: application/cbor`: codificación determinista de RFC 8949. Entre un 30 y un 40 % más pequeño que JSON.

---

<a id="17-backward-compatibility"></a>

## 17. Compatibilidad con versiones anteriores

```
V1 Verifier + V1 Bundle  ->  PASS (unchanged)
V1 Verifier + V2 Bundle  ->  REJECT "unsupported dcp_version 2.0"
V2 Verifier + V1 Bundle  ->  PASS (when allow_v1_bundles=true)
V2 Verifier + V2 Bundle  ->  PASS (full V2 verification)
```

Los verificadores V2 deben (MUST) admitir V1 indefinidamente. La migración es gradual.

---

<a id="18-verification-pipeline"></a>

## 18. Proceso de verificación

1. Decodificación del formato de intercambio (JSON o CBOR)
2. Validación de esquema (encaminamiento V1/V2)
3. Coherencia del nonce de sesión
4. Integridad del manifiesto (recalcular los hashes de los artefactos) y ventana de sesión a partir de los campos firmados `session_issued_at` y `session_expires_at`
5. Coherencia entre artefactos: estado del pasaporte, caducidad del RPR, un único principal, agente e intención en todos los artefactos y en la pista de auditoría (VERIFICATION.md V2-14)
6. Cálculo del nivel de seguridad a partir de la intención y la decisión de política firmadas (§14.2)
7. Rechazo de algoritmos según los avisos
8. Verificación de las firmas compuestas (en paralelo): la firma del bundle con las `binding_keys` del RPR, los artefactos del agente con las `keys` del pasaporte, cada kid derivado de su clave
9. Aplicación de la política del verificador con el modo efectivo, el más estricto entre el modo de la política y el del nivel (§14.3), a la firma del bundle y a cada firma de artefacto
10. Validación de la cadena de hashes de auditoría
11. Validación de los checkpoints PQ: exactamente los checkpoints enumerados, cada uno sobre sus entradas de auditoría y firmado por el agente
12. Comprobaciones de validez de las claves (caducidad, revocación, derivación del kid)
13. Consulta y almacenamiento en la caché de verificación (§14.5)

---

<a id="19-threat-model"></a>

## 19. Modelo de amenazas

| Amenaza | Mitigación |
|---|---|
| Adversario cuántico (algoritmo de Shor) | ML-DSA-65 en la firma compuesta |
| Almacenar ahora y descifrar después | Firmas híbridas compuestas (la PQ sigue siendo válida aunque se rompa la clásica) |
| Ataque de eliminación | Vinculación compuesta (la PQ firma sobre la firma clásica) |
| Reproducción entre artefactos | Etiquetas de contexto de separación de dominio |
| Empalme de sesiones | session_nonce + manifiesto del bundle |
| Rebaja de la política | Política en la que manda el verificador + regla de nivel que nunca baja |
| Confusión o apropiación de claves | kid determinista + prueba de posesión |
| Ruptura de un algoritmo (PQ) | Agilidad criptográfica + respaldo SLH-DSA-192f + sistema de avisos |
| Explotación de la canonicalización | Esquemas solo con enteros, prohibición de coma flotante |
| Robo de claves | HSM/TPM, certificados de corta duración, rotación de claves con prueba de posesión |
| Manipulación de la base de datos | Cadenas de hashes + raíces de Merkle + anclaje en blockchain |
| Exposición de datos personales | Modo de RPR cegado |
| Pérdida de claves | Recuperación social M de N (Shamir SSS) |
| Evasión del nivel | Elevación del nivel por el verificador; el agente no puede rebajarlo |
| Agente que se atribuye un principal (reutilizando un RPR publicado y firmado) | Firma del bundle solo con las `binding_keys` del RPR; se compromete con el hash del pasaporte. Un RPR emitido con el `human_id` de otra persona solo lo detiene un verificador que fije o ateste las claves del principal |
| Artefactos incoherentes pero firmados válidamente | Comprobaciones de coherencia entre artefactos (VERIFICATION.md V2-14) |
| Metadatos sin firmar que orientan una comprobación | Inicio de la sesión firmado en el manifiesto; el bloque del firmante no puede contradecir la firma |

---

<a id="20-conformance-requirements"></a>

## 20. Requisitos de conformidad

### 20.1 MUST

- Firmas híbridas con vinculación compuesta en todos los artefactos V2
- Separación de dominio en cada firma
- Nonce de sesión en cada artefacto de un bundle
- Campos numéricos solo enteros
- Derivación determinista del kid
- Validación con los KAT del NIST para todos los proveedores PQ
- Cálculo del nivel de seguridad (§14.2) y su aplicación con la regla de no rebajarlo nunca (§14.3) para cada bundle V2

### 20.2 SHOULD

- HSM/TPM para almacenar las claves privadas en producción
- Cadenas de doble hash (SHA-256 + SHA3-256)
- Formato de intercambio CBOR para despliegues de alto rendimiento
- Certificados de corta duración (TTL de 24 h) en lugar de listas de revocación
- Consulta periódica de avisos (diaria)

### 20.3 MAY

- CBOR + compresión gzip
- Verificación de firmas en paralelo
- Estrategia de verificación que falla rápido comprobando primero la PQ
- Compactación de la pista de auditoría
- Caché de los resultados de verificación con TTL según el nivel (§14.5)

---

<a id="21-references"></a>

## 21. Referencias

- FIPS 203: ML-KEM (mecanismo de encapsulación de claves basado en retículos modulares)
- FIPS 204: ML-DSA (algoritmo de firma digital basado en retículos modulares)
- FIPS 205: SLH-DSA (algoritmo de firma digital basado en hash sin estado)
- RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA)
- RFC 8785: JSON Canonicalization Scheme (JCS)
- RFC 8949: Concise Binary Object Representation (CBOR)

---

*Fin de la especificación normativa de DCP-AI v2.0*

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- **§5.1 y §7.1, eliminación.** En los verificadores de los SDK, una firma PQ presente que no se verifica se rechaza en
  todos los modos. Un bundle al que se le quitó la firma PQ y cuya vinculación se reetiquetó como `classical_only` se
  acepta cuando el modo efectivo es `classical_only` o `hybrid_preferred` (con una advertencia en `hybrid_preferred`), y
  se rechaza con `hybrid_required` y `pq_only` ([VERIFICATION.md](VERIFICATION.md) V2-7 a V2-9).
- **§7.3, `pq_only`.** Los verificadores de los SDK siguen esperando la vinculación `pq_over_classical` con los bytes de
  la firma clásica: la firma PQ los cubre, así que `pq_only` no permite prescindir del componente clásico.
- **§6, SignedPayload.** El sobre envuelve los cuatro artefactos principales de un bundle (pasaporte, RPR, intención,
  decisión de política). Los registros de DCP-05 a DCP-09 llevan sus firmas dentro del objeto, normalmente como
  `composite_sig`; un mandato de delegación raíz lleva `human_composite_sig` y un submandato
  `delegator_composite_sig` (DCP-09 §3.5).
- **§9 y §15, canonicalización.** `dcp-jcs-v1` es el único perfil normativo y el predeterminado. El perfil candidato de
  [docs/proposals/canonicalization-candidate](../docs/proposals/canonicalization-candidate/README.md) solo es accesible
  mediante API experimentales y opt-in, y no cambia lo que acepta un verificador predeterminado.
- **§10, pista de auditoría.** Las entradas de auditoría no se firman una a una: las cubre la firma del bundle a través
  del manifiesto. El contexto `DCP-AI.v2.AuditEvent` se usa en los checkpoints PQ y en la compactación de la auditoría,
  que produce quien llama con funciones auxiliares del SDK; nada los firma de forma automática. Los verificadores
  comprueban los checkpoints enumerados y la cadena SHA-256; desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 y Rust `dcp-ai` 2.11.1 también comprueban los campos secundarios SHA3-256 presentes (errata de V2-11), que las versiones anteriores no comprueban.
- **§11.3, revocación de emergencia.** Los esquemas del RPR no tienen `revocation_token`; el pasaporte V2 tiene un
  `emergency_revocation_token` opcional.
- **§12.1, supresión.** El texto describe el efecto criptográfico de borrar la sal. No es una evaluación del
  cumplimiento del RGPD ni de ninguna otra ley; consulta [docs/EU_AI_ACT_MAPPING.md](../docs/EU_AI_ACT_MAPPING.md).
- **§13, avisos.** El servidor de referencia aplica los avisos publicados a su política solo cuando un operador llama a
  `POST /v2/advisory/auto-apply`; comprueba la `composite_sig` del aviso solo en su estructura, y no hay consulta
  periódica automática.
- **§14.1, tamaños y latencias.** Las columnas de tamaño del bundle y de latencia son ilustrativas, no mediciones del
  código de `main`; [docs/OPERATOR_GUIDE.md](../docs/OPERATOR_GUIDE.md) explica cómo medirlas.
- **§1.1 y §19, anclaje.** El servicio de anclaje de referencia guarda sus registros en local y no envía nada a la
  cadena ([docker/README.md](../docker/README.md)).
- **§16, formatos de intercambio.** CBOR es un codificador y decodificador opcional solo del SDK de TypeScript, y el
  servidor de referencia solo lee cuerpos JSON. La cifra del 30–40% de tamaño no está respaldada por ninguna medición en
  este repositorio. `api/proto/dcp.proto` es una definición: ningún servidor ni cliente gRPC de este repositorio la
  implementa.
- **§17, compatibilidad con versiones anteriores.** La tabla describe resultados, no un único punto de entrada.
  `verifySignedBundleV2` de los SDK solo verifica bundles V2. `allow_v1_bundles` lo leen el servidor de referencia y el
  perfil de admisión; el `verifySignedBundle` raíz (`lib/verify.js`) envía los bundles V1 a las comprobaciones V1 sin
  leerlo.
- **§18, proceso.** `verifySignedBundleV2` no ejecuta la validación con JSON Schema (paso 2): `lib/verify.js` y el
  servidor la hacen antes de llamarlo. No usa la caché de verificación que exporta el SDK de TypeScript (paso 13), y el
  paso 12 lee el estado de las claves que hay en el bundle; consultar un servicio de revocación corresponde a la
  admisión ([docs/ADMISSION.md](../docs/ADMISSION.md)). Verificar no es admitir, confiar ni autorizar.
