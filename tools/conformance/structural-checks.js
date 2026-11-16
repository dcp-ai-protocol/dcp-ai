// SDK-free checks of the structural corpus (tests/interop/v2/structural_vectors.json): they show that each bundle carries
// the structural violation its case is built to carry, computed without any SDK verifier. They do not show which check
// of an implementation rejects a bundle, and their list is not exhaustive: the integrity layer stops at the first
// error it cannot get past (a payload that does not canonicalize ends it, as in the payload fraction case). It reuses the integrity layer of schema-boundary.js (payload hashes, manifest commitments,
// audit count, chain and root, artifact and bundle signatures over leniently decoded bytes) and adds:
//   sig_b64      every sig_b64 (bundle, artifacts, checkpoints) is canonical base64 (spec/VERIFICATION.md V2-5);
//   checkpoints  V2-12: listed equals carried, event_range is a forward run of real trail positions with `count`
//                entries, merkle_root over those entries, both components present and valid under the passport keys
//                and DCP-AI.v2.AuditEvent, session_nonce of the manifest;
//   session      V2-4: session_issued_at not after session_expires_at, not expired, not more than 30 s in the future.
// Like the integrity layer it is evidence for this finite corpus, not a normative verifier: no policy, mode, tier,
// key status, kid derivation or cross-artifact rule, and only the RFC 3339 forms this corpus holds.
import crypto from "crypto";
import nacl from "tweetnacl";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { canon, integrity } from "./schema-boundary.js";

export const CORPUS = "tests/interop/v2/structural_vectors.json";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest();

export const canonicalB64 = (s) => typeof s === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0 && Buffer.from(s, "base64").toString("base64") === s;

/** The SHA-256 Merkle root of V2-3 and V2-12 (2): raw 32-byte leaf digests, the last node duplicated on an odd layer. */
export function merkleRoot(entries) {
  let layer = entries.map((e) => sha256(Buffer.from(canon(e), "utf8")));
  while (layer.length > 1) {
    if (layer.length % 2) layer.push(layer[layer.length - 1]);
    const next = [];
    for (let i = 0; i < layer.length; i += 2) next.push(sha256(Buffer.concat([layer[i], layer[i + 1]])));
    layer = next;
  }
  return `sha256:${layer[0].toString("hex")}`;
}

/** Each component of a composite signature checked on its own: the classical one, then the PQ one over msg || classical bytes. */
export function components(context, text, cs, keys) {
  const msg = Buffer.concat([Buffer.from(context, "utf8"), Buffer.from([0]), Buffer.from(text, "utf8")]);
  const key = (kid) => { const k = keys.find((e) => e.kid === kid); return k && Buffer.from(k.public_key_b64, "base64"); };
  const csig = Buffer.from(cs?.classical?.sig_b64 ?? "", "base64");
  const ck = key(cs?.classical?.kid);
  const pk = cs?.pq ? key(cs.pq.kid) : undefined;
  return {
    classical: Boolean(ck) && csig.length === 64 && nacl.sign.detached.verify(msg, csig, ck),
    pq: cs?.pq ? Boolean(pk) && ml_dsa65.verify(Buffer.from(cs.pq.sig_b64, "base64"), Buffer.concat([msg, csig]), pk) : null,
  };
}

export const checkpointText = (cp) => { const { composite_sig: _c, ...body } = cp; return canon(body); };

function checkpointFailures(b) {
  const out = [];
  const listed = b.manifest.pq_checkpoints ?? [];
  const carried = b.pq_checkpoints ?? [];
  const ids = carried.map((c) => c.checkpoint_id);
  if (listed.length !== ids.length || listed.some((id) => !ids.includes(id)) || new Set(ids).size !== ids.length) out.push("checkpoints: listed and carried differ");
  const trail = b.audit_entries.map((e) => e.audit_id);
  for (const cp of carried) {
    const at = `checkpoint ${cp.checkpoint_id}`;
    const from = trail.indexOf(cp.event_range.from_audit_id);
    const to = trail.indexOf(cp.event_range.to_audit_id);
    if (from < 0 || to < 0) out.push(`${at}: event_range names an audit_id absent from the trail`);
    else if (from > to) out.push(`${at}: event_range is not a forward run of the trail`);
    else {
      if (to - from + 1 !== cp.event_range.count) out.push(`${at}: event_range count`);
      if (merkleRoot(b.audit_entries.slice(from, to + 1)) !== cp.merkle_root) out.push(`${at}: merkle_root`);
    }
    if (cp.session_nonce !== b.manifest.session_nonce) out.push(`${at}: session_nonce`);
    const c = components("DCP-AI.v2.AuditEvent", checkpointText(cp), cp.composite_sig, b.agent_passport.payload.keys);
    if (!c.classical) out.push(`${at}: classical signature`);
    if (c.pq === null) out.push(`${at}: pq signature absent`);
    else if (!c.pq) out.push(`${at}: pq signature`);
  }
  return out;
}

function sigB64Failures(signed) {
  const b = signed.bundle;
  const sigs = [["bundle", signed.signature.composite_sig],
    ...["responsible_principal_record", "agent_passport", "intent", "policy_decision"].map((n) => [n, b[n].composite_sig]),
    ...(b.pq_checkpoints ?? []).map((c) => [`checkpoint ${c.checkpoint_id}`, c.composite_sig])];
  return sigs.flatMap(([label, cs]) => [["classical", cs.classical], ["pq", cs.pq]].filter(([, s]) => s).filter(([, s]) => !canonicalB64(s.sig_b64)).map(([k]) => `${label}: ${k} sig_b64 not canonical`));
}

function sessionFailures(m, time) {
  const out = [];
  const t = Date.parse(time);
  const issued = m.session_issued_at === undefined ? undefined : Date.parse(m.session_issued_at);
  const expires = m.session_expires_at === undefined ? undefined : Date.parse(m.session_expires_at);
  if (expires !== undefined && expires <= t) out.push("session: expired");
  if (issued !== undefined && issued > t + 30000) out.push("session: issued more than 30 s after the verification time");
  if (issued !== undefined && expires !== undefined && issued > expires) out.push("session: issued after it expires");
  return out;
}

/** The structural failures these checks find in a bundle at `time` (integrity layer, V2-5 encodings, V2-12 checkpoints, V2-4 session order); not exhaustive. */
export function structure(signed, time) {
  const failures = [...integrity(signed).failures];
  try {
    failures.push(...sigB64Failures(signed), ...checkpointFailures(signed.bundle), ...sessionFailures(signed.bundle.manifest, time));
  } catch (e) {
    failures.push(`structure: ${e.message}`);
  }
  return failures;
}
