//! DCP-AI Rust SDK — Digital Citizenship Protocol for AI Agents.
//!
//! Provides types, Ed25519 cryptography, SHA-256 hashing, Merkle trees,
//! and full signed bundle verification. V2 adds composite hybrid signatures,
//! domain separation, and post-quantum algorithm support.

pub mod types;
pub mod crypto;
pub mod verify;
pub mod v2;
pub mod providers;
pub mod observability;
mod clock;

pub use types::*;
pub use crypto::{
    canonicalize, hash_object, generate_keypair, sign_object, verify_object,
    merkle_root_from_hex_leaves,
};
pub use verify::verify_signed_bundle;

/// Detect the DCP protocol version from a JSON value.
pub fn detect_dcp_version(value: &serde_json::Value) -> Option<&str> {
    if let Some(v) = value.get("dcp_version").and_then(|v| v.as_str()) {
        match v {
            "1.0" | "2.0" => return Some(v),
            _ => {}
        }
    }
    if let Some(v) = value.get("dcp_bundle_version").and_then(|v| v.as_str()) {
        if v == "2.0" {
            return Some("2.0");
        }
    }
    if let Some(bundle) = value.get("bundle") {
        if let Some(v) = bundle.get("dcp_bundle_version").and_then(|v| v.as_str()) {
            if v == "2.0" {
                return Some("2.0");
            }
        }
        if let Some(rpr) = bundle.get("responsible_principal_record") {
            if rpr.get("dcp_version").and_then(|v| v.as_str()) == Some("1.0") {
                return Some("1.0");
            }
        }
    }
    None
}

// ── WASM bindings ──

#[cfg(feature = "wasm")]
pub mod wasm {
    use wasm_bindgen::prelude::*;
    use serde_json::{json, Value};
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;

    use crate::crypto;
    use crate::verify;
    use crate::providers::ed25519::Ed25519Provider;
    use crate::providers::ml_dsa_65::MlDsa65Provider;
    use crate::providers::slh_dsa_192f::SlhDsa192fProvider;
    use crate::v2::crypto_provider::CryptoProvider;
    use crate::v2::composite_ops::{
        CompositeKeyInfo, composite_sign, classical_only_sign, composite_verify,
    };
    use crate::v2::composite_sig::{CompositeSignature, SignatureEntry};
    use crate::v2::dual_hash;
    use crate::v2::canonicalize::canonicalize_v2;
    use crate::v2::signed_payload;
    use crate::v2::verify_bundle::provider_for_alg;
    use crate::v2::proof_of_possession::{
        PopChallenge, generate_registration_pop, verify_registration_pop,
    };

    fn json_err(msg: &str) -> String {
        format!("{{\"error\":\"{}\"}}", msg.replace('"', "'"))
    }

    // ── V1 Compatibility ──────────────────────────────────────────────────

    #[wasm_bindgen]
    pub fn wasm_verify_signed_bundle(signed_bundle_json: &str, public_key_b64: Option<String>) -> String {
        let sb: Value = match serde_json::from_str(signed_bundle_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse error: {}", e)),
        };
        let result = verify::verify_signed_bundle(&sb, public_key_b64.as_deref());
        serde_json::to_string(&result).unwrap_or_else(|_| "{\"verified\":false}".to_string())
    }

    #[wasm_bindgen]
    pub fn wasm_hash_object(json_str: &str) -> String {
        let obj: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        crypto::hash_object(&obj)
    }

    #[wasm_bindgen]
    pub fn wasm_detect_version(json_str: &str) -> String {
        let val: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(_) => return "null".to_string(),
        };
        match crate::detect_dcp_version(&val) {
            Some(v) => format!("\"{}\"", v),
            None => "null".to_string(),
        }
    }

    // ── EXPERIMENTAL, opt-in: candidate dcp-jcs-v2 ingress of one unit (phase 1) ──

    /// EXPERIMENTAL, opt-in: the candidate ingress of one unit from its original bytes. Returns
    /// {"status":"accept","canonical":<text>,"canonical_sha256":<hex>} or
    /// {"status":"reject","class":<class>,"offset":<byte offset>}; {"error":...} only for an
    /// internal error, never for the data. It verifies, signs or admits nothing.
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_ingress(input: &[u8]) -> String {
        use crate::v2::experimental_candidate_ingress::{experimental_candidate_ingress, CandidateIngressOutcome};
        match experimental_candidate_ingress(input) {
            Ok(CandidateIngressOutcome::Accept { canonical, canonical_sha256, .. }) => match String::from_utf8(canonical) {
                Ok(text) => json!({"status": "accept", "canonical": text, "canonical_sha256": canonical_sha256}).to_string(),
                Err(_) => json_err("canonical bytes are not UTF-8"),
            },
            Ok(CandidateIngressOutcome::Reject { class, offset }) => {
                json!({"status": "reject", "class": class.as_str(), "offset": offset}).to_string()
            }
            Err(e) => json_err(&e.to_string()),
        }
    }

    // ── EXPERIMENTAL, opt-in: candidate dcp-jcs-v2 router (phase 2) ──
    //
    // Stateless: `route` either ends or returns the decision point where the JS historical decoder must
    // be consulted; `resume` recomputes everything from its own arguments, accepts the decoder's result
    // only at that same point, and can only end in a rejection or a v1 delegation, never `candidate`.
    // A misuse is {"usage_error": ...}, never a result for the data. The point checks coherence; it is
    // not authentication: a caller can always lie about what its decoder returned.

    use crate::v2::experimental_candidate_router::{
        CandidateExtraction, CandidateHistorical, CandidateRoute, CandidateRouter, CandidateRouterConfig,
        HistoricalAdapter, HistoricalDecode, HistoricalPoint,
    };

    fn candidate_router(config_json: &str) -> Result<CandidateRouter, String> {
        let config: Value = serde_json::from_str(config_json)
            .map_err(|_| json!({"config_error": {"code": "CONFIG_INVALID", "detail": "CONFIG"}}).to_string())?;
        let name = config.get("historical").and_then(Value::as_str).unwrap_or("").to_string();
        CandidateRouter::new(CandidateRouterConfig {
            transport: config.get("transport").and_then(Value::as_str).unwrap_or("").into(),
            accepted_profiles: config.get("accepted_profiles").cloned().unwrap_or(Value::Null),
            historical: Some(HistoricalAdapter::custom(name, |_| {
                Err(HistoricalDecode::Adapter("the wasm binding consults the JS decoder through resume".into()))
            })),
        })
        .map_err(|e| json!({"config_error": {"code": e.code, "detail": e.detail}}).to_string())
    }

    fn normalized_config(router: &CandidateRouter) -> Value {
        let (transport, profiles, historical) = router.configuration();
        json!({"transport": transport, "accepted_profiles": profiles, "historical": historical})
    }

    fn point_json(router: &CandidateRouter, point: &HistoricalPoint, unit: &[u8]) -> Value {
        use sha2::Digest;
        json!({
            "step": point.step,
            "unit": [point.start, point.end],
            "unit_sha256": hex::encode(sha2::Sha256::digest(unit)),
            "diagnosis": point.diagnosis.as_ref().map(|d| json!({"class": d.class, "offset": d.offset})),
            "scanner_profile": point.scanner_profile.map(|(p, o)| json!({"profile": p, "offset": o})),
            "config": normalized_config(router),
        })
    }

    fn route_json(route: &CandidateRoute) -> Value {
        let attempts = route.attempts();
        match route {
            CandidateRoute::Reject { class, detail, offset, transport_offset, unit, profile } => json!({
                "outcome": "reject", "class": class, "detail": detail, "offset": offset, "transport_offset": transport_offset,
                "unit": unit.map(|(s, e)| json!({"start": s, "end": e})), "profile": profile, "attempts": attempts, "warnings": [],
            }),
            CandidateRoute::V1Path { unit, profile_source, warnings, historical } => json!({
                "outcome": "v1_path", "unit": {"start": unit.start, "end": unit.end}, "profile": "dcp-jcs-v1",
                "profile_source": profile_source, "attempts": attempts,
                "warnings": warnings.iter().map(|w| json!({"class": w.class, "offset": w.offset, "transport_offset": w.transport_offset})).collect::<Vec<_>>(),
                "historical": match &historical.decoded {
                    Some(v) => json!({"adapter": historical.adapter, "decoded": v}),
                    None => json!({"adapter": historical.adapter, "failed": historical.failed}),
                },
            }),
            CandidateRoute::Candidate { unit, canonical, canonical_sha256, .. } => json!({
                "outcome": "candidate", "unit": {"start": unit.start, "end": unit.end}, "profile": "dcp-jcs-v2",
                "attempts": attempts, "warnings": [], "canonical": String::from_utf8_lossy(canonical), "canonical_sha256": canonical_sha256,
            }),
        }
    }

    enum CandidateStop {
        Needs(Value),
        Usage(String),
        Internal(String),
    }

    impl From<crate::v2::experimental_candidate_ingress::CandidateIngressInternalError> for CandidateStop {
        fn from(e: crate::v2::experimental_candidate_ingress::CandidateIngressInternalError) -> Self {
            CandidateStop::Internal(e.to_string())
        }
    }

    /// EXPERIMENTAL, opt-in: validates a router configuration before any input. Returns the normalized
    /// configuration, or {"config_error": {"code", "detail"}}.
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_config(config_json: &str) -> String {
        match candidate_router(config_json) {
            Ok(router) => normalized_config(&router).to_string(),
            Err(e) => e,
        }
    }

    /// EXPERIMENTAL, opt-in: the unit of a transport (T1–T5), as offsets in the input.
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_extract(input: &[u8], transport: &str) -> String {
        match crate::v2::experimental_candidate_router::extract_unit(input, transport) {
            Ok(CandidateExtraction::Unit { start, end }) => json!({"status": "unit", "start": start, "end": end}).to_string(),
            Ok(CandidateExtraction::Reject { class, detail, transport_offset }) => {
                json!({"status": "reject", "class": class, "detail": detail, "transport_offset": transport_offset}).to_string()
            }
            Err(e) => json!({"usage_error": e}).to_string(),
        }
    }

    /// EXPERIMENTAL, opt-in: the route, or {"needs_historical": point} where the JS decoder must be
    /// consulted (once) before `wasm_experimental_candidate_resume`.
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_route(input: &[u8], config_json: &str) -> String {
        let router = match candidate_router(config_json) {
            Ok(r) => r,
            Err(e) => return e,
        };
        let result = router.route_internal(input, &mut |point, unit| Err(CandidateStop::Needs(point_json(&router, point, unit))));
        match result {
            Ok(route) => route_json(&route).to_string(),
            Err(CandidateStop::Needs(point)) => json!({"needs_historical": point}).to_string(),
            Err(CandidateStop::Usage(m)) => json!({"usage_error": m}).to_string(),
            Err(CandidateStop::Internal(m)) => json_err(&m),
        }
    }

    /// EXPERIMENTAL, opt-in: finishes a route with the JS decoder's result: {"json": text} (the
    /// wrapper's object path), {"text": text} (a text path) or {"failed": reason}. Everything is
    /// recomputed from these arguments; the decoder's result is used only at the same decision point
    /// (step, unit, unit hash, diagnosis, scanner reading and normalized configuration).
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_resume(input: &[u8], config_json: &str, point_json_text: &str, historical_json: &str) -> String {
        let router = match candidate_router(config_json) {
            Ok(r) => r,
            Err(e) => return e,
        };
        let (given, historical): (Value, Value) = match (serde_json::from_str(point_json_text), serde_json::from_str(historical_json)) {
            (Ok(p), Ok(h)) => (p, h),
            _ => return json!({"usage_error": "the point and the historical result must be JSON"}).to_string(),
        };
        let mut consulted = false;
        let result = router.route_internal(input, &mut |point, unit| {
            consulted = true;
            if point_json(&router, point, unit) != given {
                return Err(CandidateStop::Usage("the decision point does not match this input and configuration".into()));
            }
            let (_, _, adapter) = router.configuration();
            let parsed = |text: &str| match serde_json::from_str::<Value>(text) {
                Ok(v) => CandidateHistorical { adapter: adapter.clone(), decoded: Some(v), failed: None },
                Err(e) => CandidateHistorical { adapter: adapter.clone(), decoded: None, failed: Some(e.to_string()) },
            };
            let fields = (
                historical.get("json").and_then(Value::as_str),
                historical.get("text").and_then(Value::as_str),
                historical.get("failed").and_then(Value::as_str),
            );
            match fields {
                (Some(text), None, None) | (None, Some(text), None) => Ok(parsed(text)),
                (None, None, Some(reason)) => Ok(CandidateHistorical { adapter: adapter.clone(), decoded: None, failed: Some(reason.into()) }),
                _ => Err(CandidateStop::Usage("the historical result must be one of {json}, {text} or {failed}".into())),
            }
        });
        match result {
            Ok(_) if !consulted => json!({"usage_error": "resume without a historical step"}).to_string(),
            Ok(CandidateRoute::Candidate { .. }) => json_err("resume produced a candidate"),
            Ok(route) => route_json(&route).to_string(),
            Err(CandidateStop::Needs(_)) => json_err("resume asked for the historical decoder again"),
            Err(CandidateStop::Usage(m)) => json!({"usage_error": m}).to_string(),
            Err(CandidateStop::Internal(m)) => json_err(&m),
        }
    }

    /// EXPERIMENTAL, opt-in (phase 3): the route of `input` and, for a candidate, its verification
    /// with today's verifier accepting exactly dcp-jcs-v2, on the exact value the router extracted from
    /// `input` itself, the policy parsed and the clock read as `wasm_verify_signed_bundle_v2` does.
    /// Returns {"route", "entered", "verification"} for a rejection (no verifier) or a candidate, or
    /// {"needs_historical": point} unchanged: the decoder is consulted in JS, `resume` (which never
    /// verifies) ends in a rejection or a delegation, and JS delegates the decoder's own string.
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_verify(input: &[u8], config_json: &str, policy_json: Option<String>) -> String {
        let router = match candidate_router(config_json) {
            Ok(r) => r,
            Err(e) => return e,
        };
        let result = router.route_internal(input, &mut |point, unit| Err(CandidateStop::Needs(point_json(&router, point, unit))));
        match result {
            Ok(route @ CandidateRoute::Reject { .. }) => {
                json!({"route": route_json(&route), "entered": "none", "verification": null}).to_string()
            }
            Ok(CandidateRoute::V1Path { .. }) => json_err("a delegation without a decision point"),
            Ok(ref route @ CandidateRoute::Candidate { ref value, .. }) => {
                let policy: crate::v2::types::VerifierPolicy = match policy_json.as_deref().map(serde_json::from_str) {
                    None => Default::default(),
                    Some(Ok(p)) => p,
                    Some(Err(e)) => {
                        return json!({
                            "route": route_json(route), "entered": "dcp-jcs-v2",
                            "verification": {"verified": false, "errors": [format!("Policy parse error: {}", e)]},
                        })
                        .to_string()
                    }
                };
                let now = crate::v2::lifecycle::unix_now_millis() as i64;
                match crate::v2::experimental_candidate_verify::verify_candidate(value, &policy, now, &mut |_| {}) {
                    Ok(details) => json!({"route": route_json(route), "entered": "dcp-jcs-v2", "verification": details}).to_string(),
                    Err(e) => json_err(&e.to_string()),
                }
            }
            Err(CandidateStop::Needs(point)) => json!({"needs_historical": point}).to_string(),
            Err(CandidateStop::Usage(m)) => json!({"usage_error": m}).to_string(),
            Err(CandidateStop::Internal(m)) => json_err(&m),
        }
    }

    // ── EXPERIMENTAL, opt-in: candidate producers (phase 4) ─────────────────
    // Every piece arrives as its own bytes (a range of one buffer), never nested in a request: the
    // ingress sees each piece's original bytes and the depth budget is the final unit's. Keys, signer
    // and options are small JSON objects of labels, validated by the JS wrapper first.

    fn candidate_keys(v: &Value) -> Result<crate::v2::experimental_candidate_produce::CandidateKeys, String> {
        use crate::v2::composite_ops::CompositeKeyInfo;
        let one = |k: &Value| -> Result<CompositeKeyInfo, String> {
            let field = |name: &str| k.get(name).and_then(Value::as_str).map(String::from).ok_or_else(|| format!("key {} must be a string", name));
            Ok(CompositeKeyInfo { kid: field("kid")?, alg: field("alg")?, secret_key_b64: field("secret_key_b64")?, public_key_b64: field("public_key_b64")? })
        };
        let classical = one(v.get("classical").ok_or("keys.classical is required")?)?;
        let pq = match v.get("pq") {
            None | Some(Value::Null) => None,
            Some(k) => Some(one(k)?),
        };
        Ok(crate::v2::experimental_candidate_produce::CandidateKeys { classical, pq })
    }

    fn candidate_produce_error(e: crate::v2::experimental_candidate_produce::ProduceError) -> String {
        use crate::v2::experimental_candidate_produce::ProduceError;
        match e {
            ProduceError::Reject(r) => json!({"reject": {"class": r.class, "part": r.part, "path": r.path, "offset": r.offset}}).to_string(),
            ProduceError::Usage(m) => json!({"usage_error": m}).to_string(),
            ProduceError::Provider(m) => json_err(&format!("provider: {}", m)),
            ProduceError::Internal(m) => json_err(&m),
        }
    }

    /// EXPERIMENTAL, opt-in (phase 4): signs one artifact over `payload` (the payload's own bytes)
    /// under `context`. Returns {"canonical": artifact text} or {"reject": …} / {"usage_error": …}.
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_sign_payload(payload: &[u8], context: &str, keys_json: &str) -> String {
        use crate::v2::experimental_candidate_produce::{sign_payload, CandidateInput};
        let keys = match serde_json::from_str::<Value>(keys_json).map_err(|e| e.to_string()).and_then(|v| candidate_keys(&v)) {
            Ok(k) => k,
            Err(m) => return json!({"usage_error": m}).to_string(),
        };
        match sign_payload(context, &CandidateInput::Bytes(payload.to_vec()), &keys) {
            Ok(p) => json!({"canonical": String::from_utf8_lossy(&p.bytes)}).to_string(),
            Err(e) => candidate_produce_error(e),
        }
    }

    /// EXPERIMENTAL, opt-in (phase 4): assembles and signs a candidate bundle. `pieces` holds every
    /// part's own bytes; `layout_json` gives their ranges: {"rpr": [s, e], "passport", "intent",
    /// "policy_decision", "audit_entries": [[s, e], …], "pq_checkpoints": [[s, e], …]}.
    #[wasm_bindgen]
    pub fn wasm_experimental_candidate_sign_bundle(pieces: &[u8], layout_json: &str, signer_json: &str, options_json: &str) -> String {
        use crate::v2::experimental_candidate_produce::{sign_bundle, BundleOptions, BundleParts, BundleSigner, CandidateInput};
        let parsed = (|| -> Result<(BundleParts, BundleSigner, BundleOptions), String> {
            let layout: Value = serde_json::from_str(layout_json).map_err(|e| e.to_string())?;
            // A range is exactly [start, end], converted to usize without truncation, inside the pieces.
            let piece = |r: &Value| -> Result<CandidateInput, String> {
                let bound = |v: &Value| v.as_u64().and_then(|n| usize::try_from(n).ok());
                match r.as_array().map(Vec::as_slice) {
                    Some([s, e]) => match (bound(s), bound(e)) {
                        (Some(s), Some(e)) if s <= e && e <= pieces.len() => Ok(CandidateInput::Bytes(pieces[s..e].to_vec())),
                        _ => Err("a piece range is outside the pieces".into()),
                    },
                    _ => Err("a piece range must be [start, end]".into()),
                }
            };
            let list = |name: &str| -> Result<Vec<CandidateInput>, String> {
                match layout.get(name) {
                    None => Ok(vec![]),
                    Some(Value::Array(a)) => a.iter().map(piece).collect(),
                    Some(_) => Err(format!("layout.{} must be a list", name)),
                }
            };
            let part = |name: &str| layout.get(name).ok_or(format!("layout.{} is required", name)).and_then(piece);
            let parts = BundleParts { rpr: part("rpr")?, passport: part("passport")?, intent: part("intent")?, policy_decision: part("policy_decision")?,
                audit_entries: list("audit_entries")?, pq_checkpoints: list("pq_checkpoints")? };
            let s: Value = serde_json::from_str(signer_json).map_err(|e| e.to_string())?;
            let text = |v: &Value, name: &str| v.get(name).and_then(Value::as_str).map(String::from).ok_or(format!("{} must be a string", name));
            let signer = BundleSigner { signer_type: text(&s, "signer_type")?, signer_id: text(&s, "signer_id")?, keys: candidate_keys(s.get("keys").ok_or("signer.keys is required")?)? };
            let o: Value = serde_json::from_str(options_json).map_err(|e| e.to_string())?;
            let optional = |name: &str| -> Result<Option<String>, String> {
                match o.get(name) {
                    None => Ok(None),
                    Some(Value::String(v)) => Ok(Some(v.clone())),
                    Some(_) => Err(format!("options.{} must be a string", name)),
                }
            };
            let options = BundleOptions { session_nonce: text(&o, "session_nonce")?, session_issued_at: optional("session_issued_at")?,
                session_expires_at: optional("session_expires_at")?, intended_verifier: optional("intended_verifier")?, created_at: optional("created_at")?,
                dual_hash: match o.get("dual_hash") { None => false, Some(Value::Bool(b)) => *b, Some(_) => return Err("options.dual_hash must be a bool".into()) } };
            Ok((parts, signer, options))
        })();
        let (parts, signer, options) = match parsed {
            Ok(p) => p,
            Err(m) => return json!({"usage_error": m}).to_string(),
        };
        match sign_bundle(&parts, &signer, &options) {
            Ok(b) => json!({"canonical": String::from_utf8_lossy(&b.bytes)}).to_string(),
            Err(e) => candidate_produce_error(e),
        }
    }

    // ── Keypair Generation ────────────────────────────────────────────────

    #[wasm_bindgen]
    pub fn wasm_generate_keypair() -> String {
        let (pub_key, sec_key) = crypto::generate_keypair();
        serde_json::to_string(&json!({
            "alg": "ed25519",
            "public_key_b64": pub_key,
            "secret_key_b64": sec_key
        })).unwrap()
    }

    #[wasm_bindgen]
    pub fn wasm_generate_ml_dsa_65_keypair() -> String {
        let provider = MlDsa65Provider;
        match provider.generate_keypair() {
            Ok(kp) => serde_json::to_string(&json!({
                "alg": "ml-dsa-65",
                "kid": kp.kid,
                "public_key_b64": kp.public_key_b64,
                "secret_key_b64": kp.secret_key_b64
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    #[wasm_bindgen]
    pub fn wasm_generate_slh_dsa_192f_keypair() -> String {
        let provider = SlhDsa192fProvider;
        match provider.generate_keypair() {
            Ok(kp) => serde_json::to_string(&json!({
                "alg": "slh-dsa-192f",
                "kid": kp.kid,
                "public_key_b64": kp.public_key_b64,
                "secret_key_b64": kp.secret_key_b64
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Generate an Ed25519 + ML-DSA-65 hybrid keypair in a single call.
    #[wasm_bindgen]
    pub fn wasm_generate_hybrid_keypair() -> String {
        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let ed_kp = match ed.generate_keypair() {
            Ok(kp) => kp,
            Err(e) => return json_err(&e.to_string()),
        };
        let pq_kp = match pq.generate_keypair() {
            Ok(kp) => kp,
            Err(e) => return json_err(&e.to_string()),
        };
        serde_json::to_string(&json!({
            "classical": {
                "alg": "ed25519",
                "kid": ed_kp.kid,
                "public_key_b64": ed_kp.public_key_b64,
                "secret_key_b64": ed_kp.secret_key_b64
            },
            "pq": {
                "alg": "ml-dsa-65",
                "kid": pq_kp.kid,
                "public_key_b64": pq_kp.public_key_b64,
                "secret_key_b64": pq_kp.secret_key_b64
            }
        })).unwrap()
    }

    // ── Composite Signing ─────────────────────────────────────────────────

    /// Composite sign: Ed25519 + ML-DSA-65 with pq_over_classical binding.
    #[wasm_bindgen]
    pub fn wasm_composite_sign(
        context: &str,
        payload_json: &str,
        classical_sk_b64: &str,
        classical_kid: &str,
        pq_sk_b64: &str,
        pq_kid: &str,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let canonical = match canonicalize_v2(&val) {
            Ok(c) => c,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let classical_key = CompositeKeyInfo {
            kid: classical_kid.to_string(),
            alg: "ed25519".to_string(),
            secret_key_b64: classical_sk_b64.to_string(),
            public_key_b64: String::new(),
        };
        let pq_key = CompositeKeyInfo {
            kid: pq_kid.to_string(),
            alg: "ml-dsa-65".to_string(),
            secret_key_b64: pq_sk_b64.to_string(),
            public_key_b64: String::new(),
        };

        match composite_sign(&ed, &pq, context, canonical.as_bytes(), &classical_key, &pq_key) {
            Ok(sig) => serde_json::to_string(&sig).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Classical-only signing (Ed25519 transition mode).
    #[wasm_bindgen]
    pub fn wasm_classical_only_sign(
        context: &str,
        payload_json: &str,
        sk_b64: &str,
        kid: &str,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let canonical = match canonicalize_v2(&val) {
            Ok(c) => c,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let key = CompositeKeyInfo {
            kid: kid.to_string(),
            alg: "ed25519".to_string(),
            secret_key_b64: sk_b64.to_string(),
            public_key_b64: String::new(),
        };

        match classical_only_sign(&ed, context, canonical.as_bytes(), &key) {
            Ok(sig) => serde_json::to_string(&sig).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Sign a payload and return a SignedPayload envelope (payload + hash + composite_sig).
    #[wasm_bindgen]
    pub fn wasm_sign_payload(
        context: &str,
        payload_json: &str,
        classical_sk_b64: &str,
        classical_kid: &str,
        pq_sk_b64: &str,
        pq_kid: &str,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let (canonical_bytes, payload_hash) = match signed_payload::prepare_payload(&val) {
            Ok(r) => r,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let classical_key = CompositeKeyInfo {
            kid: classical_kid.to_string(),
            alg: "ed25519".to_string(),
            secret_key_b64: classical_sk_b64.to_string(),
            public_key_b64: String::new(),
        };
        let pq_key = CompositeKeyInfo {
            kid: pq_kid.to_string(),
            alg: "ml-dsa-65".to_string(),
            secret_key_b64: pq_sk_b64.to_string(),
            public_key_b64: String::new(),
        };

        match composite_sign(&ed, &pq, context, &canonical_bytes, &classical_key, &pq_key) {
            Ok(sig) => serde_json::to_string(&json!({
                "payload": val,
                "payload_hash": payload_hash,
                "composite_sig": sig
            })).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    // ── Composite Verification ────────────────────────────────────────────

    /// Verify a composite signature cryptographically.
    #[wasm_bindgen]
    pub fn wasm_composite_verify(
        context: &str,
        payload_json: &str,
        composite_sig_json: &str,
        classical_pk_b64: &str,
        pq_pk_b64: Option<String>,
    ) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let sig: CompositeSignature = match serde_json::from_str(composite_sig_json) {
            Ok(s) => s,
            Err(e) => return json_err(&format!("Signature parse: {}", e)),
        };
        let canonical = match canonicalize_v2(&val) {
            Ok(c) => c,
            Err(e) => return json_err(&e),
        };

        let ed = Ed25519Provider;
        let pq = MlDsa65Provider;
        let pq_ref: Option<&dyn CryptoProvider> = if pq_pk_b64.is_some() { Some(&pq) } else { None };

        match composite_verify(
            &ed, pq_ref, context, canonical.as_bytes(),
            &sig, classical_pk_b64, pq_pk_b64.as_deref(),
        ) {
            Ok(result) => serde_json::to_string(&json!({
                "valid": result.valid,
                "classical_valid": result.classical_valid,
                "pq_valid": result.pq_valid
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Full V2 bundle verification with cryptographic signature checks.
    ///
    /// `policy_json` is a `VerifierPolicy` for V2 bundles, with every field but
    /// the optional ones (the Phase 3 fields, `max_session_duration_seconds`,
    /// `require_session_expiry`, `require_audience_binding`, `verifier_id`);
    /// without it the default policy applies. The mode is the stricter of the policy mode and
    /// the security tier's mode (spec §14.3). The V1 verifier cannot apply a
    /// policy, so with one a V1 bundle is rejected. A V2 result also lists the
    /// signer keys (`signer_keys`), from the same verification.
    #[wasm_bindgen]
    pub fn wasm_verify_signed_bundle_v2(signed_bundle_json: &str, policy_json: Option<String>) -> String {
        let policy: crate::v2::types::VerifierPolicy = match policy_json.as_deref().map(serde_json::from_str) {
            None => Default::default(),
            Some(Ok(p)) => p,
            Some(Err(e)) => return serde_json::to_string(&json!({
                "verified": false, "errors": [format!("Policy parse error: {}", e)]
            })).unwrap(),
        };
        let val: Value = match serde_json::from_str(signed_bundle_json) {
            Ok(v) => v,
            Err(e) => return serde_json::to_string(&json!({
                "verified": false, "errors": [format!("JSON parse error: {}", e)]
            })).unwrap(),
        };

        match crate::detect_dcp_version(&val) {
            Some("1.0") if policy_json.is_some() => serde_json::to_string(&json!({
                "verified": false, "errors": ["V1 bundles cannot be verified under a verifier policy"]
            })).unwrap(),
            Some("1.0") => {
                let result = verify::verify_signed_bundle(&val, None);
                serde_json::to_string(&result).unwrap_or_else(|_| "{\"verified\":false}".to_string())
            },
            Some("2.0") => {
                let now = crate::v2::lifecycle::unix_now_millis() as i64;
                let result = crate::v2::verify_bundle::verify_signed_bundle_v2_at(&val, &policy, now);
                serde_json::to_string(&result).unwrap_or_else(|_| "{\"verified\":false}".to_string())
            },
            _ => serde_json::to_string(&json!({
                "verified": false, "errors": ["Unknown DCP version"]
            })).unwrap(),
        }
    }

    // ── Canonicalization & Domain Separation ───────────────────────────────

    #[wasm_bindgen]
    pub fn wasm_derive_kid(alg: &str, public_key_b64: &str) -> String {
        let pk_bytes = match BASE64.decode(public_key_b64) {
            Ok(b) => b,
            Err(e) => return json_err(&format!("base64 decode: {}", e)),
        };
        crate::v2::crypto_provider::derive_kid(alg, &pk_bytes)
    }

    #[wasm_bindgen]
    pub fn wasm_canonicalize_v2(json_str: &str) -> String {
        let val: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        match canonicalize_v2(&val) {
            Ok(s) => s,
            Err(e) => json_err(&e),
        }
    }

    #[wasm_bindgen]
    pub fn wasm_domain_separated_message(context: &str, payload_hex: &str) -> String {
        let payload = match hex::decode(payload_hex) {
            Ok(b) => b,
            Err(e) => return json_err(&format!("hex decode: {}", e)),
        };
        match crate::v2::domain_separation::domain_separated_message(context, &payload) {
            Ok(dsm) => hex::encode(dsm),
            Err(e) => json_err(&e),
        }
    }

    // ── Dual Hash ─────────────────────────────────────────────────────────

    /// Compute SHA-256 + SHA3-256 dual hash of a string.
    #[wasm_bindgen]
    pub fn wasm_dual_hash(data: &str) -> String {
        let dh = dual_hash::dual_hash(data.as_bytes());
        serde_json::to_string(&dh).unwrap()
    }

    /// Compute SHA3-256 hash of a string (hex-encoded).
    #[wasm_bindgen]
    pub fn wasm_sha3_256(data: &str) -> String {
        dual_hash::sha3_256_hex(data.as_bytes())
    }

    /// Compute dual Merkle root from an array of dual-hash leaves.
    /// Input: JSON array of {"sha256":"...","sha3_256":"..."} objects, each a 32-byte digest in hex.
    /// Delegates to v2::dual_hash::dual_merkle_root, the reduction of spec/VERIFICATION.md V2-11 that the
    /// bundle verifier uses (raw digests concatenated, the last node duplicated on an odd layer). A leaf
    /// that is not a 32-byte hex digest is an error, never hashed as text.
    #[wasm_bindgen]
    pub fn wasm_dual_merkle_root(leaves_json: &str) -> String {
        let leaves: Vec<dual_hash::DualHash> = match serde_json::from_str(leaves_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        if leaves.is_empty() {
            return json_err("Empty leaves array");
        }
        let is_digest = |h: &str| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit());
        if let Some(i) = leaves.iter().position(|l| !is_digest(&l.sha256) || !is_digest(&l.sha3_256)) {
            return json_err(&format!("Leaf {} is not a 32-byte hex digest", i));
        }
        match dual_hash::dual_merkle_root(&leaves) {
            Some(root) => serde_json::to_string(&json!({
                "sha256": root.sha256,
                "sha3_256": root.sha3_256
            })).unwrap(),
            None => json_err("Empty leaves array"),
        }
    }

    // ── Session Nonce ─────────────────────────────────────────────────────

    /// Generate a 256-bit random session nonce (64 hex chars).
    #[wasm_bindgen]
    pub fn wasm_generate_session_nonce() -> String {
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        hex::encode(bytes)
    }

    /// Verify session nonce consistency across artifacts.
    /// Input: JSON array of objects, each optionally containing "session_nonce".
    #[wasm_bindgen]
    pub fn wasm_verify_session_binding(artifacts_json: &str) -> String {
        let artifacts: Vec<Value> = match serde_json::from_str(artifacts_json) {
            Ok(v) => v,
            Err(e) => return serde_json::to_string(&json!({
                "valid": false, "error": format!("JSON parse: {}", e)
            })).unwrap(),
        };

        let mut found_nonce: Option<String> = None;
        for art in &artifacts {
            if let Some(nonce) = art.get("session_nonce").and_then(|n| n.as_str()) {
                match &found_nonce {
                    None => found_nonce = Some(nonce.to_string()),
                    Some(expected) => {
                        if nonce != expected {
                            return serde_json::to_string(&json!({
                                "valid": false,
                                "error": "Session nonce mismatch",
                                "expected": expected,
                                "got": nonce
                            })).unwrap();
                        }
                    }
                }
            }
        }

        serde_json::to_string(&json!({
            "valid": true,
            "nonce": found_nonce
        })).unwrap()
    }

    // ── Security Tier ─────────────────────────────────────────────────────

    /// Compute the adaptive security tier (spec §14.2) from an intent and,
    /// optionally, the bundle's policy decision, whose risk_score it reads.
    #[wasm_bindgen]
    pub fn wasm_compute_security_tier(intent_json: &str, policy_decision_json: Option<String>) -> String {
        let intent: Value = match serde_json::from_str(intent_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        let policy_decision: Option<Value> = match policy_decision_json.as_deref().map(serde_json::from_str) {
            None => None,
            Some(Ok(v)) => Some(v),
            Some(Err(e)) => return json_err(&format!("JSON parse: {}", e)),
        };

        let tier = crate::v2::security_tier::compute_security_tier(&intent, policy_decision.as_ref());
        serde_json::to_string(&json!({
            "tier": tier.as_str(),
            "verification_mode": crate::v2::security_tier::tier_to_verification_mode(tier),
            "checkpoint_interval": crate::v2::security_tier::tier_to_checkpoint_interval(tier)
        })).unwrap()
    }

    // ── Payload Preparation ───────────────────────────────────────────────

    /// Canonicalize a payload and compute its hash.
    /// Returns { canonical: "...", payload_hash: "sha256:..." }.
    #[wasm_bindgen]
    pub fn wasm_prepare_payload(payload_json: &str) -> String {
        let val: Value = match serde_json::from_str(payload_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("JSON parse: {}", e)),
        };
        match signed_payload::prepare_payload(&val) {
            Ok((canonical_bytes, hash)) => {
                let canonical_str = String::from_utf8_lossy(&canonical_bytes);
                serde_json::to_string(&json!({
                    "canonical": canonical_str,
                    "payload_hash": hash
                })).unwrap()
            },
            Err(e) => json_err(&e),
        }
    }

    // ── Bundle Building & Signing ─────────────────────────────────────────

    /// Build a V2 CitizenshipBundle with `crate::v2::bundle::build_bundle_v2`:
    /// each artifact is a SignedPayload from `wasm_sign_payload`.
    #[wasm_bindgen]
    pub fn wasm_build_bundle(
        rpr_json: &str,
        passport_json: &str,
        intent_json: &str,
        policy_json: &str,
        audit_entries_json: &str,
        session_nonce: &str,
    ) -> String {
        let mut signed = Vec::with_capacity(4);
        for (name, artifact_json) in [
            ("RPR", rpr_json), ("Passport", passport_json), ("Intent", intent_json), ("Policy", policy_json),
        ] {
            match serde_json::from_str::<signed_payload::SignedPayload>(artifact_json) {
                Ok(sp) => signed.push(sp),
                Err(e) => return json_err(&format!("{} must be a SignedPayload from wasm_sign_payload: {}", name, e)),
            }
        }
        let audit_entries: Vec<Value> = match serde_json::from_str(audit_entries_json) {
            Ok(v) => v, Err(e) => return json_err(&format!("Audit entries parse: {}", e)),
        };
        match crate::v2::bundle::build_bundle_v2(
            &signed[0], &signed[1], &signed[2], &signed[3], &audit_entries, session_nonce,
        ) {
            Ok(bundle) => serde_json::to_string(&bundle).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e),
        }
    }

    /// Sign a V2 bundle with composite signature (Ed25519 + ML-DSA-65), with
    /// `crate::v2::bundle::sign_bundle_v2`.
    #[wasm_bindgen]
    pub fn wasm_sign_bundle(
        bundle_json: &str,
        classical_sk_b64: &str,
        classical_kid: &str,
        pq_sk_b64: &str,
        pq_kid: &str,
    ) -> String {
        let bundle: Value = match serde_json::from_str(bundle_json) {
            Ok(v) => v,
            Err(e) => return json_err(&format!("Bundle parse: {}", e)),
        };
        let key = |kid: &str, alg: &str, sk: &str| CompositeKeyInfo {
            kid: kid.to_string(),
            alg: alg.to_string(),
            secret_key_b64: sk.to_string(),
            public_key_b64: String::new(),
        };
        match crate::v2::bundle::sign_bundle_v2(
            bundle,
            &key(classical_kid, "ed25519", classical_sk_b64),
            &key(pq_kid, "ml-dsa-65", pq_sk_b64),
        ) {
            Ok(signed) => serde_json::to_string(&signed).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e),
        }
    }

    // ── Proof of Possession ───────────────────────────────────────────────

    /// Generate a proof-of-possession for key registration.
    #[wasm_bindgen]
    pub fn wasm_generate_registration_pop(
        challenge_json: &str,
        sk_b64: &str,
        alg: &str,
    ) -> String {
        let challenge: PopChallenge = match serde_json::from_str(challenge_json) {
            Ok(c) => c,
            Err(e) => return json_err(&format!("Challenge parse: {}", e)),
        };
        let provider = match provider_for_alg(alg) {
            Ok(p) => p,
            Err(e) => return json_err(&e),
        };

        match generate_registration_pop(provider.as_ref(), &challenge, sk_b64) {
            Ok(entry) => serde_json::to_string(&entry).unwrap_or_else(|_| json_err("serialize failed")),
            Err(e) => json_err(&e.to_string()),
        }
    }

    // ── ML-KEM-768 Key Encapsulation ─────────────────────────────────────

    /// Generate an ML-KEM-768 keypair (encapsulation key + decapsulation key).
    #[wasm_bindgen]
    pub fn wasm_ml_kem_768_keygen() -> String {
        use crate::providers::ml_kem_768::MlKem768Provider;
        use crate::v2::crypto_provider::KemProvider;
        let provider = MlKem768Provider;
        match provider.generate_keypair() {
            Ok(kp) => serde_json::to_string(&json!({
                "alg": "ml-kem-768",
                "kid": kp.kid,
                "public_key_b64": kp.public_key_b64,
                "secret_key_b64": kp.secret_key_b64
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Encapsulate a shared secret using an ML-KEM-768 public key.
    /// Returns { shared_secret_hex, ciphertext_b64 }.
    #[wasm_bindgen]
    pub fn wasm_ml_kem_768_encapsulate(public_key_b64: &str) -> String {
        use crate::providers::ml_kem_768::MlKem768Provider;
        use crate::v2::crypto_provider::KemProvider;
        let provider = MlKem768Provider;
        match provider.encapsulate(public_key_b64) {
            Ok((ss, ct)) => serde_json::to_string(&json!({
                "shared_secret_hex": hex::encode(&ss),
                "ciphertext_b64": BASE64.encode(&ct)
            })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Decapsulate a shared secret from ciphertext using an ML-KEM-768 secret key.
    /// Returns the shared secret as hex.
    #[wasm_bindgen]
    pub fn wasm_ml_kem_768_decapsulate(ciphertext_b64: &str, secret_key_b64: &str) -> String {
        use crate::providers::ml_kem_768::MlKem768Provider;
        use crate::v2::crypto_provider::KemProvider;
        let provider = MlKem768Provider;
        let ct = match BASE64.decode(ciphertext_b64) {
            Ok(b) => b,
            Err(e) => return json_err(&format!("base64 decode: {}", e)),
        };
        match provider.decapsulate(&ct, secret_key_b64) {
            Ok(ss) => hex::encode(ss),
            Err(e) => json_err(&e.to_string()),
        }
    }

    /// Verify a proof-of-possession for key registration.
    #[wasm_bindgen]
    pub fn wasm_verify_registration_pop(
        challenge_json: &str,
        pop_json: &str,
        pk_b64: &str,
        alg: &str,
    ) -> String {
        let challenge: PopChallenge = match serde_json::from_str(challenge_json) {
            Ok(c) => c,
            Err(e) => return json_err(&format!("Challenge parse: {}", e)),
        };
        let pop: SignatureEntry = match serde_json::from_str(pop_json) {
            Ok(p) => p,
            Err(e) => return json_err(&format!("PoP parse: {}", e)),
        };
        let provider = match provider_for_alg(alg) {
            Ok(p) => p,
            Err(e) => return json_err(&e),
        };

        match verify_registration_pop(provider.as_ref(), &challenge, &pop, pk_b64) {
            Ok(valid) => serde_json::to_string(&json!({ "valid": valid })).unwrap(),
            Err(e) => json_err(&e.to_string()),
        }
    }
}
