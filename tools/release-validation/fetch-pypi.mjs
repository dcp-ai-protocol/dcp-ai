#!/usr/bin/env node
// Downloads one file of one project from a Python package index as bytes: nothing is unpacked, built or
// imported. Run as a subprocess of the release validation, under its deadline and environment.
//
//   node fetch-pypi.mjs <index url> <project> <file name> <allowed file url prefix> <destination file>
//
// Prints { url, declared_sha256, bytes }. `declared_sha256` is what the index says; the caller hashes the
// bytes itself and never takes the index's word for them.
import fs from 'node:fs';

const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const [index, project, fileName, prefix, dest] = process.argv.slice(2);
const fail = (m) => { console.error(m); process.exit(1); };
if (!dest) fail('usage: fetch-pypi.mjs <index url> <project> <file name> <allowed file url prefix> <destination file>');

async function get(url, max, accept) {
  const res = await fetch(url, { headers: { accept, 'user-agent': 'dcp-ai-release-validation' }, redirect: 'error' });
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) fail(`${url}: more than ${max} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const listing = JSON.parse((await get(`${index}${project}/`, MAX_INDEX_BYTES, 'application/vnd.pypi.simple.v1+json')).toString('utf8'));
const files = (listing.files ?? []).filter((f) => f.filename === fileName);
if (files.length !== 1) fail(`the index lists ${files.length} files named ${fileName}`);
const url = new URL(files[0].url, `${index}${project}/`).href;
if (!url.startsWith(prefix)) fail(`the index points to ${url}, outside ${prefix}`);
const bytes = await get(url, MAX_FILE_BYTES, '*/*');
fs.writeFileSync(dest, bytes, { flag: 'wx' });
console.log(JSON.stringify({ url, declared_sha256: files[0].hashes?.sha256 ?? null, bytes: bytes.length }));
