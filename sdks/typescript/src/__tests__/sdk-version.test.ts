import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dist = resolve(root, 'dist', 'index.js');

describe('bundled SDK version', () => {
  it.skipIf(!existsSync(dist))('dist/index.js reports the package.json version', () => {
    const bundle = readFileSync(dist, 'utf8');
    expect(bundle).toContain(JSON.stringify(version));
    expect(bundle).not.toContain('__DCP_SDK_VERSION__');
  });
});
