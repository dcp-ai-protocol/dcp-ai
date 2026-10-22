//! DCP v2.0 Session Nonce — anti-splicing defense. Rust port.

use rand::RngCore;
use serde_json::Value;


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
    // The `unwrap_or("")` returns an empty string (not a cryptographic value)
    // when the field is missing; is_valid_session_nonce below rejects empty
    // strings and produces a clear error. No secret is hardcoded here.
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

/// Milliseconds since the Unix epoch of an RFC 3339 timestamp with a `Z` or
/// `±hh:mm` offset (`YYYY-MM-DDTHH:MM:SS[.fraction]`), or None for anything
/// else: a date without a time, a time without an offset, or an impossible date
/// or time. Digits beyond milliseconds are dropped.
pub fn parse_rfc3339_millis(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let num = |from: usize, to: usize| -> Option<i64> {
        let digits = b.get(from..to)?;
        digits.iter().all(u8::is_ascii_digit).then(|| digits.iter().fold(0, |n, d| n * 10 + i64::from(d - b'0')))
    };
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hour, minute, second) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let mut at = 19;
    let mut millis = 0;
    if b[at] == b'.' {
        let digits = b[at + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if digits == 0 {
            return None;
        }
        let kept = digits.min(3);
        millis = num(at + 1, at + 1 + kept)? * 10_i64.pow(3 - kept as u32);
        at += 1 + digits;
    }
    let offset_minutes = match &b[at..] {
        [b'Z'] => 0,
        [sign @ (b'+' | b'-'), _, _, b':', _, _] => {
            let (oh, om) = (num(at + 1, at + 3)?, num(at + 4, at + 6)?);
            if oh > 23 || om > 59 {
                return None;
            }
            (oh * 60 + om) * if *sign == b'-' { -1 } else { 1 }
        }
        _ => return None,
    };
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return None,
    };
    if day < 1 || day > days_in_month || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    // Days from civil (Howard Hinnant).
    let (y, m) = if month <= 2 { (year - 1, month + 9) } else { (year, month - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + (153 * m + 2) / 5 + day - 1;
    let days = era * 146_097 + doe - 719_468;
    Some((((days * 24 + hour) * 60 + minute - offset_minutes) * 60 + second) * 1000 + millis)
}

/// Whether an RFC 3339 `expires_at` has passed. A value that is not an RFC 3339
/// timestamp counts as expired, so a malformed expiry fails closed.
pub fn is_session_expired(expires_at: &str) -> bool {
    parse_rfc3339_millis(expires_at).map_or(true, |t| t < crate::v2::lifecycle::unix_now_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiry_compares_instants_not_strings() {
        // Written with an offset, an instant an hour ahead can sort before now as
        // a string, and one an hour behind can sort after it.
        let now = crate::v2::lifecycle::unix_now_millis() as i64 / 1000;
        let with_offset = |secs: i64, offset_hours: i64| {
            let (y, mo, d, h, mi, s) = civil_from_secs(secs + offset_hours * 3600);
            format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}{offset_hours:+03}:00")
        };
        assert!(!is_session_expired(&with_offset(now + 3600, -5)), "{}", with_offset(now + 3600, -5));
        assert!(is_session_expired(&with_offset(now - 3600, 5)), "{}", with_offset(now - 3600, 5));
    }
}
