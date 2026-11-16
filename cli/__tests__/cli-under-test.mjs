// Which CLI the suites run. By default this checkout's (the directory above), as always. With DCP_CLI_ROOT set to
// the directory of an installed @dcp-ai/cli, the suites run that package instead: its binary, its lib/ and its
// dependencies as installed next to it. The fixtures and the expectations stay in this checkout either way.
//
//   DCP_CLI_ROOT=<consumer>/node_modules/@dcp-ai/cli node --test cli/__tests__/*.test.mjs
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** This checkout: where the fixtures, the reference copies and schemas/ are. */
export const REPO = fileURLToPath(new URL('../..', import.meta.url));
export const INSTALLED = (process.env.DCP_CLI_ROOT ?? '') !== '';
export const CLI = INSTALLED ? realpathSync(resolve(process.env.DCP_CLI_ROOT)) + sep : fileURLToPath(new URL('..', import.meta.url));
export const BIN = join(CLI, 'bin', 'dcp-ai.js');

const inCheckout = (p) => realpathSync(p).startsWith(realpathSync(REPO) + sep);
if (INSTALLED && inCheckout(CLI)) throw new Error(`DCP_CLI_ROOT (${CLI}) is inside this checkout: it must be an installed package`);

// Resolved from the CLI under test, as the CLI itself resolves them: cli/node_modules here, or wherever the package
// manager installed them for the installed package. An installed CLI never gets a module of this checkout.
const require = createRequire(join(CLI, 'package.json'));
function locate(name) {
  const file = require.resolve(name);
  if (INSTALLED && inCheckout(file)) throw new Error(`${name} of the installed CLI resolves to ${file}, inside this checkout`);
  return file;
}
/** The default export of one of the CLI's dependencies. */
export const dependency = async (name) => (await import(pathToFileURL(locate(name)).href)).default;
export const { findConfigDir } = await import(pathToFileURL(join(CLI, 'lib', 'config.js')).href);

/**
 * The node_modules directories that hold the CLI's dependencies, outermost first: its own in this checkout; for an
 * installed package, the one it was installed into (npm hoists dependencies there) and its own, if it has one.
 */
export function dependencyDirs() {
  const own = join(CLI, 'node_modules');
  if (!INSTALLED) return [own];
  let d = dirname(CLI);
  while (d !== dirname(d) && d.split(sep).at(-1) !== 'node_modules') d = dirname(d);
  if (d === dirname(d)) throw new Error(`${CLI} is not inside a node_modules directory`);
  return [d, ...(existsSync(own) ? [own] : [])];
}
