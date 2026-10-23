//! Rust agent for tools/interop-matrix (protocol in ../../README.md).
//! Built on the LOCAL Rust SDK (sdks/rust). One JSON request per stdin line,
//! one JSON response per stdout line, in order.
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};

use dcp_ai::providers::{ed25519::Ed25519Provider, ml_dsa_65::MlDsa65Provider};
use dcp_ai::v2::bundle::{build_bundle_v2, sign_bundle_v2};
use dcp_ai::v2::canonicalize::canonicalize_v2;
use dcp_ai::v2::composite_ops::{composite_sign, CompositeKeyInfo};
use dcp_ai::v2::crypto_provider::CryptoProvider;
use dcp_ai::v2::domain_separation::{
    CTX_AGENT_PASSPORT, CTX_INTENT, CTX_POLICY_DECISION, CTX_RESPONSIBLE_PRINCIPAL,
};
use dcp_ai::v2::dual_hash::sha256_hex;
use dcp_ai::v2::security_tier::compute_security_tier;
use dcp_ai::v2::session_nonce::generate_session_nonce;
use dcp_ai::v2::signed_payload::{prepare_payload, SignedPayload};
use dcp_ai::v2::types::VerifierPolicy;
use dcp_ai::v2::verify_bundle::verify_signed_bundle_v2_with_policy;
use serde_json::{json, Value};

type Res = Result<Value, String>;

struct Keys {
    classical: CompositeKeyInfo,
    pq: CompositeKeyInfo,
}

struct Intent {
    intent: SignedPayload,
    policy: SignedPayload,
    trail: Vec<Value>,
}

struct State {
    human: Keys,
    agent: Keys,
    nonce: String,
    human_id: String,
    agent_id: String,
    rpr: SignedPayload,
    passport: SignedPayload,
    intents: HashMap<String, Intent>,
}

fn now() -> String {
    humantime::format_rfc3339_millis(std::time::SystemTime::now()).to_string()
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn sha256(bytes: &[u8]) -> String {
    format!("sha256:{}", sha256_hex(bytes))
}

fn canonical_hash(v: &Value) -> Result<String, String> {
    Ok(sha256(canonicalize_v2(v)?.as_bytes()))
}

fn key(p: &dyn CryptoProvider) -> Result<CompositeKeyInfo, String> {
    let k = p.generate_keypair().map_err(|e| e.to_string())?;
    Ok(CompositeKeyInfo {
        kid: k.kid,
        alg: p.alg().to_string(),
        secret_key_b64: k.secret_key_b64,
        public_key_b64: k.public_key_b64,
    })
}

fn key_pair() -> Result<Keys, String> {
    Ok(Keys {
        classical: key(&Ed25519Provider)?,
        pq: key(&MlDsa65Provider)?,
    })
}

fn entries(keys: &Keys, at: &str) -> Value {
    let e = |k: &CompositeKeyInfo| {
        json!({"kid": k.kid, "alg": k.alg, "public_key_b64": k.public_key_b64,
               "created_at": at, "expires_at": null, "status": "active"})
    };
    json!([e(&keys.classical), e(&keys.pq)])
}

fn sign(context: &str, bytes: &[u8], keys: &Keys) -> Res {
    let sig = composite_sign(
        &Ed25519Provider,
        &MlDsa65Provider,
        context,
        bytes,
        &keys.classical,
        &keys.pq,
    )
    .map_err(|e| e.to_string())?;
    serde_json::to_value(sig).map_err(|e| e.to_string())
}

fn signed(payload: Value, context: &str, keys: &Keys) -> Result<SignedPayload, String> {
    let (bytes, payload_hash) = prepare_payload(&payload)?;
    let composite_sig =
        serde_json::from_value(sign(context, &bytes, keys)?).map_err(|e| e.to_string())?;
    Ok(SignedPayload {
        payload,
        payload_hash,
        composite_sig,
    })
}

fn arg<'a>(args: &'a Value, name: &str) -> Result<&'a Value, String> {
    args.get(name)
        .ok_or_else(|| format!("missing argument {name}"))
}

fn arg_str<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    arg(args, name)?
        .as_str()
        .ok_or_else(|| format!("{name} must be a string"))
}

fn identity(state: &mut Option<State>, args: &Value) -> Res {
    let (human, agent) = (key_pair()?, key_pair()?);
    let at = now();
    let nonce = generate_session_nonce();
    let human_id = format!("rpr:{}", uuid());
    let agent_id = format!("agent:{}", uuid());
    let rpr = json!({
        "dcp_version": "2.0", "human_id": human_id, "session_nonce": nonce,
        "legal_name": arg(args, "owner_name")?, "entity_type": "natural_person",
        "jurisdiction": arg(args, "jurisdiction")?, "liability_mode": "owner_responsible",
        "override_rights": true, "issued_at": at, "expires_at": null, "contact": null,
        "binding_keys": entries(&human, &at),
    });
    let passport = json!({
        "dcp_version": "2.0", "agent_id": agent_id, "session_nonce": nonce,
        "keys": entries(&agent, &at), "principal_binding_reference": human_id,
        "capabilities": ["api_call", "payments"], "risk_tier": "medium", "created_at": at,
        "status": "active",
    });
    let result = json!({"agent_id": agent_id, "human_id": human_id, "session_nonce": nonce});
    *state = Some(State {
        rpr: signed(rpr, CTX_RESPONSIBLE_PRINCIPAL, &human)?,
        passport: signed(passport, CTX_AGENT_PASSPORT, &agent)?,
        human,
        agent,
        nonce,
        human_id,
        agent_id,
        intents: HashMap::new(),
    });
    Ok(result)
}

fn intent(s: &mut State, args: &Value) -> Res {
    let risk_score = arg(args, "risk_score")?
        .as_i64()
        .ok_or("risk_score must be an integer")?;
    let impact = arg_str(args, "estimated_impact")?;
    let at = now();
    let intent_id = format!("intent:{}", uuid());
    let mut intent = json!({
        "dcp_version": "2.0", "intent_id": intent_id, "session_nonce": s.nonce,
        "agent_id": s.agent_id, "human_id": s.human_id, "timestamp": at,
        "action_type": arg(args, "action_type")?,
        "target": {"channel": arg(args, "channel")?, "to": null},
        "data_classes": arg(args, "data_classes")?, "estimated_impact": impact,
        "requires_consent": impact == "high",
    });
    let tier = compute_security_tier(&intent, Some(&json!({ "risk_score": risk_score })));
    intent["security_tier"] = json!(tier.as_str());
    let decision = match risk_score {
        r if r < 500 => "approve",
        r if r < 800 => "escalate",
        _ => "block",
    };
    let confirmation = match decision {
        "approve" => Value::Null,
        _ => json!({"type": "human_approve", "fields": ["action_type"]}),
    };
    let policy = json!({
        "dcp_version": "2.0", "intent_id": intent_id, "session_nonce": s.nonce,
        "decision": decision, "risk_score": risk_score,
        "reasons": [format!("interop-matrix: risk_score {risk_score}")],
        "required_confirmation": confirmation,
        "applied_policy_hash": arg(args, "applied_policy_hash")?, "timestamp": at,
        "resolved_tier": tier.as_str(),
    });
    let entry = Intent {
        intent: signed(intent, CTX_INTENT, &s.agent)?,
        policy: signed(policy, CTX_POLICY_DECISION, &s.agent)?,
        trail: Vec::new(),
    };
    s.intents.insert(intent_id.clone(), entry);
    Ok(json!({"intent_id": intent_id, "decision": decision, "security_tier": tier.as_str()}))
}

fn act(s: &mut State, args: &Value) -> Res {
    let intent_id = arg_str(args, "intent_id")?;
    let (nonce, agent_id, human_id) = (&s.nonce, &s.agent_id, &s.human_id);
    let it = s
        .intents
        .get_mut(intent_id)
        .ok_or(format!("unknown intent {intent_id}"))?;
    let prev_hash = match it.trail.last() {
        Some(prev) => canonical_hash(prev)?,
        None => "GENESIS".to_string(),
    };
    let decision = match it.policy.payload["decision"].as_str() {
        Some("approve") => "approved",
        Some("escalate") => "escalated",
        _ => "blocked",
    };
    let result_ref = arg_str(args, "result_ref")?;
    let audit_id = format!("audit:{}", uuid());
    it.trail.push(json!({
        "dcp_version": "2.0", "audit_id": audit_id, "session_nonce": nonce,
        "prev_hash": prev_hash, "hash_alg": "sha256", "timestamp": now(),
        "agent_id": agent_id, "human_id": human_id, "intent_id": intent_id,
        "intent_hash": canonical_hash(&it.intent.payload)?,
        "policy_decision": decision, "outcome": arg(args, "outcome")?,
        "evidence": {"tool": arg(args, "tool")?, "result_ref": result_ref,
                     "evidence_hash": sha256(result_ref.as_bytes())},
        "pq_checkpoint_ref": null,
    }));
    Ok(json!({"audit_id": audit_id, "count": it.trail.len()}))
}

fn bundle(s: &State, args: &Value) -> Res {
    let intent_id = arg_str(args, "intent_id")?;
    let it = s
        .intents
        .get(intent_id)
        .ok_or(format!("unknown intent {intent_id}"))?;
    let bundle = build_bundle_v2(
        &s.rpr,
        &s.passport,
        &it.intent,
        &it.policy,
        &it.trail,
        &s.nonce,
    )?;
    let signed = sign_bundle_v2(bundle, &s.human.classical, &s.human.pq)?;
    Ok(json!({"signed_bundle": signed}))
}

fn verify(args: &Value) -> Res {
    let mode = args.get("mode").and_then(Value::as_str).unwrap_or("");
    let mut policy = VerifierPolicy::default();
    if !mode.is_empty() {
        policy.default_mode = mode.to_string();
        policy.risk_overrides = ["low", "medium", "high"]
            .iter()
            .map(|t| (t.to_string(), mode.to_string()))
            .collect();
    }
    let r = verify_signed_bundle_v2_with_policy(
        args.get("signed_bundle").unwrap_or(&Value::Null),
        &policy,
    );
    Ok(json!({"valid": r.verified, "errors": r.errors}))
}

fn handle(state: &mut Option<State>, cmd: &str, args: &Value) -> Res {
    let no_identity = || "no identity".to_string();
    match cmd {
        "identity" => identity(state, args),
        "intent" => intent(state.as_mut().ok_or_else(no_identity)?, args),
        "act" => act(state.as_mut().ok_or_else(no_identity)?, args),
        "bundle" => bundle(state.as_ref().ok_or_else(no_identity)?, args),
        "verify" => verify(args),
        "shutdown" => Ok(json!({})),
        _ => Err(format!("unknown command {cmd}")),
    }
}

fn main() {
    let mut state: Option<State> = None;
    let mut out = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let cmd = req.get("cmd").and_then(Value::as_str).unwrap_or("");
        let args = req.get("args").cloned().unwrap_or(json!({}));
        let result = if req.is_null() {
            Err("malformed request".to_string())
        } else {
            catch_unwind(AssertUnwindSafe(|| handle(&mut state, cmd, &args)))
                .unwrap_or_else(|_| Err(format!("panic in {cmd}")))
        };
        let resp = match result {
            Ok(result) => json!({"id": id, "ok": true, "result": result}),
            Err(error) => json!({"id": id, "ok": false, "error": error}),
        };
        writeln!(out, "{resp}")
            .and_then(|_| out.flush())
            .expect("stdout");
        if cmd == "shutdown" {
            break;
        }
    }
}
