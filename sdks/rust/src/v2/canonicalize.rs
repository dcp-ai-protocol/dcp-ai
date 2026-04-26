//! DCP v2.0 canonicalization — profile `dcp-jcs-v1`.
//!
//! Strict subset of RFC 8785 (JCS) with the cases JCS leaves
//! implementation-defined explicitly pinned. See
//! `spec/CANONICALIZATION_PROFILE.md` for the normative reference.
//!
//! Numeric rule: a number is valid iff its value is a finite integer.
//! `1.0`, `1.00`, `1e2`, and `100` are all accepted and emitted in
//! integer form. `0.1`, `NaN`, `±inf` are rejected.

use serde_json::Value;

/// Reject any JSON number whose value is not a finite integer.
///
/// Accepts integers (`as_i64` / `as_u64`) and floats whose value has no
/// fractional component. Rejects `NaN`, infinities, and any float with
/// a non-zero fractional part.
pub fn assert_no_floats(value: &Value) -> Result<(), String> {
    match value {
        Value::Number(n) => {
            if n.as_i64().is_some() || n.as_u64().is_some() {
                return Ok(());
            }
            if let Some(f) = n.as_f64() {
                if !f.is_finite() {
                    return Err(format!("Non-finite number in V2 canonical form: {}", n));
                }
                if f.fract() == 0.0 {
                    return Ok(());
                }
                return Err(format!("Non-integer number in V2 canonical form: {}", n));
            }
            Err(format!("Unrepresentable number in V2 canonical form: {}", n))
        }
        Value::Array(arr) => {
            for (i, v) in arr.iter().enumerate() {
                assert_no_floats(v).map_err(|e| format!("array[{}]: {}", i, e))?;
            }
            Ok(())
        }
        Value::Object(map) => {
            for (k, v) in map.iter() {
                assert_no_floats(v).map_err(|e| format!("key \"{}\": {}", k, e))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Canonical JSON serialisation per profile `dcp-jcs-v1`.
pub fn canonicalize_v2(value: &Value) -> Result<String, String> {
    assert_no_floats(value)?;
    Ok(canonical_recurse(value))
}

fn canonical_recurse(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let pairs: Vec<String> = keys
                .iter()
                .map(|k| {
                    format!("{}:{}", serde_json::to_string(k).unwrap(), canonical_recurse(&map[*k]))
                })
                .collect();
            format!("{{{}}}", pairs.join(","))
        }
        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(canonical_recurse).collect();
            format!("[{}]", items.join(","))
        }
        Value::Number(n) => format_number(n),
        _ => serde_json::to_string(value).unwrap(),
    }
}

/// Format a JSON number per profile `dcp-jcs-v1`: integer form, no
/// decimal point, no exponent. Assumes [`assert_no_floats`] has already
/// validated the value.
fn format_number(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    if let Some(f) = n.as_f64() {
        let as_i128 = f as i128;
        if (as_i128 as f64) == f {
            return as_i128.to_string();
        }
        return n.to_string();
    }
    n.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_sorted_keys() {
        let val = json!({"z": 1, "a": 2, "m": 3});
        let result = canonicalize_v2(&val).unwrap();
        assert_eq!(result, r#"{"a":2,"m":3,"z":1}"#);
    }

    #[test]
    fn test_rejects_non_integer_floats() {
        assert!(canonicalize_v2(&json!({"score": 0.5})).is_err());
        assert!(canonicalize_v2(&json!({"score": 1.5})).is_err());
        // Source `1.0e-1` parses to 0.1 — a non-integer float.
        let v: Value = serde_json::from_str(r#"{"n":1.0e-1}"#).unwrap();
        assert!(canonicalize_v2(&v).is_err());
    }

    #[test]
    fn test_integer_ok() {
        let val = json!({"score": 500});
        assert!(canonicalize_v2(&val).is_ok());
    }

    #[test]
    fn test_nested() {
        let val = json!({"b": [3, 1], "a": {"y": true, "x": null}});
        let result = canonicalize_v2(&val).unwrap();
        assert_eq!(result, r#"{"a":{"x":null,"y":true},"b":[3,1]}"#);
    }

    // ── dcp-jcs-v1 profile: integer-valued floats accepted ──

    #[test]
    fn test_accepts_integer_valued_float() {
        // `1.0` from a JSON literal — serde_json stores as Number(f64).
        let v: Value = serde_json::from_str(r#"{"n":1.0}"#).unwrap();
        assert_eq!(canonicalize_v2(&v).unwrap(), r#"{"n":1}"#);
    }

    #[test]
    fn test_accepts_trailing_zeros() {
        let v: Value = serde_json::from_str(r#"{"n":1.00}"#).unwrap();
        assert_eq!(canonicalize_v2(&v).unwrap(), r#"{"n":1}"#);
    }

    #[test]
    fn test_accepts_scientific_notation_with_integer_value() {
        let v: Value = serde_json::from_str(r#"{"n":1e2}"#).unwrap();
        assert_eq!(canonicalize_v2(&v).unwrap(), r#"{"n":100}"#);
    }

    #[test]
    fn test_rejects_non_finite() {
        // serde_json's default parser does not accept NaN/Infinity, so
        // we construct a Value with infinity through serde_json::Number.
        let inf = serde_json::Number::from_f64(f64::INFINITY);
        // Number::from_f64 returns None for non-finite inputs; assert
        // that this is the case (the canonicalizer never sees a
        // non-finite Number through the JSON parse path).
        assert!(inf.is_none());
    }
}
