//! DCP v2.0 Session Nonce — anti-splicing defense. Rust port.

use rand::RngCore;
use serde_json::Value;

use crate::v2::lifecycle::utc_now_iso_pub as utc_now_iso;

/// Generate a cryptographically random 256-bit session nonce (64 hex chars).
pub fn generate_session_nonce() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Return `true` iff the input is a well-formed lower-case hex 64-char string.
pub fn is_valid_session_nonce(nonce: &str) -> bool {
    if nonce.len() != 64 {
        return false;
    }
    nonce.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

#[derive(Debug, Clone)]
pub struct SessionBindingResult {
    pub valid: bool,
    pub nonce: Option<String>,
    pub error: Option<String>,
}

/// Verify that all artifacts share the same `session_nonce`.
pub fn verify_session_binding(artifacts: &[Value]) -> SessionBindingResult {
    if artifacts.is_empty() {
        return SessionBindingResult {
            valid: false,
            nonce: None,
            error: Some("No artifacts to verify".into()),
        };
    }
    let first = artifacts[0]
        .get("session_nonce")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !is_valid_session_nonce(first) {
        return SessionBindingResult {
            valid: false,
            nonce: None,
            error: Some(format!("Invalid session_nonce in artifact[0]: {first:?}")),
        };
    }
    for (i, art) in artifacts.iter().enumerate().skip(1) {
        let nonce = art.get("session_nonce").and_then(Value::as_str).unwrap_or("");
        if nonce != first {
            return SessionBindingResult {
                valid: false,
                nonce: None,
                error: Some(format!(
                    "Session nonce mismatch: artifact[0]={first}, artifact[{i}]={nonce}"
                )),
            };
        }
    }
    SessionBindingResult {
        valid: true,
        nonce: Some(first.to_string()),
        error: None,
    }
}

/// Default per-tier session durations in seconds.
fn default_duration_for_tier(tier: Option<&str>) -> u64 {
    match tier {
        Some("routine") => 86_400,
        Some("standard") => 14_400,
        Some("elevated") => 3_600,
        Some("maximum") => 900,
        _ => 14_400,
    }
}

/// Generate an ISO-8601 session expiry timestamp.
pub fn generate_session_expiry(duration_seconds: Option<i64>, tier: Option<&str>) -> String {
    let _ = tier; // consumed by default_duration_for_tier; kept in public API
    let duration = duration_seconds
        .unwrap_or_else(|| default_duration_for_tier(tier) as i64);
    use std::time::{SystemTime, UNIX_EPOCH, Duration};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let target_secs = now.as_secs() as i64 + duration;
    let target = UNIX_EPOCH + Duration::from_secs(target_secs.max(0) as u64);
    // Reuse lifecycle::utc_now_iso-style formatting: since we need a fixed
    // point in time, compute the civil date directly.
    civil_iso(target)
}

fn civil_iso(t: std::time::SystemTime) -> String {
    use std::time::UNIX_EPOCH;
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let millis = d.subsec_millis();
    let (y, mo, d, h, mi, s) = civil_from_secs(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, mo, d, h, mi, s, millis
    )
}

fn civil_from_secs(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400) as u32;
    let z = days + 719_468;
    let era = if z >= 0 { z / 146_097 } else { (z - 146_096) / 146_097 };
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let h = tod / 3600;
    let mi = (tod % 3600) / 60;
    let s = tod % 60;
    (y, m, d, h, mi, s)
}

/// Return `true` if the ISO-8601 timestamp has already passed.
pub fn is_session_expired(expires_at: &str) -> bool {
    // Lexicographic comparison works for UTC ISO-8601 with Z suffix.
    utc_now_iso().as_str() > expires_at
}
