"""Independent checker of tests/interop/v2/ed25519_ped1_vectors.json (MP-02 F5a). Review tooling, never production.

Shares no code with tools/ed25519-review/generate_ped1_vectors.py or with the affine model it loads. It uses its own
arithmetic in extended coordinates (RFC 8032 § 5.1.4 formulas) and its own decoding (RFC 8032 § 5.1.3, strict, plus
a lenient variant that reduces y mod p and takes x = 0 with any sign bit). It decides canonicity by strict decoding
(round trip) rather than by the byte rule, small order by [8]P = O, and derives E[8] by collecting distinct [L]Q.

It checks the corpus against its layout, not only the cases present: the exact sets of sections, ids, keys and
bytes per family; exact JSON types (a 1 is not a true); every predicate of every case recomputed from its bytes;
the controls over the same bytes; and the negative controls.

Exit codes: 0 the corpus passes; 1 the corpus is rejected (a complete JSON report on stdout, "pass": false);
2 the checker could not run (unreadable input, internal error): never a verdict on the corpus.
Usage, from the repository root: python3 -I tools/ed25519-review/check_ped1_vectors.py [VECTORS] [OUT.json]
"""
import hashlib
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

p = 2**255 - 19
q = 2**252 + 27742317777372353535851937790883648493  # the group order L
d = -121665 * pow(121666, p - 2, p) % p
SQRT_M1 = pow(2, (p - 1) // 4, p)
O = (0, 1, 1, 0)


def add(P, Q):
    a = (P[1] - P[0]) * (Q[1] - Q[0]) % p
    b = (P[1] + P[0]) * (Q[1] + Q[0]) % p
    c = 2 * P[3] * Q[3] * d % p
    dd = 2 * P[2] * Q[2] % p
    e, f, g, h = b - a, dd - c, dd + c, b + a
    return (e * f % p, g * h % p, f * g % p, e * h % p)


def mul(s, P):
    Q = O
    while s > 0:
        if s & 1:
            Q = add(Q, P)
        P = add(P, P)
        s >>= 1
    return Q


def eq(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % p == 0


def negate(P):
    return ((-P[0]) % p, P[1], P[2], (-P[3]) % p)


def decode(raw, strict):
    """RFC 8032 § 5.1.3. strict: y >= p, and x = 0 with the sign bit, fail; lenient: y mod p, x = 0 kept."""
    if len(raw) != 32:
        return None
    n = int.from_bytes(raw, 'little')
    y, sign = n & ((1 << 255) - 1), n >> 255
    if y >= p:
        if strict:
            return None
        y -= p
    u, v = (y * y - 1) % p, (d * y * y + 1) % p
    x = u * pow(v, 3, p) * pow(u * pow(v, 7, p), (p - 5) // 8, p) % p
    if (v * x * x - u) % p:
        if (v * x * x + u) % p:
            return None
        x = x * SQRT_M1 % p
    if x == 0 and sign:
        if strict:
            return None
        return (0, y, 1, 0)
    if x & 1 != sign:
        x = p - x
    return (x, y, 1, x * y % p)


def encode(P):
    zi = pow(P[2], p - 2, p)
    x, y = P[0] * zi % p, P[1] * zi % p
    return (y | (x & 1) << 255).to_bytes(32, 'little')


B = decode(bytes.fromhex('5866666666666666666666666666666666666666666666666666666666666666'), True)
assert B is not None and eq(mul(q, B), O) and not eq(B, O)


def le(n):
    return n.to_bytes(32, 'little')


def canonical(raw):
    """Canonical by round trip when the bytes decode; otherwise only y < p can be said of them."""
    lenient = decode(raw, False)
    if lenient is not None:
        return decode(raw, True) is not None and encode(lenient) == raw
    return int.from_bytes(raw, 'little') & ((1 << 255) - 1) < p


def is_small(P):
    return P is not None and eq(mul(8, P), O)


def point_order(P):
    return next(n for n in (1, 2, 4, 8) if eq(mul(n, P), O))


def prime_subgroup(P):
    return P is not None and eq(mul(q, P), O)


# E[8] by another route than the generator's: collect distinct [L]Q over decoded points Q until there are 8.
def _small_order_points():
    found = {}
    for seed in range(2, 10000):
        Q = decode(le(seed), True)
        if Q is None:
            continue
        T = mul(q, Q)
        found.setdefault(encode(T), T)
        if len(found) == 8:
            return found
    raise AssertionError('E[8] not collected')


E8 = _small_order_points()  # canonical encoding -> point
assert all(is_small(T) for T in E8.values())
E8_LABEL = {}
for enc_, T in E8.items():
    h = enc_.hex()
    E8_LABEL[f'order-{point_order(T)}-{h[:8]}-{h[-2:]}'] = enc_
IDENTITY_ENC = le(1)

# The non-canonical encodings of E[8], by name (the corpus layout), checked against an enumeration below.
NC = {'y-p': le(p), 'y-p-sign': le(p | 1 << 255), 'y-p-plus-1': le(p + 1), 'y-p-plus-1-sign': le((p + 1) | 1 << 255),
      'identity-sign': le(1 | 1 << 255), 'order-2-sign': le((p - 1) | 1 << 255)}
Y_AT_LEAST_P = {f'encoding/y-p-plus-{v}' + ('-sign' if s else ''): le((p + v) | s << 255)
                for v in range(19) for s in (0, 1)}
ZERO_X = {'encoding/identity-sign': NC['identity-sign'], 'encoding/order-2-sign': NC['order-2-sign']}
_nc_small = {raw for raw in list(Y_AT_LEAST_P.values()) + list(ZERO_X.values()) if is_small(decode(raw, False))}
assert _nc_small == set(NC.values()), 'the named non-canonical encodings of E[8] are not the enumerated ones'

CONDITIONS = ['s_range', 'a_encoding', 'r_encoding', 'a_small_order', 'r_small_order', 'equation']
PREDICATES = ['lengths_valid', 's_below_l', 'a_decodes', 'r_decodes', 'a_canonical', 'r_canonical', 'a_small_order',
              'r_small_order', 'equation_points', 'equation_full_challenge', 'equation_cofactored', 'bytes_match',
              'accept', 'failing', 'kind']
LENGTH_PREDICATES = ['lengths_valid', 'accept', 'failing', 'kind']
POSITIVES = ['signature/rfc8032-test1-empty', 'signature/rfc8032-test2-one-byte', 'signature/rfc8032-test3-two-bytes',
             'signature/public-key-mixed-order-k-multiple-of-8', 'signature/ped1-mixed-a-and-r-cancel-reduced',
             'signature/normal-key']
TOP = {'title': str, 'design': str, 'criterion': str, 'scope': str, 'generated_by': str, 'checked_by': str,
       'sources_sha256': dict, 'copied_fixture': str, 'predicates': dict, 'constants': dict, 'historical': list,
       'encodings': list, 'signatures': list, 'objects': dict, 'composite': dict}


def evaluate(pk, sig, msg, lenient_policy=False):
    out = {'lengths_valid': len(pk) == 32 and len(sig) == 64}
    if not out['lengths_valid']:
        return {**out, 'accept': False, 'failing': ['lengths'], 'kind': 'length'}
    rb, s = sig[:32], int.from_bytes(sig[32:], 'little')
    A, R = decode(pk, False), decode(rb, False)
    kf = int.from_bytes(hashlib.sha512(rb + pk + msg).digest(), 'little')
    k = kf % q
    both = A is not None and R is not None
    sB = mul(s, B)
    out.update({
        's_below_l': s < q,
        'a_decodes': A is not None,
        'r_decodes': R is not None,
        'a_canonical': canonical(pk),
        'r_canonical': canonical(rb),
        'a_small_order': is_small(A),
        'r_small_order': is_small(R),
        'equation_points': both and eq(sB, add(R, mul(k, A))),
        'equation_full_challenge': both and eq(sB, add(R, mul(kf, A))),
        'equation_cofactored': both and eq(mul(8, sB), mul(8, add(R, mul(k, A)))),
        'bytes_match': A is not None and encode(add(sB, negate(mul(k, A)))) == rb,
    })
    checks = [('s_range', out['s_below_l']), ('a_encoding', out['a_decodes'] and out['a_canonical']),
              ('r_encoding', out['r_decodes'] and out['r_canonical']), ('a_small_order', not out['a_small_order']),
              ('r_small_order', not out['r_small_order']), ('equation', out['equation_points'])]
    if lenient_policy:  # the lenient control: conditions 1 to 3 off, only the equation on the decoded points
        checks = [c for c in checks if c[0] == 'equation']
    failing = [name for name, ok in checks if not ok]
    out['accept'] = not failing
    out['failing'] = failing
    out['kind'] = 'accept' if not failing else 'isolated' if len(failing) == 1 else 'combined'
    return out


def same(a, b):
    """Equality with exact JSON types: 1 is not true, 1.0 is not 1."""
    if type(a) is not type(b):
        return False
    if isinstance(a, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    return a == b


def is_hex(x, nbytes=None):
    return (type(x) is str and len(x) % 2 == 0 and x == x.lower() and all(c in '0123456789abcdef' for c in x)
            and (nbytes is None or len(x) == 2 * nbytes))


def alter(msg):
    return msg[:-1] + bytes([msg[-1] ^ 1]) if msg else b'\x01'


class Checker:
    def __init__(self):
        self.problems = []

    def check(self, cond, what):
        if not cond:
            self.problems.append(what)
        return bool(cond)

    def case_shape(self, c, base, extra=()):
        """Exact keys and types of a signature-like case; True when its bytes can be evaluated."""
        if not self.check(type(c) is dict, 'a case is not an object'):
            return False
        cid = c.get('id')
        if not self.check(type(cid) is str, f'a case id is not a string: {cid!r}'):
            return False
        ok = all(self.check(is_hex(c.get(k)), f'{cid}: {k} is not lowercase hex') for k in
                 ('public_key_hex', 'signature_hex', 'message_hex'))
        if not ok:
            return False
        lengths = len(c['public_key_hex']) == 64 and len(c['signature_hex']) == 128
        expected = set(base) | set(extra) | set(PREDICATES if lengths else LENGTH_PREDICATES)
        self.check(set(c) == expected, f'{cid}: keys {sorted(set(c) ^ expected)} missing or unknown')
        if 'construction' in base:
            self.check(type(c.get('construction')) is str and c.get('construction'), f'{cid}: construction')
        if 'search_counter' in extra:
            self.check(type(c.get('search_counter')) is int and c.get('search_counter') >= 0, f'{cid}: search_counter')
        if 's_high_bits_clear' in extra:
            self.check(type(c.get('s_high_bits_clear')) is bool, f'{cid}: s_high_bits_clear is not a boolean')
        return True

    def predicates(self, c, msg=None):
        pk, sig, m = (bytes.fromhex(c[k]) for k in ('public_key_hex', 'signature_hex', 'message_hex'))
        got = evaluate(pk, sig, m if msg is None else msg)
        for key, value in got.items():
            self.check(same(c.get(key), value), f"{c['id']}: {key} is {c.get(key)!r}, the checker finds {value!r}")
        return got

    def exact_ids(self, cases, expected, section):
        ids = [c.get('id') for c in cases if type(c) is dict]
        self.check(len(ids) == len(cases), f'{section}: a case is not an object')
        self.check(all(type(i) is str for i in ids), f'{section}: an id is not a string')
        ids = [i for i in ids if type(i) is str]
        self.check(len(ids) == len(set(ids)), f'{section}: duplicate ids')
        missing, unknown = set(expected) - set(ids), set(ids) - set(expected)
        self.check(not missing, f'{section}: missing {sorted(missing)}')
        self.check(not unknown, f'{section}: unknown {sorted(unknown)}')
        return {c['id']: c for c in cases if type(c) is dict and type(c.get('id')) is str and c['id'] in expected}

    def run(self, v):
        if not self.check(type(v) is dict, 'the corpus is not a JSON object'):
            return
        self.check(set(v) == set(TOP), f'top-level keys {sorted(set(v) ^ set(TOP))} missing or unknown')
        bad = [k for k, t in TOP.items() if type(v.get(k)) is not t]
        if not self.check(not bad, f'top-level members of the wrong type: {bad}'):
            return
        self.sources(v)
        self.constants(v['constants'])
        hist = self.historical(v['historical'])
        self.encodings(v['encodings'], v['signatures'])
        sigs = self.signatures(v['signatures'], hist)
        objs = self.objects(v['objects'])
        comp = self.composite(v['composite'])
        self.controls([c for c in list(hist.values()) + list(sigs.values()) + objs + comp])

    def sources(self, v):
        s = v['sources_sha256']
        expected = {k: hashlib.sha256((ROOT / k).read_bytes()).hexdigest() for k in
                    ('tools/ed25519-review/check_equations_independent.py', 'tools/ed25519-review/corpus.json')}
        self.check(same(s, expected), 'sources_sha256 are not the hashes of the model and the historical corpus')

    def constants(self, c):
        self.check(set(c) == {'p_le_hex', 'l_le_hex', 'small_order_encodings_hex'}, 'constants: keys')
        self.check(same(c.get('p_le_hex'), le(p).hex()) and same(c.get('l_le_hex'), le(q).hex()), 'constants: p or L')
        self.check(same(c.get('small_order_encodings_hex'), sorted(e.hex() for e in E8)),
                   'constants: small_order_encodings_hex is not exactly the 8 encodings of E[8], sorted')

    def historical(self, cases):
        frozen = json.loads((ROOT / 'tools/ed25519-review/corpus.json').read_text())['cases']
        got = self.exact_ids(cases, [h['id'] for h in frozen], 'historical')
        self.check([c.get('id') for c in cases if type(c) is dict] == [h['id'] for h in frozen], 'historical: order')
        for h in frozen:
            c = got.get(h['id'])
            if c is None or not self.case_shape(c, ('id', 'historical_category', 'public_key_hex', 'signature_hex',
                                                    'message_hex')):
                continue
            self.check(all(same(c[k], h[k]) for k in ('public_key_hex', 'signature_hex', 'message_hex')) and
                       same(c['historical_category'], h['category']), f"{h['id']}: not the frozen bytes")
            self.predicates(c)
        return got

    def encodings(self, rows, signatures):
        expected = {**Y_AT_LEAST_P, **ZERO_X, **{f'encoding/{lab}': e for lab, e in E8_LABEL.items()}}
        controls = ['encoding/basepoint', 'encoding/mixed-order-point', 'encoding/normal-point', 'encoding/not-on-curve']
        got = self.exact_ids(rows, list(expected) + controls, 'encodings')
        family = {**{k: 'y-at-least-p' for k in Y_AT_LEAST_P}, **{k: 'zero-x-sign-bit' for k in ZERO_X},
                  **{f'encoding/{lab}': 'small-order' for lab in E8_LABEL}, **{k: 'control' for k in controls}}
        for eid, e in got.items():
            keys = {'id', 'family', 'encoding_hex', 'canonical_rule', 'decodes', 'small_order', 'order'}
            if not self.check(set(e) == keys and is_hex(e.get('encoding_hex'), 32), f'{eid}: keys or encoding'):
                continue
            raw = bytes.fromhex(e['encoding_hex'])
            self.check(same(e['family'], family[eid]), f'{eid}: family')
            if eid in expected:
                self.check(raw == expected[eid], f'{eid}: not the bytes its id names')
            P = decode(raw, False)
            self.check(same(e['decodes'], P is not None), f'{eid}: decodes')
            self.check(same(e['canonical_rule'], canonical(raw)), f'{eid}: canonical_rule')
            self.check(same(e['small_order'], None if P is None else is_small(P)), f'{eid}: small_order')
            order = None if P is None else point_order(P) if is_small(P) else 'not small'
            self.check(same(e['order'], order), f'{eid}: order')
        every = [r.get('encoding_hex') for r in rows if type(r) is dict and is_hex(r.get('encoding_hex'), 32)]
        self.check(len(every) == len(set(every)), 'encodings: the same bytes appear twice')
        self.control_points(got, signatures)

    def control_points(self, got, signatures):
        def point(eid):
            e = got.get(eid)
            return bytes.fromhex(e['encoding_hex']) if e and is_hex(e.get('encoding_hex'), 32) else None
        self.check(point('encoding/basepoint') == encode(B), 'encoding/basepoint is not B')
        mixed = next((s for s in signatures if type(s) is dict
                      and s.get('id') == 'signature/ped1-mixed-a-and-r-cancel-reduced'), {})
        raw = point('encoding/mixed-order-point')
        P = decode(raw, True) if raw else None
        self.check(raw is not None and raw.hex() == mixed.get('public_key_hex') and P is not None and not is_small(P)
                   and not prime_subgroup(P), 'encoding/mixed-order-point is not the mixed A of the positive')
        raw = point('encoding/normal-point')
        P = decode(raw, True) if raw else None
        self.check(P is not None and prime_subgroup(P) and not eq(P, O), 'encoding/normal-point is not of order L')
        raw = point('encoding/not-on-curve')
        self.check(raw is not None and decode(raw, False) is None and canonical(raw),
                   'encoding/not-on-curve: not a y < p that does not decode')

    def signatures(self, cases, hist):
        nc_ids = {f'signature/{side}-non-canonical-small-order/{n}': (side, raw) for n, raw in NC.items()
                  for side in ('a', 'r')}
        small_ids = {f'signature/{side}-small-order/{lab}': (side, e) for lab, e in E8_LABEL.items() for side in ('a', 'r')}
        altered_ids = {f'{x}/message-altered': x for x in POSITIVES}
        expected = POSITIVES + list(altered_ids) + ['signature/normal-key-s-plus-l'] + list(small_ids) + list(nc_ids)
        got = self.exact_ids(cases, expected, 'signatures')
        base = ('id', 'public_key_hex', 'signature_hex', 'message_hex', 'construction')
        ok = {}
        for cid, c in got.items():
            extra = (('control_of',) if cid in altered_ids else ('search_counter',) if cid in small_ids or cid in nc_ids
                     else ('s_high_bits_clear',) if cid == 'signature/normal-key-s-plus-l' else ())
            if self.case_shape(c, base, extra):
                ok[cid] = c
                self.predicates(c)
        b = {k: tuple(bytes.fromhex(c[f]) for f in ('public_key_hex', 'signature_hex', 'message_hex'))
             for k, c in ok.items()}
        for x in POSITIVES:
            self.check(ok.get(x, {}).get('accept') is True, f'{x}: the positive is not accepted')
        for hid in ('rfc8032-test1-empty', 'rfc8032-test2-one-byte', 'rfc8032-test3-two-bytes',
                    'public-key-mixed-order-k-multiple-of-8'):
            h, s = hist.get(hid), ok.get(f'signature/{hid}')
            self.check(h is not None and s is not None and all(same(h.get(k), s[k]) for k in
                       ('public_key_hex', 'signature_hex', 'message_hex')), f'signature/{hid}: not the historical bytes')
        for aid, x in altered_ids.items():
            if aid in b and x in b:
                self.check(b[aid][:2] == b[x][:2] and b[aid][2] == alter(b[x][2]) and same(ok[aid]['control_of'], x)
                           and same(ok[aid]['failing'], ['equation']), f'{aid}: not its positive with the message altered')
        normal = b.get('signature/normal-key')
        synthetic = ['signature/normal-key-s-plus-l'] + list(small_ids) + list(nc_ids)
        for cid in synthetic:
            if cid in b and normal:
                self.check(b[cid][2] == normal[2], f'{cid}: not the message of its control signature/normal-key')
        sp = b.get('signature/normal-key-s-plus-l')
        if sp and normal:
            s_plus = int.from_bytes(normal[1][32:], 'little') + q
            self.check(sp[0] == normal[0] and sp[1][:32] == normal[1][:32] and int.from_bytes(sp[1][32:], 'little') == s_plus
                       and same(ok['signature/normal-key-s-plus-l']['failing'], ['s_range'])
                       and same(ok['signature/normal-key-s-plus-l']['s_high_bits_clear'], s_plus < 1 << 253),
                       'signature/normal-key-s-plus-l: not signature/normal-key with S + L, failing on the range only')
        for cid, (side, raw) in small_ids.items():
            if cid in b:
                part = b[cid][0] if side == 'a' else b[cid][1][:32]
                self.check(part == raw and same(ok[cid]['failing'], [f'{side}_small_order']),
                           f'{cid}: not the point of E[8] its id names, isolated on {side}_small_order')
        for cid, (side, raw) in nc_ids.items():
            if cid in b:
                part = b[cid][0] if side == 'a' else b[cid][1][:32]
                self.check(part == raw and same(ok[cid]['failing'], [f'{side}_encoding', f'{side}_small_order']),
                           f'{cid}: not the non-canonical encoding its id names, failing on encoding and order')
                if side == 'r':
                    self.check(ok[cid]['equation_points'] is True and ok[cid]['bytes_match'] is False,
                               f'{cid}: expected the equation without the bytes match')
        return ok

    def objects(self, o):
        cases = []
        if not self.check(set(o) == {'object', 'canonical_hex', 'cases'} and type(o.get('cases')) is list
                          and is_hex(o.get('canonical_hex')), 'objects: keys or types'):
            return cases
        canonical_bytes = json.dumps(o['object'], sort_keys=True, separators=(',', ':')).encode()
        self.check(same(o['object'], {'dcp_ped1': 'v1-object', 'n': 1}) and o['canonical_hex'] == canonical_bytes.hex(),
                   'objects: object or canonical bytes')
        ids = ['object/normal-key', 'object/a-small-order', 'object/r-small-order', 'object/r-identity']
        got = self.exact_ids(o['cases'], ids, 'objects')
        searched = {'object/a-small-order', 'object/r-small-order'}
        for cid, c in got.items():
            if not self.case_shape(c, ('id', 'public_key_hex', 'signature_hex', 'message_hex', 'construction'),
                                   ('search_counter',) if cid in searched else ()):
                continue
            cases.append(c)
            self.predicates(c)
            self.check(c['message_hex'] == o['canonical_hex'], f'{cid}: not over the canonical object bytes')
            A, R = decode(bytes.fromhex(c['public_key_hex']), True), decode(bytes.fromhex(c['signature_hex'][:64]), True)
            expect = {'object/normal-key': c['accept'] is True,
                      'object/a-small-order': same(c['failing'], ['a_small_order']) and A is not None and point_order(A) == 8,
                      'object/r-small-order': same(c['failing'], ['r_small_order']) and R is not None and point_order(R) == 8
                      and A is not None and not is_small(A) and not prime_subgroup(A),
                      'object/r-identity': same(c['failing'], ['r_small_order']) and c['signature_hex'][:64] == IDENTITY_ENC.hex()
                      and A is not None and prime_subgroup(A) and not eq(A, O)}
            self.check(expect[cid], f'{cid}: not the case its id names')
        return cases

    def composite(self, cp):
        cases = []
        if not self.check(set(cp) == {'context', 'payload_canonical', 'dsm_hex', 'cases'} and type(cp.get('cases')) is list
                          and type(cp.get('context')) is str and type(cp.get('payload_canonical')) is str
                          and is_hex(cp.get('dsm_hex')), 'composite: keys or types'):
            return cases
        dsm = cp['context'].encode() + b'\x00' + cp['payload_canonical'].encode()
        self.check(cp['dsm_hex'] == dsm.hex() and cp['context'].startswith('DCP-AI.v2.') and '\x00' not in cp['context'],
                   'composite: the DSM is not context || 0x00 || payload')
        got = self.exact_ids(cp['cases'], ['composite/normal-key', 'composite/a-small-order'], 'composite')
        for cid, c in got.items():
            if not self.case_shape(c, ('id', 'public_key_hex', 'signature_hex', 'message_hex', 'construction'),
                                   ('search_counter',) if cid == 'composite/a-small-order' else ()):
                continue
            cases.append(c)
            self.predicates(c)
            self.check(c['message_hex'] == cp['dsm_hex'], f'{cid}: not over the DSM')
            A = decode(bytes.fromhex(c['public_key_hex']), True)
            self.check(c['accept'] is True if cid == 'composite/normal-key' else
                       same(c['failing'], ['a_small_order']) and A is not None and point_order(A) == 8,
                       f'{cid}: not the case its id names')
        return cases

    def controls(self, cases):
        accepted = [c for c in cases if c.get('accept') is True]
        for c in accepted:
            pk, sig, m = (bytes.fromhex(c[k]) for k in ('public_key_hex', 'signature_hex', 'message_hex'))
            self.check(evaluate(pk, sig, m + b'!')['accept'] is False, f"{c['id']}: still accepted with an altered message")
        policy_only = [c for c in cases if c.get('kind') in ('isolated', 'combined') and 'equation' not in c.get('failing', [])]
        for c in policy_only:
            pk, sig, m = (bytes.fromhex(c[k]) for k in ('public_key_hex', 'signature_hex', 'message_hex'))
            self.check(evaluate(pk, sig, m, lenient_policy=True)['accept'] is True,
                       f"{c['id']}: not accepted by the lenient control")
        self.counts = {'altered_message_rejected': len(accepted), 'lenient_control_accepts': len(policy_only)}


def local_cross_checks(checker, v):
    """Local review evidence, when present (.claude is not in the repository): the Codex fixtures."""
    if type(v) is not dict:
        return
    local = ROOT / '.claude/mp02-20261107'
    sigs = ({c['id']: c for c in v['signatures'] if type(c) is dict and type(c.get('id')) is str}
            if type(v.get('signatures')) is list else {})
    fx = local / 'f5-mixed-a-and-r-positive.json'
    if fx.exists():
        f, s = json.loads(fx.read_text()), sigs.get('signature/ped1-mixed-a-and-r-cancel-reduced', {})
        checker.cross['mixed_fixture_bytes_equal'] = all(f[k] == s.get(k) for k in
                                                         ('public_key_hex', 'signature_hex', 'message_hex'))
    mr = local / 'f5-ped1-independent-model-results.json'
    if mr.exists() and type(v.get('historical')) is list:
        m = {r['id']: r['accept'] for r in json.loads(mr.read_text())['observations']}
        checker.cross['historical_accept_equals_codex_model'] = all(
            type(c) is dict and m.get(c.get('id')) is c.get('accept') for c in v['historical'])
    so = local / 'f5-small-order-independent-review.json'
    if so.exists() and type(v.get('constants')) is dict:
        checker.cross['small_order_equals_codex_review'] = (
            sorted(json.loads(so.read_text())['points']) == v['constants'].get('small_order_encodings_hex'))
    for name, ok in checker.cross.items():
        checker.check(ok, f'local cross-check failed: {name}')


def main(argv):
    vectors = Path(argv[1]) if len(argv) > 1 else ROOT / 'tests/interop/v2/ed25519_ped1_vectors.json'
    out = Path(argv[2]) if len(argv) > 2 else None
    data = vectors.read_bytes()  # an unreadable input is not a verdict: it raises, exit 2
    checker = Checker()
    checker.counts, checker.cross = {}, {}
    v = None
    try:
        v = json.loads(data)
    except ValueError as e:
        checker.problems.append(f'not JSON: {e}')
    else:
        checker.run(v)
        local_cross_checks(checker, v)
    report = {'vectors': str(vectors), 'vectors_sha256': hashlib.sha256(data).hexdigest(),
              'checker_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'controls': checker.counts, 'local_cross_checks': checker.cross,
              'problems': checker.problems, 'pass': not checker.problems}
    text = json.dumps(report, indent=1) + '\n'
    if out:
        out.write_text(text)
    sys.stdout.write(text)
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Exception:  # an internal or input error is never a verdict on the corpus
        traceback.print_exc()
        sys.exit(2)
