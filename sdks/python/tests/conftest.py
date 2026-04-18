"""Pytest configuration for the dcp-ai Python SDK.

Prior to v2.0.1, framework bridges (fastapi, langchain, openai, crewai)
lived outside the package under /integrations and were loaded here via
sys.modules gymnastics. From v2.0.1 they ship inside dcp_ai itself
(dcp_ai.fastapi, dcp_ai.langchain, ...), so this file intentionally has
no module-wiring hacks; normal `from dcp_ai.fastapi import ...` works.
"""
