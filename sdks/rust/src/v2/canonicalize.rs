use serde_json::Value;

/// Reject any JSON number that is not a finite integer.
pub fn assert_no_floats(value: &Value) -> Result<(), String> {
    match value {
        Value::Number(n) => {
            if n.as_i64().is_none() && n.as_u64().is_none() {
                return Err(format!("Float values are prohibited in V2 canonical form: {}", n));
            }
            Ok(())
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

/// RFC 8785 JSON Canonicalization with float prohibition.
/// Sorts object keys lexicographically, uses compact form, rejects non-integer numbers.
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
        _ => serde_json::to_string(value).unwrap(),
    }
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
    fn test_rejects_floats() {
        let val = json!({"score": 0.5});
        assert!(canonicalize_v2(&val).is_err());
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
}
