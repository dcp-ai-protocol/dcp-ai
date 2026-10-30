<sub>[English](../../../docs/QUICKSTART_AGNO.md) · [中文](../../zh-CN/docs/QUICKSTART_AGNO.md) · **Español** · [日本語](../../ja/docs/QUICKSTART_AGNO.md) · [Português](../../pt-BR/docs/QUICKSTART_AGNO.md)</sub>

<a id="quickstart-agno--dcp-ai"></a>
<a id="quickstart-agno-dcp-ai"></a>

# Inicio rápido: Agno + DCP-AI

> Traducción informativa de [la versión en inglés](../../../docs/QUICKSTART_AGNO.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

[Agno](https://www.agno.com/) es un framework y runtime de Python para construir agentes de IA. La integración [`agno-dcp`](https://github.com/dcp-ai-protocol/agno-dcp) envuelve las primitivas `Agent`, `Team`, `Workflow` y MCP de Agno con una gobernanza modelada sobre DCP-01 a DCP-04: un registro de identidad del agente firmado, decisiones de política firmadas, una cadena de auditoría enlazada por hashes con checkpoints de raíz firmados y mensajes MCP firmados.

> **▸ Míralo en marcha:** [agno-dcp-demo.fly.dev](https://agno-dcp-demo.fly.dev) — un flujo de trabajo de cobros bancarios con escenarios de un clic, un registro de auditoría en vivo mediante Server-Sent Events y exportación de un Compliance Bundle firmado. Código fuente: [`dcp-ai-protocol/agno-dcp-demo`](https://github.com/dcp-ai-protocol/agno-dcp-demo).

A diferencia de las demás integraciones de Python (`dcp-ai[fastapi]`, `dcp-ai[langchain]`, ...), `agno-dcp` se distribuye como un **paquete independiente** porque depende de Agno como dependencia par. Requiere `dcp-ai>=2.8.1` y firma con el `sign_object` Ed25519 de ese SDK (canonicalización `dcp-jcs-v1`), así que cada firma que hace puede comprobarse con `verify_object` en cualquier SDK de DCP-AI.

> **Qué produce `agno-dcp` 0.1.0 (comprobado con su código fuente el 25/10/2026).**
>
> * Sus registros (el registro de identidad `CitizenshipBundle`, las entradas y raíces de auditoría, el ZIP de cumplimiento) son formatos de `agno-dcp`. **No** son bundles firmados DCP V1 ni V2, así que `dcp verify-bundle` y `verifySignedBundleV2` no los aceptan. Para producir bundles normativos, usa los inicios rápidos de los SDK ([QUICKSTART.md](../../../docs/QUICKSTART.md)).
> * Sus firmas (registro de identidad, intenciones, decisiones de política, mensajes MCP, raíces selladas, manifiesto de cumplimiento) usan solo Ed25519, diga lo que diga `dcp_security_tier`. `tier-3` y `tier-4` se registran, pero el código 0.1.0 no hace ninguna firma ML-DSA-65, aunque su README describe un híbrido Ed25519 + ML-DSA-65. Las entradas de auditoría no se firman una a una: se enlazan por hashes, y solo las raíces selladas llevan firma.

El código fuente completo, las notas de diseño de extremo a extremo y la referencia de la API están en el repositorio dedicado: <https://github.com/dcp-ai-protocol/agno-dcp>. Esta página es una entrada de 60 segundos.

---

<a id="install"></a>

## Instalación

> **Estado del paquete (25/10/2026).** PyPI tiene una sola versión de `agno-dcp`, la 0.1.0. Es una versión de **acceso anticipado**: su README dice que todavía no se recomienda para despliegues en producción que manejen datos regulados. Los ejemplos de esta página se comprobaron estáticamente contra el código fuente de la 0.1.0 (nombres exportados, argumentos con nombre, opciones de la CLI). No se ejecutaron aquí, porque ejecutarlos requiere Agno y un proveedor de modelos.

```bash
pip install agno-dcp
```

Para producción con almacenamiento respaldado por Postgres:

```bash
pip install "agno-dcp[postgres]"
```

Requiere Python 3.11+. Agno es una dependencia par; instala por separado la versión de Agno que prefieras.

---

<a id="wrap-an-agno-agent"></a>

## Envolver un agente de Agno

Esto es un fragmento: `crm_lookup` y `payment_plan_offer` son tus propias funciones de herramienta de Agno, y `model` se pasa a Agno sin cambios, así que indica un modelo que acepte tu versión de Agno.

```python
import asyncio

from agno_dcp import (
    DCPAgent,
    PolicyEngine,
    MerkleAuditChain,
    SQLiteStorage,
)


async def main() -> None:
    # 1. Storage and audit chain (DCP-03)
    storage = SQLiteStorage("./agent.db")
    audit = MerkleAuditChain(storage=storage)

    # 2. Policy engine from a YAML file (DCP-02)
    policy = PolicyEngine.from_yaml("policies.yaml")

    # 3. Wrap an Agno Agent
    agent = DCPAgent(
        # Native Agno arguments (forwarded as-is)
        name="Collections Agent",
        model="claude:sonnet-4",
        tools=[crm_lookup, payment_plan_offer],
        instructions="You help customers reschedule overdue invoices.",
        # DCP-AI governance arguments
        dcp_human_principal="ops@example.com",
        dcp_security_tier="tier-3",
        dcp_audit_chain=audit,
        dcp_policy_engine=policy,
        dcp_strict_mode=True,
    )
    await agent.dcp_initialize()

    # 4. Run a tool through the full DCP-AI pipeline:
    #    intent + policy gate + tool execution + audit
    result = await agent.run_tool(
        crm_lookup,
        {"customer_id": 12345},
    )

    # 5. Periodically seal a signed root checkpoint
    root = await audit.seal_root()
    print(f"Sealed Merkle root: {root.root_hash}, entries: {root.entry_count}")


asyncio.run(main())
```

El `policies.yaml` correspondiente:

```yaml
version: "1.0"
default: deny
rules:
  - name: "Allow CRM lookups"
    when:
      action_type: tool_call
      tool_name: crm_lookup
    then: allow

  - name: "Limit payment discounts"
    when:
      action_type: tool_call
      tool_name: payment_plan_offer
      payload.discount_pct:
        gt: 20
    then: deny
    reason: "Discounts above 20% require human approval"
```

El comparador admite rutas con puntos (`payload.discount_pct`) y los operadores `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`. Gana la primera regla que coincide; si ninguna coincide, se aplica el veredicto `default`.

---

<a id="what-run_tool-does-under-the-hood"></a>

## Qué hace `run_tool` por dentro

```
DCPAgent.run_tool(tool, args)
  ├── 1. Build and sign IntentDeclaration with the agent's keypair
  ├── 2. PolicyGate.evaluate
  │      ├── verify intent signature
  │      ├── PolicyEngine.evaluate -> signed PolicyDecision
  │      ├── persist intent + decision
  │      └── append INTENT_DECLARED + POLICY_DECISION audit events
  ├── 3. If deny + strict_mode -> raise PolicyDenied
  ├── 4. Execute tool (sync or async)
  ├── 5. Append TOOL_EXECUTED (or ERROR) audit event
  └── 6. Return tool result
```

Modo estricto frente a modo de observación:

* `dcp_strict_mode=True`: un veredicto de denegación lanza `PolicyDenied` y la herramienta no se ejecuta.
* `dcp_strict_mode=False` (por defecto): la denegación se registra y se audita, pero la herramienta se ejecuta igualmente. Útil durante la incorporación, cuando quieres rastros de auditoría antes de tener cobertura de políticas.

---

<a id="teams-and-workflows"></a>

## Equipos y flujos de trabajo

Un fragmento que continúa dentro de la función `async` de arriba (`collections_agent`, `risk_agent` y `evaluate_credit_fn` son tuyos):

```python
from agno_dcp import DCPTeam, DCPWorkflow

team = DCPTeam(
    dcp_team_name="Collections + Risk",
    dcp_human_principal="ops@example.com",
    members=[collections_agent, risk_agent],
    dcp_audit_chain=audit,  # shared chain across the team
)
await team.dcp_initialize()

workflow = DCPWorkflow(
    dcp_workflow_id="escalation",
    dcp_human_principal="ops@example.com",
    dcp_audit_chain=audit,
    dcp_strict_mode=True,
)
await workflow.dcp_initialize()
result = await workflow.run_step("evaluate_credit", evaluate_credit_fn, {"amount": 5000})
```

Un `DCPTeam` hace que sus miembros `DCPAgent` escriban en la cadena de auditoría del equipo. Un `DCPWorkflow` usa la cadena que pases como `dcp_audit_chain`; sin ella, inicia su propia cadena en memoria. Pasar la misma cadena a ambos da a un auditor un único orden de las acciones de los agentes y de la coordinación del equipo.

---

<a id="verify-an-audit-chain-offline"></a>

## Verificar una cadena de auditoría sin conexión

```bash
agno-dcp verify --sqlite ./agent.db
agno-dcp verify --postgres-url $DATABASE_URL --agent-id agent:abc123 --range 0:1000
```

La CLI recalcula cada `entry_hash`, comprueba el enlace `prev_hash` y comprueba la firma de la raíz sellada **más reciente** con la clave pública guardada en esa raíz. Termina con un código distinto de cero cuando la cadena de hashes se rompe o esa firma no es válida.

Un código de salida 0 no es una comprobación completa de las raíces en la 0.1.0:

* solo se examina la raíz más reciente;
* un registro de raíz que no se puede analizar se enumera en `notes` y se omite, y el código de salida ignora `notes`, así que léelas (o usa `--json`);
* la raíz no se compara con las entradas, y su clave no se compara con una en la que confíes. Así que alguien que pueda escribir en la base de datos puede reescribir entradas, recalcular los hashes y sellar una raíz nueva con una clave nueva, y la comprobación sigue pasando. Guarda la clave pública del firmante de la auditoría y las raíces selladas fuera de la base de datos, y compáralas tú.

---

<a id="compliance-bundle-export"></a>

## Exportación del bundle de cumplimiento

Para entregarlo a un auditor, envía un ZIP firmado:

```python
from pathlib import Path
from agno_dcp import ComplianceBundleExporter

exporter = ComplianceBundleExporter(audit, storage)
zip_path = await exporter.export(
    framework="eu_ai_act",   # or "nist_ai_rmf"
    output_dir=Path("./bundles"),
)
```

El archivo contiene el registro de auditoría en orden de índice, todas las raíces de Merkle selladas, los Citizenship Bundles relevantes y la correspondencia con el marco (artículos 12, 13, 14, 15 y 50 del Reglamento de IA de la UE, o subcategorías Govern/Map/Measure/Manage del NIST AI RMF). Su `manifest.json` lleva un hash del contenido del archivo y está firmado con la clave de la cadena de auditoría, de modo que un auditor puede detectar cambios hechos entre la exportación y la revisión.

---

<a id="production-deployment"></a>

## Despliegue en producción

Cambia `SQLiteStorage` por `PostgresStorage` y el código de la aplicación queda idéntico:

```python
import os

from agno_dcp import PostgresStorage  # requires the [postgres] extra

# For example postgresql+psycopg://host/db, with credentials kept out of the code.
storage = PostgresStorage(os.environ["DATABASE_URL"])
await storage.initialize()
audit = MerkleAuditChain(storage=storage)
```

`PostgresStorage` se carga al usarse por primera vez, así que no figura en `agno_dcp.__all__`, pero `from agno_dcp import PostgresStorage` funciona una vez instalado el extra. El esquema idempotente incluido (`agno_dcp/storage/schema.sql`) reutiliza la misma base de datos que aloja las tablas propias de Agno; el prefijo `dcp_*` de cada tabla evita colisiones.

---

<a id="status"></a>

## Estado

`agno-dcp v0.1.0` (abril de 2026) es una versión de **acceso anticipado**, adecuada para evaluación, demostraciones y pilotos internos. Su contrato público es la lista de `agno_dcp/__init__.py`. El README del proyecto enumera DCP-05 a DCP-09 (ciclo de vida, sucesión, disputas, derechos, delegación) y la custodia de claves respaldada por hardware (AWS KMS, GCP Cloud KMS) como trabajo futuro.

Estado del paquete en los registros:

* PyPI: <https://pypi.org/project/agno-dcp/>
* Código fuente: <https://github.com/dcp-ai-protocol/agno-dcp>
* Estado de CI: visible en la pestaña GitHub Actions del repositorio.

---

<a id="further-reading"></a>

## Lecturas adicionales

* [README de agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp#readme) para el inicio rápido completo y la tabla comparativa.
* [`docs/why.md` de agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/why.md) para la propuesta (cuándo adoptarlo y cuándo no).
* [`docs/architecture.md` de agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/architecture.md) para el diagrama por capas y la semántica de los hooks.
* [`docs/compliance_mapping.md` de agno-dcp](https://github.com/dcp-ai-protocol/agno-dcp/blob/main/docs/compliance_mapping.md) para las correspondencias con el Reglamento de IA de la UE y el NIST AI RMF.
* [Especificación DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md) como referencia normativa a nivel de protocolo.
