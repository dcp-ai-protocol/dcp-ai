#!/usr/bin/env node
/**
 * @dcp-ai/create-crewai — scaffolds a DCP-governed LangChain project.
 *
 * Usage:
 *   npm create @dcp-ai/crewai my-app
 *   npx @dcp-ai/create-crewai my-app
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_NAME = 'crewai';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'template');

function die(msg) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

const target = process.argv[2];
if (!target) {
  console.log(`Usage: npm create @dcp-ai/${TEMPLATE_NAME} <directory>`);
  process.exit(0);
}

const dest = path.resolve(process.cwd(), target);
if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
  die(`Target directory "${target}" already exists and is not empty.`);
}

if (!fs.existsSync(TEMPLATE_DIR)) {
  die(`Template directory not found at ${TEMPLATE_DIR}. Reinstall the package.`);
}

console.log(`\x1b[36m→\x1b[0m Scaffolding DCP-AI ${TEMPLATE_NAME} template into ${dest}`);
copyRecursive(TEMPLATE_DIR, dest);

console.log(`\x1b[32m✓\x1b[0m Done.\n`);
console.log(`Next steps:\n`);
console.log(`  cd ${target}`);
console.log(`  npm install`);
console.log(`  # follow the README for API keys and run instructions\n`);
console.log(`Docs: https://docs.dcp-ai.org/quickstart/QUICKSTART_CREWAI/`);
