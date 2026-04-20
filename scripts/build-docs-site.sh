#!/usr/bin/env bash
# Copies documentation sources from their canonical locations (docs/, spec/,
# CHANGELOG.md, README.md) into docs-site/ with the sub-directory layout that
# mkdocs.yml expects. Run before `mkdocs build` / `mkdocs serve`.
#
# docs-site/ is git-ignored — it is a build artefact. The canonical sources
# stay where they are so internal repo references keep working.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs-site"

rm -rf "$OUT"
mkdir -p "$OUT/quickstart" "$OUT/specs" "$OUT/architecture" "$OUT/guides" "$OUT/community"

# Landing page — reuse the repo README as the index.
cp "$ROOT/README.md"    "$OUT/index.md"
cp "$ROOT/CHANGELOG.md" "$OUT/CHANGELOG.md"

# Quickstart guides
cp "$ROOT/docs/QUICKSTART.md"           "$OUT/quickstart/QUICKSTART.md"
cp "$ROOT/docs/QUICKSTART_EXPRESS.md"   "$OUT/quickstart/QUICKSTART_EXPRESS.md"
cp "$ROOT/docs/QUICKSTART_LANGCHAIN.md" "$OUT/quickstart/QUICKSTART_LANGCHAIN.md"
cp "$ROOT/docs/QUICKSTART_OPENAI.md"    "$OUT/quickstart/QUICKSTART_OPENAI.md"
cp "$ROOT/docs/QUICKSTART_CREWAI.md"    "$OUT/quickstart/QUICKSTART_CREWAI.md"

# Specifications — every .md directly under spec/
cp "$ROOT/spec/README.md"            "$OUT/specs/README.md"
cp "$ROOT/spec/DCP-01.md"            "$OUT/specs/DCP-01.md"
cp "$ROOT/spec/DCP-02.md"            "$OUT/specs/DCP-02.md"
cp "$ROOT/spec/DCP-03.md"            "$OUT/specs/DCP-03.md"
cp "$ROOT/spec/DCP-04.md"            "$OUT/specs/DCP-04.md"
cp "$ROOT/spec/DCP-05.md"            "$OUT/specs/DCP-05.md"
cp "$ROOT/spec/DCP-06.md"            "$OUT/specs/DCP-06.md"
cp "$ROOT/spec/DCP-07.md"            "$OUT/specs/DCP-07.md"
cp "$ROOT/spec/DCP-08.md"            "$OUT/specs/DCP-08.md"
cp "$ROOT/spec/DCP-09.md"            "$OUT/specs/DCP-09.md"
cp "$ROOT/spec/DCP-AI-v2.0.md"       "$OUT/specs/DCP-AI-v2.0.md"
cp "$ROOT/spec/BUNDLE.md"            "$OUT/specs/BUNDLE.md"
cp "$ROOT/spec/VERIFICATION.md"      "$OUT/specs/VERIFICATION.md"
cp "$ROOT/spec/AUDIT-v2.0-FINAL.md"  "$OUT/specs/AUDIT-v2.0-FINAL.md"

# Architecture
cp "$ROOT/docs/TECHNICAL_ARCHITECTURE.md" "$OUT/architecture/TECHNICAL_ARCHITECTURE.md"
cp "$ROOT/docs/SECURITY_MODEL.md"         "$OUT/architecture/SECURITY_MODEL.md"
cp "$ROOT/docs/STORAGE_AND_ANCHORING.md"  "$OUT/architecture/STORAGE_AND_ANCHORING.md"
cp "$ROOT/docs/NIST_CONFORMITY.md"        "$OUT/architecture/NIST_CONFORMITY.md"

# Operator / migration / reference guides
cp "$ROOT/docs/AGENT_CREATION_AND_CERTIFICATION.md" "$OUT/guides/AGENT_CREATION_AND_CERTIFICATION.md"
cp "$ROOT/docs/OPERATOR_GUIDE.md"                   "$OUT/guides/OPERATOR_GUIDE.md"
cp "$ROOT/docs/MIGRATION_V1_V2.md"                  "$OUT/guides/MIGRATION_V1_V2.md"
cp "$ROOT/docs/API_REFERENCE.md"                    "$OUT/guides/API_REFERENCE.md"

# Community
cp "$ROOT/docs/EARLY_ADOPTERS.md" "$OUT/community/EARLY_ADOPTERS.md"
cp "$ROOT/docs/GENESIS_PAPER.md"  "$OUT/community/GENESIS_PAPER.md"

# Rewrite internal links that reference the original on-disk layout so they
# resolve in the site's sub-directory structure. Portable sed invocation
# (works on BSD sed / macOS and GNU sed).
_sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"       # GNU
  else
    sed -i '' "$@"    # BSD
  fi
}

# index.md (the repo README reused as landing) has many repo-relative
# links. Rewrite the ones that have a site equivalent; point the rest
# at the repo on GitHub.
REPO_BLOB="https://github.com/dcp-ai-protocol/dcp-ai/blob/main"
REPO_TREE="https://github.com/dcp-ai-protocol/dcp-ai/tree/main"
_sed_inplace \
  -e 's|](spec/DCP-01\.md)|](specs/DCP-01.md)|g' \
  -e 's|](spec/DCP-02\.md)|](specs/DCP-02.md)|g' \
  -e 's|](spec/DCP-03\.md)|](specs/DCP-03.md)|g' \
  -e 's|](spec/DCP-04\.md)|](specs/DCP-04.md)|g' \
  -e 's|](spec/DCP-05\.md)|](specs/DCP-05.md)|g' \
  -e 's|](spec/DCP-06\.md)|](specs/DCP-06.md)|g' \
  -e 's|](spec/DCP-07\.md)|](specs/DCP-07.md)|g' \
  -e 's|](spec/DCP-08\.md)|](specs/DCP-08.md)|g' \
  -e 's|](spec/DCP-09\.md)|](specs/DCP-09.md)|g' \
  -e 's|](spec/DCP-AI-v2\.0\.md)|](specs/DCP-AI-v2.0.md)|g' \
  -e 's|](spec/BUNDLE\.md)|](specs/BUNDLE.md)|g' \
  -e 's|](spec/VERIFICATION\.md)|](specs/VERIFICATION.md)|g' \
  -e 's|](docs/QUICKSTART\.md)|](quickstart/QUICKSTART.md)|g' \
  -e 's|](docs/QUICKSTART_EXPRESS\.md)|](quickstart/QUICKSTART_EXPRESS.md)|g' \
  -e 's|](docs/QUICKSTART_LANGCHAIN\.md)|](quickstart/QUICKSTART_LANGCHAIN.md)|g' \
  -e 's|](docs/QUICKSTART_OPENAI\.md)|](quickstart/QUICKSTART_OPENAI.md)|g' \
  -e 's|](docs/QUICKSTART_CREWAI\.md)|](quickstart/QUICKSTART_CREWAI.md)|g' \
  -e 's|](docs/TECHNICAL_ARCHITECTURE\.md)|](architecture/TECHNICAL_ARCHITECTURE.md)|g' \
  -e 's|](docs/SECURITY_MODEL\.md)|](architecture/SECURITY_MODEL.md)|g' \
  -e 's|](docs/STORAGE_AND_ANCHORING\.md)|](architecture/STORAGE_AND_ANCHORING.md)|g' \
  -e 's|](docs/NIST_CONFORMITY\.md)|](architecture/NIST_CONFORMITY.md)|g' \
  -e 's|](docs/OPERATOR_GUIDE\.md)|](guides/OPERATOR_GUIDE.md)|g' \
  -e 's|](docs/AGENT_CREATION_AND_CERTIFICATION\.md)|](guides/AGENT_CREATION_AND_CERTIFICATION.md)|g' \
  -e 's|](docs/MIGRATION_V1_V2\.md)|](guides/MIGRATION_V1_V2.md)|g' \
  -e 's|](docs/EARLY_ADOPTERS\.md)|](community/EARLY_ADOPTERS.md)|g' \
  -e 's|](docs/GENESIS_PAPER\.md)|](community/GENESIS_PAPER.md)|g' \
  "$OUT/index.md"

# Rest of the repo-relative references in index.md → point at GitHub.
_sed_inplace \
  -e "s|](spec/core/\\([^)]*\\))|]($REPO_BLOB/spec/core/\\1)|g" \
  -e "s|](spec/profiles/)|]($REPO_TREE/spec/profiles)|g" \
  -e "s|](spec/profiles/\\([^)]*\\))|]($REPO_TREE/spec/profiles/\\1)|g" \
  -e "s|](sdks/\\([^)]*\\))|]($REPO_TREE/sdks/\\1)|g" \
  -e "s|](integrations/\\([^)]*\\))|]($REPO_TREE/integrations/\\1)|g" \
  -e "s|](templates/)|]($REPO_TREE/templates)|g" \
  -e "s|](playground/)|]($REPO_TREE/playground)|g" \
  -e "s|](server/README\\.md)|]($REPO_BLOB/server/README.md)|g" \
  -e "s|](services/\\([^)]*\\))|]($REPO_TREE/services/\\1)|g" \
  -e "s|](api/openapi\\.yaml)|]($REPO_BLOB/api/openapi.yaml)|g" \
  -e "s|](api/proto/)|]($REPO_TREE/api/proto)|g" \
  -e "s|](api/README\\.md)|]($REPO_BLOB/api/README.md)|g" \
  -e "s|](contracts/ethereum/DCPAnchor\\.sol)|]($REPO_BLOB/contracts/ethereum/DCPAnchor.sol)|g" \
  -e "s|](LICENSE)|]($REPO_BLOB/LICENSE)|g" \
  -e "s|](CITATION\\.cff)|]($REPO_BLOB/CITATION.cff)|g" \
  -e "s|](ROADMAP\\.md)|]($REPO_BLOB/ROADMAP.md)|g" \
  -e "s|](CONTRIBUTING\\.md)|]($REPO_BLOB/CONTRIBUTING.md)|g" \
  -e "s|](GOVERNANCE\\.md)|]($REPO_BLOB/GOVERNANCE.md)|g" \
  "$OUT/index.md"

# docs/* and spec/* cross-references in every site page → rewrite to the
# site layout (architecture/, guides/, specs/, etc.).
find "$OUT" -name '*.md' -print0 | while IFS= read -r -d '' f; do
  _sed_inplace \
    -e 's|\.\./docs/TECHNICAL_ARCHITECTURE\.md|../architecture/TECHNICAL_ARCHITECTURE.md|g' \
    -e 's|\.\./docs/SECURITY_MODEL\.md|../architecture/SECURITY_MODEL.md|g' \
    -e 's|\.\./docs/STORAGE_AND_ANCHORING\.md|../architecture/STORAGE_AND_ANCHORING.md|g' \
    -e 's|\.\./docs/NIST_CONFORMITY\.md|../architecture/NIST_CONFORMITY.md|g' \
    -e 's|\.\./docs/OPERATOR_GUIDE\.md|../guides/OPERATOR_GUIDE.md|g' \
    -e 's|\.\./docs/AGENT_CREATION_AND_CERTIFICATION\.md|../guides/AGENT_CREATION_AND_CERTIFICATION.md|g' \
    -e 's|\.\./docs/MIGRATION_V1_V2\.md|../guides/MIGRATION_V1_V2.md|g' \
    -e 's|\.\./docs/API_REFERENCE\.md|../guides/API_REFERENCE.md|g' \
    -e 's|\.\./docs/EARLY_ADOPTERS\.md|../community/EARLY_ADOPTERS.md|g' \
    -e 's|\.\./docs/GENESIS_PAPER\.md|../community/GENESIS_PAPER.md|g' \
    -e 's|\.\./docs/QUICKSTART\.md|../quickstart/QUICKSTART.md|g' \
    -e 's|\.\./spec/DCP-01\.md|../specs/DCP-01.md|g' \
    -e 's|\.\./spec/DCP-02\.md|../specs/DCP-02.md|g' \
    -e 's|\.\./spec/DCP-03\.md|../specs/DCP-03.md|g' \
    -e 's|\.\./spec/DCP-04\.md|../specs/DCP-04.md|g' \
    -e 's|\.\./spec/DCP-05\.md|../specs/DCP-05.md|g' \
    -e 's|\.\./spec/DCP-06\.md|../specs/DCP-06.md|g' \
    -e 's|\.\./spec/DCP-07\.md|../specs/DCP-07.md|g' \
    -e 's|\.\./spec/DCP-08\.md|../specs/DCP-08.md|g' \
    -e 's|\.\./spec/DCP-09\.md|../specs/DCP-09.md|g' \
    -e 's|\.\./spec/DCP-AI-v2\.0\.md|../specs/DCP-AI-v2.0.md|g' \
    -e 's|\.\./spec/BUNDLE\.md|../specs/BUNDLE.md|g' \
    -e 's|\.\./spec/VERIFICATION\.md|../specs/VERIFICATION.md|g' \
    -e "s|\\.\\./GOVERNANCE\\.md|$REPO_BLOB/GOVERNANCE.md|g" \
    -e "s|\\.\\./CONTRIBUTING\\.md|$REPO_BLOB/CONTRIBUTING.md|g" \
    -e "s|\\.\\./ROADMAP\\.md|$REPO_BLOB/ROADMAP.md|g" \
    -e "s|\\.\\./LICENSE|$REPO_BLOB/LICENSE|g" \
    -e "s|\\.\\./CITATION\\.cff|$REPO_BLOB/CITATION.cff|g" \
    -e "s|\\.\\./protocol_fingerprints\\.json|$REPO_BLOB/protocol_fingerprints.json|g" \
    -e "s|\\.\\./server/README\\.md|$REPO_BLOB/server/README.md|g" \
    -e "s|\\.\\./services/\\([^)]*\\)|$REPO_TREE/services/\\1|g" \
    -e "s|\\.\\./sdks/\\([^)]*\\)|$REPO_TREE/sdks/\\1|g" \
    -e "s|\\.\\./integrations/\\([^)]*\\)|$REPO_TREE/integrations/\\1|g" \
    "$f"
done

# Within-section sibling links (no `../` prefix) that actually jump to
# another section in the site → rewrite with the correct relative prefix.
find "$OUT/architecture" -name '*.md' -print0 | while IFS= read -r -d '' f; do
  _sed_inplace \
    -e 's|](MIGRATION_V1_V2\.md)|](../guides/MIGRATION_V1_V2.md)|g' \
    -e 's|](OPERATOR_GUIDE\.md)|](../guides/OPERATOR_GUIDE.md)|g' \
    -e 's|](API_REFERENCE\.md)|](../guides/API_REFERENCE.md)|g' \
    "$f"
done
find "$OUT/guides" -name '*.md' -print0 | while IFS= read -r -d '' f; do
  _sed_inplace \
    -e 's|](NIST_CONFORMITY\.md)|](../architecture/NIST_CONFORMITY.md)|g' \
    -e 's|](SECURITY_MODEL\.md)|](../architecture/SECURITY_MODEL.md)|g' \
    -e 's|](TECHNICAL_ARCHITECTURE\.md)|](../architecture/TECHNICAL_ARCHITECTURE.md)|g' \
    -e 's|](STORAGE_AND_ANCHORING\.md)|](../architecture/STORAGE_AND_ANCHORING.md)|g' \
    -e 's|](QUICKSTART\.md)|](../quickstart/QUICKSTART.md)|g' \
    -e "s|](\\.\\./scripts/\\([^)]*\\))|]($REPO_BLOB/scripts/\\1)|g" \
    -e "s|](\\.\\./tests/\\([^)]*\\))|]($REPO_BLOB/tests/\\1)|g" \
    "$f"
done
find "$OUT/community" -name '*.md' -print0 | while IFS= read -r -d '' f; do
  _sed_inplace \
    -e 's|](MIGRATION_V1_V2\.md)|](../guides/MIGRATION_V1_V2.md)|g' \
    -e 's|](NIST_CONFORMITY\.md)|](../architecture/NIST_CONFORMITY.md)|g' \
    -e 's|](TECHNICAL_ARCHITECTURE\.md)|](../architecture/TECHNICAL_ARCHITECTURE.md)|g' \
    "$f"
done

# Quickstart files cross-reference ./API_REFERENCE.md and ./MIGRATION_V1_V2.md
# (flat names that used to sit next to them in docs/). Rewrite to ../guides/.
find "$OUT/quickstart" -name '*.md' -print0 | while IFS= read -r -d '' f; do
  _sed_inplace \
    -e 's|\./API_REFERENCE\.md|../guides/API_REFERENCE.md|g' \
    -e 's|\./SECURITY_MODEL\.md|../architecture/SECURITY_MODEL.md|g' \
    -e 's|](MIGRATION_V1_V2\.md)|](../guides/MIGRATION_V1_V2.md)|g' \
    "$f"
done

# Spec files reference ../tests/... JSON examples and ../ROADMAP.md
# These live outside the docs site; point them at the repo on GitHub.
find "$OUT/specs" -name '*.md' -print0 | while IFS= read -r -d '' f; do
  _sed_inplace \
    -e 's|\.\./tests/|https://github.com/dcp-ai-protocol/dcp-ai/blob/main/tests/|g' \
    -e 's|\.\./protocol_fingerprints\.json|https://github.com/dcp-ai-protocol/dcp-ai/blob/main/protocol_fingerprints.json|g' \
    -e 's|\.\./ROADMAP\.md|https://github.com/dcp-ai-protocol/dcp-ai/blob/main/ROADMAP.md|g' \
    "$f"
done

echo "docs-site/ rebuilt ($(find "$OUT" -name '*.md' | wc -l | tr -d ' ') markdown files)."
