<sub>[English](README.md) · [中文](README.zh-CN.md) · **Español** · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--openai-function-calling-template"></a>
<a id="dcp-ai-openai-function-calling-template"></a>

# Plantilla DCP-AI + llamada a funciones de OpenAI

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Un recorrido por el flujo de DCP alrededor de la llamada a funciones de OpenAI.

> **Un recorrido, no un firmante.** Las claves y firmas de `index.js` son marcadores de posición (`«generated»`, `«sig»`): la plantilla muestra la forma del flujo de DCP v2.0, pero no genera claves, no firma nada y sus bundles no se verifican. No lee nada de `.dcp/`. Para claves y firmas reales, sigue [docs/QUICKSTART_OPENAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_OPENAI.md).

<a id="quick-start"></a>

## Inicio rápido

1. Instala las dependencias:
   ```bash
   npm install
   ```

2. Ejecútala. Con `OPENAI_API_KEY`, la plantilla llama a la API de OpenAI (facturada por OpenAI). Si esa primera llamada falla por cualquier motivo (sin clave, red, cuota, modelo), recurre a llamadas a funciones simuladas; el mensaje que imprime sobre la falta de clave no diagnostica la causa. Fija la clave en tu entorno, no en el comando:
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## Qué hace esta plantilla

- Registra herramientas que conocen DCP como funciones de OpenAI
- Cada llamada a función crea una Intent de DCP antes de ejecutarse; el paso de política es un esbozo que siempre devuelve `approve`
  (riesgo 120), así que la rama "blocked by policy" no se alcanza
- Las herramientas (`lookupWeather`, `sendEmail`, `searchWeb`) siempre devuelven datos simulados, incluso cuando se llama al modelo de
  verdad: sus resultados y sus entradas de auditoría no demuestran que se haya realizado ninguna acción externa
- Cada respuesta recibe una entrada de auditoría, encadenada por hash a la anterior
- Tras la conversación se imprime un Citizenship Bundle con firmas de marcador de posición

<a id="files"></a>

## Archivos

- `index.js` — llamada a funciones de OpenAI con el flujo de DCP
- `package.json` — dependencias
