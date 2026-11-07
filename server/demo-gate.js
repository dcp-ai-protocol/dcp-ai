/**
 * The gate of the reference server's DCP-05–09 demo endpoints: 31 schema-only record stores for lifecycle,
 * succession, disputes, rights and delegation. They verify no signature and establish no principal authority.
 *
 * Off unless the operator starts the server with DCP_DEMO_ENDPOINTS=dcp-05-09 and a usable OPERATOR_TOKEN.
 * Off, every request under the twelve families answers 404; on, every request there needs
 * `Authorization: Bearer <OPERATOR_TOKEN>`, before its body is read or any store is touched. The shared
 * isOperator of lib/http.js, which the admin endpoints use, is not changed.
 */
import crypto from "crypto";

/**
 * The raw request target of every demo route: one of the twelve family prefixes, then "/", "?", "#" or the end.
 * Each of the 31 handlers matches only URLs that start this way, so the gate covers whatever they accept.
 */
export const DEMO_FAMILIES = /^\/v2\/(?:lifecycle|succession|disputes|objections|jurisprudence|rights|obligations|delegation|agent-advisory|mirror|interactions|awareness)(?=[/?#]|$)/;

export const DEMO_VALUE = "dcp-05-09";
// RFC 6750 b64token; the length is a floor on what the operator sets, not a measure of its entropy.
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;
export const MIN_DEMO_TOKEN_LENGTH = 32;

/**
 * Reads DCP_DEMO_ENDPOINTS and, when it enables the demo, OPERATOR_TOKEN, from `env`. Returns true (on) or
 * false (off); anything else throws, and no message carries the token.
 */
export function demoEnabled(env) {
  const value = env.DCP_DEMO_ENDPOINTS;
  if (value === undefined || value === "off") return false;
  if (value !== DEMO_VALUE) throw new Error(`CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset, "off" or "${DEMO_VALUE}"`);
  const token = env.OPERATOR_TOKEN;
  if (token === undefined || token === "") throw new Error(`CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS=${DEMO_VALUE} needs OPERATOR_TOKEN`);
  if (!B64TOKEN.test(token) || token.length < MIN_DEMO_TOKEN_LENGTH) {
    throw new Error(`CONFIG_INVALID_VALUE: with DCP_DEMO_ENDPOINTS=${DEMO_VALUE}, OPERATOR_TOKEN must be an RFC 6750 b64token of at least ${MIN_DEMO_TOKEN_LENGTH} characters`);
  }
  return true;
}

/**
 * True only for exactly `Bearer <token>`: the scheme in any case (RFC 7235 § 2.1), one space, and the token
 * itself. A bare token, another scheme, extra spaces or anything after the token is false.
 */
export function isDemoOperator(authorization, token) {
  if (typeof authorization !== "string" || !token) return false;
  const m = /^bearer ([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization);
  if (!m) return false;
  const digest = (s) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(digest(m[1]), digest(token));
}
