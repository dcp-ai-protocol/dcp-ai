import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseRequest, IngressError } from './ingress-node.mjs';

const corpus = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(corpus.format, 'mp05-application-ingress-cases-v1');
assert.equal(corpus.cases.length, 20);
const ids = new Set();
const results = [];
for (const item of corpus.cases) {
  assert(!ids.has(item.id)); ids.add(item.id);
  let observed;
  try {
    parseRequest(Buffer.from(item.bytes_b64, 'base64'), item.max_bytes);
    observed = { accepted: true, reason: null };
  } catch (error) {
    if (!(error instanceof IngressError)) throw error;
    observed = { accepted: false, reason: error.reason };
    assert.equal(error.status, error.reason === 'BODY_BUDGET' ? 413 : 400);
  }
  assert.deepEqual(observed, item.expected, item.id);
  results.push({ id: item.id, observed });
}
console.log(JSON.stringify({ status: 'pass', cases: results.length, results }, null, 2));
