<sub>[English](QUICKSTART_CREWAI.md) · [中文](QUICKSTART_CREWAI.zh-CN.md) · **Español** · [日本語](QUICKSTART_CREWAI.ja.md) · [Português](QUICKSTART_CREWAI.pt-BR.md)</sub>

<a id="dcp-ai--crewai-quick-start"></a>
<a id="dcp-ai-crewai-quick-start"></a>

# DCP-AI + CrewAI: inicio rápido

> Traducción informativa de [la versión en inglés](QUICKSTART_CREWAI.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Añade identidad criptográfica, control por política y rastros de auditoría a tus equipos multiagente de CrewAI.

---

<a id="installation"></a>

## Instalación

```bash
pip install 'dcp-ai[crewai]'
```

El extra `[crewai]` instala el runtime de `crewai`. Los ejemplos de abajo usan directamente el SDK principal; las utilidades de CrewAI propias del SDK, `DCPCrewAgent` y `DCPCrew` en `dcp_ai.crewai`, se describen en [integrations/crewai](../integrations/crewai/README.md).

<a id="zero-config-scaffold-alternative"></a>

### Scaffold sin configuración (alternativa)

```bash
npm create @dcp-ai/crewai my-app
cd my-app
python main.py
```

El generador produce un `main.py` inicial que recorre el flujo DCP con un equipo de tres agentes (nonce de sesión, pasaportes, intenciones, decisiones de política, entradas de auditoría) con claves y firmas de relleno, y un `requirements.txt` con las dependencias comentadas. Se ejecuta sin CrewAI ni el SDK; sustituye los valores de relleno por las llamadas al SDK de abajo.

---

<a id="how-dcp-integrates-with-crewai"></a>

## Cómo se integra DCP con CrewAI

En CrewAI, cada miembro del equipo (agente) obtiene su propia identidad DCP, mientras que todos los agentes comparten un principal humano común a través del Responsible Principal Record. Cada llamada a una herramienta pasa por el control de la política DCP y produce una entrada de auditoría.

```
Crew
  ├─ Agent A (DCP Passport A)
  │    └─ Task → Tool → DCP intent/audit
  ├─ Agent B (DCP Passport B)
  │    └─ Task → Tool → DCP intent/audit
  └─ Shared RPR (human principal)
       └─ Citizenship Bundle per tool call (RPR + the acting agent's passport)
```

---

<a id="complete-working-example"></a>

## Ejemplo completo funcional

```python
import uuid
from datetime import datetime, timezone

from crewai import Agent, Task, Crew, Process
from crewai.tools import tool
from dcp_ai import (
    AgentPassport,
    AuditEvidence,
    BundleBuilder,
    Intent,
    PolicyDecision,
    ResponsiblePrincipalRecord,
    generate_keypair,
    sign_bundle,
    sign_object,
    verify_object,
    verify_signed_bundle,
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


# 1. Initialize the shared human principal: the RPR is signed with the operator's key,
#    over the object without its "signature" field
operator_keys = generate_keypair()
human_id = "did:human:crew-operator-001"

rpr_body = {
    "dcp_version": "1.0",
    "human_id": human_id,
    "legal_name": "Crew Operator",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": now(),
    "expires_at": None,
    "contact": None,
}
rpr = ResponsiblePrincipalRecord(**rpr_body, signature=sign_object(rpr_body, operator_keys["secret_key_b64"]))


# 2. Create per-agent DCP passports, each with its own key
def create_passport(agent_name: str, capabilities: list[str]) -> AgentPassport:
    agent_keys = generate_keypair()
    passport_body = {
        "dcp_version": "1.0",
        "agent_id": f"did:agent:crew-{agent_name}",
        "public_key": agent_keys["public_key_b64"],
        "principal_binding_reference": human_id,
        "capabilities": capabilities,
        "risk_tier": "low",
        "created_at": now(),
        "status": "active",
    }
    # Signed over the object without its "signature" field
    return AgentPassport(**passport_body, signature=sign_object(passport_body, agent_keys["secret_key_b64"]))


researcher_passport = create_passport("researcher", ["browse", "api_call"])
writer_passport = create_passport("writer", ["file_write"])  # for the writer's own DCP-gated tools


# 3. The policy gate: your rules decide before the tool runs
def evaluate_policy(intent: Intent) -> PolicyDecision:
    """Approve low-impact actions on public data; anything else waits for a human."""
    low_risk = intent.estimated_impact == "low" and intent.data_classes == ["none"]
    return PolicyDecision(
        intent_id=intent.intent_id,
        decision="approve" if low_risk else "escalate",
        risk_score=0.05 if low_risk else 0.6,
        reasons=["low-impact action on public data" if low_risk else "needs human approval"],
        required_confirmation=None if low_risk else {"type": "human_approve", "fields": ["action_type"]},
    )


bundles = []  # one sealed bundle per tool call


# 4. Create a DCP-gated tool
@tool("search_web")
def search_web(query: str) -> str:
    """Search the web for information."""
    intent = Intent(
        intent_id=f"intent:{uuid.uuid4()}",
        agent_id=researcher_passport.agent_id,
        human_id=human_id,
        timestamp=now(),
        action_type="browse",
        target={"channel": "web"},  # the query itself stays out of the record
        data_classes=["none"],
        estimated_impact="low",
        requires_consent=False,
    )

    policy = evaluate_policy(intent)
    # Your own policy may also return "block": the audit entry records each decision as it is
    audit_decision, outcome = {
        "approve": ("approved", "search_completed"),
        "escalate": ("escalated", "awaiting_human_approval"),
        "block": ("blocked", "action_blocked"),
    }[policy.decision]

    # Execute only what the policy approved
    result = f"Search results for: {query}" if policy.decision == "approve" else f"Not run (DCP policy: {policy.decision})."

    # Log the audit entry (intent_hash and the prev_hash chain are computed for you) and seal the bundle
    bundle = (
        BundleBuilder()
        .responsible_principal_record(rpr)
        .agent_passport(researcher_passport)
        .intent(intent)
        .policy_decision(policy)
        .create_audit_entry(
            audit_id=f"audit:{uuid.uuid4()}",
            timestamp=now(),
            agent_id=researcher_passport.agent_id,
            human_id=human_id,
            intent_id=intent.intent_id,
            policy_decision=audit_decision,
            outcome=outcome,
            evidence=AuditEvidence(tool="search_web", result_ref=None),
        )
        .build()
    )
    bundles.append(sign_bundle(bundle, operator_keys["secret_key_b64"]))

    return result


# 5. Define CrewAI agents
researcher = Agent(
    role="Research Analyst",
    goal="Find accurate information on the given topic",
    backstory="You are a thorough researcher with DCP-verified identity.",
    tools=[search_web],
    verbose=True,
)

writer = Agent(
    role="Content Writer",
    goal="Write clear, concise content based on research",
    backstory="You produce DCP-audited content with full traceability.",
    verbose=True,
)

# 6. Define tasks
research_task = Task(
    description="Research the topic: {topic}",
    agent=researcher,
    expected_output="A summary of findings",
)

writing_task = Task(
    description="Write a brief article based on the research",
    agent=writer,
    expected_output="A short article",
)

# 7. Run the crew
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,
    verbose=True,
)

result = crew.kickoff(inputs={"topic": "post-quantum cryptography"})

# 8. Verify the sealed DCP bundles
for signed in bundles:
    verification = verify_signed_bundle(signed, operator_keys["public_key_b64"])  # pin the operator's key
    print(f"{signed['bundle']['intent']['intent_id']}: verified={verification['verified']}")
print(f"Bundles: {len(bundles)}")

# verify_signed_bundle does not check the RPR and passport signatures: check them over the objects
# without their "signature" field, against the operator's and the agent's keys
print(verify_object(rpr.model_dump(exclude={"signature"}), rpr.signature, operator_keys["public_key_b64"]))
print(verify_object(researcher_passport.model_dump(exclude={"signature"}), researcher_passport.signature, researcher_passport.public_key))
```

---

<a id="dcp-integration-points"></a>

## Puntos de integración de DCP

| Concepto de CrewAI | Correspondencia en DCP |
|----------------|-------------|
| Operador del equipo | Responsible Principal Record (RPR) |
| Agente | Agent Passport (único por miembro del equipo) |
| Uso de herramientas | Intención → control por política → entrada de auditoría |
| Finalización de tareas | Entradas de auditoría con evidencias |
| Ejecución del equipo | Citizenship Bundles, uno por llamada a herramienta, todos vinculados al mismo RPR |

---

<a id="multi-agent-audit"></a>

## Auditoría multiagente

Cada entrada de auditoría nombra al agente que actuó. Da a cada miembro del equipo que use herramientas su propio pasaporte y herramientas controladas por DCP, y los bundles mostrarán qué agente hizo qué, todos vinculados al mismo principal humano:

```python
# Each audit entry names the agent that acted and what came of it
for signed in bundles:
    for entry in signed["bundle"]["audit_entries"]:
        print(f"Agent: {entry['agent_id']}")
        print(f"Outcome: {entry['outcome']}")
```

---

<a id="v20-upgrade"></a>

## Actualización a V2.0

DCP v2.0 añade a los equipos de CrewAI firmas compuestas poscuánticas, niveles de seguridad adaptativos y rastros de auditoría vinculados a la sesión. El SDK de Python incluye la ruta V2 desde la versión 2.9.0: claves híbridas (Ed25519 + ML-DSA-65) en `dcp_ai.providers`, y `BundleBuilderV2`, `sign_bundle_v2` y `verify_signed_bundle_v2` en `dcp_ai.v2`.

<a id="installation-v2"></a>

### Instalación (V2)

```bash
pip install 'dcp-ai[crewai]>=2.9.0'
```

<a id="v2-crew-setup-with-security-tiers"></a>

### Configuración del equipo V2 con niveles de seguridad

```python
import asyncio
import base64
import uuid
from datetime import datetime, timezone

from crewai import Agent, Crew, Task
from crewai.tools import tool
from dcp_ai.providers.ed25519_provider import Ed25519Provider
from dcp_ai.providers.ml_dsa_65_provider import MlDsa65Provider
from dcp_ai.v2 import (
    DCP_CONTEXTS,
    DEFAULT_VERIFIER_POLICY,
    AlgorithmRegistry,
    BundleBuilderV2,
    CompositeKeyInfo,
    canonicalize_v2,
    composite_sign,
    compute_security_tier,
    derive_kid,
    generate_session_expiry,
    generate_session_nonce,
    prepare_payload,
    sha256_hex,
    sign_bundle_v2,
    verify_signed_bundle_v2,
)

registry = AlgorithmRegistry()
registry.register_signer(Ed25519Provider())
registry.register_signer(MlDsa65Provider())


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def hybrid_keys() -> list[CompositeKeyInfo]:
    """[classical, pq]: an Ed25519 key and an ML-DSA-65 key."""
    keys = []
    for alg in ("ed25519", "ml-dsa-65"):
        k = await registry.get_signer(alg).generate_keypair()
        keys.append(CompositeKeyInfo(k["kid"], alg, k["secret_key_b64"], k["public_key_b64"]))
    return keys


def key_entries(keys: list[CompositeKeyInfo], at: str) -> list[dict]:
    return [
        {"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64,
         "created_at": at, "expires_at": None, "status": "active"}
        for k in keys
    ]


async def sign(payload: dict, context: str, keys: list[CompositeKeyInfo]) -> dict:
    """A SignedPayload: the payload, its hash and a composite signature under its context."""
    canonical, payload_hash = prepare_payload(payload)
    sig = await composite_sign(registry, DCP_CONTEXTS[context], canonical, *keys)
    return {"payload": payload, "payload_hash": payload_hash, "composite_sig": sig}


# Both key pairs live in one process here; in production the operator signs on its own side.
operator_keys = asyncio.run(hybrid_keys())    # the crew operator signs the RPR and the bundles
researcher_keys = asyncio.run(hybrid_keys())  # the researcher agent signs its passport, intents and decisions
session_nonce = generate_session_nonce()      # every artifact of this crew run carries it
human_id = "rpr:crew-operator-001"
agent_id = "agent:crew-researcher"
at = now()

rpr = {
    "dcp_version": "2.0",
    "human_id": human_id,
    "session_nonce": session_nonce,
    "legal_name": "Crew Operator",
    "entity_type": "natural_person",
    "jurisdiction": "US-CA",
    "liability_mode": "owner_responsible",
    "override_rights": True,
    "issued_at": at,
    "expires_at": None,
    "binding_keys": key_entries(operator_keys, at),
}

researcher_passport = {
    "dcp_version": "2.0",
    "agent_id": agent_id,
    "session_nonce": session_nonce,
    "keys": key_entries(researcher_keys, at),
    "principal_binding_reference": human_id,
    "capabilities": ["browse"],
    "risk_tier": "low",
    "created_at": at,
    "status": "active",
}
```

<a id="v2-dcp-gated-tool-with-security-tiers"></a>

### Herramienta V2 controlada por DCP con niveles de seguridad

La herramienta declara una intención, consulta el control por política, ejecuta solo lo que este aprobó y escribe la entrada de auditoría. Los artefactos se firman cuando se sella la ejecución, más abajo; para firmar cada intención antes de actuar, llama a `sign` desde tu propio bucle de eventos dentro de la herramienta.

```python
records = []  # one {"intent", "policy", "audit"} per tool call


def evaluate_policy(intent: dict) -> tuple[str, int]:
    """Your policy engine: (decision, risk_score in 0..1000)."""
    if intent["estimated_impact"] == "low" and intent["data_classes"] == ["none"]:
        return "approve", 50
    return "escalate", 600


@tool("search_web_v2")
def search_web_v2(query: str) -> str:
    """Search the web with a DCP V2 audit trail."""
    intent = {
        "dcp_version": "2.0",
        "intent_id": f"intent:{uuid.uuid4()}",
        "session_nonce": session_nonce,
        "agent_id": agent_id,
        "human_id": human_id,
        "timestamp": now(),
        "action_type": "browse",
        "target": {"channel": "web"},  # the query itself stays out of the record
        "data_classes": ["none"],
        "estimated_impact": "low",
        "requires_consent": False,
    }

    decision, risk_score = evaluate_policy(intent)
    # Adaptive security tier (spec §14.2) from the intent and the policy's risk score
    tier = compute_security_tier(intent, {"risk_score": risk_score})  # "routine" here
    intent["security_tier"] = tier

    policy = {
        "dcp_version": "2.0",
        "intent_id": intent["intent_id"],
        "session_nonce": session_nonce,
        "decision": decision,
        "risk_score": risk_score,
        "reasons": [{"approve": "low-impact action on public data", "escalate": "needs human approval", "block": "not allowed"}[decision]],
        "required_confirmation": {"type": "human_approve", "fields": ["action_type"]} if decision == "escalate" else None,
        "applied_policy_hash": f"sha256:{sha256_hex(b'crew-policy-v1')}",
        "timestamp": now(),
        "resolved_tier": tier,
    }

    # Execute only what the policy approved; your own policy may also return "block"
    audit_decision, outcome = {
        "approve": ("approved", "search_completed"),
        "escalate": ("escalated", "awaiting_human_approval"),
        "block": ("blocked", "action_blocked"),
    }[decision]
    result = f"Search results for: {query}" if decision == "approve" else f"Not run (DCP policy: {decision})."

    audit = {
        "dcp_version": "2.0",
        "audit_id": f"audit:{uuid.uuid4()}",
        "session_nonce": session_nonce,
        "prev_hash": "GENESIS",  # first entry of this intent's trail
        "hash_alg": "sha256",
        "timestamp": now(),
        "agent_id": agent_id,
        "human_id": human_id,
        "intent_id": intent["intent_id"],
        "intent_hash": f"sha256:{sha256_hex(canonicalize_v2(intent).encode())}",
        "policy_decision": audit_decision,
        "outcome": outcome,
        # A real tool's output hash goes in evidence_hash; this toy result would reveal the query.
        "evidence": {"tool": "search_web_v2", "result_ref": None, "evidence_hash": None},
        "pq_checkpoint_ref": None,
    }

    records.append({"intent": intent, "policy": policy, "audit": audit})
    return result


researcher = Agent(
    role="Research Analyst",
    goal="Find accurate information on the given topic",
    backstory="You are a thorough researcher with a DCP V2 identity.",
    tools=[search_web_v2],
)
research_task = Task(
    description="Research the topic: {topic}",
    agent=researcher,
    expected_output="A summary of findings",
)
Crew(agents=[researcher], tasks=[research_task]).kickoff(inputs={"topic": "post-quantum cryptography"})
```

<a id="v2-bundle-sealing-with-composite-signatures"></a>

### Sellado de bundles V2 con firmas compuestas

Tras la ejecución del equipo, cada llamada a herramienta se convierte en un citizenship bundle: su intención, su decisión de política y su entrada de auditoría, con el RPR y el pasaporte, unidos por un manifiesto que el operador firma con Ed25519 + ML-DSA-65.

```python
async def seal() -> list[dict]:
    signed_rpr = await sign(rpr, "ResponsiblePrincipal", operator_keys)
    signed_passport = await sign(researcher_passport, "AgentPassport", researcher_keys)
    bundles = []
    for record in records:
        bundle = (
            BundleBuilderV2(session_nonce)
            .responsible_principal_record(signed_rpr)
            .agent_passport(signed_passport)
            .intent(await sign(record["intent"], "Intent", researcher_keys))
            .policy_decision(await sign(record["policy"], "PolicyDecision", researcher_keys))
            .add_audit_entry(record["audit"])
            .build()
        )
        bundles.append(await sign_bundle_v2(
            bundle, registry, "human", human_id, *operator_keys,
            session_expires_at=generate_session_expiry(tier=record["intent"]["security_tier"]),
        ))
    return bundles


signed_bundles = asyncio.run(seal())
```

<a id="v2-verification-pinned-to-the-operator"></a>

### Verificación V2 anclada al operador

`verify_signed_bundle_v2` comprueba un bundle con las claves que lleva el propio bundle, así que un bundle que otra persona firmó con sus propias claves también es coherente consigo mismo. Quien verifica los bundles del equipo fija el firmante: el operador publica el hash de su RPR y sus kids, y un bundle debe llevar ese RPR y nombrar esos kids. Además, cada kid debe derivarse de su clave pública (spec/VERIFICATION.md V2-13). El verificador de este repositorio lo comprueba, pero la versión dcp-ai 2.9.0 de PyPI no, así que la guía también lo comprueba. Una política `hybrid_required` exige ambas firmas, ya que la política por defecto acepta una firma Ed25519 sin firma poscuántica en el nivel routine, y los bundles deben llevar una caducidad de sesión.

`verified` cubre la integridad y el firmante; si la acción se aprobó lo dice la decisión de política que contiene el bundle.

```python
# What the operator publishes to anyone who verifies the crew's bundles
TRUSTED_RPR_HASH = prepare_payload(rpr)[1]
TRUSTED_KIDS = [k.kid for k in operator_keys]

HYBRID_REQUIRED = {
    **DEFAULT_VERIFIER_POLICY,
    "default_mode": "hybrid_required",
    "risk_overrides": dict.fromkeys(("low", "medium", "high"), "hybrid_required"),
    "require_session_expiry": True,
}


def kid_matches_key(entry: dict) -> bool:
    """spec/VERIFICATION.md V2-13: a kid is derived from its algorithm and public key."""
    try:
        public_key = base64.b64decode(entry["public_key_b64"], validate=True)
        return entry["kid"] == derive_kid(entry["alg"], public_key)
    except Exception:
        return False


async def verify_crew_bundle(signed: dict) -> bool:
    """Valid, signed with both algorithms, and signed by the operator."""
    result = await verify_signed_bundle_v2(signed, registry, HYBRID_REQUIRED)
    if not result["verified"]:
        return False
    # Verified under hybrid_required, so both signatures are there: check whose they are.
    bundle = signed["bundle"]
    composite = signed["signature"]["composite_sig"]
    keys = bundle["agent_passport"]["payload"]["keys"] + bundle["responsible_principal_record"]["payload"]["binding_keys"]
    return (
        bundle["responsible_principal_record"]["payload_hash"] == TRUSTED_RPR_HASH
        and [composite["classical"]["kid"], composite["pq"]["kid"]] == TRUSTED_KIDS
        and all(kid_matches_key(k) for k in keys)
    )


for signed in signed_bundles:
    intent = signed["bundle"]["intent"]["payload"]
    decision = signed["bundle"]["policy_decision"]["payload"]["decision"]
    print(f"{intent['intent_id']}: verified={asyncio.run(verify_crew_bundle(signed))}, "
          f"decision={decision}, tier={intent['security_tier']}")
```

Fuera de Python, guarda un bundle como JSON y fija la clave pública Ed25519 del operador (`operator_keys[0].public_key_b64`) en un archivo. La CLI de referencia se ejecuta desde una copia de este repositorio tras `npm install`; el comando `dcp` que instala `pip install dcp-ai` es la CLI de Python, que no tiene `verify-bundle`:

```bash
node bin/dcp.js verify-bundle --policy hybrid_required bundle.json operator_ed25519_pub.txt
```

Los mismos bundles verifican con los SDK de TypeScript, Go y Rust.

<a id="v2-dcp-integration-points-for-crewai"></a>

### Puntos de integración de DCP V2 para CrewAI

| Concepto de CrewAI | Correspondencia en DCP V1 | Añadidos de DCP V2 |
|----------------|---------------|-----------------|
| Operador del equipo | RPR | RPR con `binding_keys` (Ed25519 + ML-DSA-65) |
| Agente | Agent Passport | Pasaporte con claves híbridas |
| Uso de herramientas | Intención → política → auditoría | + risk_score entero, nivel de seguridad, nonce de sesión |
| Finalización de tareas | Entradas de auditoría | + checkpoints PQ según el nivel |
| Ejecución del equipo | Citizenship Bundles, uno por llamada a herramienta | + manifiesto, session_nonce, firma compuesta, caducidad de sesión |

Véase [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) para actualizar integraciones V1 existentes con CrewAI.

---

<a id="next-steps"></a>

## Siguientes pasos

- **[Inicio rápido principal](./QUICKSTART.md)** — Uso básico del SDK
- **[Integración con LangChain](./QUICKSTART_LANGCHAIN.md)** — Guía específica de LangChain
- **[Referencia de la API](./API_REFERENCE.md)** — Documentación completa del SDK
