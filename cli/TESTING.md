# Testing `@dcp-ai/cli`

The CLI needs `@dcp-ai/sdk` 2.2.0, which is not on npm yet, so it is tested against the SDK built in this repository.

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # both suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` copies the built SDK into `cli/node_modules` instead of linking it, and the other flags leave `package.json` and the lockfile untouched and run no install scripts. CI does the same in the `cli` job of `.github/workflows/ci.yml`, on Node 20 and 22. That job does not install the repository root, so nothing resolves through a root `node_modules`.

## Suites

- `__tests__/verify-s-range.test.mjs`: V1 verification, the Ed25519 S range (RFC 8032 §5.1.7), exit codes, and the rejection of the historical V2 format.
- `__tests__/verify-v2-normative.test.mjs`: V2 bundles with the normative verifier (the cross-SDK vectors, the pre-normative envelope, the `.dcp` key pin), the schema copies in `lib/schemas/v2`, and the packaged files run on their own. Its child processes run with `Date.now` fixed, so the result does not depend on the date.

Each case runs `bin/dcp-ai.js` in a child process, in a fresh temporary directory with no `.dcp/` above it.

## Negative control

With `DCP_NEGATIVE_CONTROL=1` each suite inverts one positive case. `__tests__/negative-control.mjs` runs both suites that way. It passes only when the run exits 1 with exactly those two cases failing, each on an assertion, and every other test passing, none cancelled or skipped. Any other result fails it, including a suite that does not load.

The reference verifier and the playground have their own S range tests (`tools/crypto-s-range.test.mjs`, `tools/playground-s-range.test.mjs`), which the `conformance` job runs.
