//! EXPERIMENTAL and opt-in: the ingress of one unit under the inactive candidate profile
//! `dcp-jcs-v2` (docs/proposals/canonicalization-candidate, §3–§6). It is not normative and nothing
//! calls it: `dcp-jcs-v1` (`canonicalize_v2`) and the verifier over `serde_json::Value` are
//! unchanged, and `dcp-jcs-v1` remains the only profile.
//!
//! Phase 1 only. From the original bytes of one unit it decides acceptance (UTF-8, BOM, the whole
//! RFC 8259 grammar, scalar strings, unique keys, exact integers by N4, at most 64 levels) with the
//! precedence and byte offsets of §6, and on acceptance materializes the exact value and produces its
//! canonical bytes and SHA-256. It reads no transport envelope, selects no profile, and verifies,
//! signs or admits nothing.
//!
//! A rejection of the data is `Ok(CandidateIngressOutcome::Reject { .. })`; a broken invariant is
//! `Err(CandidateIngressInternalError)`, never a rejection.

use std::collections::HashSet;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

const MAX_DEPTH: usize = 64;
const MAX_INTEGER: &[u8] = b"9007199254740991"; // 2^53-1, 16 digits

/// The rejection classes of the candidate ingress (§3, §6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateRejectClass {
    Bom,
    Utf8Invalid,
    Syntax,
    SurrogateUnpaired,
    DuplicateKey,
    NumberNotInteger,
    NumberOutOfRange,
    DepthExceeded,
}

impl CandidateRejectClass {
    /// The class name as the proposal and its corpus write it.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Bom => "BOM",
            Self::Utf8Invalid => "UTF8_INVALID",
            Self::Syntax => "SYNTAX",
            Self::SurrogateUnpaired => "SURROGATE_UNPAIRED",
            Self::DuplicateKey => "DUPLICATE_KEY",
            Self::NumberNotInteger => "NUMBER_NOT_INTEGER",
            Self::NumberOutOfRange => "NUMBER_OUT_OF_RANGE",
            Self::DepthExceeded => "DEPTH_EXCEEDED",
        }
    }
}

/// The outcome for the data: the exact value (integers as `i64`), its canonical bytes and their
/// SHA-256 in hex, or the rejection class and its byte offset.
#[derive(Debug, Clone, PartialEq)]
pub enum CandidateIngressOutcome {
    Accept { value: Value, canonical: Vec<u8>, canonical_sha256: String },
    Reject { class: CandidateRejectClass, offset: usize },
}

/// A broken invariant of the experimental ingress; never a rejection of the data.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("experimental candidate ingress: internal error: {0}")]
pub struct CandidateIngressInternalError(pub String);

enum Halt {
    Syntax(usize),
    Internal(String),
}

enum Container {
    Object(Map<String, Value>),
    Array(Vec<Value>),
}

struct Frame {
    object: bool,
    container: Option<Container>, // None once a defect stops materialization
    keys: Option<HashSet<Vec<u8>>>, // only within 64 levels: deeper defects cannot be the earliest
    key: Vec<u8>,
}

struct Scanner<'a> {
    b: &'a [u8],
    pos: usize,
    best: Option<(usize, CandidateRejectClass)>,
}

fn hex_value(c: u8) -> Option<u32> {
    (c as char).to_digit(16)
}

impl<'a> Scanner<'a> {
    /// Value-level defects: the earliest offset is the primary one (§6.1, layer 3).
    fn defect(&mut self, class: CandidateRejectClass, offset: usize) {
        if self.best.map_or(true, |(o, _)| offset < o) {
            self.best = Some((offset, class));
        }
    }

    fn skip_ws(&mut self) {
        while self.pos < self.b.len() && matches!(self.b[self.pos], b' ' | b'\t' | b'\n' | b'\r') {
            self.pos += 1;
        }
    }

    fn need(&self) -> Result<u8, Halt> {
        self.b.get(self.pos).copied().ok_or(Halt::Syntax(self.b.len()))
    }

    /// One JSON text, iteratively: the grammar is checked to the end at any depth.
    fn document(&mut self) -> Result<Value, Halt> {
        enum State {
            Value,
            Key,
            After,
        }
        let mut stack: Vec<Frame> = Vec::new();
        let mut state = State::Value;
        let mut current = Value::Null;
        self.skip_ws();
        loop {
            match state {
                State::Value => {
                    let c = self.need()?;
                    match c {
                        b'{' | b'[' => {
                            let object = c == b'{';
                            let depth = stack.len() + 1;
                            if depth > MAX_DEPTH {
                                self.defect(CandidateRejectClass::DepthExceeded, self.pos);
                            }
                            let container = if self.best.is_some() {
                                None
                            } else if object {
                                Some(Container::Object(Map::new()))
                            } else {
                                Some(Container::Array(Vec::new()))
                            };
                            let keys = if object && depth <= MAX_DEPTH { Some(HashSet::new()) } else { None };
                            stack.push(Frame { object, container, keys, key: Vec::new() });
                            self.pos += 1;
                            self.skip_ws();
                            let closer = if object { b'}' } else { b']' };
                            if self.b.get(self.pos) == Some(&closer) {
                                self.pos += 1;
                                current = close(stack.pop().expect("a frame was pushed"));
                                state = State::After;
                            } else if object {
                                state = State::Key;
                            }
                        }
                        b'"' => {
                            current = self.string_value()?;
                            state = State::After;
                        }
                        b'-' | b'0'..=b'9' => {
                            current = self.number()?;
                            state = State::After;
                        }
                        b't' => {
                            self.literal(b"true")?;
                            current = Value::Bool(true);
                            state = State::After;
                        }
                        b'f' => {
                            self.literal(b"false")?;
                            current = Value::Bool(false);
                            state = State::After;
                        }
                        b'n' => {
                            self.literal(b"null")?;
                            current = Value::Null;
                            state = State::After;
                        }
                        _ => return Err(Halt::Syntax(self.pos)),
                    }
                }
                State::Key => {
                    if self.need()? != b'"' {
                        return Err(Halt::Syntax(self.pos));
                    }
                    let start = self.pos;
                    let key = self.string()?;
                    let frame = stack.last_mut().expect("a key is read inside an object");
                    let mut duplicate = false;
                    if let Some(keys) = frame.keys.as_mut() {
                        duplicate = !keys.insert(key.clone());
                    }
                    frame.key = key;
                    if duplicate {
                        self.defect(CandidateRejectClass::DuplicateKey, start);
                    }
                    self.skip_ws();
                    if self.need()? != b':' {
                        return Err(Halt::Syntax(self.pos));
                    }
                    self.pos += 1;
                    self.skip_ws();
                    state = State::Value;
                }
                State::After => {
                    let Some(frame) = stack.last_mut() else {
                        self.skip_ws();
                        if self.pos != self.b.len() {
                            return Err(Halt::Syntax(self.pos));
                        }
                        return Ok(current);
                    };
                    if self.best.is_none() {
                        match frame.container.as_mut() {
                            Some(Container::Object(map)) => {
                                let key = String::from_utf8(std::mem::take(&mut frame.key))
                                    .map_err(|_| Halt::Internal("a key that is not UTF-8 without a defect".into()))?;
                                map.insert(key, std::mem::replace(&mut current, Value::Null));
                            }
                            Some(Container::Array(list)) => list.push(std::mem::replace(&mut current, Value::Null)),
                            None => {}
                        }
                    }
                    let object = frame.object;
                    self.skip_ws();
                    let c = self.need()?;
                    if c == b',' {
                        self.pos += 1;
                        self.skip_ws();
                        state = if object { State::Key } else { State::Value };
                    } else if c == (if object { b'}' } else { b']' }) {
                        self.pos += 1;
                        current = close(stack.pop().expect("the frame is on the stack"));
                    } else {
                        return Err(Halt::Syntax(self.pos));
                    }
                }
            }
        }
    }

    fn literal(&mut self, word: &[u8]) -> Result<(), Halt> {
        for (k, expected) in word.iter().enumerate() {
            match self.b.get(self.pos + k) {
                None => return Err(Halt::Syntax(self.b.len())),
                Some(c) if c != expected => return Err(Halt::Syntax(self.pos + k)),
                _ => {}
            }
        }
        self.pos += word.len();
        Ok(())
    }

    fn hex4(&self, at: usize) -> Result<u32, Halt> {
        let mut v = 0;
        for k in 0..4 {
            let c = *self.b.get(at + k).ok_or(Halt::Syntax(self.b.len()))?;
            v = v * 16 + hex_value(c).ok_or(Halt::Syntax(at + k))?;
        }
        Ok(v)
    }

    /// A low surrogate escape (U+DC00 to U+DFFF) at `at`, read without consuming it.
    fn low_surrogate_at(&self, at: usize) -> Option<u32> {
        let e = self.b.get(at..at + 6)?;
        if e[0] != b'\\' || e[1] != b'u' {
            return None;
        }
        let mut v = 0;
        for &c in &e[2..] {
            v = v * 16 + hex_value(c)?;
        }
        (0xDC00..=0xDFFF).contains(&v).then_some(v)
    }

    fn string_value(&mut self) -> Result<Value, Halt> {
        let bytes = self.string()?;
        if self.best.is_some() {
            return Ok(Value::Null); // not materialized: the unit is rejected
        }
        String::from_utf8(bytes)
            .map(Value::String)
            .map_err(|_| Halt::Internal("a string that is not UTF-8 without a defect".into()))
    }

    /// A string at its opening quote, unescaped, as generalized UTF-8: a lone surrogate keeps its
    /// three-byte form, so it stays one unit in key comparisons; such a unit is never accepted.
    fn string(&mut self) -> Result<Vec<u8>, Halt> {
        let n = self.b.len();
        self.pos += 1;
        let mut out = Vec::new();
        let mut segment = self.pos;
        loop {
            let c = self.need()?;
            if c == b'"' {
                out.extend_from_slice(&self.b[segment..self.pos]);
                self.pos += 1;
                return Ok(out);
            }
            if c < 0x20 {
                return Err(Halt::Syntax(self.pos));
            }
            if c != b'\\' {
                self.pos += 1;
                continue;
            }
            out.extend_from_slice(&self.b[segment..self.pos]);
            let escape = self.pos;
            let e = *self.b.get(escape + 1).ok_or(Halt::Syntax(n))?;
            let simple = match e {
                b'"' => Some(b'"'),
                b'\\' => Some(b'\\'),
                b'/' => Some(b'/'),
                b'b' => Some(0x08),
                b'f' => Some(0x0C),
                b'n' => Some(b'\n'),
                b'r' => Some(b'\r'),
                b't' => Some(b'\t'),
                _ => None,
            };
            if let Some(byte) = simple {
                out.push(byte);
                self.pos = escape + 2;
            } else if e == b'u' {
                let unit = self.hex4(escape + 2)?;
                self.pos = escape + 6;
                let scalar = if (0xD800..=0xDBFF).contains(&unit) {
                    match self.low_surrogate_at(self.pos) {
                        Some(low) => {
                            self.pos += 6;
                            Some(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00))
                        }
                        None => None,
                    }
                } else if (0xDC00..=0xDFFF).contains(&unit) {
                    None
                } else {
                    Some(unit)
                };
                match scalar.and_then(char::from_u32) {
                    Some(ch) => out.extend_from_slice(ch.encode_utf8(&mut [0; 4]).as_bytes()),
                    None => {
                        self.defect(CandidateRejectClass::SurrogateUnpaired, escape);
                        out.extend_from_slice(&[0xE0 | (unit >> 12) as u8, 0x80 | ((unit >> 6) & 0x3F) as u8, 0x80 | (unit & 0x3F) as u8]);
                    }
                }
            } else {
                return Err(Halt::Syntax(escape + 1));
            }
            segment = self.pos;
        }
    }

    fn digits(&mut self) {
        while self.pos < self.b.len() && self.b[self.pos].is_ascii_digit() {
            self.pos += 1;
        }
    }

    /// A number literal: its grammar, then its exact value by N4 (§3.3).
    fn number(&mut self) -> Result<Value, Halt> {
        let start = self.pos;
        let negative = self.b[self.pos] == b'-';
        if negative {
            self.pos += 1;
        }
        let int_start = self.pos;
        match self.need()? {
            b'0' => self.pos += 1,
            b'1'..=b'9' => self.digits(),
            _ => return Err(Halt::Syntax(self.pos)),
        }
        let int_end = self.pos;
        let (mut frac_start, mut frac_end) = (int_end, int_end);
        if self.b.get(self.pos) == Some(&b'.') {
            self.pos += 1;
            if !self.need()?.is_ascii_digit() {
                return Err(Halt::Syntax(self.pos));
            }
            frac_start = self.pos;
            self.digits();
            frac_end = self.pos;
        }
        let mut exp_negative = false;
        let (mut exp_start, mut exp_end) = (self.pos, self.pos);
        if matches!(self.b.get(self.pos), Some(b'e' | b'E')) {
            self.pos += 1;
            let sign = self.need()?;
            if sign == b'+' || sign == b'-' {
                exp_negative = sign == b'-';
                self.pos += 1;
            }
            if !self.need()?.is_ascii_digit() {
                return Err(Halt::Syntax(self.pos));
            }
            exp_start = self.pos;
            self.digits();
            exp_end = self.pos;
        }
        // N4. X saturates at len(literal) + 17: past it the outcome cannot change.
        let limit = (self.pos - start + 17) as i64;
        let mut x: i64 = 0;
        for &d in &self.b[exp_start..exp_end] {
            x = (x * 10 + i64::from(d - b'0')).min(limit);
        }
        let digits: Vec<u8> = [&self.b[int_start..int_end], &self.b[frac_start..frac_end]].concat();
        let first = digits.iter().position(|&d| d != b'0');
        let Some(first) = first else {
            return Ok(Value::from(0i64)); // D is empty: the value is 0, whatever the exponent
        };
        let last = digits.iter().rposition(|&d| d != b'0').expect("a nonzero digit exists") + 1;
        let d = &digits[first..last];
        let scale = if exp_negative { -x } else { x } - (frac_end - frac_start) as i64 + (digits.len() - last) as i64;
        if scale < 0 {
            self.defect(CandidateRejectClass::NumberNotInteger, start);
            return Ok(Value::Null);
        }
        if d.len() as i64 + scale > 16 {
            self.defect(CandidateRejectClass::NumberOutOfRange, start);
            return Ok(Value::Null);
        }
        let mut full = d.to_vec();
        full.resize(d.len() + scale as usize, b'0');
        if full.len() == 16 && full.as_slice() > MAX_INTEGER {
            self.defect(CandidateRejectClass::NumberOutOfRange, start);
            return Ok(Value::Null);
        }
        let magnitude: i64 = std::str::from_utf8(&full)
            .ok()
            .and_then(|t| t.parse().ok())
            .ok_or_else(|| Halt::Internal("an exact integer in range that does not parse".into()))?;
        Ok(Value::from(if negative { -magnitude } else { magnitude }))
    }
}

fn close(frame: Frame) -> Value {
    match frame.container {
        Some(Container::Object(map)) => Value::Object(map),
        Some(Container::Array(list)) => Value::Array(list),
        None => Value::Null,
    }
}

/// The `dcp-jcs-v1` output rules (§3.4) over an accepted value, at most 64 levels deep.
fn serialize(value: &Value, out: &mut Vec<u8>) -> Result<(), CandidateIngressInternalError> {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(n) => match n.as_i64() {
            Some(i) => out.extend_from_slice(i.to_string().as_bytes()),
            None => return Err(CandidateIngressInternalError(format!("not an i64: {}", n))),
        },
        Value::String(s) => quote(s, out),
        Value::Array(list) => {
            out.push(b'[');
            for (i, item) in list.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                serialize(item, out)?;
            }
            out.push(b']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort(); // byte order of UTF-8 is code point order
            out.push(b'{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                quote(key, out);
                out.push(b':');
                serialize(&map[key.as_str()], out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}

fn quote(s: &str, out: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push(b'"');
    for &c in s.as_bytes() {
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x08 => out.extend_from_slice(b"\\b"),
            b'\t' => out.extend_from_slice(b"\\t"),
            b'\n' => out.extend_from_slice(b"\\n"),
            0x0C => out.extend_from_slice(b"\\f"),
            b'\r' => out.extend_from_slice(b"\\r"),
            0x00..=0x1F => out.extend_from_slice(&[b'\\', b'u', b'0', b'0', HEX[(c >> 4) as usize], HEX[(c & 0xF) as usize]]),
            _ => out.push(c),
        }
    }
    out.push(b'"');
}

/// EXPERIMENTAL, opt-in (candidate `dcp-jcs-v2`, phase 1): the ingress of one unit from its original
/// bytes. Returns the rejection class and byte offset, or the exact value, its canonical bytes and
/// their SHA-256. It never verifies, signs or admits anything, and it does not change `dcp-jcs-v1`.
pub fn experimental_candidate_ingress(input: &[u8]) -> Result<CandidateIngressOutcome, CandidateIngressInternalError> {
    let reject = |class, offset| Ok(CandidateIngressOutcome::Reject { class, offset });
    if input.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return reject(CandidateRejectClass::Bom, 0);
    }
    // Strict: overlong forms, encoded surrogates and code points above U+10FFFF fail.
    if let Err(e) = std::str::from_utf8(input) {
        return reject(CandidateRejectClass::Utf8Invalid, e.valid_up_to());
    }
    let mut scanner = Scanner { b: input, pos: 0, best: None };
    let value = match scanner.document() {
        Ok(value) => value,
        Err(Halt::Syntax(offset)) => return reject(CandidateRejectClass::Syntax, offset),
        Err(Halt::Internal(message)) => return Err(CandidateIngressInternalError(message)),
    };
    if let Some((offset, class)) = scanner.best {
        return reject(class, offset);
    }
    let mut canonical = Vec::new();
    serialize(&value, &mut canonical)?;
    let canonical_sha256 = hex::encode(Sha256::digest(&canonical));
    Ok(CandidateIngressOutcome::Accept { value, canonical, canonical_sha256 })
}
