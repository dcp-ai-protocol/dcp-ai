# DCP-AI + CrewAI Template

Demonstrates the DCP v2.0 protocol flow for multi-agent crews. This template simulates a CrewAI-style multi-agent workflow where every agent receives a DCP passport and all actions are audited.

> **Note:** This template demonstrates the DCP data structures and lifecycle without depending on the CrewAI or dcp-ai libraries at runtime. It is a standalone Python simulation intended as a reference for integrating DCP into your own CrewAI projects. For real keys and signatures, follow [docs/QUICKSTART_CREWAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_CREWAI.md).

## Quick Start

1. Install dependencies (optional — the template runs without them):
   ```bash
   pip install -r requirements.txt
   ```

2. Run the simulation:
   ```bash
   python main.py
   ```

## What this template does

- Simulates a multi-agent crew where every agent has a DCP v2.0 passport
- Each agent action generates an Intent → PolicyDecision → AuditEntry. The policy step is a stub: `evaluate_policy`
  always returns `approve` (risk 75)
- The crew execution produces a Citizenship Bundle with **placeholder** keys and signatures (`«generated»`, `«sig»`): nothing is signed, and the bundle does not verify
- Shows the DCP v2.0 data flow: session nonce, key entries, manifest, composite signature fields

## Files

- `main.py` — Multi-agent DCP flow simulation (standalone Python)
- `requirements.txt` — Python dependencies (for real CrewAI + DCP SDK integration)

## Integrating with real CrewAI

To integrate DCP with a real CrewAI crew, wrap each agent's task execution with the DCP lifecycle shown in `main.py`:

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
