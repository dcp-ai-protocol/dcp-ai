//! spec/VERIFICATION.md V2-2: the signed bundle against signed_bundle.schema.json and each `SignedPayload.payload`
//! against its artifact schema (bound by bundle member name), from the IR that tools/schema-ir/generate.mjs compiles
//! out of schemas/v2 (schema_v2_generated.rs; no schema file or network access at verification time). Internal: the
//! crate exports no schema-only API; `verify_bundle::verify` runs this before any other check of the bundle.
//!
//! It validates the `serde_json::Value` the caller already has, so its value domain is exactly that type's: `Null`,
//! `Bool`, `Number` (an i64, a u64 or a finite f64), `String`, `Array` and `Object`. What serde_json does not
//! represent never reaches it: a lone surrogate escape or a number that overflows binary64 (1e400) is a parse error
//! of the caller's `serde_json::from_str`, before this check.
//!
//! - integer is an i64, a u64 or a finite f64 with no fraction (2 and 2.0 alike); a bool is never a number;
//!   `minimum` and `maximum` compare an integer exactly, without going through f64;
//! - an object's members are its keys; a member of an open object that no schema names is not visited;
//! - lengths in Unicode scalar values (chars); enum and const by exact string equality; uniqueItems over strings with
//!   a set; patterns through the IR's deterministic programs (full-string match, as these anchored sources say);
//!   date-time as ajv-formats 3.0.1 asserts it (below), not a Rust date/time library;
//! - oneOf: exactly one branch valid, reported once at the instance;
//! - unknown members of a closed object are reported in code-point order, whatever order the map keeps;
//! - at most 16 errors and then a truncation marker; the verdict never depends on the cap; diagnostics name the
//!   instance pointer (RFC 6901, each token escaped and then cut to 64 code points) and the keyword, never a value.
//!
//! Nothing is written to the input. The IR is parsed once (OnceLock) and is read-only afterwards, so concurrent
//! verifications share it safely.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{Number, Value};
use sha2::{Digest, Sha256};

use crate::v2::schema_v2_generated::{SCHEMA_V2_IR, SCHEMA_V2_IR_SHA256};

pub(crate) const SCHEMA_ERRORS_CAP: usize = 16;
const SCHEMA_TOKEN_CAP: usize = 64;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProgramItem {
    ranges: Vec<[u32; 2]>,
    min: u32,
    max: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Program {
    #[allow(dead_code)] // read by the crate's tests: each program against its anchored source
    pub(crate) source: String,
    alternatives: Vec<Vec<ProgramItem>>,
}

// Every keyword the IR format carries; an IR with another one does not load (fail closed).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Node {
    site: String,
    types: Option<Vec<String>>,
    properties: Option<Vec<(String, usize)>>,
    required: Option<Vec<String>>,
    #[serde(default)]
    closed: bool,
    items: Option<usize>,
    #[serde(rename = "oneOf")]
    one_of: Option<Vec<usize>>,
    #[serde(rename = "enum")]
    enum_: Option<Vec<String>>,
    #[serde(rename = "const")]
    const_: Option<String>,
    pattern: Option<usize>,
    format: Option<String>,
    #[serde(rename = "minLength")]
    min_length: Option<u64>,
    #[serde(rename = "maxLength")]
    max_length: Option<u64>,
    #[serde(rename = "minItems")]
    min_items: Option<u64>,
    #[serde(rename = "uniqueItems", default)]
    unique_items: bool,
    minimum: Option<Number>,
    maximum: Option<Number>,
    #[serde(rename = "ref")]
    ref_: Option<usize>,
}

#[derive(Deserialize)]
struct Overlay {
    node: usize,
    keyword: String,
    value: String,
}

#[derive(Deserialize)]
struct Roots {
    signed_bundle: usize,
    payloads: Vec<(String, usize)>,
}

#[derive(Deserialize)]
struct Ir {
    format: String,
    patterns: Vec<Program>,
    nodes: Vec<Node>,
    roots: Roots,
    overlays: HashMap<String, Vec<Overlay>>,
}

struct Loaded {
    ir: Ir,
    named: Vec<HashSet<String>>, // per node: the names of its properties
}

static LOADED: OnceLock<Result<Loaded, String>> = OnceLock::new();

fn build_loaded() -> Result<Loaded, String> {
    if hex::encode(Sha256::digest(SCHEMA_V2_IR.as_bytes())) != SCHEMA_V2_IR_SHA256 {
        return Err("the V2 schema IR does not match its sha256".into());
    }
    let ir: Ir = serde_json::from_str(SCHEMA_V2_IR).map_err(|e| format!("the V2 schema IR does not parse: {}", e))?;
    if ir.format != "dcp-ai.v2-schema-ir/1" {
        return Err(format!("unsupported V2 schema IR {:?}", ir.format));
    }
    let named = ir.nodes.iter().map(|n| n.properties.iter().flatten().map(|(name, _)| name.clone()).collect()).collect();
    Ok(Loaded { ir, named })
}

fn load() -> Result<&'static Loaded, String> {
    LOADED.get_or_init(build_loaded).as_ref().map_err(|e| e.clone())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SchemaError {
    pub(crate) instance: String,
    pub(crate) keyword: &'static str,
    pub(crate) site: String,
    pub(crate) member: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SchemaResult {
    pub(crate) valid: bool,
    pub(crate) errors: Vec<SchemaError>,
    pub(crate) truncated: bool,
}

/// An RFC 6901 token, escaped first and then cut to 64 code points with a marker.
pub(crate) fn bounded_token(token: &str) -> String {
    let t = token.replace('~', "~0").replace('/', "~1");
    match t.char_indices().nth(SCHEMA_TOKEN_CAP) {
        Some((at, _)) => format!("{}…[cut]", &t[..at]),
        None => t,
    }
}

fn is_integer(n: &Number) -> bool {
    n.is_i64() || n.is_u64() || n.as_f64().is_some_and(|f| f.is_finite() && f.fract() == 0.0)
}

fn type_ok(t: &str, v: &Value) -> bool {
    match t {
        "null" => v.is_null(),
        "boolean" => v.is_boolean(),
        "string" => v.is_string(),
        "integer" => matches!(v, Value::Number(n) if is_integer(n)),
        "array" => v.is_array(),
        "object" => v.is_object(),
        _ => false,
    }
}

/// An integer against a finite f64, exactly.
fn cmp_int_float(x: i128, f: f64) -> Ordering {
    if f >= 1e38 {
        return Ordering::Less;
    }
    if f <= -1e38 {
        return Ordering::Greater;
    }
    let floor = f.floor();
    let fi = floor as i128;
    if floor == f {
        x.cmp(&fi)
    } else if x <= fi {
        Ordering::Less
    } else {
        Ordering::Greater
    }
}

fn as_int(n: &Number) -> Option<i128> {
    n.as_i64().map(i128::from).or_else(|| n.as_u64().map(i128::from))
}

/// a against b; integers exactly, an integer against a float exactly, floats as binary64.
fn cmp_number(a: &Number, b: &Number) -> Ordering {
    match (as_int(a), as_int(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(x), None) => cmp_int_float(x, b.as_f64().unwrap_or(0.0)),
        (None, Some(y)) => cmp_int_float(y, a.as_f64().unwrap_or(0.0)).reverse(),
        (None, None) => a.as_f64().unwrap_or(0.0).partial_cmp(&b.as_f64().unwrap_or(0.0)).unwrap_or(Ordering::Equal),
    }
}

/// The full-string match of a compiled program over the code points of s.
pub(crate) fn match_program(p: &Program, s: &str) -> bool {
    let cps: Vec<u32> = s.chars().map(u32::from).collect();
    p.alternatives.iter().any(|items| {
        let mut i = 0;
        for it in items {
            let mut n = 0;
            while it.max.is_none_or(|m| n < m) && i < cps.len() && it.ranges.iter().any(|r| r[0] <= cps[i] && cps[i] <= r[1]) {
                i += 1;
                n += 1;
            }
            if n < it.min {
                return false;
            }
        }
        i == cps.len()
    })
}

// date-time: ajv-formats 3.0.1 fullFormats["date-time"] (getDateTime(true)), the format lib/verify.js asserts. A
// compatibility boundary, quirks included, not a reading of RFC 3339; the V2-4, V2-13 and V2-14 temporal parsers are
// a later, different layer. Ported from ajv-formats (https://github.com/ajv-validator/ajv-formats), under its license:
//
// MIT License
//
// Copyright (c) 2020 Evgeny Poberezkin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/// DATE_TIME_SEPARATOR = /t|\s/i: "t", "T" and ECMAScript white space and line terminators.
fn is_separator(c: char) -> bool {
    matches!(c as u32,
        0x74 | 0x54 | 0x09..=0x0d | 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}

const DAYS: [u32; 13] = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

fn digits(s: &[u8], i: usize, n: usize) -> bool {
    s.len() >= i + n && s[i..i + n].iter().all(u8::is_ascii_digit)
}

fn num(s: &[u8]) -> i64 {
    s.iter().fold(0, |acc, d| acc * 10 + i64::from(d - b'0'))
}

fn is_date(s: &[u8]) -> bool {
    if s.len() != 10 || !digits(s, 0, 4) || s[4] != b'-' || !digits(s, 5, 2) || s[7] != b'-' || !digits(s, 8, 2) {
        return false;
    }
    let (year, month, day) = (num(&s[0..4]), num(&s[5..7]) as usize, num(&s[8..10]) as u32);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    (1..=12).contains(&month) && day >= 1 && day <= if month == 2 && leap { 29 } else { DAYS[month] }
}

fn is_time(s: &[u8]) -> bool {
    if !digits(s, 0, 2) || s.get(2) != Some(&b':') || !digits(s, 3, 2) || s.get(5) != Some(&b':') || !digits(s, 6, 2) {
        return false;
    }
    let mut i = 8;
    if s.get(i) == Some(&b'.') {
        let mut j = i + 1;
        while digits(s, j, 1) {
            j += 1;
        }
        if j == i + 1 {
            return false;
        }
        i = j;
    }
    // binary64, as JavaScript's Number("59.99999999999999999") is 60
    let sec: f64 = match std::str::from_utf8(&s[6..i]).ok().and_then(|t| t.parse().ok()) {
        Some(v) => v,
        None => return false,
    };
    let (mut tz, mut sign, mut tz_h, mut tz_m) = (false, 1, 0, 0);
    match s.get(i) {
        Some(b'z') | Some(b'Z') => {
            tz = true;
            i += 1;
        }
        Some(c @ (b'+' | b'-')) => {
            if !digits(s, i + 1, 2) {
                return false;
            }
            tz = true;
            if *c == b'-' {
                sign = -1;
            }
            tz_h = num(&s[i + 1..i + 3]);
            i += 3;
            if s.get(i) == Some(&b':') && digits(s, i + 1, 2) {
                tz_m = num(&s[i + 1..i + 3]);
                i += 3;
            } else if digits(s, i, 2) {
                tz_m = num(&s[i..i + 2]);
                i += 2;
            }
        }
        _ => {}
    }
    if i != s.len() {
        return false;
    }
    let (hr, mn) = (num(&s[0..2]), num(&s[3..5]));
    if tz_h > 23 || tz_m > 59 || !tz {
        return false;
    }
    if hr <= 23 && mn <= 59 && sec < 60.0 {
        return true;
    }
    let utc_min = mn - tz_m * sign;
    let utc_hr = hr - tz_h * sign - if utc_min < 0 { 1 } else { 0 };
    (utc_hr == 23 || utc_hr == -1) && (utc_min == 59 || utc_min == -1) && sec < 61.0
}

/// True when the string is a date-time as ajv-formats 3.0.1 (full mode) accepts it.
pub(crate) fn is_schema_date_time(s: &str) -> bool {
    let mut at: Option<(usize, usize)> = None;
    for (i, c) in s.char_indices() {
        if is_separator(c) {
            if at.is_some() {
                return false;
            }
            at = Some((i, c.len_utf8()));
        }
    }
    match at {
        Some((i, len)) => is_date(&s.as_bytes()[..i]) && is_time(&s.as_bytes()[i + len..]),
        None => false,
    }
}

struct Stop;

type Sink<'s> = dyn FnMut(&str, &'static str, &Node, Option<&str>) -> Result<(), Stop> + 's;

struct Validator<'a> {
    loaded: &'a Loaded,
    replaced: Option<(usize, &'a str)>,
}

impl Validator<'_> {
    fn visit(&self, id: usize, v: &Value, ptr: &str, sink: &mut Sink) -> Result<(), Stop> {
        let n = &self.loaded.ir.nodes[id];
        if let Some(r) = n.ref_ {
            self.visit(r, v, ptr, sink)?;
        }
        if let Some(types) = &n.types {
            if !types.iter().any(|t| type_ok(t, v)) {
                sink(ptr, "type", n, None)?;
            }
        }
        if let Some(values) = &n.enum_ {
            if !v.as_str().is_some_and(|s| values.iter().any(|e| e == s)) {
                sink(ptr, "enum", n, None)?;
            }
        }
        if let Some(c) = &n.const_ {
            let want = match self.replaced {
                Some((node, value)) if node == id => value,
                _ => c.as_str(),
            };
            if v.as_str() != Some(want) {
                sink(ptr, "const", n, None)?;
            }
        }
        match v {
            Value::String(s) => {
                if n.min_length.is_some() || n.max_length.is_some() {
                    let l = s.chars().count() as u64;
                    if n.min_length.is_some_and(|m| l < m) {
                        sink(ptr, "minLength", n, None)?;
                    }
                    if n.max_length.is_some_and(|m| l > m) {
                        sink(ptr, "maxLength", n, None)?;
                    }
                }
                if let Some(p) = n.pattern {
                    if !match_program(&self.loaded.ir.patterns[p], s) {
                        sink(ptr, "pattern", n, None)?;
                    }
                }
                if n.format.as_deref() == Some("date-time") && !is_schema_date_time(s) {
                    sink(ptr, "format", n, None)?;
                }
            }
            Value::Array(a) => {
                if n.min_items.is_some_and(|m| (a.len() as u64) < m) {
                    sink(ptr, "minItems", n, None)?;
                }
                if n.unique_items && a.iter().all(Value::is_string) {
                    let mut seen = HashSet::new();
                    if !a.iter().all(|x| seen.insert(x.as_str())) {
                        sink(ptr, "uniqueItems", n, None)?;
                    }
                }
                if let Some(items) = n.items {
                    for (i, x) in a.iter().enumerate() {
                        self.visit(items, x, &format!("{}/{}", ptr, i), sink)?;
                    }
                }
            }
            Value::Object(o) => {
                for r in n.required.iter().flatten() {
                    if !o.contains_key(r) {
                        sink(ptr, "required", n, Some(r.as_str()))?;
                    }
                }
                if n.closed {
                    let mut unknown: Vec<&String> = o.keys().filter(|k| !self.loaded.named[id].contains(*k)).collect();
                    unknown.sort(); // UTF-8 byte order is code-point order
                    for k in unknown {
                        sink(ptr, "additionalProperties", n, Some(k.as_str()))?;
                    }
                }
                for (name, child) in n.properties.iter().flatten() {
                    if let Some(x) = o.get(name) {
                        self.visit(*child, x, &format!("{}/{}", ptr, bounded_token(name)), sink)?;
                    }
                }
            }
            Value::Number(x) => {
                if n.minimum.as_ref().is_some_and(|m| cmp_number(x, m) == Ordering::Less) {
                    sink(ptr, "minimum", n, None)?;
                }
                if n.maximum.as_ref().is_some_and(|m| cmp_number(x, m) == Ordering::Greater) {
                    sink(ptr, "maximum", n, None)?;
                }
            }
            _ => {}
        }
        if let Some(branches) = &n.one_of {
            let mut valid = 0;
            for b in branches {
                let mut failed = false;
                let _ = self.visit(*b, v, ptr, &mut |_, _, _, _| {
                    failed = true;
                    Ok(())
                });
                if !failed {
                    valid += 1;
                }
            }
            if valid != 1 {
                sink(ptr, "oneOf", n, None)?;
            }
        }
        Ok(())
    }
}

/// V2-2 for `doc` under the accepted canonicalization profile: "dcp-jcs-v1" is the normative schema; "dcp-jcs-v2"
/// (only the explicitly selected experimental route) replaces exactly one const, canonicalization_profile.
pub(crate) fn validate_signed_bundle_v2_schema(doc: &Value, accepted_profile: &str) -> Result<SchemaResult, String> {
    let loaded = load()?;
    let replaced = match accepted_profile {
        "dcp-jcs-v1" => None,
        "dcp-jcs-v2" => match loaded.ir.overlays.get("dcp-jcs-v2").map(Vec::as_slice) {
            Some([o]) if o.keyword == "const" => Some((o.node, o.value.as_str())),
            _ => return Err("the V2 schema IR has no dcp-jcs-v2 overlay".into()),
        },
        other => return Err(format!("unknown canonicalization profile {:?}", other)),
    };
    let validator = Validator { loaded, replaced };
    let mut res = SchemaResult { valid: true, ..Default::default() };
    let mut top = |ptr: &str, keyword: &'static str, n: &Node, member: Option<&str>| -> Result<(), Stop> {
        res.valid = false;
        if res.errors.len() >= SCHEMA_ERRORS_CAP {
            res.truncated = true;
            return Err(Stop);
        }
        res.errors.push(SchemaError {
            instance: ptr.to_string(),
            keyword,
            site: format!("{}/{}", n.site, keyword),
            member: member.map(bounded_token),
        });
        Ok(())
    };
    let _ = (|| -> Result<(), Stop> {
        validator.visit(loaded.ir.roots.signed_bundle, doc, "", &mut top)?;
        if let Some(bundle) = doc.get("bundle").filter(|b| b.is_object()) {
            for (member, root) in &loaded.ir.roots.payloads {
                if let Some(payload) = bundle.get(member).filter(|e| e.is_object()).and_then(|e| e.get("payload")).filter(|p| p.is_object()) {
                    validator.visit(*root, payload, &format!("/bundle/{}/payload", member), &mut top)?;
                }
            }
        }
        Ok(())
    })();
    Ok(res)
}

/// The verifier's errors for a schema failure: one line per error, then the truncation marker. No input value.
pub(crate) fn schema_diagnostics(r: &SchemaResult) -> Vec<String> {
    let mut lines: Vec<String> = r
        .errors
        .iter()
        .map(|e| {
            let instance = if e.instance.is_empty() { "/" } else { &e.instance };
            match &e.member {
                Some(m) => format!("schema: {} {} {}", instance, e.keyword, m),
                None => format!("schema: {} {}", instance, e.keyword),
            }
        })
        .collect();
    if r.truncated {
        lines.push("schema: further errors not listed".into());
    }
    lines
}

/// The parsed IR's patterns, for the crate's own tests.
#[cfg(test)]
pub(crate) fn patterns() -> &'static [Program] {
    &load().expect("the V2 schema IR").ir.patterns
}

/// Starts from a fresh, not yet initialized IR, for the concurrent initialization test.
#[cfg(test)]
pub(crate) fn fresh_load() -> Result<(), String> {
    let cell: OnceLock<Result<Loaded, String>> = OnceLock::new();
    std::thread::scope(|s| {
        let handles: Vec<_> = (0..32).map(|_| s.spawn(|| cell.get_or_init(build_loaded).is_ok())).collect();
        if handles.into_iter().all(|h| h.join().unwrap_or(false)) {
            Ok(())
        } else {
            Err("a thread could not load the IR".into())
        }
    })
}

#[cfg(test)]
#[path = "schema_v2_tests.rs"]
mod tests;
