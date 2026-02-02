# DCP-AI (Digital Citizenship Protocol for AI Agents) — Genesis Repo

A minimal, protocol-first reference implementation for:

- DCP-01: Identity & Human Binding
- DCP-02: Intent Declaration & Policy Gating
- DCP-03: Audit Chain & Transparency
- Bundle: `citizenship_bundle.json` + `citizenship_bundle.signed.json`
- CLI: `dcp` (validate, conformance, bundle signing & verification)

## Install

```bash
npm install
npm link
```

## Quickstart

```bash
# Run protocol conformance (auto-generates keys + signed fixture if missing)
npm run conformance

# Validate one object
dcp validate schemas/v1/intent.schema.json tests/conformance/examples/intent.json

# Validate a full bundle
dcp validate-bundle tests/conformance/examples/citizenship_bundle.json

# Keygen + sign + verify
dcp keygen keys
dcp sign-bundle tests/conformance/examples/citizenship_bundle.json keys/secret_key.txt tests/conformance/examples/citizenship_bundle.signed.json
dcp verify-bundle tests/conformance/examples/citizenship_bundle.signed.json keys/public_key.txt
```

## Repository Layout

- `schemas/v1/` — JSON Schemas (draft 2020-12)
- `tools/` — validation, conformance, crypto + merkle helpers
- `tests/conformance/examples/` — minimal fixtures
- `bin/dcp.js` — reference CLI
- `docs/` — whitepaper + manifesto (working draft)

## License

Apache-2.0
