/**
 * Admission from bytes (opt-in, MP-02 F3): a V2 signed bundle admitted from the bytes of one JSON
 * text, under `dcp-jcs-v1`. Design: docs/reviews/mp02-security-composition-design.md § 3.
 *
 * One route, in this order:
 * 1. a private copy of the caller's bytes; nothing reads the caller's bytes again;
 * 2. the candidate scanner, unchanged, over that copy (UTF-8, BOM, grammar, surrogates, duplicate
 *    keys, integers, range, depth): its rejections keep their class and offset;
 * 3. the portable integer domain: every number literal outside strings is a plain integer, with no
 *    fraction, no exponent and no `-0` (`NUMBER_NOT_PORTABLE`, at the literal's first byte);
 * 4. this SDK's parser over the same copy, canonicalized with `dcp-jcs-v1` and compared byte for byte
 *    with the scanner's canonical bytes: a difference or a parser failure is a local fault,
 *    `INGRESS_PARSER_MISMATCH`;
 * 5. admitSignedBundleV2 over that parsed value, which nobody else holds.
 *
 * Nothing else changes: `dcp-jcs-v1`, the candidate `dcp-jcs-v2`, the scanner, the profiles, the
 * defaults and admitSignedBundleV2 keep their behavior. A transport that rewrites `100` as `100.0`
 * is rejected here even when the signature still verifies over the parsed value.
 */
import type { AlgorithmRegistry } from './crypto-registry.js';
import { admitSignedBundleV2, type AdmissionResult, type AdmitOptions } from './admission.js';
import { canonicalizeV2 } from './canonicalize.js';
import { sha256Hex } from './dual-hash.js';
import { experimentalCandidateIngress } from './experimental-candidate-ingress.js';

export interface IngressOutcome {
  accepted: boolean;
  /** Which step rejected: the scanner, the portable domain or the parser comparison. null when accepted. */
  layer: 'scanner' | 'domain' | 'parser' | null;
  class: string | null;
  /** Byte offset in the input; null when accepted and for a parser fault. */
  offset: number | null;
  /** SHA-256 of the copied bytes. */
  unit_sha256: string;
  /** SHA-256 of the canonical bytes; null when rejected. */
  canonical_sha256: string | null;
}

export interface IngressAdmissionResult {
  ingress: IngressOutcome;
  /** admitSignedBundleV2's result for `value`; null when ingress rejects, as nothing was verified. */
  admission: AdmissionResult | null;
  /** The parsed value admission received; null when ingress rejects. */
  value: unknown;
}

const PORTABLE_INTEGER = /^-?(0|[1-9][0-9]*)$/;
const ASCII = new TextDecoder();
const UTF8 = new TextDecoder('utf-8', { fatal: true });

const isNumberByte = (c: number) =>
  (c >= 0x30 && c <= 0x39) || c === 0x2e || c === 0x65 || c === 0x45 || c === 0x2b || c === 0x2d;

/**
 * The offset of the first number literal outside strings that is not a plain integer, or -1. Only for
 * a unit the scanner accepted, so the text is well-formed JSON and every string is closed.
 */
function firstNonPortableNumber(b: Uint8Array): number {
  let inString = false;
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    if (inString) {
      if (c === 0x5c) i += 2; // the escaped byte cannot end the string
      else {
        if (c === 0x22) inString = false;
        i++;
      }
    } else if (c === 0x22) {
      inString = true;
      i++;
    } else if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      let j = i + 1;
      while (j < b.length && isNumberByte(b[j])) j++;
      const literal = ASCII.decode(b.subarray(i, j));
      if (!PORTABLE_INTEGER.test(literal) || literal === '-0') return i;
      i = j;
    } else i++;
  }
  return -1;
}

const parseJson = (unit: Uint8Array): unknown => JSON.parse(UTF8.decode(unit));

/**
 * Admits a V2 signed bundle from the bytes of one JSON text (see the module comment). A rejected
 * ingress is a result with `admission: null`; a non-Uint8Array argument is a TypeError.
 */
export function admitSignedBundleV2FromBytes(
  bytes: Uint8Array,
  registry: AlgorithmRegistry,
  options: AdmitOptions = {},
): Promise<IngressAdmissionResult> {
  return admitFromBytesWithParser(parseJson, bytes, registry, options);
}

/**
 * @internal Tests only: the same route with another parser, to show that a parser fault is caught.
 * It is not exported from the package (src/index.ts) and no request or option selects it.
 */
export async function admitFromBytesWithParser(
  parse: (unit: Uint8Array) => unknown,
  bytes: Uint8Array,
  registry: AlgorithmRegistry,
  options: AdmitOptions = {},
): Promise<IngressAdmissionResult> {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('admitSignedBundleV2FromBytes: bytes must be a Uint8Array');
  }
  const unit = new Uint8Array(bytes); // a copy: Buffer#slice and subarray would share the caller's memory
  const unitSha256 = sha256Hex(unit);
  const reject = (layer: 'scanner' | 'domain' | 'parser', cls: string, offset: number | null): IngressAdmissionResult => ({
    ingress: { accepted: false, layer, class: cls, offset, unit_sha256: unitSha256, canonical_sha256: null },
    admission: null,
    value: null,
  });

  const scanned = experimentalCandidateIngress(unit);
  if (scanned.status === 'reject') return reject('scanner', scanned.class, scanned.offset);
  const at = firstNonPortableNumber(unit);
  if (at >= 0) return reject('domain', 'NUMBER_NOT_PORTABLE', at);

  let value: unknown;
  let same = false;
  try {
    value = parse(unit);
    const canonical = Buffer.from(canonicalizeV2(value), 'utf8');
    same = canonical.equals(scanned.canonical);
  } catch {
    // a parser that fails on a unit the scanner accepted is the same local fault as a different value
  }
  if (!same) return reject('parser', 'INGRESS_PARSER_MISMATCH', null);

  const admission = await admitSignedBundleV2(value, registry, options);
  return {
    ingress: { accepted: true, layer: null, class: null, offset: null, unit_sha256: unitSha256, canonical_sha256: scanned.canonicalSha256 },
    admission,
    value,
  };
}
