#!/usr/bin/env node
// A controlled shim for the self-tests of tools/difffuzz: a real child process that answers the dcp-difffuzz/2
// protocol, or deliberately breaks it, as its first argument says. It never runs an SDK.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const behaviour = process.argv[2];
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const raw = Buffer.concat(chunks).toString('utf8');
if (process.env.FAKE_RECORD) fs.appendFileSync(process.env.FAKE_RECORD, raw + '\n');
const req = JSON.parse(raw);
const text = (c) => Buffer.from(c.bundle_b64, 'base64').toString('utf8');
const parse = (c) => { try { return { doc: JSON.parse(text(c)) }; } catch (e) { return { error: e.message }; } };
const verdict = (id, verified) => ({ id, status: 'verdict', verified, errors: verified ? [] : ['rejected by the fake'] });
const answer = (results, extra = {}) => process.stdout.write(JSON.stringify({ protocol: req.protocol, run_id: req.run_id, nonce: req.nonce, results, ...extra }) + '\n');

const results = req.cases.map((c) => {
  const p = parse(c);
  if (p.error) return { id: c.id, status: 'parse_rejected', message: p.error };
  switch (behaviour) {
    case 'accept-all': return verdict(c.id, true);
    case 'reject-all': return verdict(c.id, false);
    case 'order': return verdict(c.id, text(c).indexOf('"bundle"') < text(c).indexOf('"signature"'));
    case 'raw-detect': return verdict(c.id, !text(c).includes('1e400'));
    case 'error': return { id: c.id, status: 'error', message: 'the fake SDK threw' };
    case 'fault-field': return p.doc?.fault === 'error' ? { id: c.id, status: 'error', message: 'controlled fault' } : p.doc?.fault === 'unsupported' ? { id: c.id, status: 'unsupported' } : verdict(c.id, p.doc?.ok === true);
    case 'unsup-if-two': return req.cases.length === 2 ? { id: c.id, status: 'unsupported' } : verdict(c.id, !text(c).includes('1e400'));
    case 'raw-error': return text(c).includes('1e400') ? { id: c.id, status: 'error', message: 'the fake SDK threw on 1e400' } : verdict(c.id, p.doc?.ok === true);
    case 'unsupported': return { id: c.id, status: 'unsupported' };
    case 'string-valid': return { id: c.id, status: 'verdict', verified: 'yes', errors: [] };
    default: return verdict(c.id, p.doc?.ok === true); // by-field, and every lifecycle behaviour below
  }
});

switch (behaviour) {
  case 'empty': process.stdout.write('{}\n'); break;
  case 'missing': answer(results.slice(1)); break;
  case 'duplicate': answer([...results, results[0]]); break;
  case 'unknown': answer([{ ...results[0], id: 'not-a-sent-id' }, ...results.slice(1)]); break;
  case 'stale': process.stdout.write(JSON.stringify({ protocol: req.protocol, run_id: req.run_id, nonce: '0'.repeat(32), results }) + '\n'); break;
  case 'extra-field': answer(results, { note: 'not in the protocol' }); break;
  case 'silent': break;
  case 'exit1': answer(results); process.exitCode = 1; break;
  case 'crash-on-boom': if (req.cases.some((c) => text(c).includes('BOOM'))) process.exit(1); answer(results); break;
  case 'empty-if-batch': if (req.cases.length > 1) process.stdout.write('{}\n'); else answer(results); break;
  case 'crash-if-batch': if (req.cases.length > 1) process.exit(1); answer(results); break;
  case 'large': process.stdout.write(' '.repeat(1 << 20)); answer(results); break;
  case 'hang': process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); break;
  case 'descendant': spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' }).unref(); answer(results); break;
  default: answer(results);
}
