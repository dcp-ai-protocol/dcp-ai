// playground/js/core/utils.js — Shared utilities

export function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

export function sessionNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hexEncode(bytes);
}

export function isoNow() {
  return new Date().toISOString();
}

export function hexEncode(uint8) {
  return Array.from(uint8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexDecode(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function b64encode(uint8) {
  return nacl.util.encodeBase64(uint8);
}

export function b64decode(str) {
  return nacl.util.decodeBase64(str);
}

export function isoFuture(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}
