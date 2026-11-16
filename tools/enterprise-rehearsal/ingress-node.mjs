// Application transport policy, not a new DCP canonicalization profile.
// Copy this module into the isolated Node consumer before importing it.
import { experimentalCandidateIngress, canonicalizeV2 } from '@dcp-ai/sdk';

export class IngressError extends Error {
  constructor(reason, status = 400) {
    super(reason);
    this.reason = reason;
    this.status = status;
    this.code = status === 413 ? 'APP_INGRESS_TOO_LARGE' : 'APP_INGRESS_REJECTED';
  }
}

function reasonFor(code) {
  if (code === 'UTF8_INVALID' || code === 'BOM') return 'UTF8';
  if (code === 'SURROGATE_UNPAIRED') return 'UNICODE';
  if (code.startsWith('NUMBER_')) return 'NUMBER_FORM';
  return code;
}

function hasNonPortableNumber(bytes) {
  let quoted = false;
  for (let i = 0; i < bytes.length;) {
    const c = bytes[i];
    if (quoted) {
      if (c === 92) i += 2;
      else { if (c === 34) quoted = false; i++; }
    } else if (c === 34) { quoted = true; i++; }
    else if (c === 45 || (c >= 48 && c <= 57)) {
      let end = i + 1;
      while (end < bytes.length && '0123456789.eE+-'.includes(String.fromCharCode(bytes[end]))) end++;
      const literal = Buffer.from(bytes.subarray(i, end)).toString('ascii');
      if (!/^-?(0|[1-9][0-9]*)$/.test(literal) || literal === '-0') return true;
      i = end;
    } else i++;
  }
  return false;
}

export function parseRequest(bytes, maxBytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('raw bytes required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('positive body budget required');
  if (bytes.byteLength > maxBytes) throw new IngressError('BODY_BUDGET', 413);
  const copy = new Uint8Array(bytes);
  // This scanner checks raw syntax/Unicode/unique keys/range/depth. Reusing it
  // selects no signature profile; all rehearsal evidence remains dcp-jcs-v1.
  const scanned = experimentalCandidateIngress(copy);
  if (scanned.status !== 'accept') throw new IngressError(reasonFor(scanned.class));
  if (hasNonPortableNumber(copy)) throw new IngressError('NUMBER_FORM');
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(copy));
  if (!Buffer.from(canonicalizeV2(parsed)).equals(Buffer.from(scanned.canonical))) {
    // A local parser disagreement is an infrastructure fault, never a PASS or
    // a repaired request. The HTTP runner must fail if it observes this.
    throw new Error('APP_INGRESS_PARSER_MISMATCH');
  }
  return parsed;
}
