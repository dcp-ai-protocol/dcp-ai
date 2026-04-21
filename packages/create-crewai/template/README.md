# DCP-AI + CrewAI Template

Demonstrates the DCP v2.0 protocol flow for multi-agent crews. This template simulates a CrewAI-style multi-agent workflow where every agent receives a DCP passport and all actions are audited.

> **Note:** This template demonstrates the DCP data structures and lifecycle without depending on the CrewAI or dcp-ai libraries at runtime. It is a standalone Python simulation intended as a reference for integrating DCP into your own CrewAI projects.

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
- Each agent action generates an Intent → PolicyDecision → AuditEntry
- The full crew execution produces a signed Citizenship Bundle with composite signatures
- Demonstrates the complete DCP v2.0 data flow: session nonce, dual keys, manifest, composite signatures

## Files

- `main.py` — Multi-agent DCP flow simulation (standalone Python)
- `requirements.txt` — Python dependencies (for real CrewAI + DCP SDK integration)

## Integrating with real CrewAI

To integrate DCP with a real CrewAI crew, wrap each agent's task execution with the DCP lifecycle shown in `main.py`:

```python
from crewai import Agent, Task, Crew

# Use the DCP helpers from main.py to wrap agent actions
member = DCPCrewMember(name="researcher", role="analyst")

# Before each task: declare intent + get policy
intent = member.declare_intent("api_call", "api", "api.openai.com")
policy = member.evaluate_policy(intent)

# Execute the CrewAI task
crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()

# After each task: log audit entry
member.log_action(intent, policy, str(result), "crewai.task")
```
