<sub>[English](../../../../templates/langchain/README.md) · [中文](../../../zh-CN/templates/langchain/README.md) · **Español** · [日本語](../../../ja/templates/langchain/README.md) · [Português](../../../pt-BR/templates/langchain/README.md)</sub>

<a id="dcp-ai--langchain-template"></a>
<a id="dcp-ai-langchain-template"></a>

# Plantilla DCP-AI + LangChain

> Traducción informativa de [la versión en inglés](../../../../templates/langchain/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Un recorrido por el flujo de DCP alrededor de una llamada de LangChain.

> **Un recorrido, no un firmante.** Las claves y firmas de `index.js` son marcadores de posición (`«generated»`, `«sig»`): la plantilla muestra la forma del flujo de DCP v2.0, pero no genera claves, no firma nada y sus bundles no se verifican. No lee nada de `.dcp/`. Para claves y firmas reales, sigue [docs/QUICKSTART_LANGCHAIN.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_LANGCHAIN.md).

La plantilla fija LangChain.js 0.3 (`langchain` y `@langchain/openai` `^0.3.0`); la guía muestra la API actual de LangChain.js v1.

<a id="quick-start"></a>

## Inicio rápido

1. Instala las dependencias:
   ```bash
   npm install
   ```

2. Ejecútala. Con `OPENAI_API_KEY`, la plantilla llama a la API de OpenAI (facturada por OpenAI). Si la llamada falla por cualquier motivo (sin clave, red, cuota, modelo), imprime una respuesta simulada y aun así registra `outcome: "success"`, así que la entrada de auditoría no demuestra que la llamada tuviera éxito. Fija la clave en tu entorno:
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## Qué hace esta plantilla

- Envuelve una llamada de LangChain en el flujo de DCP
- Cada acción se declara como una Intent; el paso de política es un esbozo que siempre devuelve `approve` (riesgo 50), así que las
  ramas de escalado y bloqueo muestran el flujo pero no se alcanzan
- Cada respuesta recibe una entrada de auditoría
- El Citizenship Bundle del agente lleva firmas de marcador de posición

<a id="files"></a>

## Archivos

- `index.js` — llamada de LangChain con el flujo de DCP
- `package.json` — dependencias
