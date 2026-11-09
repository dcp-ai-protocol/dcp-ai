<sub>[English](../../../cli/README.md) · [中文](../../zh-CN/cli/README.md) · **Español** · [日本語](../../ja/cli/README.md) · [Português](../../pt-BR/cli/README.md)</sub>

# @dcp-ai/cli

> Traducción informativa de [la versión en inglés](../../../cli/README.md), actualizada el 09/11/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Herramienta de línea de comandos del Digital Citizenship Protocol para agentes de IA (DCP-AI). `dcp-ai verify` comprueba las firmas y la estructura de un archivo de bundle, y `dcp-init` prepara un directorio para un agente. Necesita Node.js 18 o posterior.

<a id="installation"></a>

## Instalación

```bash
npm install -g @dcp-ai/cli@^2.2.0
dcp-ai --version
```

La versión 2.2.0 requiere `@dcp-ai/sdk` `^2.4.0`, que npm instala con ella. Para las versiones disponibles en el registro, véase [Versiones publicadas](../../../docs/README.md#published-versions).

<a id="commands"></a>

## Comandos

| Comando | Qué hace |
|---|---|
| `dcp-ai verify <bundle.json>` | Verifica un archivo de bundle: un bundle V2 con el verificador V2 normativo de `@dcp-ai/sdk`, un archivo V1 con su firma Ed25519 sobre el bundle canónico |
| `dcp-ai init` | Ejecuta el asistente `dcp-init` en el directorio actual |
| `dcp-ai status` | Muestra la configuración encontrada en `.dcp/` |
| `dcp-ai sign <bundle.json>` | Firma un bundle con las claves de `.dcp/` |
| `dcp-ai info` | Muestra la versión del protocolo y las capacidades |
| `dcp-ai --version` | Imprime la versión de la CLI y la del protocolo |

<a id="verification-and-exit-codes"></a>

## Verificación y códigos de salida

`dcp-ai verify` sale con 0 cuando el bundle es VALID. Sale con 1 cuando el bundle es INVALID, cuando el archivo no se puede leer o analizar, y ante el sobre V2 prenormativo. Busca un directorio `.dcp/` en el directorio actual y luego en cada directorio superior: una clave en `.dcp/keys/ed25519_public.key` fija el firmante esperado, y sin ella las claves salen del propio bundle.

VALID es un resultado solo sobre firmas y estructura. No establece que el principal sea de confianza, no es una decisión de admisión con un conjunto de confianza o un perfil, y no autoriza ninguna acción; esos son pasos aparte de la aplicación (véase [ADMISSION.md](../docs/ADMISSION.md)).

<a id="ed25519-p-ed-1-in-220"></a>

## Ed25519 P-ED-1 en la 2.2.0

`dcp-ai verify` rechaza una firma Ed25519 cuya clave pública o R no sea una codificación canónica, o sea un punto de orden divisor de 8, además de una con S ≥ L: imprime INVALID y sale con 1. Conserva la evidencia que falla tal como está; vuelve a firmar con la misma clave si cumple P-ED-1, rota una clave pública no canónica y sustituye una clave de orden pequeño. Véanse el [registro de cambios](../../../CHANGELOG.md#unreleased) y el [perfil criptográfico](../spec/profiles/crypto/README.md).

<a id="limits"></a>

## Límites

- La CLI no ejecuta admisión, cadenas de mandatos ni activación, y no autoriza ninguna acción.
- `dcp-ai init` y `dcp-ai sign` guardan claves privadas en `.dcp/` del directorio actual. Mantén ese directorio fuera del control de versiones y lejos de ubicaciones compartidas.
- [TESTING.md](TESTING.md) explica cómo el repositorio prueba la CLI contra el SDK compilado desde el mismo checkout.
