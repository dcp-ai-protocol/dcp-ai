import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSecrets, scanSecrets, variants } from './secrets.mjs';

test('known encodings detected without leaking secret in result; clean control', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp05-secret-test-'));
  try {
    const key = Buffer.from(Array.from({length: 65}, (_, i) => (i * 37 + 17) % 256));
    fs.writeFileSync(path.join(dir, 'evidence.json'), '{"pass":true}\n');
    assert.equal(scanSecrets([key], [dir]).pass, true);
    for (const bytes of variants(key)) {
      fs.writeFileSync(path.join(dir, 'evidence.json'), bytes);
      const result = scanSecrets([key], [dir]);
      assert.equal(result.pass, false);
      assert.equal(result.findings.length, 1);
      assert.equal(JSON.stringify(result).includes(key.toString('base64')), false);
    }
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('collector includes both key types and tokens, rejects empty and malformed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp05-secret-collect-'));
  try {
    assert.throws(() => collectSecrets([dir]), /no secrets/);
    const key = Buffer.alloc(64, 17).toString('base64');
    fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify({classical:{secretKeyB64:key},pq:{secretKeyB64:key}}));
    fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({operator:'ab'.repeat(32),tenants:{T1:'cd'.repeat(32)}}));
    assert.equal(collectSecrets([dir]).length, 6);
    fs.writeFileSync(path.join(dir, 'unknown.json'), '{}');
    assert.throws(() => collectSecrets([dir]), /unexpected/);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('scan refuses empty tree and symlink, not a silent clean result', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp05-secret-path-'));
  try {
    assert.throws(() => scanSecrets([Buffer.alloc(32, 17)], [dir]), /empty/);
    fs.symlinkSync(dir, path.join(dir, 'cycle'));
    assert.throws(() => scanSecrets([Buffer.alloc(32, 17)], [dir]), /symlink/);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
