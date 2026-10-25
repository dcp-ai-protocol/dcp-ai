"""Writes the design corpus of the non-normative dcp-jcs-v2 candidate.

Every expectation is written here by hand, with the rule it applies (`why`). Offsets are where this
generator placed the defect. This file never imports or runs the design model: the only values it
computes are input bytes, their SHA-256, the hashes a producer would sign for the synthetic bundles
(json.dumps with the shared output rules, exact for the in-domain values used here) and the SHA-256
of the canonical text it writes by hand.

    python3 tools/canonicalization-lab/generate_corpus.py OUT.json
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
R2 = 'docs/proposals/canonicalization-candidate/baseline-corpus.json'
V1, V2 = 'dcp-jcs-v1', 'dcp-jcs-v2'
EXPERIMENTAL = [V1, V2]  # a verifier with the candidate explicitly enabled; never a default
BOM = b'\xef\xbb\xbf'

cases = []


def raw(data):
    return data if isinstance(data, bytes) else data.encode('utf-8')


def add(case_id, group, data, expected, why, mode='document', transport='bare', **extra):
    data = raw(data)
    entry = {'id': case_id, 'group': group, 'mode': mode, 'transport': transport}
    try:
        as_text = data.decode('utf-8')
        if data.startswith(BOM):
            raise ValueError
        entry['input_json'] = as_text
    except (UnicodeDecodeError, ValueError):
        entry['input_hex'] = data.hex()
    entry['input_sha256'] = hashlib.sha256(data).hexdigest()
    entry.update(extra)
    entry['expected'] = expected
    entry['why'] = why
    cases.append(entry)


def at(data, needle, nth=1):
    """Byte offset of the nth occurrence of `needle` in `data`."""
    data, needle = raw(data), raw(needle)
    pos = -1
    for _ in range(nth):
        pos = data.index(needle, pos + 1)
    return pos


def accept(canonical_text):
    return {'result': 'accept', 'canonical_sha256': hashlib.sha256(canonical_text.encode('utf-8')).hexdigest()}


def reject(cls, offset=None, **extra):
    out = {'result': 'reject', 'class': cls}
    if offset is not None:
        out['offset'] = offset
    out.update(extra)
    return out


# ── 1. Several defects in one document: a total precedence ──────────────────────────────────────

# Value-level defects, each a member fragment with the offset of its defect inside the fragment.
FRAGMENTS = {
    'sur': ('"s":"\\ud800"', 5, 'SURROGATE_UNPAIRED'),        # the backslash of the lone escape
    'dup': ('"d":1,"d":2', 6, 'DUPLICATE_KEY'),               # the quote of the second key
    'frac': ('"f":1.5', 4, 'NUMBER_NOT_INTEGER'),            # the first byte of the literal
    'range': ('"r":1e16', 4, 'NUMBER_OUT_OF_RANGE'),         # the first byte of the literal
    'depth': ('"p":' + '[' * 64 + ']' * 64, 4 + 63, 'DEPTH_EXCEEDED'),  # the bracket opening level 65
}
for a, (fa, oa, ca) in FRAGMENTS.items():
    for b, (fb, _, _) in FRAGMENTS.items():
        if a == b:
            continue
        add(f'm-pair-{a}-then-{b}', 'multi', '{' + fa + ',' + fb + '}', reject(ca, 1 + oa),
            f'Two value-level defects: the earlier offset wins ({ca} before the {b} defect).')

add('m-same-sur', 'multi', '{"s":"\\ud800","t":"\\udc00"}', reject('SURROGATE_UNPAIRED', 6),
    'Two lone surrogates: the first escape.')
add('m-same-dup', 'multi', '{"d":1,"d":2,"e":1,"e":2}', reject('DUPLICATE_KEY', 7),
    'Two duplicated keys: the first repetition.')
add('m-same-frac', 'multi', '{"f":1.5,"g":2.5}', reject('NUMBER_NOT_INTEGER', 5), 'Two fractions: the first literal.')
add('m-same-depth', 'multi', '{"p":' + '[' * 64 + ']' * 64 + ',"q":' + '[' * 64 + ']' * 64 + '}',
    reject('DEPTH_EXCEEDED', 5 + 63), 'Two subtrees past level 64: the first bracket opening level 65.')
add('m-key-sur-value-frac', 'multi', '{"\\ud800":1.5}', reject('SURROGATE_UNPAIRED', 2),
    'A defect in a key comes before a defect in its value: the key is earlier in the bytes.')
add('m-dup-key-bad-value', 'multi', '{"x":1,"x":1.5}', reject('DUPLICATE_KEY', 7),
    'The repeated key is notified, not the fraction in its value, which comes later.')
add('m-value-then-dup-key', 'multi', '{"x":1.5,"x":2}', reject('NUMBER_NOT_INTEGER', 5),
    'The fraction in the first member comes before the repetition of its key.')
add('m-dup-lone-keys', 'multi', '{"\\ud800":1,"\\ud800":2}', reject('SURROGATE_UNPAIRED', 2),
    'Keys with lone surrogates compare as code units; the first escape (2) precedes the repeated key (12).')
add('m-dup-escaped-key-range', 'multi', '{"a":1,"\\u0061":1e16}', reject('DUPLICATE_KEY', 7),
    'Keys are compared after unescaping: "\\u0061" repeats "a" before its out-of-range value.')
add('m-token-fraction-wins-range', 'multi', '{"n":123456789012345678.9e-1}', reject('NUMBER_NOT_INTEGER', 5),
    'One literal both fractional and above 2^53-1: N4 checks the fraction first.')
add('m-token-fraction-wins-range-2', 'multi', '{"n":12345678901234567.5}', reject('NUMBER_NOT_INTEGER', 5),
    'The same tie inside one literal, without an exponent.')

for name, (frag, _, _) in FRAGMENTS.items():
    add(f'm-bom-then-{name}', 'multi', BOM + raw('{' + frag + '}'), reject('BOM', 0),
        'Encoding layer first: a BOM is at offset 0 and hides every later defect.')
    doc = raw('{' + frag + ',"u":"') + b'\xff' + b'"}'
    add(f'm-{name}-then-utf8', 'multi', doc, reject('UTF8_INVALID', at(doc, b'\xff')),
        'Encoding layer first: invalid UTF-8 is notified even after an earlier value-level defect.')
    doc = '{' + frag + ',"z":1,}'
    add(f'm-{name}-then-syntax', 'multi', doc, reject('SYNTAX', len(doc) - 1),
        'Grammar layer before value level: a trailing comma later in the text wins over an earlier defect.')
doc = BOM + b'{"u":"\xff"}'
add('m-bom-then-utf8', 'multi', doc, reject('BOM', 0), 'Both encoding defects: the BOM is at offset 0.')
doc = b'{,"u":"\xff"}'
add('m-syntax-then-utf8', 'multi', doc, reject('UTF8_INVALID', at(doc, b'\xff')),
    'Encoding before grammar, whatever the offsets: the syntax error at 1 is not notified.')
doc = b'{"u":"\xc0\x80","v":"\xff"}'
add('m-two-utf8', 'multi', doc, reject('UTF8_INVALID', at(doc, b'\xc0')), 'Two invalid sequences: the first.')
add('m-bom-then-syntax', 'multi', BOM + b'[1,]', reject('BOM', 0), 'A BOM before a syntax error.')
add('m-syntax-then-frac', 'multi', '{"z":01,"f":1.5}', reject('SYNTAX', 6),
    'A leading zero ends the number at "0"; the "1" after it is the first byte that cannot continue.')
doc = '{"p":' + '[' * 70 + '1,' + ']' * 70 + '}'
add('m-syntax-inside-deep', 'multi', doc, reject('SYNTAX', 5 + 70 + 2),
    'Depth is exceeded first in the bytes, but the grammar layer wins: "1," followed by "]".')
add('m-unterminated-after-surrogate', 'multi', '{"a":"\\ud800', reject('SYNTAX', 12),
    'Not a JSON text: the unterminated string is SYNTAX at the end, though a lone escape came first.')
doc = '{"s":"\\ud800"} x'
add('m-surrogate-then-trailing-data', 'multi', doc, reject('SYNTAX', len(doc) - 1),
    'Trailing data after the value: SYNTAX at the "x", over the lone surrogate.')

# ── 2. Exact numbers at the edges ────────────────────────────────────────────────────────────────

NUMBERS = [
    ('x-neg-two53', '-9007199254740992', reject('NUMBER_OUT_OF_RANGE', 5), '-(2^53) is below the range.'),
    ('x-max-scaled-down', '90071992547409910e-1', '9007199254740991', '2^53-1 written with an extra zero and e-1.'),
    ('x-max-fraction-scaled', '900719925474099.1e1', '9007199254740991', '2^53-1 as a fraction times ten.'),
    ('x-max-sci-padded', '9.0071992547409910e15', '9007199254740991', '2^53-1 in scientific form with a trailing zero.'),
    ('x-max-half', '9.0071992547409915e15', reject('NUMBER_NOT_INTEGER', 5), '2^53-1 plus one half.'),
    ('x-two53-sci', '9.007199254740992e15', reject('NUMBER_OUT_OF_RANGE', 5), '2^53 in scientific form.'),
    ('x-exp-padded-16', '1E+00016', reject('NUMBER_OUT_OF_RANGE', 5), '10^16 with a zero-padded exponent.'),
    ('x-exp-padded-15', '1E+00015', '1000000000000000', '10^15 with a zero-padded exponent.'),
    ('x-neg-zero-huge-exp', '-0e-99999999999999999999', '0', 'Zero with any exponent is 0; -0 is 0.'),
    ('x-tiny-fraction-scaled-up', '0.' + '0' * 5000 + '1e5001', '1', '10^-5001 times 10^5001 is exactly 1.'),
    ('x-long-zero-fraction', '1.' + '0' * 5000, '1', 'A long zero fraction is still the integer 1.'),
    ('x-trailing-zeros-down', '10000000000000000e-1', '1000000000000000', '10^16 / 10 is 10^15.'),
    ('x-neg-one-exp-zero', '-1e-0', '-1', 'An exponent of -0 changes nothing.'),
    ('x-half', '5e-1', reject('NUMBER_NOT_INTEGER', 5), '0.5 in scientific form.'),
    ('x-sci-integer', '4.5e1', '45', '4.5 times ten is 45.'),
    ('x-max-zero-fraction', '9007199254740991.000000000000000000000', '9007199254740991', '2^53-1 with a zero fraction.'),
    ('x-min-sci-zero', '-9007199254740991.0e0', '-9007199254740991', '-(2^53-1) with a zero fraction and exponent.'),
    ('x-exp-many-zeros', '1e' + '0' * 60 + '16', reject('NUMBER_OUT_OF_RANGE', 5), 'An exponent of 16 behind 60 zeros.'),
    ('x-exp-many-zeros-neg', '1e-' + '0' * 60 + '1', reject('NUMBER_NOT_INTEGER', 5), 'An exponent of -1 behind 60 zeros.'),
    ('x-big-mantissa-cancelled', '9007199254740991' + '0' * 300 + 'e-300', '9007199254740991',
     'A 316-digit mantissa scaled back to 2^53-1.'),
]
for case_id, literal, expected, why in NUMBERS:
    expected = accept('{"n":' + expected + '}') if isinstance(expected, str) else expected
    add(case_id, 'number', '{"n":' + literal + '}', expected, why)

# ── 3. Depth of the validated unit, with and without a transport envelope ────────────────────────

ENV = '{"signed_bundle":'
unit64 = '{"p":' + '[' * 63 + ']' * 63 + '}'
unit65 = '{"p":' + '[' * 64 + ']' * 64 + '}'
add('d-unit-64-bare', 'depth', unit64, accept(unit64), 'Depth 64, counted from the unit root (depth 1).')
add('d-unit-64-envelope', 'depth', ENV + unit64 + '}', dict(accept(unit64), unit=[17, 17 + len(unit64)]),
    'The same unit inside an HTTP envelope: the envelope does not count; same result and canonical bytes.',
    transport='envelope')
add('d-unit-64-envelope-v03-rule', 'depth', ENV + unit64 + '}', reject('DEPTH_EXCEEDED', 5 + 62),
    'Comparison only: under v0.3 (depth over the whole transport document) the same unit is rejected.',
    transport='envelope', options={'depth_scope': 'transport'})
add('d-unit-65-bare', 'depth', unit65, reject('DEPTH_EXCEEDED', 5 + 63), 'Depth 65 from the unit root.')
add('d-unit-65-envelope', 'depth', ENV + unit65 + '}', reject('DEPTH_EXCEEDED', 5 + 63),
    'The same unit enveloped: same class and same offset relative to the unit.', transport='envelope')
deep = '{"p":' + '[' * 20000 + ']' * 20000 + '}'
add('d-unit-20000-bare', 'depth', deep, reject('DEPTH_EXCEEDED', 5 + 63),
    'Twenty thousand levels: an iterative scan reaches the verdict with no recursion limit.')
doc = '{"meta":' + '[' * 70 + ']' * 70 + ',"signed_bundle":{"a":1}}'
add('d-deep-envelope-outside-unit', 'depth', doc, dict(accept('{"a":1}'), unit=[at(doc, '{"a"'), len(doc) - 1]),
    'Envelope members outside the unit are not limited by the profile (transport budgets apply).',
    transport='envelope')

# ── 4. Transport: extraction of the unit without re-serializing it ───────────────────────────────

unit = '{"t":"x\\ud800"}'
add('t-surrogate-bare', 'transport', unit, reject('SURROGATE_UNPAIRED', 7), 'Lone surrogate in a bare unit.')
add('t-surrogate-envelope', 'transport', ENV + unit + '}', reject('SURROGATE_UNPAIRED', 7, unit=[17, 17 + len(unit)]),
    'Same unit enveloped: the class and the unit offset do not depend on the transport.', transport='envelope')
unit_b = b'{"s":"a\xffb"}'
add('t-utf8-bare', 'transport', unit_b, reject('UTF8_INVALID', 7), 'Invalid UTF-8 inside a string of a bare unit.')
add('t-utf8-envelope', 'transport', raw(ENV) + unit_b + b'}', reject('UTF8_INVALID', 7),
    'Same unit enveloped: a byte-level grammar delimits strings without decoding them.', transport='envelope')
unit = '{"b":1,"b":2}'
add('t-dup-bare', 'transport', unit, reject('DUPLICATE_KEY', 7), 'Duplicate key in a bare unit.')
add('t-dup-envelope', 'transport', ENV + unit + '}', reject('DUPLICATE_KEY', 7),
    'Same unit enveloped: duplicates are kept for the unit scan, not resolved by the extraction.', transport='envelope')
unit = '{"a":[1,]}'
add('t-grammar-bare', 'transport', unit, reject('SYNTAX', 8), 'A grammar error in a bare unit is SYNTAX.')
add('t-grammar-envelope', 'transport', ENV + unit + '}',
    {'result': 'reject', 'class': 'TRANSPORT_INVALID', 'detail': 'SYNTAX', 'transport_offset': 17 + 8},
    'Enveloped, a unit whose grammar breaks cannot be delimited: a transport failure. Both reject.',
    transport='envelope')
add('t-envelope-repeated', 'transport', ENV + '{"a":1},"signed_bundle":{"a":2}}',
    {'result': 'reject', 'class': 'TRANSPORT_AMBIGUOUS', 'detail': 'SIGNED_BUNDLE_REPEATED', 'transport_offset': 25},
    'Two signed_bundle members: no unit is chosen (no first-wins or last-wins).', transport='envelope')
add('t-envelope-escaped-repeat', 'transport', ENV + '{"a":1},"signed\\u005fbundle":{"a":2}}',
    {'result': 'reject', 'class': 'TRANSPORT_AMBIGUOUS', 'detail': 'SIGNED_BUNDLE_REPEATED', 'transport_offset': 25},
    'Member names are compared after unescaping: an escaped repeat is still a repeat.', transport='envelope')
doc = '{"signed\\u005fbundle":{"a":1}}'
add('t-envelope-escaped-name', 'transport', doc, dict(accept('{"a":1}'), unit=[at(doc, '{"a"'), len(doc) - 1]),
    'An escaped member name names the unit.', transport='envelope')
add('t-envelope-missing', 'transport', '{"bundle":{"a":1}}',
    {'result': 'reject', 'class': 'TRANSPORT_INVALID', 'detail': 'NO_SIGNED_BUNDLE'},
    'No signed_bundle member: no content sniffing, no fallback to the whole body.', transport='envelope')
add('t-envelope-bom', 'transport', BOM + raw(ENV + '{"a":1}}'),
    {'result': 'reject', 'class': 'TRANSPORT_INVALID', 'detail': 'BOM', 'transport_offset': 0},
    'A BOM before the envelope is a transport defect.', transport='envelope')
doc = ENV + '{"a":1}} x'
add('t-envelope-trailing', 'transport', doc,
    {'result': 'reject', 'class': 'TRANSPORT_INVALID', 'detail': 'SYNTAX', 'transport_offset': len(doc) - 1},
    'Trailing data after the envelope.', transport='envelope')
add('t-envelope-array', 'transport', '[{"a":1}]',
    {'result': 'reject', 'class': 'TRANSPORT_INVALID', 'detail': 'NOT_AN_OBJECT', 'transport_offset': 0},
    'The envelope must be an object.', transport='envelope')
doc = raw('{"note":"') + b'\xff' + raw('",' + '"signed_bundle":{"a":1}}')
add('t-envelope-utf8-outside', 'transport', doc,
    {'result': 'reject', 'class': 'TRANSPORT_INVALID', 'detail': 'UTF8_INVALID', 'transport_offset': 9},
    'Invalid UTF-8 in the envelope, outside the unit.', transport='envelope')
doc = '{"x":1e400,"y":"\\ud800","signed_bundle":{"a":1},"x":2}'
add('t-envelope-other-members-ignored', 'transport', doc, dict(accept('{"a":1}'), unit=[at(doc, '{"a"'), at(doc, ',"x":2')]),
    'Other envelope members are transport data: not interpreted, not validated beyond grammar and encoding.',
    transport='envelope')

# Several defects in a transport envelope: fixed phases, not offsets (proposal README §6.3). T1 BOM,
# T2 grammar of the whole envelope, T3 root type, T4 number of signed_bundle members, T5 UTF-8 outside
# the unit; only then is the unit scanned.
def transport_reject(cls, detail, offset=None):
    out = {'result': 'reject', 'class': cls, 'detail': detail}
    if offset is not None:
        out['transport_offset'] = offset
    return out


doc = b'{"bad":"\xff","signed_bundle":{},"signed_bundle":{}}'
add('tm-ambiguous-over-utf8', 'transport-multi', doc,
    transport_reject('TRANSPORT_AMBIGUOUS', 'SIGNED_BUNDLE_REPEATED', at(doc, '"signed_bundle"', 2)),
    'T4 before T5: the repeated member (30) is notified over the earlier invalid UTF-8 (8).', transport='envelope')
add('tm-missing-over-utf8', 'transport-multi', b'{"bad":"\xff"}', transport_reject('TRANSPORT_INVALID', 'NO_SIGNED_BUNDLE'),
    'T4 before T5: no unit, whatever the encoding of the rest.', transport='envelope')
doc = '{"signed_bundle":{},"signed_bundle":{},}'
add('tm-syntax-over-ambiguous', 'transport-multi', doc, transport_reject('TRANSPORT_INVALID', 'SYNTAX', len(doc) - 1),
    'T2 before T4: a trailing comma is notified over the repeated member.', transport='envelope')
add('tm-bom-over-syntax', 'transport-multi', BOM + b'{,', transport_reject('TRANSPORT_INVALID', 'BOM', 0),
    'T1 before T2.', transport='envelope')
add('tm-bom-over-missing', 'transport-multi', BOM + b'{}', transport_reject('TRANSPORT_INVALID', 'BOM', 0),
    'T1 before T4.', transport='envelope')
doc = '{"a":1,}'
add('tm-syntax-over-missing', 'transport-multi', doc, transport_reject('TRANSPORT_INVALID', 'SYNTAX', len(doc) - 1),
    'T2 before T4: the missing member is not notified.', transport='envelope')
doc = b'{"a":"\xff","signed_bundle":{"x":[1,]}}'
add('tm-unit-grammar-over-utf8-outside', 'transport-multi', doc,
    transport_reject('TRANSPORT_INVALID', 'SYNTAX', at(doc, b',]') + 1),
    'T2 covers the whole envelope, the unit included: its broken grammar is notified before T5.', transport='envelope')
add('tm-not-object-over-utf8', 'transport-multi', b'["\xff"]', transport_reject('TRANSPORT_INVALID', 'NOT_AN_OBJECT', 0),
    'T3 before T5.', transport='envelope')
doc = b'{"a":"\xff","signed_bundle":{},"b":"\xfe"}'
add('tm-utf8-before-and-after-unit', 'transport-multi', doc, transport_reject('TRANSPORT_INVALID', 'UTF8_INVALID', 6),
    'T5: the bytes before the unit are checked before those after it.', transport='envelope')
doc = b'{"a":"\xff","signed_bundle":{"x":1.5}}'
add('tm-utf8-outside-over-unit-defect', 'transport-multi', doc, transport_reject('TRANSPORT_INVALID', 'UTF8_INVALID', 6),
    'The transport phases end before the unit is scanned: its fraction is not notified.', transport='envelope')
add('tm-ambiguous-over-unit-defects', 'transport-multi', '{"signed_bundle":{"x":1.5},"signed_bundle":{"y":1e16}}',
    transport_reject('TRANSPORT_AMBIGUOUS', 'SIGNED_BUNDLE_REPEATED', 27),
    'Neither unit is scanned when the envelope is ambiguous.', transport='envelope')
doc = '{"z":"ok","signed_bundle":{"x":1.5}}'
add('tm-clean-envelope-unit-defect', 'transport-multi', doc, reject('NUMBER_NOT_INTEGER', 5, unit=[at(doc, '{"x"'), len(doc) - 1]),
    'A clean envelope: the unit class, with its offset relative to the unit.', transport='envelope')

# ── 5. Synthetic bundles: selection, policy, migration ───────────────────────────────────────────


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def H(value):
    return 'sha256:' + hashlib.sha256(canon(value).encode('utf-8')).hexdigest()


ABSENT = object()
PAYLOAD = {'action': 'read', 'amount': 42, 'resource': 'doc-1'}


def chain(n=2):
    entries, previous = [], 'GENESIS'
    for seq in range(n):
        entry = {'event': 'step-%d' % seq, 'prev_hash': previous, 'seq': seq}
        entries.append(entry)
        previous = H(entry)
    return entries


def signed(profile=ABSENT, payload=None, entries=None, sign_profile=ABSENT):
    """The value a producer signs, and its manifest. `sign_profile` lets the manifest it hashed
    differ from the one it writes (a relabel after signing)."""
    payload = PAYLOAD if payload is None else payload
    entries = chain() if entries is None else entries
    manifest = {} if profile is ABSENT else {'canonicalization_profile': profile}
    manifest.update({'intent_hash': H(payload), 'audit_count': len(entries)})
    hashed = dict(manifest)
    if sign_profile is not ABSENT:
        hashed.pop('canonicalization_profile', None)
        if sign_profile is not None:
            hashed = {'canonicalization_profile': sign_profile, **hashed}
    value = {'bundle': {'dcp_bundle_version': '2.0', 'manifest': manifest,
                        'intent': {'payload': payload, 'payload_hash': H(payload)}, 'audit_entries': entries},
             'signature': {'manifest_hash': H(hashed)}}
    return value, manifest


def dump(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def swap(text, old, new):
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new)


FIELD = '"canonicalization_profile":'


def bundle_case(case_id, group, text, expected, why, policy=EXPERIMENTAL, **extra):
    if policy is not ABSENT:
        extra['policy'] = policy
    add(case_id, group, text, expected, why, mode='bundle', **extra)


def v1_path(**extra):
    return dict({'result': 'v1_path', 'profile': V1, 'attempts': [V1], 'warnings': []}, **extra)


def accepted_v2(manifest):
    return {'result': 'accept_v2', 'profile': V2, 'attempts': [V2], 'warnings': [], 'manifest_sha256': H(manifest)}


# The plain absent, v1 and v2 bundles are the r2 selection cases o-sel-00..02 (section 6).
base_absent = dump(signed()[0])
value, manifest_v2 = signed(V2)
base_v2 = dump(value)
bundle_case('b-v2-escaped-value', 'selection', swap(base_v2, '"dcp-jcs-v2"', '"dcp-jcs-v\\u0032"'),
            accepted_v2(manifest_v2), 'The value is compared after unescaping.')
bundle_case('b-v2-escaped-key', 'selection', swap(base_v2, FIELD, '"canonicalization\\u005fprofile":'),
            accepted_v2(manifest_v2), 'The key is compared after unescaping.')
for case_id, token, why in [
    ('b-unknown-upper', '"DCP-JCS-V2"', 'Exact comparison, no case folding.'),
    ('b-unknown-space', '"dcp-jcs-v2 "', 'No trimming.'),
    ('b-unknown-empty', '""', 'Empty string.'),
    ('b-unknown-null', 'null', 'null is not absence.'),
    ('b-unknown-number', '2', 'Not a string.'),
    ('b-unknown-array', '["dcp-jcs-v2"]', 'Not a string.'),
    ('b-unknown-object', '{"id":"dcp-jcs-v2"}', 'Not a string.'),
    ('b-unknown-v3', '"dcp-jcs-v3"', 'Not defined.'),
    ('b-unknown-lone-surrogate', '"dcp-jcs-v2\\ud800"', 'Unknown is decided before the lone surrogate counts.'),
]:
    text = swap(base_v2, '"dcp-jcs-v2"', token)
    bundle_case(case_id, 'selection', text, reject('PROFILE_UNKNOWN', at(text, FIELD) + len(FIELD), attempts=[], warnings=[]),
                why + ' Unknown before policy and before any hash; no other profile is tried.')

text = swap(base_v2, FIELD + '"dcp-jcs-v2"', FIELD + '"dcp-jcs-v1",' + FIELD + '"dcp-jcs-v2"')
bundle_case('b-field-repeated-last-v2', 'selection', text,
            reject('DUPLICATE_KEY', at(text, FIELD, 2), profile=V2, attempts=[], warnings=[]),
            'Read as the last value (v2), as every historical parser would; the candidate refuses the repetition.')
text = swap(base_v2, FIELD + '"dcp-jcs-v2"', FIELD + '"dcp-jcs-v2",' + FIELD + '"dcp-jcs-v1"')
bundle_case('b-field-repeated-last-v1', 'selection', text,
            v1_path(warnings=[{'class': 'DUPLICATE_KEY', 'offset': at(text, FIELD, 2)}]),
            'Signed as v2, a v1 repetition appended: read as v1 and delegated; today\'s verifier hashes a '
            'manifest the producer did not sign. The design never treats it as v2 nor retries.')
value, manifest_v1 = signed(V1)
text = swap(dump(value), FIELD + '"dcp-jcs-v1"', FIELD + '"dcp-jcs-v2",' + FIELD + '"dcp-jcs-v1"')
bundle_case('b-field-decoy-before-v1', 'selection', text,
            v1_path(warnings=[{'class': 'DUPLICATE_KEY', 'offset': at(text, FIELD, 2)}]),
            'A v2 decoy before the signed v1 value: delegated to v1 as today, with a warning.')
m2 = '"manifest":' + dump(manifest_v2)
text = swap(base_v2, m2, '"manifest":' + dump(manifest_v1) + ',' + m2)
bundle_case('b-manifest-repeated-last-v2', 'selection', text,
            reject('DUPLICATE_KEY', at(text, '"manifest"', 2), profile=V2, attempts=[], warnings=[]),
            'Two manifests, the last one v2: refused.')
value, manifest_v1 = signed(V1)
m1 = '"manifest":' + dump(manifest_v1)
text = swap(dump(value), m1, '"manifest":' + dump(manifest_v2) + ',' + m1)
bundle_case('b-manifest-repeated-last-v1', 'selection', text,
            v1_path(warnings=[{'class': 'DUPLICATE_KEY', 'offset': at(text, '"manifest"', 2)}]),
            'Two manifests, the last one v1: delegated as today.')
value, _ = signed(V2)
inner = dump(value['bundle'])
text = '{"bundle":{"dcp_bundle_version":"2.0"},"bundle":' + inner + ',"signature":' + dump(value['signature']) + '}'
bundle_case('b-bundle-repeated', 'selection', text,
            reject('DUPLICATE_KEY', at(text, '"bundle"', 2), profile=V2, attempts=[], warnings=[]),
            'The path is read through the last "bundle"; the repetition is refused.')
for case_id, old, new, why in [
    ('b-decoy-root', '{"bundle":', '{' + FIELD + '"dcp-jcs-v2","bundle":', 'At the unit root.'),
    ('b-decoy-bundle', '{"bundle":{', '{"bundle":{' + FIELD + '"dcp-jcs-v2",', 'Directly in "bundle".'),
]:
    text = swap(base_absent, old, new)
    bundle_case(case_id, 'selection', text, v1_path(),
                why + ' Only bundle.manifest.canonicalization_profile selects; this field is data.')
text = swap(base_absent, '"signature":{', '"signature":{' + FIELD + '"dcp-jcs-v2",')
bundle_case('b-decoy-signature', 'selection', text, v1_path(), 'In "signature": not the selection path.')
value, manifest = signed(V1, payload=dict(PAYLOAD, canonicalization_profile=V2))
bundle_case('b-decoy-payload', 'selection', dump(value), v1_path(), 'In a payload: data, not selection.')
value, manifest = signed(V2, payload=dict(PAYLOAD, canonicalization_profile=V1))
bundle_case('b-decoy-v1-payload-of-v2', 'selection', dump(value), accepted_v2(manifest), 'A v1 decoy in a payload of a v2 bundle.')
text = swap(base_v2, '"manifest":' + dump(manifest_v2), '"manifest":[' + dump(manifest_v2) + ']')
bundle_case('b-manifest-array', 'selection', text, v1_path(), 'A manifest that is not an object has no field: delegated.')

value, manifest = signed(V2, payload=dict(PAYLOAD, amount=1))
text = swap(dump(value), '"amount":1,', '"amount":1.5,')
bundle_case('b-v2-fraction', 'ingress', text, reject('NUMBER_NOT_INTEGER', at(text, '1.5'), profile=V2, attempts=[], warnings=[]),
            'A claimed v2 bundle with a defect: refused with the ingress class.')
text = swap(base_v2, '"action":"read"', '"action":"read","action":"read"')
bundle_case('b-v2-duplicate-in-payload', 'ingress', text,
            reject('DUPLICATE_KEY', at(text, '"action"', 2), profile=V2, attempts=[], warnings=[]),
            'Same value repeated: still refused.')
for depth, expected_ok in ((64, True), (65, False)):
    nested = 1
    for _ in range(depth - 4):
        nested = [nested]
    value, manifest = signed(V2, payload=dict(PAYLOAD, deep=nested))
    text = dump(value)
    first = at(text, '"deep":[') + len('"deep":')
    expected = accepted_v2(manifest) if expected_ok else reject('DEPTH_EXCEEDED', first + 60, profile=V2, attempts=[], warnings=[])
    bundle_case(f'b-v2-unit-depth-{depth}', 'depth', text, expected,
                f'Unit depth {depth}: a payload starts at depth 4, so its own nesting reaches {depth - 3}.')
    bundle_case(f'b-v2-unit-depth-{depth}-envelope', 'depth', ENV + text + '}',
                dict(expected, unit=[17, 17 + len(raw(text))]), 'Same bundle in an HTTP envelope: same result.',
                transport='envelope')
    if expected_ok:
        bundle_case('b-v2-unit-depth-64-envelope-v03-rule', 'depth', ENV + text + '}',
                    reject('DEPTH_EXCEEDED', first + 59, profile=V2, attempts=[], warnings=[]),
                    'Comparison only: the v0.3 rule counted the envelope and refused this bundle.',
                    transport='envelope', options={'depth_scope': 'transport'})
value, manifest = signed(V1, payload=dict(PAYLOAD, amount=1))
text = swap(dump(value), '"amount":1,', '"amount":1.0000000000000001,')
bundle_case('b-v1-out-of-domain', 'ingress', text,
            v1_path(warnings=[{'class': 'NUMBER_NOT_INTEGER', 'offset': at(text, '1.0000000000000001')}]),
            'A v1 bundle outside the candidate domain: delegated unchanged, optional warning (D7).')

# Units the scanner cannot walk: only here does today's parser decide whether the v1 path proceeds.
bom_v2 = BOM + raw(base_v2)
bundle_case('b-bom-v2-parser-fails', 'historical', bom_v2, reject('BOM', 0, attempts=[], warnings=[]),
            'Like Go or Rust today: the parser fails; the class is the scanner\'s.', historical='fails')
bundle_case('b-bom-v2-parser-strips', 'historical', bom_v2, reject('BOM', 0, attempts=[], warnings=[]),
            'Like Python on bytes: it strips the BOM and reads v2; the candidate never relies on that repair.',
            historical=V2)
bom_v1 = BOM + raw(dump(signed(V1)[0]))
bundle_case('b-bom-v1-parser-strips', 'historical', bom_v1, v1_path(warnings=[{'class': 'BOM', 'offset': 0}]),
            'Reads v1 after stripping: delegated as today, with a warning.', historical=V1)
bundle_case('b-bom-v1-parser-fails', 'historical', bom_v1, reject('BOM', 0, attempts=[], warnings=[]),
            'Today\'s parser fails: rejected as today, with the scanner\'s class.', historical='fails')
bad_v1 = raw(dump(signed(V1)[0])).replace(b'doc-1', b'doc-\xff', 1)
bundle_case('b-utf8-v1-parser-repairs', 'historical', bad_v1,
            v1_path(warnings=[{'class': 'UTF8_INVALID', 'offset': at(bad_v1, b'\xff')}]),
            'Like Go or TextDecoder: replaced by U+FFFD and read as v1; delegated as today.', historical=V1)
bad_v2 = raw(base_v2).replace(b'doc-1', b'doc-\xff', 1)
bundle_case('b-utf8-v2-parser-repairs', 'historical', bad_v2,
            reject('UTF8_INVALID', at(bad_v2, b'\xff'), attempts=[], warnings=[]),
            'A repaired reading that says v2 is never admitted as v2.', historical=V2)
bundle_case('b-utf8-unknown-parser-repairs', 'historical', bad_v2,
            reject('UTF8_INVALID', at(bad_v2, b'\xff'), attempts=[], warnings=[]),
            'Whatever other value a repair yields, the class is the scanner\'s, the same in every SDK.',
            historical='other')
text = swap(dump(signed(V1)[0]), '"audit_count":2}', '"audit_count":2,}')
bundle_case('b-syntax-v1-parser-fails', 'historical', text, reject('SYNTAX', at(text, ',}') + 1, attempts=[], warnings=[]),
            'Not a JSON text: every parser fails, the class is SYNTAX.', historical='fails')

# Policy, and the verifier's own configuration.
for case_id, policy, text, expected, why in [
    ('p-v2-only-v1', [V2], dump(signed(V1)[0]), reject('PROFILE_NOT_ACCEPTED', at(dump(signed(V1)[0]), FIELD) + len(FIELD), profile=V1, attempts=[], warnings=[]),
     'Explicit v1 under a v2-only policy.'),
    ('p-v2-v1-order', [V2, V1], base_v2, accepted_v2(manifest_v2), 'The order of the policy list does not select.'),
    ('p-v1-only-unknown', [V1], swap(base_v2, '"dcp-jcs-v2"', '"dcp-jcs-v3"'),
     reject('PROFILE_UNKNOWN', at(base_v2, FIELD) + len(FIELD), attempts=[], warnings=[]), 'Unknown is decided before policy.'),
]:
    bundle_case(case_id, 'policy', text, expected, why, policy=policy)
text = swap(base_v2, '"action":"read"', '"action":"read","action":"read"')
bundle_case('p-v1-only-v2-with-defect', 'policy', text,
            reject('PROFILE_NOT_ACCEPTED', at(text, FIELD) + len(FIELD), profile=V2, attempts=[], warnings=[]),
            'Policy before the ingress class of a v2 unit.', policy=[V1])
bundle_case('p-v2-only-bom-v1-parser-strips', 'policy', bom_v1, reject('PROFILE_NOT_ACCEPTED', profile=V1, attempts=[], warnings=[]),
            'A unit the scanner cannot walk, read as v1 by today\'s parser, under a v2-only policy.',
            policy=[V2], historical=V1)
for case_id, policy, detail in [
    ('cfg-policy-empty', [], 'NOT_A_NON_EMPTY_LIST'),
    ('cfg-policy-string', V1, 'NOT_A_NON_EMPTY_LIST'),
    ('cfg-policy-null-entry', [None], 'NOT_STRINGS'),
    ('cfg-policy-nested-list', [[]], 'NOT_STRINGS'),
    ('cfg-policy-object-entry', [{}], 'NOT_STRINGS'),
    ('cfg-policy-number-entry', [1], 'NOT_STRINGS'),
    ('cfg-policy-repeated', [V1, V1], 'REPEATED'),
    ('cfg-policy-unknown', ['dcp-jcs-v3'], 'UNKNOWN_PROFILE'),
]:
    bundle_case(case_id, 'configuration', base_v2, {'result': 'reject', 'class': 'POLICY_INVALID', 'detail': detail},
                'A verifier configuration error, refused before reading the unit; never a model failure.', policy=policy)
bundle_case('cfg-policy-missing', 'configuration', base_v2, {'result': 'reject', 'class': 'POLICY_INVALID', 'detail': 'MISSING'},
            'No implicit policy: the candidate is enabled only explicitly.', policy=ABSENT)

# Migration and no fallback.
value, _ = signed(V2, sign_profile=V1)
bundle_case('mig-relabel-v1-to-v2', 'migration', dump(value),
            reject('COMMITMENT_MISMATCH', detail='manifest_hash', profile=V2, attempts=[V2], warnings=[]),
            'Signed as v1, relabeled v2: the manifest no longer matches its hash; v1 is not tried.')
value, _ = signed(V1, sign_profile=V2)
bundle_case('mig-relabel-v2-to-v1', 'migration', dump(value), v1_path(),
            'Signed as v2, relabeled v1: delegated to today\'s v1 verifier, which hashes a manifest the producer '
            'did not sign. Its verdict is not computed by this model.')
value, _ = signed(ABSENT, sign_profile=V2)
bundle_case('mig-field-removed-from-v2', 'migration', dump(value), v1_path(),
            'The field removed from a v2 bundle: absent means v1; delegated, never treated as v2.')
value, manifest = signed(V2, payload=dict(PAYLOAD, amount=1))
text = swap(dump(value), '"amount":1,', '"amount":1.0000000000000001,')
bundle_case('mig-no-fallback-out-of-domain', 'migration', text,
            reject('NUMBER_NOT_INTEGER', at(text, '1.0000000000000001'), profile=V2, attempts=[], warnings=[]),
            'Committed as a binary64 reader sees it (1). A v1 retry might pass; the design never retries.')
v1_entries = chain(3)
copied = H(v1_entries[-1])
entries = [{'event': 'continue', 'prev_hash': copied, 'seq': 0}]
value, manifest = signed(V2, entries=entries)
bundle_case('mig-copied-v1-hash', 'migration', dump(value),
            reject('COMMITMENT_MISMATCH', detail='audit_chain', profile=V2, attempts=[V2], warnings=[]),
            'A v1 hash copied as the first prev_hash: the chain starts at GENESIS, so it is a break, not a link.')
value, manifest = signed(V2, entries=chain(3))
bundle_case('mig-new-chain', 'migration', dump(value), accepted_v2(manifest), 'New v2 evidence starts its own chain at GENESIS.')
reference = {'manifest_hash': H({'previous': 'v1 manifest'}), 'profile': V1}
value, manifest = signed(V2, payload=dict(PAYLOAD, previous_evidence=reference))
bundle_case('mig-reference-is-data', 'migration', dump(value), accepted_v2(manifest),
            'A reference to earlier v1 evidence is accepted as data; it identifies, it does not verify.')
entries = chain(3)
entries[2] = dict(entries[2], prev_hash=entries[1]['prev_hash'])
value, manifest = signed(V2, entries=entries)
bundle_case('mig-chain-break', 'migration', dump(value),
            reject('COMMITMENT_MISMATCH', detail='audit_chain', profile=V2, attempts=[V2], warnings=[]), 'A broken link.')
value, manifest = signed(V2)
value['bundle']['intent']['payload_hash'] = H({'other': 1})
bundle_case('mig-payload-hash', 'migration', dump(value),
            reject('COMMITMENT_MISMATCH', detail='payload_hash', profile=V2, attempts=[V2], warnings=[]), 'A wrong payload hash.')

# The same clean bundle through each transport gives the same manifest hash.
bundle_case('b-v2-envelope', 'transport', ENV + base_v2 + '}', dict(accepted_v2(manifest_v2), unit=[17, 17 + len(raw(base_v2))]),
            'Enveloped: the same unit bytes, the same result.', transport='envelope')
bundle_case('b-envelope-unit-not-object', 'transport', ENV + '"' + base_v2.replace('"', '\\"') + '"}', v1_path(),
            'A bundle sent as a JSON string: the unit is a string, with no field; delegated (today\'s verifier refuses it).',
            transport='envelope')

# ── 6. The r2 corpus, kept by reference ──────────────────────────────────────────────────────────

r2_bytes = (ROOT / R2).read_bytes()
r2 = json.loads(r2_bytes)
for index, sel in enumerate(r2['profile_selection_cases']):
    token = sel['manifest_field_json']
    profile = ABSENT if token is None else json.loads(token)
    known = token is None or profile in (V1, V2)
    value, manifest = signed(profile if known else V1)
    text = dump(value)
    if not known:
        text = swap(text, FIELD + '"dcp-jcs-v1"', FIELD + token)
    if sel['expected'] == V1:
        expected = v1_path()
    elif sel['expected'] == V2:
        expected = accepted_v2(manifest)
    else:
        expected = reject('PROFILE_UNKNOWN', at(text, FIELD) + len(FIELD), attempts=[], warnings=[])
    bundle_case(f'o-sel-{index:02d}', 'r2-selection', text, expected,
                f'r2 profile_selection_cases[{index}] ({sel["note"]}), on a synthetic bundle.',
                maps_original={'list': 'profile_selection_cases', 'index': index, 'r2': sel})
for index, pol in enumerate(r2['policy_cases']):
    token = pol['manifest_field_json']
    value, manifest = signed(ABSENT if token is None else json.loads(token))
    text = dump(value)
    if pol['expected'] == V2:
        expected = accepted_v2(manifest)
    else:
        offset = None if token is None else at(text, FIELD) + len(FIELD)
        expected = reject('PROFILE_NOT_ACCEPTED', offset, profile=V2 if token else V1, attempts=[], warnings=[])
    same = {'same_input_as': 'o-sel-02'} if index == 2 else {}  # r2 lists this situation in both lists
    bundle_case(f'o-pol-{index}', 'r2-policy', text, expected, f'r2 policy_cases[{index}], on a synthetic bundle.',
                policy=pol['accepted_profiles'], maps_original={'list': 'policy_cases', 'index': index, 'r2': pol}, **same)

corpus = {
    'title': 'DCP-AI canonicalization candidate: design corpus',
    'status': 'NON-NORMATIVE DESIGN CORPUS. Not a conformance requirement; no SDK implements or accepts dcp-jcs-v2.',
    'candidate_profile': V2,
    'design': 'docs/proposals/canonicalization-candidate/README.md',
    'corpus_revision': 'design-2',
    'provenance': {
        'approved_corpus_sha256': '6dcee1f0bf14d8342928ed12136010033b911643189cc64b5e0039ede9bfc475',
        'approved_baseline_sha256': 'c0400691004f8e366a1cb4f581b87e44fdcdc46cdcfd8bc49e2f4ef2024734c9',
        'note': 'Same cases, mappings, revisions and expectations as the approved design-2 corpus; only the '
                'paths, this field and the hash of the baseline copy differ.',
    },
    'date': '2026-10-24',
    'how_to_read': {
        'file': 'ASCII JSON. Decode it with any JSON parser first.',
        'input_json / input_hex': 'The exact input bytes: UTF-8 of input_json, or hex when not UTF-8 or starting with a BOM.',
        'mode': 'document: one unit, ingress and canonical output. bundle: a synthetic signed bundle through '
                'transport, selection, policy and the candidate path.',
        'transport': 'bare: the input is the unit. envelope: the unit is the one "signed_bundle" member of the input.',
        'expected.offset': 'Byte offset relative to the unit. transport_offset is relative to the whole input.',
        'expected.result': 'accept (document), accept_v2, v1_path (delegated to today\'s dcp-jcs-v1 verifier; '
                           'its verdict is not computed), reject.',
        'historical': 'Only for units the scanner cannot walk: what today\'s parser of an SDK does (fails, or the '
                      'profile value it reads).',
        'policy': 'accepted_canonicalization_profiles; every bundle case states it. No default.',
        'options.depth_scope': '"transport" reproduces the v0.3 rule, for comparison only.',
        'why': 'The rule the expectation applies, written by hand.',
    },
    'original_corpus': {
        'path': R2,
        'sha256': hashlib.sha256(r2_bytes).hexdigest(),
        'corpus_revision': r2['corpus_revision'],
        'cases': [{'id': c['id'], 'input_sha256': c['input_sha256']} for c in r2['cases']],
        'profile_selection_cases': len(r2['profile_selection_cases']),
        'policy_cases': len(r2['policy_cases']),
        'run_as': 'document mode, bare transport, with the r2 expectations',
    },
    'expectation_revisions': [],
    'scope_revisions': [
        {'what': 'max_depth_scope',
         'r2': r2['domain']['max_depth_scope'],
         'design': 'Counted from the root of the validated unit (the signed bundle bytes), never over a transport envelope.',
         'effect_on_r2_cases': 'None: every r2 case is a bare unit.'},
    ],
    'cases': cases,
}

out = pathlib.Path(sys.argv[1])
out.write_text(json.dumps(corpus, indent=1, ensure_ascii=True) + '\n')
print(f'{len(cases)} design cases, {len(r2["cases"])} original cases by reference -> {out}')
