/**
 * HTTP helpers shared by the reference server (server/) and the services
 * (services/*): bounded body parsing, client IP for rate limiting and the
 * operator token that guards admin endpoints.
 */
import crypto from "crypto";

export const MAX_BODY_BYTES = 1_048_576; // 1 MB

/**
 * Parse a JSON body. Rejects with Error("PAYLOAD_TOO_LARGE") past maxBytes;
 * the rest of the body is drained, not buffered, so the caller can still
 * answer 413.
 */
export function parseBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) reject(new Error("PAYLOAD_TOO_LARGE"));
      else chunks.push(chunk);
    });
    req.on("end", () => {
      if (bytes > maxBytes) return;
      try { resolve(bytes ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

/**
 * X-Forwarded-For is client-controlled. Only behind a proxy we run
 * (TRUST_PROXY=true, e.g. Fly) is its last hop trustworthy: that one is
 * appended by the proxy itself.
 */
export function getClientIp(req) {
  const hops = process.env.TRUST_PROXY === "true" ? req.headers["x-forwarded-for"]?.split(",") : null;
  return hops?.at(-1).trim() || req.socket.remoteAddress || "unknown";
}

/**
 * Fixed-window rate limiter: the returned `allow(key)` turns false once `max`
 * calls for `key` fall in the current `windowMs` window.
 */
export function rateLimiter(max, windowMs) {
  const windows = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) if (now - entry.start > windowMs) windows.delete(key);
  }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    let entry = windows.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      windows.set(key, entry);
    }
    entry.count++;
    return entry.count <= max;
  };
}

/**
 * Admin endpoints require `Authorization: Bearer $OPERATOR_TOKEN`. With no
 * OPERATOR_TOKEN configured they stay locked.
 */
export function isOperator(req) {
  const token = process.env.OPERATOR_TOKEN;
  const given = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token || !given) return false;
  const digest = (s) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(digest(given), digest(token));
}

// decodeURIComponent throws on malformed escapes (e.g. %E0); inside an async
// handler that becomes an unhandled rejection and kills the process.
export function decodeParam(value) {
  try { return decodeURIComponent(value); }
  catch { return null; }
}
