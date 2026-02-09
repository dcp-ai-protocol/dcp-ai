"""
JSON Schema validation for DCP artifacts.
Uses jsonschema with Draft 2020-12 support.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
from jsonschema import Draft202012Validator

# Load schemas from the repository
_SCHEMAS_DIR = Path(__file__).parent.parent.parent.parent / "schemas" / "v1"
_schema_store: dict[str, Any] = {}


def _load_schemas() -> None:
    """Load all v1 schemas into the schema store."""
    global _schema_store
    if _schema_store:
        return
    if not _SCHEMAS_DIR.exists():
        return
    for f in _SCHEMAS_DIR.glob("*.schema.json"):
        schema = json.loads(f.read_text())
        if "$id" in schema:
            _schema_store[schema["$id"]] = schema


def _get_validator(schema_name: str) -> Draft202012Validator | None:
    """Get a validator for a named DCP schema."""
    _load_schemas()
    schema_id = f"https://dcp-ai.org/schemas/v1/{schema_name}.schema.json"
    schema = _schema_store.get(schema_id)
    if schema is None:
        return None

    resolver = jsonschema.RefResolver(
        base_uri=schema_id,
        referrer=schema,
        store=_schema_store,
    )
    return Draft202012Validator(schema, resolver=resolver)


def validate_schema(schema_name: str, data: Any) -> dict[str, Any]:
    """Validate a JSON object against a named DCP schema."""
    validator = _get_validator(schema_name)
    if validator is None:
        return {"valid": False, "errors": [f"Schema not found: {schema_name}"]}

    errors = list(validator.iter_errors(data))
    if not errors:
        return {"valid": True}

    error_msgs = [
        f"{'/'.join(str(p) for p in e.absolute_path) or '/'} {e.message}"
        for e in errors
    ]
    return {"valid": False, "errors": error_msgs}


def validate_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    """Validate a Citizenship Bundle (all artifacts + audit entries)."""
    errors: list[str] = []
    artifacts = [
        ("human_binding_record", "human_binding_record"),
        ("agent_passport", "agent_passport"),
        ("intent", "intent"),
        ("policy_decision", "policy_decision"),
    ]

    for schema_name, key in artifacts:
        obj = bundle.get(key)
        if obj is None:
            errors.append(f"{key}: missing")
            continue
        result = validate_schema(schema_name, obj)
        if not result["valid"]:
            for e in result.get("errors", []):
                errors.append(f"{key}: {e}")

    audit_entries = bundle.get("audit_entries")
    if not isinstance(audit_entries, list) or len(audit_entries) == 0:
        errors.append("audit_entries must be a non-empty array")
    else:
        for i, entry in enumerate(audit_entries):
            result = validate_schema("audit_entry", entry)
            if not result["valid"]:
                for e in result.get("errors", []):
                    errors.append(f"audit_entries[{i}]: {e}")

    if errors:
        return {"valid": False, "errors": errors}
    return {"valid": True}
