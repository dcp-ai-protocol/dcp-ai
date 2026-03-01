"""Register integration modules under dcp_ai namespace so tests can import them."""

import sys
import importlib.util
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
INTEGRATIONS_DIR = PROJECT_ROOT / "integrations"

_INTEGRATION_MODULES = {
    "dcp_ai.openai": "openai/__init__.py",
    "dcp_ai.langchain": "langchain/__init__.py",
    "dcp_ai.crewai": "crewai/__init__.py",
    "dcp_ai.fastapi": "fastapi/__init__.py",
}


def _register_integration(module_name: str, rel_path: str) -> None:
    if module_name in sys.modules:
        return
    file_path = INTEGRATIONS_DIR / rel_path
    if not file_path.exists():
        return
    spec = importlib.util.spec_from_file_location(
        module_name,
        str(file_path),
        submodule_search_locations=[],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    try:
        spec.loader.exec_module(mod)
    except ImportError as exc:
        del sys.modules[module_name]
        print(f"WARNING: Could not load {module_name}: {exc}")


for _name, _path in _INTEGRATION_MODULES.items():
    _register_integration(_name, _path)
