// `dcp-ai --version` reads its version from the package.json next to the binary, so a release cannot ship a stale
// constant. The binary runs in a fresh temporary directory with no .dcp/ above it, so the result does not depend on
// the working directory.
//
//   node --test cli/__tests__/version.test.mjs
//   DCP_NEGATIVE_CONTROL=1 node --test cli/__tests__/version.test.mjs   # must fail once
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, BIN, findConfigDir } from './cli-under-test.mjs';

const NEGATIVE_CONTROL = process.env.DCP_NEGATIVE_CONTROL === '1';
const { version } = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8'));

test('--version prints the package.json version from another working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcp-cli-version-'));
  try {
    assert.equal(findConfigDir(dir), null, `a .dcp/ above ${dir} would change the run`);
    const r = spawnSync(process.execPath, [BIN, '--version'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
    assert.equal(r.error, undefined, 'the binary ran and finished within 5 s');
    assert.equal(r.status, 0, r.stderr);
    const expected = NEGATIVE_CONTROL ? `${version}-negative-control` : version;
    assert.equal(r.stdout.replace(/\x1b\[[0-9;]*m/g, '').trim(), `dcp-ai ${expected} (protocol 2.0)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
