import { describe, expect, it } from 'vitest';
import { cborDecode, cborEncode } from '../wire/cbor.js';

const decodeHex = (hex: string) => cborDecode(Buffer.from(hex, 'hex'));

describe('CBOR preserves the JSON data model', () => {
  it('keeps __proto__ as an own data property without changing the decoded prototype', () => {
    const input = JSON.parse('{"__proto__":{"elevated":true},"ok":1}');
    const decoded = cborDecode(cborEncode(input)) as Record<string, unknown>;
    expect(decoded).toStrictEqual(input);
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(decoded.elevated).toBeUndefined();
    expect(({} as Record<string, unknown>).elevated).toBeUndefined();
  });

  it('preserves special property names inside nested maps', () => {
    const input = JSON.parse('{"outer":{"__proto__":null,"constructor":1,"prototype":2}}');
    expect(cborDecode(cborEncode(input))).toStrictEqual(input);
  });

  it('rejects duplicate map keys instead of silently choosing one value', () => {
    expect(() => decodeHex('a2617801617802')).toThrow(/duplicate/i);
  });

  it('also detects duplicate __proto__ keys', () => {
    const key = cborEncode('__proto__');
    const bytes = Buffer.concat([Buffer.from([0xa2]), key, Buffer.from([1]), key, Buffer.from([2])]);
    expect(() => cborDecode(bytes)).toThrow(/duplicate/i);
  });

  it.each(['', 'plain', 'é', 'e\u0301', '😀', '\ufffd', '\ufeff', '\ufefftext'])
    ('preserves valid Unicode text %j', (text) => {
      expect(cborDecode(cborEncode(text))).toBe(text);
    });

  it.each(['61ff', '62c0ae', '63eda080', '64f4908080', '61c2'])
    ('rejects malformed UTF-8 %s', (hex) => {
      expect(() => decodeHex(hex)).toThrow();
    });

  it.each(['\ud800', '\udc00', 'a\ud800b', '\ud800\ud800', '\udc00\ud800'])
    ('rejects an unpaired surrogate rather than replacing it: %j', (text) => {
      expect(() => cborEncode(text)).toThrow(/Unicode|surrogate/i);
      expect(() => cborEncode({ [text]: 1 })).toThrow(/Unicode|surrogate/i);
    });

  it('preserves byte strings independently of UTF-8 text validation', () => {
    const bytes = Uint8Array.from([0xff, 0xc0, 0xae]);
    expect(cborDecode(cborEncode(bytes))).toEqual(bytes);
  });
});

describe('CBOR integers stay exact and never wrap', () => {
  it.each([
    [0, '00'], [23, '17'], [24, '1818'], [255, '18ff'],
    [256, '190100'], [65535, '19ffff'], [65536, '1a00010000'],
    [4294967296, '1b0000000100000000'], [-1, '20'], [-25, '3818'],
    [Number.MAX_SAFE_INTEGER, '1b001fffffffffffff'],
    [Number.MIN_SAFE_INTEGER, '3b001ffffffffffffe'],
  ])('uses the preferred encoding for %s', (value, hex) => {
    expect(Buffer.from(cborEncode(value)).toString('hex')).toBe(hex);
    expect(decodeHex(hex as string)).toBe(value);
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, 1e21, -1e21, Number.MAX_VALUE])
    ('refuses an unsafe encoder integer %s', (number) => {
      expect(() => cborEncode(number)).toThrow(/safe integer|range/i);
    });

  it.each(['1b0020000000000000', '1bffffffffffffffff', '3b001fffffffffffff', '3bffffffffffffffff'])
    ('refuses an unsafe decoded integer %s', (hex) => {
      expect(() => decodeHex(hex)).toThrow(/safe integer|range/i);
    });
});
