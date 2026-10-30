<sub>[English](../../../keys/README.md) · **Español** · [Português](../../pt-BR/keys/README.md) · [日本語](../../ja/keys/README.md) · [中文](../../zh-CN/keys/README.md)</sub>

<a id="dcp-key-storage"></a>

# Almacenamiento de claves de DCP

> Traducción informativa de [la versión en inglés](../../../keys/README.md), actualizada el 25/10/2026. Si hay diferencias, prevalece el original inglés. Los identificadores y los bloques de código, incluidos los comentarios, se conservan sin traducir.

Este directorio almacena las claves criptográficas que utilizan las herramientas del protocolo DCP.

<a id="structure"></a>

## Estructura

```
keys/
├── README.md               # This file
├── public_key.txt          # Ed25519 public key (base64) — safe to share
├── secret_key.txt          # Ed25519 secret key (base64) — NEVER commit
├── agent_public_key.txt    # Agent-specific public key (optional)
└── agent_secret_key.txt    # Agent-specific secret key (optional, NEVER commit)
```

<a id="key-generation"></a>

## Generación de claves

`dcp` es la CLI de referencia del checkout (`node bin/dcp.js`). Si no indicas un directorio, escribe en `keys/`, y **en un checkout eso sobrescribe `keys/public_key.txt`, la clave con la que se verifican los ejemplos de conformidad** (`npm run conformance` y CI la utilizan). Indica otro directorio:

```bash
# Ed25519 (V1): public_key.txt and secret_key.txt
node bin/dcp.js keygen my-keys

# Hybrid V2 (Ed25519 + ML-DSA-65): ed25519_public_key.txt, ed25519_secret_key.txt, ed25519_kid.txt,
# ml_dsa_65_public_key.txt, ml_dsa_65_secret_key.txt, ml_dsa_65_kid.txt
node bin/dcp.js keygen --hybrid my-keys
```

Los archivos de claves secretas se escriben con modo `0600`. Los comandos V1 reciben archivos de claves como argumentos (`dcp sign-bundle <bundle.json> <secret_key.txt>`, `dcp verify-bundle <bundle.signed.json> <public_key.txt>`). La clave secreta correspondiente a `keys/public_key.txt` no está en el repositorio.

<a id="security-policy"></a>

## Política de seguridad

- Las **claves privadas** (`secret_key.txt`, `*_secret*`, `*.pem`, `*.key`) se excluyen del control de versiones mediante `.gitignore`.
- Las **claves públicas** pueden incluirse en el repositorio para fines de referencia y verificación.
- En producción, guarda las claves secretas en un módulo de seguridad de hardware (HSM) o en un servicio de gestión de claves, en lugar de hacerlo en el sistema de archivos. Este repositorio no proporciona integración con HSM: esa custodia depende de tu propia infraestructura.
- El material secreto ML-DSA-65 de las claves híbridas V2 sigue la misma política de exclusión.

<a id="key-formats"></a>

## Formatos de claves

| Tipo de clave | Codificación | Tamaño (bytes) |
|----------|----------|-------------|
| Pública Ed25519 | Base64 | 32 |
| Secreta Ed25519 | Base64 | 64 (semilla seguida de la clave pública) |
| Pública ML-DSA-65 | Base64 | 1952 |
| Secreta ML-DSA-65 | Base64 | 4032 |

<a id="deterministic-key-id-kid"></a>

## Identificador de clave determinista (kid)

Las claves V2 utilizan un `kid` determinista derivado del algoritmo y de los bytes de la clave pública:

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]
```

Esto garantiza que la misma clave produzca siempre el mismo `kid` en todas las implementaciones de DCP (`dcp kid <public_key_file> --alg <algorithm>` lo calcula).
