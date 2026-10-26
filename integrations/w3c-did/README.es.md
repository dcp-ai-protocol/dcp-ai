<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--w3c-didvc-bridge"></a>
<a id="dcp-ai-w3c-didvc-bridge"></a>

# Puente DCP-AI ↔ W3C DID/VC

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Convierte entre artefactos de DCP y los identificadores descentralizados (DID) y credenciales verificables (VC) del W3C.

<a id="installation"></a>

## Instalación

```bash
npm install @dcp-ai/w3c-did
```

La 2.0.1 de npm (26/10/2026) tiene el mismo `index.js` que el código fuente de `main`. Se ejecuta en Node.js (usa `Buffer`) y no tiene dependencias.

<a id="limits-25102026"></a>

## Límites (25/10/2026)

Léelos antes de confiar en la salida; están comprobados contra `index.js`:

- **Claves.** `rprToDIDDocument` lee las claves de `rpr.keys`. Un RPR V2 que sigue el esquema las lleva en `binding_keys`, que no lee, así que su DID Document no tiene métodos de verificación.
- **Codificación.** `publicKeyMultibase` es `z` seguido de base64url. En [Multibase](https://www.w3.org/TR/cid-1.0/#multibase), `z` significa base58btc: esto etiqueta mal la codificación y puede producir un error de decodificación o bytes de clave distintos en otras herramientas. El `didDocumentToRPR` de este paquete usa el decodificador base64url correspondiente, no un decodificador multibase conforme.
- **Sin pruebas.** Las credenciales y presentaciones verificables que construye no llevan `proof`: no están firmadas. `passportToVC` copia campos seleccionados del pasaporte y no conserva una firma de DCP. `bundleToVP` conserva el bundle firmado recibido en `dcpBundle`, que debe comprobarse aparte con un verificador de DCP; esa comprobación no autentica el `holder`, el `created` ni los campos copiados de la credencial de la VP que lo rodea.
- **URL de contexto.** Los DID Documents que produce enumeran `https://w3id.org/security/suites/ed2519-2020/v1` en `@context`, una URL mal escrita de la suite Ed25519-2020 (`index.js`). Hasta que se corrija en otro cambio, no trates la salida como JSON-LD de DID del W3C conforme.
- **Espacios de nombres.** Este repositorio usa `did:dcp:` y `PostQuantumVerificationKey2024` como identificadores propios. No aporta ningún resolvedor de DID ni evidencia de registro para ellos; no supongas que las herramientas externas de DID/VC los reconocen.

<a id="supported-dcp-specifications"></a>

## Especificaciones de DCP admitidas

De DCP-01 a DCP-09, como correspondencias parciales de los campos enumerados abajo y con los límites anteriores; no es una implementación completa de esas especificaciones.

<a id="overview"></a>

## Descripción general

Este puente permite la interoperabilidad entre la capa de identidad de DCP-AI y el ecosistema de identidad descentralizada del W3C. Admite la conversión en ambos sentidos de:

- **Responsible Principal Records ↔ DID Documents** — asigna las identidades humanas de DCP a DID del método `did:dcp:` con métodos de verificación derivados de las claves del RPR.
- **Agent Passports ↔ Verifiable Credentials** — representa las certificaciones de agentes de DCP como VC del W3C, con las capacidades, el modo de responsabilidad y la jurisdicción.
- **Signed Bundles → Verifiable Presentations** — envuelve Citizenship Bundles de DCP completos como VP del W3C para presentarlos a verificadores externos.

<a id="functions"></a>

## Funciones

| Función | Sentido | Descripción |
|---|---|---|
| `rprToDIDDocument(rpr)` | DCP → W3C | Convierte un Responsible Principal Record en un DID Document |
| `didDocumentToRPR(didDoc)` | W3C → DCP | Convierte un DID Document de vuelta en un esqueleto de RPR |
| `passportToVC(passport, issuerDid)` | DCP → W3C | Convierte un Agent Passport en una Verifiable Credential |
| `vcToPassport(vc)` | W3C → DCP | Convierte una Verifiable Credential de vuelta en un esqueleto de pasaporte |
| `bundleToVP(signedBundle, holderDid)` | DCP → W3C | Envuelve un bundle firmado como Verifiable Presentation |
| `rightsToServiceEndpoints(rightsDeclaration)` | DCP → W3C | Convierte una declaración de derechos en endpoints de servicio del DID (DCP-08) |

<a id="did-method"></a>

## Método DID

Este puente usa el espacio de nombres del método `did:dcp:`. Los identificadores DID se derivan directamente de los ID humanos del RPR:

```
did:dcp:<human-id-uuid>
```

Los métodos de verificación admiten tanto Ed25519 (clásico) como tipos de clave poscuánticos.

<a id="usage"></a>

## Uso

```javascript
// Fragment: myRpr, myPassport and signedBundle come from your application
import { rprToDIDDocument, passportToVC, bundleToVP } from '@dcp-ai/w3c-did';

// Convert an RPR to a DID Document
const didDoc = rprToDIDDocument(myRpr);

// Issue a Verifiable Credential for an agent
const vc = passportToVC(myPassport, 'did:dcp:issuer-id');

// Wrap a full bundle as a Verifiable Presentation
const vp = bundleToVP(signedBundle, 'did:dcp:holder-id');
```

<a id="notes"></a>

## Notas

- Las conversiones a esqueleto (W3C → DCP) producen registros parciales que requieren un procesamiento adicional (recálculo de los ID de clave, firma, etc.) antes de ser artefactos de DCP válidos.
- El valor de `publicKeyMultibase` etiqueta base64url como base58btc y no codifica correctamente la clave original para los consumidores de multibase (véanse los límites).
