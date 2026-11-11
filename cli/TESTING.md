# Testing `@dcp-ai/cli`

CLI 2.2.0 requires `@dcp-ai/sdk` `^2.4.0`. These repository tests deliberately use the SDK built from the same checkout to cover source changes before a release.

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # the four suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` copies the built SDK into `cli/node_modules` instead of linking it, and the other flags leave `package.json` and the lockfile untouched and run no install scripts. CI does the same in the `cli` job of `.github/workflows/ci.yml`, on Node 20 and 22. That job does not install the repository root, so nothing resolves through a root `node_modules`.

## Suites

- `__tests__/verify-s-range.test.mjs`: V1 verification, the Ed25519 S range (RFC 8032 §5.1.7), exit codes, and the rejection of the historical V2 format.
- `__tests__/verify-ped1.test.mjs`: V1 verification under Ed25519 P-ED-1 against the frozen corpus `tests/interop/v2/ed25519_ped1_vectors.json`.
- `__tests__/version.test.mjs`: `--version` prints the version of `package.json` from another working directory.
- `__tests__/verify-v2-normative.test.mjs`: V2 bundles with the normative verifier (the cross-SDK vectors, the pre-normative envelope, the `.dcp` key pin), the schema copies in `lib/schemas/v2`, and the packaged files run on their own. Its child processes run with `Date.now` fixed, so the result does not depend on the date.

Each case runs `bin/dcp-ai.js` in a child process, in a fresh temporary directory with no `.dcp/` above it.

## Negative control

With `DCP_NEGATIVE_CONTROL=1` each suite inverts one positive case. `__tests__/negative-control.mjs` runs the four suites that way. It passes only when the run exits 1 with exactly those four cases failing, each on an assertion, and every other test passing, none cancelled or skipped. Any other result fails it, including a suite that does not load.

The reference verifier and the playground have their own S range tests (`tools/crypto-s-range.test.mjs`, `tools/playground-s-range.test.mjs`), which the `conformance` job runs.

## Against an installed package

`DCP_CLI_ROOT` points the same four suites and the negative control at an installed `@dcp-ai/cli` instead of this checkout's `cli/`:

```bash
cd cli
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm test
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm run test:negative-control
```

The binary, `lib/` and the dependencies then come from that package as it was installed: `__tests__/cli-under-test.mjs` resolves them from it and refuses a path or a dependency inside this checkout. The fixtures and the expectations stay here. Two cases adapt: the standalone copy takes the dependencies from the `node_modules` directory the package was installed into, and the packaging test checks that the two files are in the installed package instead of asking `npm pack --dry-run`, which describes a source tree. Without the variable nothing changes. The [release validation](../tools/release-validation/README.md) runs the suites this way against the published package.
