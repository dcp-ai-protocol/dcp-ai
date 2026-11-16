<sub>[English](../../../templates/README.md) · [中文](../../zh-CN/templates/README.md) · **Español** · [日本語](../../ja/templates/README.md) · [Português](../../pt-BR/templates/README.md)</sub>

<a id="templates"></a>

# Plantillas

> Traducción informativa de [la versión en inglés](../../../templates/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Plantillas de inicio que muestran dónde encaja DCP en frameworks de IA y servidores web populares: identidad, declaración de intención, control por política, registro de auditoría y sellado del bundle.

> **Recorridos, no firmantes.** Las plantillas usan claves y firmas de marcador de posición (`«generated»`, `«sig»`): no generan claves, no firman nada y sus bundles no se verifican. El middleware de la plantilla de Express solo comprueba la estructura del bundle, no las firmas. Para claves, firmas y verificación reales, sigue las guías de inicio rápido de [docs/](../../../docs/README.md). Las mismas plantillas se distribuyen como `npm create @dcp-ai/<name>` (`packages/create-*`).

<a id="available-templates"></a>

## Plantillas disponibles

| Plantilla | Lenguaje | Descripción |
|----------|----------|-------------|
| [express/](../../../templates/express/) | Node.js | Servidor Express con una comprobación estructural de DCP (sin verificación de firmas) y endpoints de descubrimiento |
| [openai/](../../../templates/openai/) | Node.js | Llamada a funciones de OpenAI envuelta con intención/política/auditoría de DCP |
| [langchain/](../../../templates/langchain/) | Node.js | Llamada de LangChain.js 0.3 envuelta en el flujo de DCP |
| [crewai/](../../../templates/crewai/) | Python | Simulación de una tripulación multiagente con pasaportes y registro de auditoría de DCP |

<a id="quick-start"></a>

## Inicio rápido

Cada plantilla puede ejecutarse por separado, desde la raíz del repositorio (cada comando se ejecuta en una subshell, así que el siguiente
vuelve a empezar desde la raíz). El servidor Express se queda en primer plano: detenlo con Ctrl+C antes del siguiente.

```bash
# Express
(cd templates/express && npm install && npm start)

# OpenAI (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/openai && npm install && npm start)

# LangChain (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/langchain && npm install && npm start)

# CrewAI (standalone Python)
(cd templates/crewai && python main.py)
```

<a id="dcp-lifecycle"></a>

## Ciclo de vida de DCP

En conjunto, las plantillas ilustran este flujo conceptual de DCP v2.0; cada una cubre solo una parte (la plantilla de
Express, por ejemplo, no crea ninguna identidad, no sella ningún bundle ni ejecuta ninguna acción):

1. **Iniciar la sesión** — generar un nonce de sesión de 256 bits; los pares de claves duales (Ed25519 + ML-DSA-65) son marcadores de posición
2. **Crear el RPR** — vincular el agente de IA a un principal humano responsable
3. **Emitir el pasaporte** — declarar las capacidades y el nivel de riesgo del agente
4. **Declarar la intención** — antes de cada acción, declarar lo que el agente quiere hacer
5. **Controlar por política** — evaluar la puntuación de riesgo y obtener una decisión approve/escalate/block. En las plantillas este paso es un
   esbozo que siempre devuelve `approve`; la plantilla de Express no tiene paso de política y solo comprueba las capacidades
   autodeclaradas del bundle
6. **Ejecutar la acción** — continuar solo si la política la aprueba
7. **Registrar la auditoría** — registrar la acción en un registro de auditoría encadenado por hash
8. **Sellar el bundle** — reunir todos los artefactos en un Citizenship Bundle, con firmas compuestas de marcador de posición

<a id="see-also"></a>

## Véase también

- [Guía de inicio rápido](../../../docs/QUICKSTART.md)
- [Referencia de la API](../../../docs/API_REFERENCE.md)
- [Guía de migración (V1 a V2)](../../../docs/MIGRATION_V1_V2.md)
