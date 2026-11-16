<sub>[English](../../../spec/BUNDLE.md) · [中文](../../zh-CN/spec/BUNDLE.md) · **Español** · [日本語](../../ja/spec/BUNDLE.md) · [Português](../../pt-BR/spec/BUNDLE.md)</sub>

<a id="bundle--citizenship-bundle--signed-bundle"></a>
<a id="bundle-citizenship-bundle-signed-bundle"></a>

# Bundle — Citizenship Bundle y Signed Bundle

> Traducción informativa de [la especificación en inglés](../../../spec/BUNDLE.md), actualizada el 25/10/2026. **La versión normativa es la inglesa**: esta traducción no tiene valor normativo y, si difieren, prevalece el inglés. Los identificadores y bloques de código se conservan sin traducir.

Un agente no opera en el vacío: opera con una identidad, una intención declarada, una decisión de política y un registro auditable. El **Citizenship Bundle** es el paquete portable que reúne todo eso. El **Signed Bundle** lo hace verificable criptográficamente.

<a id="citizenship-bundle-l3-bundle"></a>

## Citizenship Bundle (bundle L3)

Un Citizenship Bundle es un objeto JSON que contiene exactamente:

- `responsible_principal_record` — DCP-01 (RPR)
- `agent_passport` — DCP-01 (AP)
- `intent` — DCP-02
- `policy_decision` — DCP-02
- `audit_entries` — DCP-03 (array, al menos un elemento)

**Esquema normativo:** `schemas/v1/citizenship_bundle.schema.json`  
**$id:** `https://dcp-ai.org/schemas/v1/citizenship_bundle.schema.json`

**Validación:**

```bash
dcp validate-bundle <bundle.json>
```

O valida el objeto directamente contra el esquema del bundle:

```bash
dcp validate schemas/v1/citizenship_bundle.schema.json <bundle.json>
```

**Ejemplo:** [tests/conformance/examples/citizenship_bundle.json](../../../tests/conformance/examples/citizenship_bundle.json)

---

## Signed Bundle

Un Signed Bundle envuelve un Citizenship Bundle con una firma Ed25519 y hashes deterministas:

- `bundle` — el objeto Citizenship Bundle completo
- `signature` — objeto con:
  - `alg`: `"ed25519"`
  - `created_at`: fecha y hora ISO 8601
  - `signer`: `{ type: "human"|"organization", id, public_key_b64 }`
  - `bundle_hash`: `sha256:<hex>` — SHA-256 del JSON canonicalizado del bundle
  - `merkle_root`: `sha256:<hex>` o `null` — raíz de Merkle de `audit_entries` (opcional)
  - `sig_b64`: firma en Base64

**Esquema normativo:** `schemas/v1/signed_bundle.schema.json`  
**$id:** `https://dcp-ai.org/schemas/v1/signed_bundle.schema.json`

**Validación (esquema + firma):**

```bash
dcp verify-bundle <bundle.signed.json> <public_key.txt>
```

**Comandos auxiliares:**

```bash
dcp bundle-hash <bundle.json>        # Prints bundle_hash (sha256:...)
dcp merkle-root <bundle.json>       # Prints merkle_root of audit_entries or null
dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]
dcp keygen [out_dir]
```

**Ejemplo:** [tests/conformance/examples/citizenship_bundle.signed.json](../../../tests/conformance/examples/citizenship_bundle.signed.json)

**Bundles V2** (`bundle.dcp_bundle_version: "2.0"`) usan `schemas/v2/signed_bundle.schema.json`: cada artefacto es un `SignedPayload`, y la firma compuesta Ed25519 + ML-DSA-65 cubre el `manifest` del bundle. Véase la lista de verificación V2 en [VERIFICATION.md](../../../spec/VERIFICATION.md).

```bash
dcp sign-bundle --composite <bundle_v2.json> <ed25519_secret_key.txt> <ml_dsa_65_secret_key.txt> [out.json]
dcp verify-bundle [--policy <mode>] <signed_bundle_v2.json> [public_key.txt]   # key pins the classical signer
```

---

<a id="verification-checklist"></a>

## Lista de verificación

Para una lista de verificación normativa paso a paso (esquema, firma, caducidad, revocación, intent_hash, cadena de auditoría, Merkle, anclaje opcional), véase [VERIFICATION.md](../../../spec/VERIFICATION.md). Todos los pasos son locales; no hace falta ninguna llamada a un servidor.

<a id="implementation-notes-informative"></a>

## Notas de implementación (informativas)

> **Añadidas el 25/10/2026. No normativas.** Estas notas no añaden ningún requisito ni cambian nada de lo anterior: describen cómo
> se relaciona el código de referencia de `main` con este texto. Donde difieren, prevalece el texto normativo anterior.

- En V2 solo los cuatro artefactos principales (RPR, pasaporte, intención y decisión de política) son sobres `SignedPayload`; las
  entradas de auditoría son objetos simples, comprometidos por la raíz de Merkle del manifiesto y cubiertos por la firma del bundle sobre
  el manifiesto, no firmados uno a uno.
- Un Citizenship Bundle V1 necesita al menos una entrada de auditoría; un bundle V2 puede tener un registro de auditoría vacío (su raíz de Merkle son
  64 ceros), como permite [VERIFICATION.md](../../../spec/VERIFICATION.md).
- Un bundle que se verifica es coherente y está firmado por las claves que enumera; eso por sí solo no establece quién es el
  principal, no admite el bundle ni autoriza una acción ([docs/ADMISSION.md](../../../docs/ADMISSION.md)).
- `<bundle.json>` y los demás nombres entre ángulos son marcadores de posición para tus propios archivos.
