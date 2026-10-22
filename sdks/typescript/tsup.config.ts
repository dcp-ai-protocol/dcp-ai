import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The telemetry SDK version comes from package.json, so a release bump cannot
// leave the bundled build reporting a stale version (2.2.0 shipped as "2.1.2").
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  define: { __DCP_SDK_VERSION__: JSON.stringify(version) },
});
