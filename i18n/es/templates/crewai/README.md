<sub>[English](../../../../templates/crewai/README.md) · [中文](../../../zh-CN/templates/crewai/README.md) · **Español** · [日本語](../../../ja/templates/crewai/README.md) · [Português](../../../pt-BR/templates/crewai/README.md)</sub>

<a id="dcp-ai--crewai-template"></a>
<a id="dcp-ai-crewai-template"></a>

# Plantilla DCP-AI + CrewAI

> Traducción informativa de [la versión en inglés](../../../../templates/crewai/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Muestra el flujo del protocolo DCP v2.0 para tripulaciones multiagente. Esta plantilla simula un flujo de trabajo multiagente al estilo de CrewAI en el que cada agente recibe un pasaporte de DCP y todas las acciones se auditan.

> **Nota:** Esta plantilla muestra las estructuras de datos y el ciclo de vida de DCP sin depender en tiempo de ejecución de las bibliotecas de CrewAI ni de dcp-ai. Es una simulación autónoma en Python pensada como referencia para integrar DCP en tus propios proyectos de CrewAI. Para claves y firmas reales, sigue [docs/QUICKSTART_CREWAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_CREWAI.md).

<a id="quick-start"></a>

## Inicio rápido

1. Instala las dependencias (opcional — la plantilla se ejecuta sin ellas):
   ```bash
   pip install -r requirements.txt
   ```

2. Ejecuta la simulación:
   ```bash
   python main.py
   ```

<a id="what-this-template-does"></a>

## Qué hace esta plantilla

- Simula una tripulación multiagente en la que cada agente tiene un pasaporte de DCP v2.0
- Cada acción de un agente genera una Intent → PolicyDecision → AuditEntry. El paso de política es un esbozo: `evaluate_policy`
  siempre devuelve `approve` (riesgo 75)
- La ejecución de la tripulación produce un Citizenship Bundle con claves y firmas de **marcador de posición** (`«generated»`, `«sig»`): no se firma nada y el bundle no se verifica
- Muestra el flujo de datos de DCP v2.0: nonce de sesión, entradas de claves, manifiesto, campos de firma compuesta

<a id="files"></a>

## Archivos

- `main.py` — simulación del flujo de DCP multiagente (Python autónomo)
- `requirements.txt` — dependencias de Python (para una integración real con CrewAI y el SDK de DCP)

<a id="integrating-with-real-crewai"></a>

## Integración con CrewAI real

Para integrar DCP con una tripulación real de CrewAI, envuelve la ejecución de la tarea de cada agente con el ciclo de vida de DCP que se muestra en `main.py`:

```python
# Fragment: agent and task are your CrewAI objects; DCPCrewMember comes from main.py
from crewai import Agent, Task, Crew

# Use the DCP helpers from main.py to wrap agent actions
member = DCPCrewMember(name="researcher", role="analyst")

# Before each task: declare intent + get policy
intent = member.declare_intent("api_call", "api", "api.openai.com")
policy = member.evaluate_policy(intent)
if policy["decision"] != "approve":
    raise RuntimeError(f"DCP policy decision: {policy['decision']}")  # do not run the task

# Execute the CrewAI task
crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()

# After each task: log audit entry
member.log_action(intent, policy, str(result), "crewai.task")
```
