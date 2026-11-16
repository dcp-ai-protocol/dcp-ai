// Evidence hygiene for synthetic MP-05 secrets; not a general DLP system.
import fs from 'node:fs';
import path from 'node:path';

function files(root) {
  const out = [];
  function visit(file) {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) throw Error('symlink in evidence or secrets');
    if (st.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    else if (st.isFile()) out.push(file);
    else throw Error('nonregular evidence or secret file');
  }
  visit(root);
  return out;
}

export function collectSecrets(roots) {
  const result = [];
  for (const root of roots) for (const file of files(root)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (path.basename(file) === 'tokens.json') {
      for (const token of [value.operator, ...Object.values(value.tenants ?? {})]) {
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw Error('unexpected synthetic token format');
        result.push(Buffer.from(token, 'utf8'), Buffer.from(token, 'hex'));
      }
    } else {
      for (const key of [value.classical, value.pq]) {
        if (typeof key?.secretKeyB64 !== 'string') throw Error('unexpected synthetic key format');
        const bytes = Buffer.from(key.secretKeyB64, 'base64');
        if (bytes.length < 32 || bytes.toString('base64') !== key.secretKeyB64) throw Error('invalid synthetic key encoding');
        result.push(bytes);
      }
    }
  }
  if (!result.length) throw Error('no secrets to check');
  return result;
}

export function variants(bytes) {
  const strings = [bytes.toString('hex'), bytes.toString('hex').toUpperCase(), bytes.toString('base64'),
    bytes.toString('base64url'), bytes.toString('base64').replace(/=+$/, '')];
  // The only textual secrets this kit writes are hex tokens and base64 keys.
  const values = [bytes, ...strings.flatMap(s => [Buffer.from(s), Buffer.from(JSON.stringify(s).slice(1, -1))])];
  return [...new Map(values.map(b => [b.toString('hex'), b])).values()];
}

export function scanSecrets(secrets, roots) {
  if (!secrets.length) throw Error('no secrets to check');
  const needles = secrets.flatMap(variants);
  const findings = [];
  let count = 0;
  for (const [rootIndex, root] of roots.entries()) for (const file of files(root)) {
    if (fs.statSync(file).size > 16 * 1024 * 1024) throw Error('evidence file exceeds scanner budget');
    const bytes = fs.readFileSync(file);
    count++;
    const found = needles.findIndex(n => bytes.includes(n));
    if (found !== -1) findings.push({ root: rootIndex, file: path.relative(root, file), found: true });
  }
  if (!count) throw Error('empty evidence scan');
  return { pass: findings.length === 0, files: count, findings };
}
