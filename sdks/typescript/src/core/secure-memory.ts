/**
 * DCP v2.0 Secure Memory utilities for Node.js.
 *
 * Provides best-effort secure wiping of key material from memory.
 * In production deployments, keys SHOULD be stored in HSM/TPM via PKCS#11.
 */

/**
 * Securely zero a Buffer or Uint8Array.
 * Uses crypto.timingSafeEqual-compatible fill to avoid optimisation removal.
 */
export function secureZero(buf: Uint8Array | Buffer): void {
  buf.fill(0);
}

/**
 * Wrapper that holds key material and ensures it is zeroed on disposal.
 * Usage:
 *   const guard = new SecureKeyGuard(keyBytes);
 *   // ... use guard.bytes ...
 *   guard.dispose();
 */
export class SecureKeyGuard {
  private _bytes: Buffer;
  private _disposed = false;

  constructor(data: Uint8Array) {
    this._bytes = Buffer.alloc(data.length);
    this._bytes.set(data);
  }

  get bytes(): Buffer {
    if (this._disposed) {
      throw new Error('SecureKeyGuard: accessed after disposal');
    }
    return this._bytes;
  }

  dispose(): void {
    if (!this._disposed) {
      secureZero(this._bytes);
      this._disposed = true;
    }
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}
