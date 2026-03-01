/**
 * DCP v2.0 CBOR Wire Format (RFC 8949).
 *
 * Optional binary wire format for high-throughput deployments.
 * 30-40% smaller than JSON+base64 (binary key/sig material stored as CBOR
 * byte strings, not base64). Deterministic encoding per RFC 8949 §4.2.
 *
 * Encoding rules (CTAP2 canonical CBOR):
 * - Map keys sorted by encoded length, then lexicographically
 * - Preferred integer encoding (smallest possible)
 * - No duplicate keys
 * - No indefinite-length items
 *
 * This is a minimal deterministic CBOR encoder/decoder sufficient for DCP
 * payloads. For production, consider replacing with a battle-tested library.
 */

// ── Major types ──
const MT_UNSIGNED = 0;
const MT_NEGATIVE = 1;
const MT_BYTES = 2;
const MT_TEXT = 3;
const MT_ARRAY = 4;
const MT_MAP = 5;
const MT_SIMPLE = 7;

// ── Simple values ──
const SIMPLE_FALSE = 20;
const SIMPLE_TRUE = 21;
const SIMPLE_NULL = 22;

export class CborEncoder {
  private chunks: Uint8Array[] = [];

  encode(value: unknown): Uint8Array {
    this.chunks = [];
    this.encodeValue(value);
    return this.concat();
  }

  private concat(): Uint8Array {
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result;
  }

  private push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }

  private encodeHead(majorType: number, value: number): void {
    const mt = majorType << 5;
    if (value < 24) {
      this.push(new Uint8Array([mt | value]));
    } else if (value < 0x100) {
      this.push(new Uint8Array([mt | 24, value]));
    } else if (value < 0x10000) {
      this.push(new Uint8Array([mt | 25, (value >> 8) & 0xff, value & 0xff]));
    } else if (value < 0x100000000) {
      this.push(new Uint8Array([
        mt | 26,
        (value >> 24) & 0xff,
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff,
      ]));
    } else {
      const hi = Math.floor(value / 0x100000000);
      const lo = value >>> 0;
      this.push(new Uint8Array([
        mt | 27,
        (hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
        (lo >> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff,
      ]));
    }
  }

  private encodeValue(value: unknown): void {
    if (value === null || value === undefined) {
      this.push(new Uint8Array([MT_SIMPLE << 5 | SIMPLE_NULL]));
      return;
    }

    if (typeof value === 'boolean') {
      this.push(new Uint8Array([MT_SIMPLE << 5 | (value ? SIMPLE_TRUE : SIMPLE_FALSE)]));
      return;
    }

    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        throw new Error(`DCP CBOR: float values prohibited. Got: ${value}`);
      }
      if (value >= 0) {
        this.encodeHead(MT_UNSIGNED, value);
      } else {
        this.encodeHead(MT_NEGATIVE, -1 - value);
      }
      return;
    }

    if (typeof value === 'string') {
      const bytes = new TextEncoder().encode(value);
      this.encodeHead(MT_TEXT, bytes.length);
      this.push(bytes);
      return;
    }

    if (value instanceof Uint8Array) {
      this.encodeHead(MT_BYTES, value.length);
      this.push(value);
      return;
    }

    if (Array.isArray(value)) {
      this.encodeHead(MT_ARRAY, value.length);
      for (const item of value) {
        this.encodeValue(item);
      }
      return;
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined);

      // CTAP2 canonical: sort by encoded key length, then lexicographically
      const encodedEntries = entries.map(([key, val]) => {
        const keyEncoder = new CborEncoder();
        const keyBytes = keyEncoder.encode(key);
        return { key, val, keyBytes };
      });

      encodedEntries.sort((a, b) => {
        if (a.keyBytes.length !== b.keyBytes.length) {
          return a.keyBytes.length - b.keyBytes.length;
        }
        for (let i = 0; i < a.keyBytes.length; i++) {
          if (a.keyBytes[i] !== b.keyBytes[i]) {
            return a.keyBytes[i] - b.keyBytes[i];
          }
        }
        return 0;
      });

      this.encodeHead(MT_MAP, encodedEntries.length);
      for (const { keyBytes, val } of encodedEntries) {
        this.push(keyBytes);
        this.encodeValue(val);
      }
      return;
    }

    throw new Error(`DCP CBOR: unsupported type: ${typeof value}`);
  }
}

export class CborDecoder {
  private data!: Uint8Array;
  private pos = 0;

  decode(data: Uint8Array): unknown {
    this.data = data;
    this.pos = 0;
    const result = this.decodeValue();
    if (this.pos !== data.length) {
      throw new Error(`DCP CBOR: trailing data at offset ${this.pos}`);
    }
    return result;
  }

  private readByte(): number {
    if (this.pos >= this.data.length) {
      throw new Error('DCP CBOR: unexpected end of data');
    }
    return this.data[this.pos++];
  }

  private readBytes(n: number): Uint8Array {
    if (this.pos + n > this.data.length) {
      throw new Error('DCP CBOR: unexpected end of data');
    }
    const slice = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  private decodeLength(additional: number): number {
    if (additional < 24) return additional;
    if (additional === 24) return this.readByte();
    if (additional === 25) {
      const b = this.readBytes(2);
      return (b[0] << 8) | b[1];
    }
    if (additional === 26) {
      const b = this.readBytes(4);
      return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    }
    if (additional === 27) {
      const b = this.readBytes(8);
      const hi = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
      const lo = ((b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]) >>> 0;
      return hi * 0x100000000 + lo;
    }
    throw new Error(`DCP CBOR: unsupported additional info: ${additional}`);
  }

  private decodeValue(): unknown {
    const initial = this.readByte();
    const majorType = initial >> 5;
    const additional = initial & 0x1f;

    switch (majorType) {
      case MT_UNSIGNED:
        return this.decodeLength(additional);

      case MT_NEGATIVE:
        return -1 - this.decodeLength(additional);

      case MT_BYTES: {
        const len = this.decodeLength(additional);
        return this.readBytes(len);
      }

      case MT_TEXT: {
        const len = this.decodeLength(additional);
        const bytes = this.readBytes(len);
        return new TextDecoder().decode(bytes);
      }

      case MT_ARRAY: {
        const len = this.decodeLength(additional);
        const arr: unknown[] = [];
        for (let i = 0; i < len; i++) {
          arr.push(this.decodeValue());
        }
        return arr;
      }

      case MT_MAP: {
        const len = this.decodeLength(additional);
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < len; i++) {
          const key = this.decodeValue();
          if (typeof key !== 'string') {
            throw new Error(`DCP CBOR: only string map keys supported, got ${typeof key}`);
          }
          obj[key] = this.decodeValue();
        }
        return obj;
      }

      case MT_SIMPLE: {
        if (additional === SIMPLE_FALSE) return false;
        if (additional === SIMPLE_TRUE) return true;
        if (additional === SIMPLE_NULL) return null;
        throw new Error(`DCP CBOR: unsupported simple value: ${additional}`);
      }

      default:
        throw new Error(`DCP CBOR: unsupported major type: ${majorType}`);
    }
  }
}

// ── Convenience functions ──

const encoder = new CborEncoder();
const decoder = new CborDecoder();

export function cborEncode(value: unknown): Uint8Array {
  return new CborEncoder().encode(value);
}

export function cborDecode(data: Uint8Array): unknown {
  return new CborDecoder().decode(data);
}

/**
 * Convert a JSON DCP payload (with base64 fields) to CBOR-friendly format
 * where base64 strings in known fields become raw byte strings.
 */
export function jsonToCborPayload(json: Record<string, unknown>): Record<string, unknown> {
  const result = { ...json };
  const b64Fields = ['public_key_b64', 'sig_b64', 'secretKeyB64'];

  for (const [key, value] of Object.entries(result)) {
    if (b64Fields.includes(key) && typeof value === 'string') {
      result[key.replace('_b64', '')] = Buffer.from(value, 'base64');
      delete result[key];
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) {
      result[key] = jsonToCborPayload(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item && typeof item === 'object' && !(item instanceof Uint8Array)
          ? jsonToCborPayload(item as Record<string, unknown>)
          : item
      );
    }
  }
  return result;
}

/**
 * Convert a CBOR-decoded DCP payload back to JSON-compatible format
 * where byte strings become base64.
 */
export function cborPayloadToJson(cbor: Record<string, unknown>): Record<string, unknown> {
  const result = { ...cbor };

  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Uint8Array) {
      result[key + '_b64'] = Buffer.from(value).toString('base64');
      delete result[key];
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = cborPayloadToJson(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item && typeof item === 'object' && !(item instanceof Uint8Array)
          ? cborPayloadToJson(item as Record<string, unknown>)
          : item instanceof Uint8Array
            ? Buffer.from(item).toString('base64')
            : item
      );
    }
  }
  return result;
}

/**
 * Detect content type from raw bytes (CBOR starts with a map/array marker).
 */
export function detectWireFormat(data: Uint8Array): 'cbor' | 'json' {
  if (data.length === 0) return 'json';
  const first = data[0];
  // JSON starts with '{' (0x7B) or '[' (0x5B) or whitespace
  if (first === 0x7b || first === 0x5b || first === 0x20 || first === 0x0a || first === 0x0d || first === 0x09) {
    return 'json';
  }
  return 'cbor';
}
