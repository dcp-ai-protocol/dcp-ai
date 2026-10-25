//! EXPERIMENTAL and opt-in: phase 2 of the inactive candidate profile `dcp-jcs-v2`
//! (docs/proposals/canonicalization-candidate, §5–§7): the unit from a transport, the profile it
//! selects, and the decision to reject it, to delegate it to `dcp-jcs-v1` through an explicit
//! historical adapter, or to hand it to the candidate path. It is not normative and nothing calls it:
//! `dcp-jcs-v1`, the verifier over `serde_json::Value` and every default are unchanged. It verifies,
//! signs or admits nothing; `Candidate` is never an acceptance (phase 3 verifies it).
//!
//! One byte-level grammar walker serves both the envelope extraction and the profile reader; the
//! unit's own diagnosis is the unchanged phase 1 ingress. The historical adapter is consulted lazily, at
//! most once per route, and its reading can never produce `Candidate`.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use serde_json::Value;

use super::experimental_candidate_ingress::{
    experimental_candidate_ingress, CandidateIngressInternalError, CandidateIngressOutcome,
};

/// A configuration error, returned when the router is created and never for the data. `code` is
/// `POLICY_INVALID` or `CONFIG_INVALID`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {detail}")]
pub struct CandidateConfigError {
    pub code: String,
    pub detail: String,
}

/// A historical adapter that failed otherwise than by refusing the data; never a rejection.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("historical adapter {adapter}: {message}")]
pub struct CandidateAdapterError {
    pub adapter: String,
    pub message: String,
}

/// What a route can fail with, apart from the data: the adapter, or a broken invariant.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CandidateRouteError {
    #[error(transparent)]
    Adapter(#[from] CandidateAdapterError),
    #[error(transparent)]
    Internal(#[from] CandidateIngressInternalError),
}

/// An adapter's outcome other than a value: `Failed` is the decoder's refusal of the data (the data
/// path); `Adapter` is any other failure (an adapter error).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HistoricalDecode {
    Failed(String),
    Adapter(String),
}

type DecodeFn = dyn Fn(&[u8]) -> Result<Value, HistoricalDecode> + Send + Sync;

/// A historical decoder. `decode` receives its own copy of the unit and returns the decoder's value as
/// is. The router reads the profile from it by the exact path, so the decoder must keep the last
/// duplicate member, as `serde_json` measurably does; parity is only claimed for adapters that pass
/// the parity tests.
#[derive(Clone)]
pub struct HistoricalAdapter {
    name: String,
    decode: Arc<DecodeFn>,
}

impl HistoricalAdapter {
    /// `serde_json::from_slice::<Value>`, the input of `verify_signed_bundle_v2_at`. Offered by name;
    /// there is no default adapter.
    pub fn serde_json_from_slice() -> Self {
        Self::custom("serde_json_from_slice", |unit| {
            serde_json::from_slice::<Value>(unit).map_err(|e| HistoricalDecode::Failed(e.to_string()))
        })
    }

    pub fn custom(name: impl Into<String>, decode: impl Fn(&[u8]) -> Result<Value, HistoricalDecode> + Send + Sync + 'static) -> Self {
        Self { name: name.into(), decode: Arc::new(decode) }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// The decoder itself, as the router calls it.
    pub fn decode(&self, unit: &[u8]) -> Result<Value, HistoricalDecode> {
        (self.decode)(unit)
    }
}

/// The configuration, read once by `CandidateRouter::new`. `accepted_profiles` is a JSON list
/// (`Value::Null` is MISSING); `historical` has no default.
#[derive(Clone)]
pub struct CandidateRouterConfig {
    pub transport: String,
    pub accepted_profiles: Value,
    pub historical: Option<HistoricalAdapter>,
}

/// The unit of a transport, or the transport rejection (`transport_offset` is `None` for
/// NO_SIGNED_BUNDLE).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CandidateExtraction {
    Unit { start: usize, end: usize },
    Reject { class: String, detail: String, transport_offset: Option<usize> },
}

/// The unit's diagnosis carried by a delegation (D7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateWarning {
    pub class: String,
    pub offset: usize,
    pub transport_offset: usize,
}

/// What the adapter returned: the decoder's value, or its refusal.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateHistorical {
    pub adapter: String,
    pub decoded: Option<Value>,
    pub failed: Option<String>,
}

/// The unit's range in the input and a copy of its bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateUnit {
    pub start: usize,
    pub end: usize,
    pub bytes: Vec<u8>,
}

/// The outcome. `V1Path` always has profile `dcp-jcs-v1`; `profile_source` is field, absent or
/// historical. `Candidate` is not an acceptance.
#[derive(Debug, Clone, PartialEq)]
pub enum CandidateRoute {
    Reject {
        class: String,
        detail: Option<String>,
        offset: Option<usize>,
        transport_offset: Option<usize>,
        unit: Option<(usize, usize)>,
        profile: Option<String>,
    },
    V1Path { unit: CandidateUnit, profile_source: String, warnings: Vec<CandidateWarning>, historical: CandidateHistorical },
    Candidate { unit: CandidateUnit, value: Value, canonical: Vec<u8>, canonical_sha256: String },
}

impl CandidateRoute {
    /// The profile attempted: none for a rejection, at most one otherwise (no retry).
    pub fn attempts(&self) -> Vec<&'static str> {
        match self {
            Self::Reject { .. } => vec![],
            Self::V1Path { .. } => vec!["dcp-jcs-v1"],
            Self::Candidate { .. } => vec!["dcp-jcs-v2"],
        }
    }
}

// ── The byte-level grammar walker ───────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
struct Member {
    container: usize,
    name_start: usize,
    name_end: usize,
    value_start: usize,
    value_end: usize,
    value_object: Option<usize>,
}

struct Walk {
    root_start: usize,
    root_object: bool,
    members: Vec<Member>,
}

/// The RFC 8259 grammar of `b[start..end]` as one JSON text, iteratively and at any depth, without
/// decoding: strings are delimited and their escapes checked, bytes of 0x80 and above inside them are
/// left to the encoding check. Records the members of the objects within `record_depth` levels. On a
/// grammar error, the first byte that cannot extend a prefix of a JSON text (or `end`).
fn walk(b: &[u8], start: usize, end: usize, record_depth: usize) -> Result<Walk, usize> {
    struct Frame {
        object: bool,
        id: usize,
        depth: usize,
        pending: Option<usize>,
    }
    enum State {
        Value,
        Key,
        After,
    }
    let mut pos = start;
    let need = |pos: usize| if pos < end { Ok(b[pos]) } else { Err(end) };
    let skip_ws = |pos: &mut usize| {
        while *pos < end && matches!(b[*pos], b' ' | b'\t' | b'\n' | b'\r') {
            *pos += 1;
        }
    };
    let digits = |pos: &mut usize| {
        while *pos < end && b[*pos].is_ascii_digit() {
            *pos += 1;
        }
    };
    let string = |pos: &mut usize| -> Result<(), usize> {
        *pos += 1;
        loop {
            let c = need(*pos)?;
            if c == b'"' {
                *pos += 1;
                return Ok(());
            }
            if c < 0x20 {
                return Err(*pos);
            }
            if c != b'\\' {
                *pos += 1;
                continue;
            }
            *pos += 1;
            match need(*pos)? {
                b'u' => {
                    for _ in 0..4 {
                        *pos += 1;
                        if !need(*pos)?.is_ascii_hexdigit() {
                            return Err(*pos);
                        }
                    }
                    *pos += 1;
                }
                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => *pos += 1,
                _ => return Err(*pos),
            }
        }
    };
    let number = |pos: &mut usize| -> Result<(), usize> {
        if b[*pos] == b'-' {
            *pos += 1;
        }
        match need(*pos)? {
            b'0' => *pos += 1,
            b'1'..=b'9' => digits(pos),
            _ => return Err(*pos),
        }
        if *pos < end && b[*pos] == b'.' {
            *pos += 1;
            if !need(*pos)?.is_ascii_digit() {
                return Err(*pos);
            }
            digits(pos);
        }
        if *pos < end && matches!(b[*pos], b'e' | b'E') {
            *pos += 1;
            if matches!(need(*pos)?, b'+' | b'-') {
                *pos += 1;
            }
            if !need(*pos)?.is_ascii_digit() {
                return Err(*pos);
            }
            digits(pos);
        }
        Ok(())
    };
    let literal = |pos: &mut usize, word: &[u8]| -> Result<(), usize> {
        for &expected in word {
            if *pos >= end {
                return Err(end);
            }
            if b[*pos] != expected {
                return Err(*pos);
            }
            *pos += 1;
        }
        Ok(())
    };

    let mut members: Vec<Member> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut next_id = 0;
    skip_ws(&mut pos);
    let root_start = pos;
    let mut root_object = false;
    let mut state = State::Value;
    loop {
        match state {
            State::Value => {
                let c = need(pos)?;
                match c {
                    b'{' | b'[' => {
                        let object = c == b'{';
                        match stack.last() {
                            None => root_object = object,
                            Some(parent) => {
                                if let (Some(p), true) = (parent.pending, object) {
                                    members[p].value_object = Some(next_id);
                                }
                            }
                        }
                        stack.push(Frame { object, id: next_id, depth: stack.len() + 1, pending: None });
                        next_id += 1;
                        pos += 1;
                        skip_ws(&mut pos);
                        if pos < end && b[pos] == if object { b'}' } else { b']' } {
                            pos += 1;
                            stack.pop();
                            state = State::After;
                        } else if object {
                            state = State::Key;
                        }
                    }
                    b'"' => {
                        string(&mut pos)?;
                        state = State::After;
                    }
                    b'-' | b'0'..=b'9' => {
                        number(&mut pos)?;
                        state = State::After;
                    }
                    b't' => {
                        literal(&mut pos, b"true")?;
                        state = State::After;
                    }
                    b'f' => {
                        literal(&mut pos, b"false")?;
                        state = State::After;
                    }
                    b'n' => {
                        literal(&mut pos, b"null")?;
                        state = State::After;
                    }
                    _ => return Err(pos),
                }
            }
            State::Key => {
                if need(pos)? != b'"' {
                    return Err(pos);
                }
                let name_start = pos;
                string(&mut pos)?;
                let name_end = pos;
                skip_ws(&mut pos);
                if need(pos)? != b':' {
                    return Err(pos);
                }
                pos += 1;
                skip_ws(&mut pos);
                let frame = stack.last_mut().expect("a key is read inside an object");
                if frame.depth <= record_depth {
                    frame.pending = Some(members.len());
                    members.push(Member { container: frame.id, name_start, name_end, value_start: pos, value_end: 0, value_object: None });
                }
                state = State::Value;
            }
            State::After => {
                let Some(frame) = stack.last_mut() else {
                    skip_ws(&mut pos);
                    if pos != end {
                        return Err(pos);
                    }
                    return Ok(Walk { root_start, root_object, members });
                };
                if let Some(p) = frame.pending.take() {
                    members[p].value_end = pos;
                }
                let object = frame.object;
                skip_ws(&mut pos);
                let c = need(pos)?;
                if c == b',' {
                    pos += 1;
                    skip_ws(&mut pos);
                    state = if object { State::Key } else { State::Value };
                } else if c == if object { b'}' } else { b']' } {
                    pos += 1;
                    stack.pop();
                } else {
                    return Err(pos);
                }
            }
        }
    }
}

/// Whether the string `b[start..end]` (quotes included, grammar already checked) unescapes to the
/// ASCII `target`.
fn string_equals(b: &[u8], start: usize, end: usize, target: &str) -> bool {
    let target = target.as_bytes();
    let (mut i, mut k) = (start + 1, 0);
    while i < end - 1 {
        let unit: u32 = if b[i] == b'\\' {
            if b[i + 1] == b'u' {
                let v = b[i + 2..i + 6].iter().fold(0, |v, &h| v * 16 + (h as char).to_digit(16).unwrap_or(0));
                i += 6;
                v
            } else {
                let v = match b[i + 1] {
                    b'b' => 0x08,
                    b'f' => 0x0C,
                    b'n' => 0x0A,
                    b'r' => 0x0D,
                    b't' => 0x09,
                    other => other,
                };
                i += 2;
                u32::from(v)
            }
        } else {
            if b[i] >= 0x80 {
                return false; // the targets are ASCII
            }
            i += 1;
            u32::from(b[i - 1])
        };
        if k >= target.len() || unit != u32::from(target[k]) {
            return false;
        }
        k += 1;
    }
    k == target.len()
}

fn last_member<'m>(b: &[u8], members: &'m [Member], container: usize, name: &str) -> Option<&'m Member> {
    members.iter().rev().find(|m| m.container == container && string_equals(b, m.name_start, m.name_end, name))
}

fn extract(b: &[u8], transport: &str) -> CandidateExtraction {
    let n = b.len();
    if transport == "bare" {
        return CandidateExtraction::Unit { start: 0, end: n };
    }
    let reject = |class: &str, detail: &str, transport_offset: Option<usize>| CandidateExtraction::Reject {
        class: class.into(),
        detail: detail.into(),
        transport_offset,
    };
    if b.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return reject("TRANSPORT_INVALID", "BOM", Some(0)); // T1
    }
    let w = match walk(b, 0, n, 1) {
        Ok(w) => w,
        Err(offset) => return reject("TRANSPORT_INVALID", "SYNTAX", Some(offset)), // T2
    };
    if !w.root_object {
        return reject("TRANSPORT_INVALID", "NOT_AN_OBJECT", Some(w.root_start)); // T3
    }
    let named: Vec<&Member> = w.members.iter().filter(|m| m.container == 0 && string_equals(b, m.name_start, m.name_end, "signed_bundle")).collect();
    match named.len() {
        0 => return reject("TRANSPORT_INVALID", "NO_SIGNED_BUNDLE", None), // T4
        1 => {}
        _ => return reject("TRANSPORT_AMBIGUOUS", "SIGNED_BUNDLE_REPEATED", Some(named[1].name_start)),
    }
    let (start, end) = (named[0].value_start, named[0].value_end);
    if let Err(e) = std::str::from_utf8(&b[..start]) {
        return reject("TRANSPORT_INVALID", "UTF8_INVALID", Some(e.valid_up_to())); // T5: before the unit
    }
    if let Err(e) = std::str::from_utf8(&b[end..]) {
        return reject("TRANSPORT_INVALID", "UTF8_INVALID", Some(end + e.valid_up_to())); // then after it
    }
    CandidateExtraction::Unit { start, end }
}

/// EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 2): the unit of a transport, by the phases
/// T1–T5 of §6.3 for an envelope (the whole input for `bare`), as offsets in the input. The error is
/// only for a transport other than `bare` or `envelope`.
pub fn extract_unit(input: &[u8], transport: &str) -> Result<CandidateExtraction, String> {
    if transport != "bare" && transport != "envelope" {
        return Err(format!("transport must be \"bare\" or \"envelope\", not {:?}", transport));
    }
    Ok(extract(input, transport))
}

/// The profile a walkable unit selects: the exact path, the last duplicate at each step (§7).
fn read_profile(b: &[u8], start: usize, end: usize) -> Result<(&'static str, Option<usize>), CandidateIngressInternalError> {
    let w = walk(b, start, end, 3)
        .map_err(|_| CandidateIngressInternalError("the grammar walker refused a unit the ingress walked".into()))?;
    let absent = Ok(("absent", None));
    if !w.root_object {
        return absent;
    }
    let Some(bundle) = last_member(b, &w.members, 0, "bundle").and_then(|m| m.value_object) else { return absent };
    let Some(manifest) = last_member(b, &w.members, bundle, "manifest").and_then(|m| m.value_object) else { return absent };
    let Some(field) = last_member(b, &w.members, manifest, "canonicalization_profile") else { return absent };
    let offset = Some(field.value_start - start);
    for known in ["dcp-jcs-v1", "dcp-jcs-v2"] {
        if b[field.value_start] == b'"' && string_equals(b, field.value_start, field.value_end, known) {
            return Ok((known, offset));
        }
    }
    Ok(("unknown", offset))
}

/// The profile a decoded value carries at the exact path.
fn read_decoded_profile(value: &Value) -> &'static str {
    let field = value
        .as_object()
        .and_then(|o| o.get("bundle"))
        .and_then(Value::as_object)
        .and_then(|o| o.get("manifest"))
        .and_then(Value::as_object)
        .and_then(|o| o.get("canonicalization_profile"));
    match field {
        None => "absent",
        Some(Value::String(s)) if s == "dcp-jcs-v1" => "dcp-jcs-v1",
        Some(Value::String(s)) if s == "dcp-jcs-v2" => "dcp-jcs-v2",
        Some(_) => "unknown",
    }
}

/// Where a route consults the historical adapter: a pure function of the input and the configuration.
/// `step` is `unwalkable` (the adapter decides) or `v1_delegation` (it produces the delegated value).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HistoricalPoint {
    pub step: &'static str,
    pub start: usize,
    pub end: usize,
    pub diagnosis: Option<CandidateWarning>,
    pub scanner_profile: Option<(&'static str, Option<usize>)>,
}

/// A router over a private snapshot of its configuration, taken by `CandidateRouter::new`.
pub struct CandidateRouter {
    transport: String,
    accepts_v1: bool,
    accepts_v2: bool,
    adapter_name: String,
    decode: Arc<DecodeFn>,
}

fn snapshot_policy(policy: &Value) -> Result<(bool, bool), CandidateConfigError> {
    let invalid = |detail: &str| CandidateConfigError { code: "POLICY_INVALID".into(), detail: detail.into() };
    let entries = match policy {
        Value::Null => return Err(invalid("MISSING")),
        Value::Array(list) if !list.is_empty() => list,
        _ => return Err(invalid("NOT_A_NON_EMPTY_LIST")),
    };
    let strings: Vec<&str> = entries.iter().filter_map(Value::as_str).collect();
    if strings.len() != entries.len() {
        return Err(invalid("NOT_STRINGS"));
    }
    let unique: std::collections::BTreeSet<&str> = strings.iter().copied().collect();
    if unique.len() != strings.len() {
        return Err(invalid("REPEATED"));
    }
    if unique.iter().any(|p| *p != "dcp-jcs-v1" && *p != "dcp-jcs-v2") {
        return Err(invalid("UNKNOWN_PROFILE"));
    }
    Ok((unique.contains("dcp-jcs-v1"), unique.contains("dcp-jcs-v2")))
}

impl CandidateRouter {
    /// EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 2): a router over a snapshot of `config`,
    /// validated here, before any input: the transport, the accepted profiles (no default) and the
    /// historical adapter (no default; its name and decode function are captured now).
    pub fn new(config: CandidateRouterConfig) -> Result<Self, CandidateConfigError> {
        let (accepts_v1, accepts_v2) = snapshot_policy(&config.accepted_profiles)?;
        let invalid = |detail: &str| CandidateConfigError { code: "CONFIG_INVALID".into(), detail: detail.into() };
        if config.transport != "bare" && config.transport != "envelope" {
            return Err(invalid("TRANSPORT"));
        }
        let adapter = config.historical.ok_or_else(|| invalid("HISTORICAL_ADAPTER"))?;
        if adapter.name.is_empty() {
            return Err(invalid("HISTORICAL_ADAPTER"));
        }
        Ok(Self { transport: config.transport, accepts_v1, accepts_v2, adapter_name: adapter.name, decode: adapter.decode })
    }

    /// A fresh copy of the effective configuration: transport, accepted profiles, adapter name.
    pub fn configuration(&self) -> (String, Vec<String>, String) {
        let profiles = [("dcp-jcs-v1", self.accepts_v1), ("dcp-jcs-v2", self.accepts_v2)]
            .iter()
            .filter(|(_, on)| *on)
            .map(|(p, _)| p.to_string())
            .collect();
        (self.transport.clone(), profiles, self.adapter_name.clone())
    }

    /// The adapter, once, on its own copy of the unit. `HistoricalDecode::Adapter` or a panic is an
    /// adapter error, never a rejection of the data.
    fn consult(&self, unit: &[u8]) -> Result<CandidateHistorical, CandidateAdapterError> {
        let fail = |message: String| CandidateAdapterError { adapter: self.adapter_name.clone(), message };
        let copy = unit.to_vec();
        match catch_unwind(AssertUnwindSafe(|| (self.decode)(&copy))) {
            Ok(Ok(value)) => Ok(CandidateHistorical { adapter: self.adapter_name.clone(), decoded: Some(value), failed: None }),
            Ok(Err(HistoricalDecode::Failed(reason))) => Ok(CandidateHistorical { adapter: self.adapter_name.clone(), decoded: None, failed: Some(reason) }),
            Ok(Err(HistoricalDecode::Adapter(message))) => Err(fail(message)),
            Err(_) => Err(fail("decode panicked".into())),
        }
    }

    /// EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 2): reject, delegate to `dcp-jcs-v1`, or
    /// select the candidate path (§6.4), from the original bytes, borrowed and never mutated.
    pub fn route(&self, input: &[u8]) -> Result<CandidateRoute, CandidateRouteError> {
        self.route_internal(input, &mut |_, unit| self.consult(unit).map_err(CandidateRouteError::Adapter))
    }

    /// The route, with the historical consultation as a callback that receives its decision point and
    /// a copy-free view of the unit; it is called at most once, and only where §6.4 needs it.
    pub(crate) fn route_internal<E: From<CandidateIngressInternalError>>(
        &self,
        input: &[u8],
        consult: &mut dyn FnMut(&HistoricalPoint, &[u8]) -> Result<CandidateHistorical, E>,
    ) -> Result<CandidateRoute, E> {
        let (start, end) = match extract(input, &self.transport) {
            CandidateExtraction::Reject { class, detail, transport_offset } => {
                return Ok(CandidateRoute::Reject { class, detail: Some(detail), offset: None, transport_offset, unit: None, profile: None })
            }
            CandidateExtraction::Unit { start, end } => (start, end),
        };
        let unit = &input[start..end];
        let scan = experimental_candidate_ingress(unit)?;
        let diagnosis = match &scan {
            CandidateIngressOutcome::Reject { class, offset } => {
                Some(CandidateWarning { class: class.as_str().into(), offset: *offset, transport_offset: start + offset })
            }
            CandidateIngressOutcome::Accept { .. } => None,
        };
        let reject = |class: &str, offset: Option<usize>, profile: Option<&str>| CandidateRoute::Reject {
            class: class.into(),
            detail: None,
            offset,
            transport_offset: offset.map(|o| start + o),
            unit: Some((start, end)),
            profile: profile.map(String::from),
        };
        let owned_unit = || CandidateUnit { start, end, bytes: unit.to_vec() };
        let delegate = |source: &str, historical: CandidateHistorical| CandidateRoute::V1Path {
            unit: owned_unit(),
            profile_source: source.into(),
            warnings: diagnosis.iter().cloned().collect(),
            historical,
        };

        let walkable = diagnosis.as_ref().map_or(true, |d| !matches!(d.class.as_str(), "BOM" | "UTF8_INVALID" | "SYNTAX"));
        if walkable {
            let (profile, offset) = read_profile(input, start, end)?;
            return Ok(match profile {
                "unknown" => reject("PROFILE_UNKNOWN", offset, None),
                "absent" | "dcp-jcs-v1" if !self.accepts_v1 => reject("PROFILE_NOT_ACCEPTED", offset, Some("dcp-jcs-v1")),
                "absent" | "dcp-jcs-v1" => {
                    let point = HistoricalPoint { step: "v1_delegation", start, end, diagnosis: diagnosis.clone(), scanner_profile: Some((profile, offset)) };
                    delegate(if profile == "absent" { "absent" } else { "field" }, consult(&point, unit)?)
                }
                _ if !self.accepts_v2 => reject("PROFILE_NOT_ACCEPTED", offset, Some("dcp-jcs-v2")),
                _ => match (scan, &diagnosis) {
                    (_, Some(d)) => reject(&d.class, Some(d.offset), Some("dcp-jcs-v2")),
                    (CandidateIngressOutcome::Accept { value, canonical, canonical_sha256 }, None) => {
                        CandidateRoute::Candidate { unit: owned_unit(), value, canonical, canonical_sha256 }
                    }
                    (CandidateIngressOutcome::Reject { .. }, None) => {
                        return Err(CandidateIngressInternalError("a rejection without a diagnosis".into()).into())
                    }
                },
            });
        }
        // Not walkable: the historical adapter decides, once; its reading never selects the candidate.
        let d = diagnosis.clone().expect("not walkable implies a diagnosis");
        let point = HistoricalPoint { step: "unwalkable", start, end, diagnosis: Some(d.clone()), scanner_profile: None };
        let historical = consult(&point, unit)?;
        let Some(decoded) = &historical.decoded else { return Ok(reject(&d.class, Some(d.offset), None)) };
        if !matches!(read_decoded_profile(decoded), "absent" | "dcp-jcs-v1") {
            return Ok(reject(&d.class, Some(d.offset), None));
        }
        if !self.accepts_v1 {
            return Ok(reject("PROFILE_NOT_ACCEPTED", None, Some("dcp-jcs-v1")));
        }
        Ok(delegate("historical", historical))
    }
}

#[cfg(test)]
mod tests {
    //! The grammar walker against the phase 1 scanner, on every corpus input that is UTF-8 without a
    //! BOM; the encoding layer keeps its own precedence, checked apart.
    use super::*;

    #[test]
    fn grammar_walker_matches_phase_1() {
        let dir = format!("{}/../../docs/proposals/canonicalization-candidate", env!("CARGO_MANIFEST_DIR"));
        let mut compared = 0;
        for name in ["baseline-corpus.json", "corpus.json"] {
            let file: Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/{}", dir, name)).unwrap()).unwrap();
            for case in file["cases"].as_array().unwrap() {
                let input = match case.get("input_hex") {
                    Some(h) => hex::decode(h.as_str().unwrap()).unwrap(),
                    None => case["input_json"].as_str().unwrap().as_bytes().to_vec(),
                };
                let p1 = experimental_candidate_ingress(&input).unwrap();
                let class = match &p1 {
                    CandidateIngressOutcome::Reject { class, offset } => Some((class.as_str(), *offset)),
                    _ => None,
                };
                if matches!(class, Some(("BOM", _)) | Some(("UTF8_INVALID", _))) {
                    continue;
                }
                let w = walk(&input, 0, input.len(), 0).map(|_| ());
                match class {
                    Some(("SYNTAX", offset)) => assert_eq!(w, Err(offset), "{}", case["id"]),
                    _ => assert_eq!(w, Ok(()), "{}", case["id"]),
                }
                compared += 1;
            }
        }
        assert_eq!(compared, 234); // 274 corpus inputs, 40 with a BOM or invalid UTF-8
        assert_eq!(walk(b"[,\"\xff\"]", 0, 6, 0).map(|_| ()), Err(1));
        assert_eq!(walk(b"\xef\xbb\xbf{}", 0, 5, 0).map(|_| ()), Err(0));
    }
}
