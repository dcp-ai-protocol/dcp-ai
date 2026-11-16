#!/usr/bin/env node
// Decides whether a publish job goes on: is the version in ./package.json already on the npm
// registry?
//
//   node tools/publish/npm-version-check.mjs [--registry <url>] [--timeout-ms <n>]
//
// Run it in the package directory. It writes `version=<v>` and `skip=true|false` to
// $GITHUB_OUTPUT and exits 0 only when the registry gave an unequivocal answer for exactly this
// name and version:
//
//   200 with a JSON document for this name and version  -> skip=true  (already published)
//   404 with a JSON body                                -> skip=false (not published)
//
// Anything else exits 1 and writes nothing: another status (401, 403, 429, 5xx, a redirect), a
// network error, a timeout, a body that is not JSON, or a 200 for another name or version. A
// registry failure must never read as "not published".
//
// No dependencies and no npm command: this also runs in jobs that hold `id-token: write`, where
// nothing may be installed. `--registry` exists for the tests
// (tools/publish/test_publish_workflows.py); the workflows never pass it and no environment
// variable changes the registry.

import fs from 'node:fs';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

let registry = DEFAULT_REGISTRY;
let timeoutMs = 30000;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const value = args[i + 1] ?? '';
  if (args[i] === '--registry' && /^https?:\/\/[^\s]+$/.test(value)) registry = value;
  else if (args[i] === '--timeout-ms' && /^[1-9]\d{0,5}$/.test(value)) timeoutMs = Number(value);
  else fail('usage: npm-version-check.mjs [--registry <url>] [--timeout-ms <n>]');
}

const output = process.env.GITHUB_OUTPUT;
if (!output) fail('GITHUB_OUTPUT is not set: the result would not reach the next steps');

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
} catch (e) {
  fail(`cannot read ./package.json: ${e.message}`);
}
const { name, version } = pkg ?? {};
if (typeof name !== 'string' || !NAME.test(name)) {
  fail(`./package.json has no usable name: ${name}`);
}
if (typeof version !== 'string' || !VERSION.test(version)) {
  fail(`./package.json of ${name} has no usable version: ${version}`);
}
const spec = `${name}@${version}`;
const url = `${registry.replace(/\/+$/, '')}/${name.replace('/', '%2F')}/${version}`;

let status;
let body;
try {
  const res = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  status = res.status;
  body = await res.text();
} catch (e) {
  const cause = e.cause ?? e;
  fail(`no answer from the registry for ${spec}: ${cause.code ?? cause.name}: ${cause.message}`);
}

let json;
let isJson = true;
try {
  json = JSON.parse(body);
} catch {
  isJson = false;
}

let skip;
if (status === 200) {
  if (!isJson || json === null || typeof json !== 'object' || Array.isArray(json)) {
    fail(`the registry answered 200 for ${spec} with a body that is not a JSON object`);
  }
  if (json.name !== name || json.version !== version) {
    fail(`the registry answered 200 for ${spec} with ${json.name}@${json.version}`);
  }
  skip = true;
} else if (status === 404) {
  if (!isJson) fail(`the registry answered 404 for ${spec} with a body that is not JSON`);
  skip = false;
} else {
  fail(`the registry answered ${status} for ${spec}: cannot tell whether it is published`);
}

console.log(skip ? `${spec} is already on npm — skipping publish.` : `${spec} is not on npm.`);
fs.appendFileSync(output, `version=${version}\nskip=${skip}\n`);
