#!/usr/bin/env bash
# Build and validate all five documentation languages; no English fallback.
# Canonical Markdown remains in place; docs-site/ and site/ are ignored artifacts.
# For a local English-only review: python3 scripts/docs_site.py preview --locale en
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/scripts/docs_site.py" build
